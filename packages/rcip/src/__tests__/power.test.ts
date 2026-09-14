import { describe, expect, it } from 'vitest';
import { parsePower } from '../power';

describe('parsePower', () => {
  it('decodes on and off', () => {
    expect(parsePower(new Uint8Array([1]))).toEqual({ on: true, raw: 1 });
    expect(parsePower(new Uint8Array([0]))).toEqual({ on: false, raw: 0 });
  });
  it('rejects the wrong length', () => {
    expect(() => parsePower(new Uint8Array([]))).toThrow(/1 byte/);
  });
});
