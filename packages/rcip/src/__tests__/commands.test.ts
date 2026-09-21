import { describe, expect, it } from 'vitest';
import { getActiveChannel, getLcd, getPower, getStatus, getVersion, sendKey, setCcDump, setClock, setClockFromDate } from '../commands';
import { toHex } from '../frame';
import { Key } from '../keys';
import { parseResponse } from '../response';
import { decodeFrame, encodeFrame } from '../frame';

describe('command builders', () => {
  it('build the spec frames', () => {
    expect(toHex(getStatus())).toBe('02 41 03 44');
    expect(toHex(getLcd())).toBe('02 4C 03 4F');
    expect(toHex(getActiveChannel())).toBe('02 61 03 64');
    expect(toHex(getPower())).toBe('02 50 03 53');
    expect(toHex(getVersion())).toBe('02 56 00 03 59');
    expect(toHex(sendKey(Key.MENU))).toBe('02 4B 11 03 5F');
    expect(toHex(setCcDump(true))).toBe('02 43 01 03 47');
    expect(toHex(setCcDump(false))).toBe('02 43 00 03 46');
  });

  it('rejects out-of-range key codes', () => {
    expect(() => sendKey(256)).toThrow();
    expect(() => sendKey(-1)).toThrow();
  });

  it('encodes clock set as nine little-endian int16s by default', () => {
    const f = setClock({ sec: 30, min: 45, hour: 13, mday: 14, month: 8, year: 126, weekday: 1, yearday: 256, isDst: 1 });
    expect(f.length).toBe(22);
    expect(toHex(f.subarray(2, 20))).toBe('1E 00 2D 00 0D 00 0E 00 08 00 7E 00 01 00 00 01 01 00');
  });

  it('can encode clock set big-endian', () => {
    const f = setClock({ sec: 1, min: 2, hour: 3, mday: 4, month: 5, year: 126, weekday: 6 }, { byteOrder: 'be' });
    expect(toHex(f.subarray(2, 8))).toBe('00 01 00 02 00 03');
    expect(toHex(f.subarray(16, 20))).toBe('00 00 00 00');
  });

  it('derives clock fields from a Date', () => {
    const d = new Date(2026, 0, 2, 3, 4, 5); // 2 Jan 2026 03:04:05 local
    const f = setClockFromDate(d);
    const dv = new DataView(f.buffer, 2, 18);
    expect(dv.getInt16(0, true)).toBe(5);
    expect(dv.getInt16(2, true)).toBe(4);
    expect(dv.getInt16(4, true)).toBe(3);
    expect(dv.getInt16(6, true)).toBe(2);
    expect(dv.getInt16(8, true)).toBe(0);
    expect(dv.getInt16(10, true)).toBe(126);
    expect(dv.getInt16(12, true)).toBe(d.getDay());
    expect(dv.getInt16(14, true)).toBe(1);
  });
});

describe('parseResponse', () => {
  it('dispatches by code', () => {
    const p = parseResponse(decodeFrame(encodeFrame('P', [1])));
    expect(p.code === 'P' && p.power.on).toBe(true);
    const a = parseResponse(decodeFrame(encodeFrame('a', [0, 0])));
    expect(a.code === 'a' && a.activeChannel.length).toBe(0);
    const u = parseResponse(decodeFrame(encodeFrame('Z', [])));
    expect('unknown' in u && u.unknown).toBe(true);
  });
});

describe('power notification', () => {
  it("decodes the 'P' the scanner sends unprompted when it is switched off", () => {
    const p = parseResponse(decodeFrame(encodeFrame('P', [0])));
    expect(p).toMatchObject({ code: 'P', power: { on: false, raw: 0 } });
  });
});
