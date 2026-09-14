import { describe, expect, it } from 'vitest';
import { fromHex } from '../frame';
import { formatFrequency, parseStatus } from '../status';

describe('parseStatus', () => {
  it('decodes a worked example', () => {
    // mode=0x0A Scan, sq=0b011 (RF open, unmuted), batt=0x0345 on USB (battH|0x80),
    // rssi=0x0120, zeromatic=0x0007, LED r=255 g=0 b=64,
    // freq=462562500 Hz little-endian (C4 24 92 1B), rxmode=2 NFM
    const data = fromHex('0A 03 45 83 20 01 07 00 FF 00 40 C4 24 92 1B 02');
    const s = parseStatus(data);
    expect(s.mode).toBe(0x0a);
    expect(s.modeName).toBe('Scan');
    expect(s.squelch).toEqual({ rf: true, unmuted: true, xf: false, raw: 3 });
    expect(s.battery).toEqual({ level: 0x0345, usb: true });
    expect(s.rssi).toBe(0x0120);
    expect(s.zeromatic).toBe(7);
    expect(s.led).toEqual({ r: 255, g: 0, b: 64 });
    expect(s.frequencyHz).toBe(462562500);
    expect(s.rxMode).toBe(2);
    expect(s.rxModeName).toBe('NFM');
  });

  it('decodes a high frequency without sign problems', () => {
    const data = fromHex('12 04 00 00 00 00 00 00 00 00 00 94 6B B9 32 00');
    const s = parseStatus(data);
    expect(s.frequencyHz).toBe(851012500);
    expect(s.modeName).toBe('Search');
    expect(s.squelch.xf).toBe(true);
    expect(s.battery.usb).toBe(false);
    expect(s.rxModeName).toBe('AM');
  });

  it('names unknown modes and rx modes', () => {
    const data = fromHex('7F 00 00 00 00 00 00 00 00 00 00 00 00 00 00 09');
    const s = parseStatus(data);
    expect(s.modeName).toMatch(/Unknown \(0x7f\)/);
    expect(s.rxModeName).toBe('Unknown (9)');
  });

  it('rejects the wrong length', () => {
    expect(() => parseStatus(new Uint8Array(15))).toThrow(/16 bytes/);
  });

  it('formats frequency in MHz', () => {
    expect(formatFrequency(462562500)).toBe('462.56250 MHz');
  });
});
