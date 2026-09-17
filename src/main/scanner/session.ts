/**
 * Owns the connection to one scanner: opens the transport, runs the polling
 * loop, and publishes snapshots. Electron-free so it can be unit tested.
 */
import {
  getActiveChannel,
  getLcd,
  getStatus,
  getVersion,
  parseActiveChannel,
  parseLcd,
  parseStatus,
  parseVersion,
  sendKey,
  type ActiveChannel,
  type Frame,
  type Lcd,
  type Status,
  type Version,
} from '@trxcontroller/rcip';
import type { LinkStatus, ScannerSnapshot } from '../../shared/ipc';
import { ScannerLink } from './link';
import { resumeScan as resumeScanMacro, tuneTo as tuneToMacro, type MacroHost } from './macros';
import type { Transport, TransportFactory } from './transport';
import { DEFAULT_LOOKUPS } from '../../shared/sources';

export interface SessionOptions {
  /** Delay between the end of one poll cycle and the start of the next. */
  pollIntervalMs?: number;
  /** The same delay while the scanner is not answering, so a stall queues fewer requests. */
  stalledPollIntervalMs?: number;
  /** Poll the active channel every N cycles while squelch is closed. */
  activeEveryNCycles?: number;
  /** Consecutive timeouts before the link is reported unresponsive. */
  unresponsiveAfter?: number;
  timeoutMs?: number;
  onSnapshot?: (s: ScannerSnapshot) => void;
  onCcDump?: (line: string) => void;
  log?: (msg: string) => void;
}

export class ScannerSession {
  private link: ScannerLink | null = null;
  private transport: Transport | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private cycle = 0;
  private noiseText = '';
  private snapshot: ScannerSnapshot = emptySnapshot();
  private readonly pollIntervalMs: number;
  private readonly stalledPollIntervalMs: number;
  private readonly activeEveryNCycles: number;
  private readonly unresponsiveAfter: number;

  constructor(
    private readonly factory: TransportFactory,
    private readonly opts: SessionOptions = {},
  ) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 150;
    this.stalledPollIntervalMs = opts.stalledPollIntervalMs ?? 1000;
    this.activeEveryNCycles = opts.activeEveryNCycles ?? 4;
    this.unresponsiveAfter = opts.unresponsiveAfter ?? 5;
  }

  getSnapshot(): ScannerSnapshot {
    return this.snapshot;
  }

  async connect(path: string): Promise<void> {
    await this.disconnect();
    this.setLink('connecting', path, null);
    try {
      this.transport = await this.factory.open(path);
    } catch (err) {
      this.setLink('error', path, (err as Error).message);
      throw err;
    }
    this.transport.onError((err) => {
      this.opts.log?.(`transport error: ${err.message}`);
      this.setLink('error', path, err.message);
      void this.disconnect(false);
    });
    this.transport.onClose(() => {
      if (this.snapshot.link.status !== 'disconnected' && this.snapshot.link.status !== 'error') {
        this.setLink('error', path, 'Port closed');
      }
      void this.disconnect(false);
    });
    this.link = new ScannerLink(this.transport, {
      timeoutMs: this.opts.timeoutMs,
      onNoise: (b) => this.onNoise(b),
      onFrameError: (m) => this.opts.log?.(`frame error: ${m}`),
      onUnexpectedFrame: (f, late) => this.applyFrame(f, late),
    });

    const v = await this.link.request(getVersion(), 'V');
    if (!v) {
      await this.disconnect(false);
      this.setLink('error', path, 'No response to version request');
      throw new Error('Scanner did not answer the version request');
    }
    this.snapshot = { ...this.snapshot, version: safe(() => parseVersion(v.data)) ?? null };
    this.setLink('connected', path, null);
    this.startPolling();
  }

  async disconnect(publish = true): Promise<void> {
    this.stopPolling();
    const link = this.link;
    this.link = null;
    this.transport = null;
    if (link) await link.close().catch(() => undefined);
    if (publish) {
      this.snapshot = { ...emptySnapshot(), updatedAt: Date.now() };
      this.publish();
    }
  }

  async pressKey(code: number): Promise<void> {
    if (!this.link) throw new Error('Not connected');
    await this.link.send(sendKey(code));
    // Refresh the display straight away so the UI reflects the key press.
    await this.pollOnce(true);
  }

  /** Reach Tune Mode through the menus and enter `hz`; see macros.ts. */
  tuneTo(hz: number): Promise<void> {
    return this.runMacro((host) => tuneToMacro(host, hz));
  }

  /** Main Menu > Scan. */
  resumeScan(): Promise<void> {
    return this.runMacro(resumeScanMacro);
  }

  private macroRunning = false;

  /** One key sequence at a time: two macros interleaving would confuse both. */
  private async runMacro<T>(fn: (host: MacroHost) => Promise<T>): Promise<T> {
    if (!this.link) throw new Error('Not connected');
    if (this.macroRunning) throw new Error('Another key sequence is still running');
    this.macroRunning = true;
    try {
      return await fn({
        press: (code) => this.pressKey(code),
        lcd: () => this.snapshot.lcd,
        refresh: () => this.pollOnce(true),
        stalled: () => (this.link?.stats.consecutiveTimeouts ?? 0) >= 1,
      });
    } finally {
      this.macroRunning = false;
    }
  }

  private startPolling(): void {
    this.stopPolling();
    const tick = async (): Promise<void> => {
      if (!this.link) return;
      if (!this.polling) await this.pollOnce(false);
      if (this.link) {
        const stalled = this.link.stats.consecutiveTimeouts >= 2;
        this.pollTimer = setTimeout(() => void tick(), stalled ? this.stalledPollIntervalMs : this.pollIntervalMs);
      }
    };
    this.pollTimer = setTimeout(() => void tick(), 0);
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** One poll cycle: L, A, and `a` when squelch is open or every Nth cycle. */
  async pollOnce(force: boolean): Promise<void> {
    const link = this.link;
    if (!link || this.polling) return;
    this.polling = true;
    try {
      this.cycle++;
      let lcd: Lcd | null = this.snapshot.lcd;
      let status: Status | null = this.snapshot.status;
      let active: ActiveChannel | null = this.snapshot.active;

      const l = await link.request(getLcd(), 'L');
      if (l) lcd = safe(() => parseLcd(l.data)) ?? lcd;
      const a = await link.request(getStatus(), 'A');
      if (a) status = safe(() => parseStatus(a.data)) ?? status;

      const wantActive = force || status?.squelch.rf || active?.length || this.cycle % this.activeEveryNCycles === 0;
      if (wantActive) {
        const ac = await link.request(getActiveChannel(), 'a');
        if (ac) active = safe(() => parseActiveChannel(ac.data)) ?? active;
      }

      const timeouts = link.stats.consecutiveTimeouts;
      const unresponsive = timeouts >= this.unresponsiveAfter;
      const current = this.snapshot.link.status;
      const linkStatus: LinkStatus =
        current === 'error' || current === 'disconnected' ? current : unresponsive ? 'unresponsive' : 'connected';
      // Two unanswered requests in a row is a stall; the first timeout happened
      // roughly timeouts * timeoutMs ago. A menu as the last known mode means
      // the scanner is most likely loading scanlists.
      let stall = this.snapshot.link.stall;
      if (timeouts >= 2) {
        if (!stall) {
          stall = { since: Date.now() - timeouts * (this.opts.timeoutMs ?? 750), loading: isMenuMode(this.snapshot.status?.mode) };
          this.opts.log?.(`scanner stalled${stall.loading ? ' (loading scanlists?)' : ''}`);
        }
      } else if (stall) {
        this.opts.log?.(`scanner back after ${((Date.now() - stall.since) / 1000).toFixed(1)} s`);
        stall = null;
      }
      this.snapshot = {
        ...this.snapshot,
        link: { ...this.snapshot.link, status: linkStatus, stall },
        lcd,
        status,
        active,
        stats: { ...link.stats },
        updatedAt: Date.now(),
      };
      this.publish();
    } finally {
      this.polling = false;
    }
  }

  /**
   * Use a frame that arrived outside the request/response pairing (a late
   * reply). Its contents are still the scanner's current state.
   */
  private applyFrame(frame: Frame, late: boolean): void {
    let changed = false;
    const next = { ...this.snapshot };
    switch (frame.codeChar) {
      case 'L': {
        const lcd = safe(() => parseLcd(frame.data));
        if (lcd) { next.lcd = lcd; changed = true; }
        break;
      }
      case 'A': {
        const status = safe(() => parseStatus(frame.data));
        if (status) { next.status = status; changed = true; }
        break;
      }
      case 'a': {
        const active = safe(() => parseActiveChannel(frame.data));
        if (active) { next.active = active; changed = true; }
        break;
      }
      default:
        this.opts.log?.(`unexpected frame '${frame.codeChar}' (${frame.data.length} bytes)`);
    }
    if (!late) this.opts.log?.(`unsolicited frame '${frame.codeChar}'`);
    if (changed && this.link) {
      next.stats = { ...this.link.stats };
      next.updatedAt = Date.now();
      this.snapshot = next;
      this.publish();
    }
  }

  private onNoise(bytes: Uint8Array): void {
    // CC Dump and anything else non-RCIP arrives as ASCII lines.
    this.noiseText += Buffer.from(bytes).toString('latin1');
    let nl: number;
    while ((nl = this.noiseText.search(/\r?\n/)) >= 0) {
      const line = this.noiseText.slice(0, nl).trim();
      this.noiseText = this.noiseText.slice(nl).replace(/^\r?\n/, '');
      if (line) this.opts.onCcDump?.(line);
    }
    if (this.noiseText.length > 4096) this.noiseText = this.noiseText.slice(-1024);
  }

  private setLink(status: LinkStatus, port: string | null, error: string | null): void {
    this.snapshot = { ...this.snapshot, link: { status, port, error, stall: null }, updatedAt: Date.now() };
    this.publish();
  }

  private publish(): void {
    this.opts.onSnapshot?.(this.snapshot);
  }
}

export function emptySnapshot(): ScannerSnapshot {
  return {
    link: { status: 'disconnected', port: null, error: null, stall: null },
    version: null,
    status: null,
    lcd: null,
    active: null,
    radioUser: null,
    licences: [],
    repeaters: [],
    rr: null,
    stats: { requests: 0, responses: 0, timeouts: 0, late: 0, frameErrors: 0, consecutiveTimeouts: 0, lastRttMs: null },
    updatedAt: 0,
    lookups: DEFAULT_LOOKUPS.map((p) => ({ ...p })),
  };
}

/** `A` modes in which selecting an item can start a scanlist load (see MODES in rcip). */
function isMenuMode(mode: number | undefined): boolean {
  return mode === 0x00 || mode === 0x04 || mode === 0x05 || mode === 0x07 || mode === 0x08;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export type { Frame };
