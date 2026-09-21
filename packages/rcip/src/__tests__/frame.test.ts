import { describe, expect, it } from 'vitest';
import {
  ETX,
  FrameDecoder,
  FrameError,
  STX,
  checksum,
  decodeFrame,
  encodeFrame,
  fromHex,
  splitFrames,
  toHex,
} from '../frame';

describe('checksum', () => {
  it('sums code..ETX and masks to 8 bits', () => {
    // Get Status: 'A' (0x41) + ETX (0x03) = 0x44
    expect(checksum([0x41, 0x03])).toBe(0x44);
    // wraps at 0xFF
    expect(checksum([0xff, 0x03])).toBe(0x02);
  });
});

describe('encodeFrame', () => {
  it('encodes the spec commands with hand-worked checksums', () => {
    expect(toHex(encodeFrame('A'))).toBe('02 41 03 44');
    expect(toHex(encodeFrame('L'))).toBe('02 4C 03 4F');
    expect(toHex(encodeFrame('a'))).toBe('02 61 03 64');
    expect(toHex(encodeFrame('P'))).toBe('02 50 03 53');
    expect(toHex(encodeFrame('V', [0x00]))).toBe('02 56 00 03 59');
    // MENU = 17 (0x11): 0x4B + 0x11 + 0x03 = 0x5F
    expect(toHex(encodeFrame('K', [17]))).toBe('02 4B 11 03 5F');
    // POWER = 44 (0x2C): 0x4B + 0x2C + 0x03 = 0x7A
    expect(toHex(encodeFrame('K', [44]))).toBe('02 4B 2C 03 7A');
  });

  it('is case sensitive', () => {
    expect(encodeFrame('A')[1]).toBe(0x41);
    expect(encodeFrame('a')[1]).toBe(0x61);
  });

  it('rejects multi-character codes', () => {
    expect(() => encodeFrame('AB')).toThrow();
  });
});

describe('decodeFrame', () => {
  it('round-trips an encoded frame', () => {
    const data = [0x00, 0x02, 0x03, 0xff];
    const f = decodeFrame(encodeFrame('X', data));
    expect(f.codeChar).toBe('X');
    expect([...f.data]).toEqual(data);
  });

  it('rejects a bad checksum', () => {
    const buf = encodeFrame('A', [1, 2, 3]);
    buf[buf.length - 1] ^= 0x01;
    expect(() => decodeFrame(buf)).toThrow(FrameError);
  });

  it('rejects missing STX or ETX', () => {
    expect(() => decodeFrame(fromHex('00 41 03 44'))).toThrow(/STX/);
    expect(() => decodeFrame(fromHex('02 41 00 44'))).toThrow(/ETX/);
    expect(() => decodeFrame(fromHex('02 41'))).toThrow(/short/);
  });
});

function statusFrame(): Uint8Array {
  // 16 data bytes; include STX and ETX values inside the payload on purpose.
  return encodeFrame('A', [0x0a, 0x03, 0x02, 0x80, 0x10, 0x00, 0x05, 0x00, 0, 0, 0, 0xc4, 0x24, 0x92, 0x1b, 0x01]);
}

describe('FrameDecoder', () => {
  it('decodes a fixed-length response containing STX/ETX bytes in its data', () => {
    const d = new FrameDecoder();
    const events = d.push(statusFrame());
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('frame');
    expect(d.pending.length).toBe(0);
  });

  it('reassembles a frame delivered one byte at a time', () => {
    const d = new FrameDecoder();
    const raw = statusFrame();
    const events = [];
    for (const b of raw) events.push(...d.push([b]));
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('frame');
  });

  it('separates noise before and between frames', () => {
    const d = new FrameDecoder();
    const noise = new TextEncoder().encode('P25:T00001234:S0001:CC01:P25TSBK:00 11\r\n');
    const buf = new Uint8Array([...noise, ...statusFrame(), ...encodeFrame('P', [1])]);
    const events = d.push(buf);
    expect(events.map((e) => e.type)).toEqual(['noise', 'frame', 'frame']);
    expect(events[0]!.type === 'noise' && new TextDecoder().decode(events[0]!.bytes)).toContain('P25TSBK');
  });

  it('handles the variable-length a response with an empty payload', () => {
    // STX a 00 00 ETX sum: total 6 bytes as the spec says
    const raw = encodeFrame('a', [0x00, 0x00]);
    expect(raw.length).toBe(6);
    expect(toHex(raw)).toBe('02 61 00 00 03 64');
    const events = new FrameDecoder().push(raw);
    expect(events[0]!.type).toBe('frame');
  });

  it('handles the variable-length a response with a 320-byte payload', () => {
    const payload = new Uint8Array(320).fill(0x03);
    const raw = encodeFrame('a', [0x01, 0x40, ...payload]);
    const d = new FrameDecoder();
    // split across two chunks in the middle of the payload
    const e1 = d.push(raw.subarray(0, 100));
    expect(e1).toHaveLength(0);
    const e2 = d.push(raw.subarray(100));
    expect(e2).toHaveLength(1);
    expect(e2[0]!.type === 'frame' && e2[0]!.frame.data.length).toBe(322);
  });

  it('decodes the 96+3 byte L response the TRX-1e sends', () => {
    const l99 = encodeFrame('L', new Uint8Array(99).fill(0x20));
    const events = new FrameDecoder().push(l99);
    expect(events[0]!.type).toBe('frame');
    expect(events[0]!.type === 'frame' && events[0]!.frame.data.length).toBe(99);
  });

  it('decodes a real L frame captured from a TRX-1e', () => {
    const raw = fromHex(
      '02 4C 20 20 2D 4D 61 69 6E 20 4D 65 6E 75 2D 20 20 20 53 63 61 6E 20 20 20 20 20 20 20 20 20 20 20 93 ' +
        '53 63 61 6E 6C 69 73 74 73 20 20 20 20 20 20 20 42 72 6F 77 73 65 20 4C 69 62 72 61 72 79 20 20 ' +
        '42 72 6F 77 73 65 20 4F 62 6A 65 63 74 73 20 20 50 72 6F 67 72 61 6D 20 4D 65 6E 75 20 20 20 20 00 00 00 03 DF',
    );
    expect(raw.length).toBe(103);
    const events = new FrameDecoder().push(raw);
    expect(events).toHaveLength(1);
    expect(events[0]!.type === 'frame' && events[0]!.frame.data.length).toBe(99);
  });

  it('decodes real V, A, P and a frames captured from a TRX-1e', () => {
    const raw = fromHex(
      '02 56 00 54 52 58 2D 31 65 20 20 13 74 32 16 03 29 ' +
        '02 41 00 00 70 92 02 00 7E 00 00 00 00 38 49 68 07 00 03 B6 ' +
        '02 50 01 03 54 ' +
        '02 61 00 00 03 64',
    );
    const events = splitFrames(raw);
    expect(events.map((e) => (e.type === 'frame' ? e.frame.codeChar : e.type))).toEqual(['V', 'A', 'P', 'a']);
  });

  it('resynchronises after a corrupt frame', () => {
    const bad = statusFrame();
    bad[bad.length - 1] ^= 0xff;
    const good = encodeFrame('P', [0]);
    const events = new FrameDecoder().push(new Uint8Array([...bad, ...good]));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('error');
    expect(types[types.length - 1]).toBe('frame');
    const last = events[events.length - 1]!;
    expect(last.type === 'frame' && last.frame.codeChar).toBe('P');
  });

  it('falls back to an ETX+checksum scan for unknown codes', () => {
    const raw = encodeFrame('Z', [1, 2, 3]);
    const events = new FrameDecoder().push(raw);
    expect(events[0]!.type).toBe('frame');
    expect(events[0]!.type === 'frame' && [...events[0]!.frame.data]).toEqual([1, 2, 3]);
  });

  it('flush() returns leftover bytes as noise', () => {
    const d = new FrameDecoder();
    d.push([STX, 0x41, 0x00]);
    const events = d.flush();
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('noise');
    expect(d.pending.length).toBe(0);
  });

  it('honours a caller-supplied length table', () => {
    const d = new FrameDecoder({ lengths: { Q: [2] } });
    const events = d.push(encodeFrame('Q', [ETX, ETX]));
    expect(events[0]!.type).toBe('frame');
  });
});

describe('splitFrames', () => {
  it('splits a quiet-period capture into frames', () => {
    const buf = new Uint8Array([...encodeFrame('V', [0, ...'TRX-1   '.split('').map((c) => c.charCodeAt(0)), 0x12, 0x14, 0x11, 0x10]), ...statusFrame()]);
    const events = splitFrames(buf);
    expect(events.map((e) => e.type)).toEqual(['frame', 'frame']);
  });
});

describe('hex helpers', () => {
  it('round-trips', () => {
    expect(toHex(fromHex('02 41 03 44'))).toBe('02 41 03 44');
    expect(() => fromHex('ABC')).toThrow();
  });
});

describe("unsolicited 'P'", () => {
  it('is delimited by its one-byte length whether or not it was asked for', () => {
    const d = new FrameDecoder();
    const events = d.push(encodeFrame('P', [0]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'frame', frame: { codeChar: 'P', data: new Uint8Array([0]) } });
  });
});
