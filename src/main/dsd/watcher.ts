/**
 * Watches a DSD+ folder: tails `DSDPlus.event` into a `DsdFeed`, and re-reads `DSDPlus.radios` and
 * `DSDPlus.groups` when DSD+ rewrites them (every minute or so while it runs), naming radios in the log
 * from the aliases and keeping the talkgroup aliases for the System window. Polls file sizes once a
 * second: DSD+ keeps the files open and appends, and a stat poll is the one method that behaves the
 * same on Windows, macOS and Linux, including a folder on a network share.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ALIVE_MS, EMPTY_FEED, parseDsdEventLine, reduceDsdEvent, type DsdCallEvent, type DsdFeed, type DsdStatus } from '../../shared/dsd';
import type { LearnedChannel } from '../../shared/dsdChannels';
import { parseDsdGroups, parseDsdRadios } from '../../shared/dsdRadios';
import type { NewRadioName } from '../../shared/radioNames';

export const EVENT_FILE = 'DSDPlus.event';
export const RADIOS_FILE = 'DSDPlus.radios';
export const GROUPS_FILE = 'DSDPlus.groups';
/** How often the files are looked at. */
export const POLL_MS = 1000;
/** How much of the event file's tail is replayed when the folder is set, to seed the site and recent calls. */
export const SEED_BYTES = 256 * 1024;
/** How many seed windows back the network and site lines are looked for (8 MB), when the tail has none. */
export const SEED_WINDOWS = 32;
/** A rewritten radios or groups file is read once it has sat unchanged this long (DSD+ writes them in one go, but be sure). */
export const SETTLE_MS = 1500;

export interface DsdWatcherOptions {
  /** Name radios from the radios file's aliases; returns how many were written. */
  nameRadios: (list: NewRadioName[]) => number;
  /** Name one DSD+ network's talkgroups from the groups file's aliases (the whole list each time); returns how many were written. */
  nameTalkgroups?: (network: string, list: { tgid: number; name: string }[]) => number;
  /** The scanner's system tag a DSD+ network is known as, if learned. */
  systemOf?: (network: string) => string | null;
  /** The status changed (throttled by the caller). `namesChanged` says the log's radio or talkgroup names moved. */
  onChange: (status: DsdStatus, namesChanged: boolean) => void;
  /** A call line as it lands (not from the seed), with the network it belongs to: what the channel learner pairs with the TRX. */
  onCall?: (ev: DsdCallEvent, network: string | null) => void;
  /** The channel learner's view of a network, for the status. */
  channels?: (network: string) => Record<string, LearnedChannel>;
  log?: (msg: string) => void;
  now?: () => number;
}

interface Tracked {
  size: number;
  mtimeMs: number;
  /** When the file was last seen to change; it is read once that is `SETTLE_MS` ago. */
  changedAt: number | null;
  signature: string;
}

export class DsdWatcher {
  private folder: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private feed: DsdFeed = EMPTY_FEED;
  private offset = 0;
  private partial = '';
  private eventFound = false;
  private eventSize = 0;
  private radios: Tracked = { size: -1, mtimeMs: -1, changedAt: null, signature: '' };
  private groups: Tracked = { size: -1, mtimeMs: -1, changedAt: null, signature: '' };
  private named = 0;
  private importedAt: number | null = null;
  private groupAliases = new Map<string, string>();
  /** A network's protocol as DSD+ last classified it: the protocol of its newest group line (DSD+ reclassified TIII sites in 2.457, so a network can carry both). */
  private networkProtocols = new Map<string, { protocol: string; lastHeard: string }>();
  private groupCount = 0;
  private error: string | null = null;
  /** What the last status pushed out said about liveness, so going quiet (or waking) is announced once. */
  private lastAlive = false;
  private readonly now: () => number;

  constructor(private readonly opts: DsdWatcherOptions) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Point the watcher at a folder (null switches the link off); the event file's tail is replayed to seed the feed. */
  setFolder(folder: string | null): void {
    if (folder === this.folder) return;
    this.stop();
    this.folder = folder;
    this.feed = EMPTY_FEED;
    this.offset = 0;
    this.partial = '';
    this.eventFound = false;
    this.eventSize = 0;
    this.radios = { size: -1, mtimeMs: -1, changedAt: null, signature: '' };
    this.groups = { size: -1, mtimeMs: -1, changedAt: null, signature: '' };
    this.named = 0;
    this.importedAt = null;
    this.groupAliases.clear();
    this.networkProtocols.clear();
    this.groupCount = 0;
    this.error = null;
    if (!folder) {
      this.opts.onChange(this.status(), false);
      return;
    }
    this.seed();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.poll();
    this.lastAlive = this.status().alive;
    this.opts.onChange(this.status(), false);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): DsdStatus {
    const tgNames: Record<number, string> = {};
    const net = this.feed.network?.id;
    if (net) {
      for (const [key, alias] of this.groupAliases) {
        const [network, tg] = key.split('|');
        if (network === net) tgNames[Number(tg)] = alias;
      }
    }
    return {
      folder: this.folder,
      error: this.error,
      event: { found: this.eventFound, size: this.eventSize, lastEventAt: this.feed.lastEventAt },
      radios: { found: this.radios.size >= 0, named: this.named, importedAt: this.importedAt },
      groups: { found: this.groups.size >= 0, count: this.groupCount },
      tgNames,
      system: net ? (this.opts.systemOf?.(net) ?? null) : null,
      protocol: net ? (this.networkProtocols.get(net)?.protocol ?? null) : null,
      channels: net && this.opts.channels ? this.opts.channels(net) : {},
      feed: this.feed,
      alive: this.folder !== null && this.eventFound && this.feed.lastEventAt !== null && this.now() - this.feed.lastEventAt < ALIVE_MS,
    };
  }

  /** Replay the end of the event file so the window opens with the site and the last few calls, not blank. */
  private seed(): void {
    const path = join(this.folder!, EVENT_FILE);
    try {
      if (!existsSync(path)) return;
      const size = statSync(path).size;
      const from = Math.max(0, size - SEED_BYTES);
      const text = this.read(path, from, size - from);
      // The first line may be a fragment when the window starts mid-file.
      const lines = text.split(/\r?\n/);
      if (from > 0) lines.shift();
      for (const line of lines) this.ingest(line);
      this.offset = size;
      this.eventFound = true;
      this.eventSize = size;
      // A busy DMR site writes 500 registration lines a minute, so the tail may not reach back to the
      // "Current network" line: look further back, a window at a time, for the latest one and its site.
      if (!this.feed.network) this.seedContext(path, from);
    } catch (e) {
      this.error = `Cannot read ${EVENT_FILE}: ${(e as Error).message}`;
    }
  }

  /** Scan backwards from `end` for the most recent network and site lines and fold them in. */
  private seedContext(path: string, end: number): void {
    const NETWORK = /  Current network:  /;
    const SITE = /  Current site:  \S+-/;
    let network: string | null = null;
    let site: string | null = null;
    for (let windows = 0; end > 0 && windows < SEED_WINDOWS && !network; windows++) {
      const from = Math.max(0, end - SEED_BYTES);
      const lines = this.read(path, from, end - from).split(/\r?\n/);
      if (from > 0) lines.shift();
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!;
        if (!site && SITE.test(line)) site = line;
        if (NETWORK.test(line)) {
          network = line;
          break;
        }
      }
      end = from;
    }
    if (network) this.ingest(network);
    if (site) this.ingest(site);
  }

  private poll(): void {
    if (!this.folder) return;
    let changed = false;
    let radiosChanged = false;
    // --- the event file: new bytes since last time
    const path = join(this.folder, EVENT_FILE);
    try {
      if (existsSync(path)) {
        const size = statSync(path).size;
        if (!this.eventFound) changed = true;
        this.eventFound = true;
        if (size < this.offset) {
          // Truncated or replaced: start again from the top.
          this.offset = 0;
          this.partial = '';
        }
        if (size > this.offset) {
          const text = this.partial + this.read(path, this.offset, size - this.offset);
          const lines = text.split(/\r?\n/);
          this.partial = lines.pop() ?? '';
          for (const line of lines) this.ingest(line, true);
          this.offset = size;
          changed = true;
        }
        this.eventSize = size;
        this.error = null;
      } else if (this.eventFound) {
        this.eventFound = false;
        changed = true;
      }
    } catch (e) {
      const msg = `Cannot read ${EVENT_FILE}: ${(e as Error).message}`;
      if (msg !== this.error) {
        this.error = msg;
        changed = true;
      }
    }
    // --- the radios and groups files: re-read once a rewrite has settled
    const now = this.now();
    if (this.track(this.radios, join(this.folder, RADIOS_FILE), now)) {
      changed = true;
      if (this.radios.changedAt === null) radiosChanged = this.importRadios() || radiosChanged;
    }
    if (this.track(this.groups, join(this.folder, GROUPS_FILE), now)) {
      changed = true;
      if (this.groups.changedAt === null) radiosChanged = this.readGroups() || radiosChanged;
    }
    // Going quiet (or coming back) changes the pill without any file changing.
    const alive = this.status().alive;
    if (changed || alive !== this.lastAlive) {
      this.lastAlive = alive;
      this.opts.onChange(this.status(), radiosChanged);
    }
  }

  /** Note a file's size and mtime; true when it changed, or when a pending change has settled (then `changedAt` is null again). */
  private track(t: Tracked, path: string, now: number): boolean {
    let size = -1;
    let mtimeMs = -1;
    try {
      if (existsSync(path)) {
        const st = statSync(path);
        size = st.size;
        mtimeMs = st.mtimeMs;
      }
    } catch {
      return false;
    }
    if (size !== t.size || mtimeMs !== t.mtimeMs) {
      const first = t.size === -1;
      t.size = size;
      t.mtimeMs = mtimeMs;
      t.changedAt = size >= 0 ? now : null;
      // First sight: read at once; later rewrites wait to settle.
      if (first && size >= 0) {
        t.changedAt = null;
        return true;
      }
      return size < 0;
    }
    if (t.changedAt !== null && now - t.changedAt >= SETTLE_MS) {
      t.changedAt = null;
      return true;
    }
    return false;
  }

  /** Name the log's radios from the file's aliases; true when the set of names moved. */
  private importRadios(): boolean {
    try {
      const { radios } = parseDsdRadios(readFileSync(join(this.folder!, RADIOS_FILE), 'utf8'));
      const named = radios.filter((r) => r.alias !== '');
      const signature = named.map((r) => `${r.radioId}=${r.alias}`).sort().join('\n');
      if (signature === this.radios.signature) return false;
      this.radios.signature = signature;
      // DSD+ keys by its own network ID, not the scanner's system tag, so the names apply on any system.
      this.named = this.opts.nameRadios(named.map((r) => ({ radioId: r.radioId, system: '', name: r.alias })));
      this.importedAt = this.now();
      this.opts.log?.(`[dsd] ${this.named} radio names from ${RADIOS_FILE}`);
      return true;
    } catch (e) {
      this.opts.log?.(`[dsd] ${RADIOS_FILE}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Read the groups file again and hand its aliases over afresh (a network has just been matched to a scanner system tag). */
  reimportGroups(): void {
    if (!this.folder || this.groups.size < 0) return;
    this.groups.signature = '';
    this.readGroups();
  }

  /** Read the groups file: aliases and protocols per network, and the log's talkgroup names when the aliases moved. */
  private readGroups(): boolean {
    try {
      const { groups } = parseDsdGroups(readFileSync(join(this.folder!, GROUPS_FILE), 'utf8'));
      this.groupAliases.clear();
      this.networkProtocols.clear();
      const byNetwork = new Map<string, { tgid: number; name: string }[]>();
      for (const g of groups) {
        if (g.alias) {
          this.groupAliases.set(`${g.network}|${g.tgid}`, g.alias);
          const list = byNetwork.get(g.network) ?? [];
          list.push({ tgid: g.tgid, name: g.alias });
          byNetwork.set(g.network, list);
        }
        const known = this.networkProtocols.get(g.network);
        if (!known || g.lastHeard > known.lastHeard) this.networkProtocols.set(g.network, { protocol: g.protocol, lastHeard: g.lastHeard });
      }
      this.groupCount = groups.length;
      const signature = [...this.groupAliases].map(([k, v]) => `${k}=${v}`).sort().join('\n');
      if (signature === this.groups.signature || !this.opts.nameTalkgroups) return false;
      this.groups.signature = signature;
      let n = 0;
      for (const [network, list] of byNetwork) n += this.opts.nameTalkgroups(network, list);
      this.opts.log?.(`[dsd] ${n} talkgroup names from ${GROUPS_FILE}`);
      return true;
    } catch (e) {
      this.opts.log?.(`[dsd] ${GROUPS_FILE}: ${(e as Error).message}`);
      return false;
    }
  }

  private ingest(line: string, live = false): void {
    const ev = parseDsdEventLine(line);
    if (!ev) return;
    this.feed = reduceDsdEvent(this.feed, ev);
    if (live && ev.kind === 'call') this.opts.onCall?.(ev, this.feed.network?.id ?? null);
  }

  private read(path: string, from: number, length: number): string {
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(length);
      const n = readSync(fd, buf, 0, length, from);
      return buf.subarray(0, n).toString('utf8');
    } finally {
      closeSync(fd);
    }
  }
}
