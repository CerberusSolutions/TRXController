/**
 * Request/response link over a Transport. RCIP has no correlation IDs and the
 * scanner only ever answers the command it was just sent, so exactly one
 * request is in flight at a time; everything else queues.
 */
import { FrameDecoder, NO_RESPONSE_CODES, type Frame } from '@trxcontroller/rcip';
import type { LinkStats } from '../../shared/ipc';
import type { Transport } from './transport';

export interface LinkOptions {
  /** How long to wait for a response before giving up on it. */
  timeoutMs?: number;
  /** Pause after a no-response command so the scanner can act on it. */
  sendGapMs?: number;
  onNoise?: (bytes: Uint8Array) => void;
  onUnexpectedFrame?: (frame: Frame) => void;
  onFrameError?: (message: string) => void;
}

interface Pending {
  expectCode: string;
  resolve: (frame: Frame | null) => void;
  timer: ReturnType<typeof setTimeout>;
  startedAt: number;
}

export class ScannerLink {
  private readonly decoder: FrameDecoder;
  private pending: Pending | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  readonly stats: LinkStats = {
    requests: 0,
    responses: 0,
    timeouts: 0,
    frameErrors: 0,
    consecutiveTimeouts: 0,
    lastRttMs: null,
  };
  private readonly timeoutMs: number;
  private readonly sendGapMs: number;

  constructor(
    private readonly transport: Transport,
    private readonly opts: LinkOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 500;
    this.sendGapMs = opts.sendGapMs ?? 30;
    this.decoder = new FrameDecoder({
      onEvent: (e) => {
        if (e.type === 'frame') this.onFrame(e.frame);
        else if (e.type === 'noise') opts.onNoise?.(e.bytes);
        else {
          this.stats.frameErrors++;
          opts.onFrameError?.(e.error.message);
        }
      },
    });
    transport.onData((bytes) => this.decoder.push(bytes));
  }

  /**
   * Send a command and wait for the response with the given code. Resolves
   * null on timeout. Requests are serialised in call order.
   */
  request(cmd: Uint8Array, expectCode: string): Promise<Frame | null> {
    const run = async (): Promise<Frame | null> => {
      if (this.closed) return null;
      this.stats.requests++;
      const result = await new Promise<Frame | null>((resolve) => {
        const startedAt = Date.now();
        const timer = setTimeout(() => {
          if (this.pending?.resolve === resolve) {
            this.pending = null;
            this.stats.timeouts++;
            this.stats.consecutiveTimeouts++;
            // Anything half-received belongs to the request we just gave up on.
            this.decoder.reset();
            resolve(null);
          }
        }, this.timeoutMs);
        this.pending = { expectCode, resolve, timer, startedAt };
        this.transport.write(cmd).catch(() => {
          clearTimeout(timer);
          this.pending = null;
          resolve(null);
        });
      });
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Send a no-response command (K, t, C), then pause briefly. */
  send(cmd: Uint8Array): Promise<void> {
    const code = String.fromCharCode(cmd[1] ?? 0);
    if (!NO_RESPONSE_CODES.has(code)) {
      throw new Error(`send() is for no-response commands; '${code}' expects a reply, use request()`);
    }
    const run = async (): Promise<void> => {
      if (this.closed) return;
      await this.transport.write(cmd);
      await sleep(this.sendGapMs);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve(null);
      this.pending = null;
    }
    await this.transport.close();
  }

  private onFrame(frame: Frame): void {
    const p = this.pending;
    if (p && frame.codeChar === p.expectCode) {
      clearTimeout(p.timer);
      this.pending = null;
      this.stats.responses++;
      this.stats.consecutiveTimeouts = 0;
      this.stats.lastRttMs = Date.now() - p.startedAt;
      p.resolve(frame);
    } else {
      this.opts.onUnexpectedFrame?.(frame);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
