import { describe, expect, it } from 'vitest';
import { parseVersion, versionNumber } from '../version';

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

describe('parseVersion', () => {
  it('decodes the WS1080 example from the spec', () => {
    const data = new Uint8Array([0x00, ...ascii('WS1080  '), 0x10, 0x12, 0x21, 0x03]);
    const v = parseVersion(data);
    expect(v.modelRaw).toBe('WS1080  ');
    expect(v.model).toBe('WS1080');
    expect(v.boot.text).toBe('1.0');
    expect(v.cpu).toEqual({ major: 1, minor: 2, raw: 0x12, text: '1.2' });
    expect(v.dsp1.text).toBe('2.1');
    expect(v.dsp2.text).toBe('0.3');
  });

  it('strips NULs from the model field', () => {
    const data = new Uint8Array([0x00, ...ascii('TRX-1'), 0, 0, 0, 0x11, 0x11, 0x11, 0x11]);
    expect(parseVersion(data).model).toBe('TRX-1');
  });

  it('rejects the wrong length', () => {
    expect(() => parseVersion(new Uint8Array(12))).toThrow(/13 bytes/);
  });

  it('splits nibbles', () => {
    expect(versionNumber(0xfe)).toEqual({ major: 15, minor: 14, raw: 0xfe, text: '15.14' });
  });
});
