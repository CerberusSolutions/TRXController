import { encodeFrame, decodeFrame, type Frame } from '@trxcontroller/rcip';
import type { Transport, TransportFactory } from '../scanner/transport';

/** In-memory scanner: answers commands from a handler, with controllable delay. */
export class FakeTransport implements Transport {
  written: Uint8Array[] = [];
  private dataCb: ((b: Uint8Array) => void) | null = null;
  private errorCb: ((e: Error) => void) | null = null;
  private closeCb: (() => void) | null = null;
  closed = false;
  delayMs = 0;
  /** Per-command delay override; wins over delayMs when it returns a number. */
  delayFor: ((cmd: Frame) => number | undefined) | null = null;
  /** Return a response frame (or null for none) for a command frame. */
  handler: (cmd: Frame) => Uint8Array | null = defaultHandler;
  /** Split responses into chunks of this size to exercise reassembly. */
  chunkSize = 0;

  async write(bytes: Uint8Array): Promise<void> {
    this.written.push(bytes.slice());
    const cmd = decodeFrame(bytes);
    const resp = this.handler(cmd);
    if (!resp) return;
    const deliver = (): void => {
      if (this.closed || !this.dataCb) return;
      if (this.chunkSize > 0) {
        for (let i = 0; i < resp.length; i += this.chunkSize) this.dataCb(resp.subarray(i, i + this.chunkSize));
      } else {
        this.dataCb(resp);
      }
    };
    const delay = this.delayFor?.(cmd) ?? this.delayMs;
    if (delay > 0) setTimeout(deliver, delay);
    else queueMicrotask(deliver);
  }

  /** Push unsolicited bytes (e.g. CC Dump text). */
  inject(bytes: Uint8Array | string): void {
    const b = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    this.dataCb?.(b);
  }

  fail(err: Error): void {
    this.errorCb?.(err);
  }

  onData(cb: (bytes: Uint8Array) => void): void {
    this.dataCb = cb;
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.closeCb?.();
  }

  commands(): string[] {
    return this.written.map((w) => String.fromCharCode(w[1]!));
  }
}

export const STATUS_DATA = [0x0a, 0x03, 0x3e, 0x92, 0x5e, 0x01, 0x96, 0x01, 0x80, 0xff, 0xff, 0x18, 0x9f, 0x23, 0x07, 0x00];

export function lcdData(lines: string[], icons: [number, number, number] = [0, 0, 0]): Uint8Array {
  const text = lines.map((l) => l.padEnd(16, ' ')).join('').padEnd(96, ' ');
  return new Uint8Array([...[...text].map((c) => c.charCodeAt(0)), ...icons]);
}

export function defaultHandler(cmd: Frame): Uint8Array | null {
  switch (cmd.codeChar) {
    case 'V':
      return encodeFrame('V', [0, ...'TRX-1e  '.split('').map((c) => c.charCodeAt(0)), 0x13, 0x74, 0x32, 0x16]);
    case 'P':
      return encodeFrame('P', [1]);
    case 'A':
      return encodeFrame('A', STATUS_DATA);
    case 'L':
      return encodeFrame('L', lcdData(['', 'Civil Airband', 'CONV        psDr', 'TC NW Deps', 'AM    119.775000'], [0x4d, 0x40, 0x03]));
    case 'a':
      return encodeFrame('a', [0, 0]);
    default:
      return null;
  }
}

export function factoryFor(t: FakeTransport): TransportFactory {
  return { open: async () => t };
}
