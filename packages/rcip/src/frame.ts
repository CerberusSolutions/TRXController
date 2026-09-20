/**
 * RCIP frame codec.
 *
 *   STX <code> <data...> ETX <sum>
 *   sum = (code + data bytes + ETX) & 0xFF
 *
 * Data is binary and may contain STX/ETX values, so responses are delimited
 * by the known length for each response code (RESPONSE_DATA_LENGTH), with a
 * checksum check on top. Unknown codes fall back to an ETX+checksum scan.
 */

export const STX = 0x02;
export const ETX = 0x03;

/** Bytes of framing overhead around the data: STX, code, ETX, sum. */
export const FRAME_OVERHEAD = 4;

export interface Frame {
  /** Message code as a byte, e.g. 0x41 for 'A'. */
  code: number;
  /** Message code as a one-character string, e.g. 'A'. */
  codeChar: string;
  /** Payload bytes between the code and ETX. */
  data: Uint8Array;
  /** The complete frame as received or encoded, including STX and sum. */
  raw: Uint8Array;
}

export class FrameError extends Error {
  constructor(
    message: string,
    public readonly raw: Uint8Array,
  ) {
    super(message);
    this.name = 'FrameError';
  }
}

export function codeByte(code: string | number): number {
  if (typeof code === 'number') return code & 0xff;
  if (code.length !== 1) throw new Error(`Message code must be one character, got "${code}"`);
  return code.charCodeAt(0) & 0xff;
}

/** Checksum over `code .. ETX` inclusive: plain 8-bit sum. */
export function checksum(codeThroughEtx: Iterable<number>): number {
  let sum = 0;
  for (const b of codeThroughEtx) sum = (sum + b) & 0xff;
  return sum;
}

/** Build a complete frame for the given code and optional data. */
export function encodeFrame(code: string | number, data: ArrayLike<number> = []): Uint8Array {
  const c = codeByte(code);
  const out = new Uint8Array(data.length + FRAME_OVERHEAD);
  out[0] = STX;
  out[1] = c;
  for (let i = 0; i < data.length; i++) out[2 + i] = data[i]! & 0xff;
  out[out.length - 2] = ETX;
  out[out.length - 1] = checksum(out.subarray(1, out.length - 1));
  return out;
}

/**
 * Decode a buffer that holds exactly one frame. Throws FrameError on a
 * malformed frame (bad STX/ETX position or checksum).
 */
export function decodeFrame(buf: Uint8Array): Frame {
  if (buf.length < FRAME_OVERHEAD) throw new FrameError(`Frame too short (${buf.length} bytes)`, buf);
  if (buf[0] !== STX) throw new FrameError(`Missing STX (got 0x${hex(buf[0]!)})`, buf);
  if (buf[buf.length - 2] !== ETX) throw new FrameError(`Missing ETX (got 0x${hex(buf[buf.length - 2]!)})`, buf);
  const expected = checksum(buf.subarray(1, buf.length - 1));
  const actual = buf[buf.length - 1]!;
  if (expected !== actual) {
    throw new FrameError(`Bad checksum: expected 0x${hex(expected)}, got 0x${hex(actual)}`, buf);
  }
  const code = buf[1]!;
  return {
    code,
    codeChar: String.fromCharCode(code),
    data: buf.slice(2, buf.length - 2),
    raw: buf.slice(),
  };
}

/**
 * Known response data lengths (bytes between code and ETX) per response code.
 * A list means "try these, longest first". `null` means variable length with
 * a 16-bit big-endian length prefix (the `a` response).
 */
export const RESPONSE_DATA_LENGTH: Readonly<Record<string, readonly number[] | null>> = {
  A: [16],
  // Spec says lcd0..lcd96 (97 chars) + 3 icon bytes, but a TRX-1e (CPU 7.4)
  // sends 96 + 3 = 99. The spec's "96" is a typo for 95.
  L: [99],
  V: [13],
  P: [1],
  // Lowercase, undocumented: the scanner sends it unsolicited when it is switched off (data 0).
  p: [1],
  a: null,
};

export type DecoderEvent =
  | { type: 'frame'; frame: Frame }
  | { type: 'noise'; bytes: Uint8Array }
  | { type: 'error'; error: FrameError };

export interface FrameDecoderOptions {
  /** Override or extend the response length table. */
  lengths?: Readonly<Record<string, readonly number[] | null>>;
  /** Sink for events; also returned from push(). */
  onEvent?: (event: DecoderEvent) => void;
}

/**
 * Incremental stream decoder. Feed it bytes as they arrive; it emits frames,
 * "noise" (bytes that are not part of any frame, e.g. CC Dump text) and
 * errors, and resynchronises on the next STX after a bad frame.
 */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);
  private readonly lengths: Readonly<Record<string, readonly number[] | null>>;
  private readonly onEvent: ((event: DecoderEvent) => void) | undefined;

  constructor(opts: FrameDecoderOptions = {}) {
    this.lengths = { ...RESPONSE_DATA_LENGTH, ...(opts.lengths ?? {}) };
    this.onEvent = opts.onEvent;
  }

  /** Bytes currently buffered and not yet resolved into an event. */
  get pending(): Uint8Array {
    return this.buf;
  }

  reset(): void {
    this.buf = new Uint8Array(0);
  }

  push(bytes: ArrayLike<number>): DecoderEvent[] {
    const joined = new Uint8Array(this.buf.length + bytes.length);
    joined.set(this.buf, 0);
    joined.set(bytes, this.buf.length);
    this.buf = joined;

    const events: DecoderEvent[] = [];
    const emit = (e: DecoderEvent): void => {
      events.push(e);
      this.onEvent?.(e);
    };

    for (;;) {
      const stx = this.buf.indexOf(STX);
      if (stx < 0) {
        if (this.buf.length) emit({ type: 'noise', bytes: this.buf });
        this.buf = new Uint8Array(0);
        break;
      }
      if (stx > 0) {
        emit({ type: 'noise', bytes: this.buf.slice(0, stx) });
        this.buf = this.buf.slice(stx);
      }
      // Need at least STX + code to decide anything.
      if (this.buf.length < 2) break;

      const result = this.tryDecodeAtStart();
      if (result === 'need-more') break;
      if (result instanceof FrameError) {
        emit({ type: 'error', error: result });
        // Drop this STX and resync on the next one.
        this.buf = this.buf.slice(1);
        continue;
      }
      emit({ type: 'frame', frame: result });
      this.buf = this.buf.slice(result.raw.length);
    }
    return events;
  }

  /** Flush whatever is buffered as noise (e.g. on port close). */
  flush(): DecoderEvent[] {
    if (!this.buf.length) return [];
    const e: DecoderEvent = { type: 'noise', bytes: this.buf };
    this.buf = new Uint8Array(0);
    this.onEvent?.(e);
    return [e];
  }

  private tryDecodeAtStart(): Frame | FrameError | 'need-more' {
    const buf = this.buf;
    const codeChar = String.fromCharCode(buf[1]!);
    const spec = this.lengths[codeChar];

    if (spec === undefined) {
      // Unknown code: scan for an ETX whose following byte is a valid sum.
      for (let i = 2; i + 1 < buf.length; i++) {
        if (buf[i] === ETX && checksum(buf.subarray(1, i + 1)) === buf[i + 1]) {
          return decodeFrame(buf.subarray(0, i + 2));
        }
      }
      // No complete frame yet. If another STX follows, this one is almost
      // certainly a stray STX inside noise or a corrupt frame's data, so drop
      // it and resync there rather than waiting for bytes that never come.
      const next = buf.indexOf(STX, 1);
      if (next > 0 || buf.length > 1024) {
        return new FrameError(`No valid frame found for code '${codeChar}'`, buf.slice(0, Math.min(16, buf.length)));
      }
      return 'need-more';
    }

    let candidates: readonly number[];
    if (spec === null) {
      if (buf.length < 4) return 'need-more';
      const len = (buf[2]! << 8) | buf[3]!;
      candidates = [2 + len];
    } else {
      candidates = spec;
    }

    let lastError: FrameError | undefined;
    let needMore = false;
    for (const dataLen of candidates) {
      const total = dataLen + FRAME_OVERHEAD;
      if (buf.length < total) {
        needMore = true;
        continue;
      }
      try {
        return decodeFrame(buf.subarray(0, total));
      } catch (e) {
        lastError = e as FrameError;
      }
    }
    if (needMore) return 'need-more';
    return lastError ?? new FrameError(`No length candidates for '${codeChar}'`, buf.slice(0, 4));
  }
}

/**
 * Split a complete buffer (e.g. everything received until the line went
 * quiet) into frames and noise. Convenience wrapper over FrameDecoder.
 */
export function splitFrames(buf: Uint8Array, opts?: FrameDecoderOptions): DecoderEvent[] {
  const d = new FrameDecoder(opts);
  return [...d.push(buf), ...d.flush()];
}

export function hex(b: number): string {
  return b.toString(16).padStart(2, '0').toUpperCase();
}

export function toHex(bytes: ArrayLike<number>, sep = ' '): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) parts.push(hex(bytes[i]!));
  return parts.join(sep);
}

export function fromHex(s: string): Uint8Array {
  const clean = s.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2) throw new Error('Odd number of hex digits');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
