import { describe, expect, it } from 'vitest';
import { CTCSS_TONES, DCS_CODES, MODES, formatSquelch, modeName, tsysTypeName } from '../tables';

describe('tables', () => {
  it('has all 21 modes', () => {
    expect(Object.keys(MODES)).toHaveLength(21);
    expect(modeName(0x00)).toBe('Main Menu');
    expect(modeName(0x14)).toBe('Sweeper Settings Menu');
  });

  it('has 50 CTCSS tones and 112 DCS codes as in the spec', () => {
    expect(CTCSS_TONES).toHaveLength(50);
    expect(CTCSS_TONES[0]).toBe(67.0);
    expect(CTCSS_TONES[49]).toBe(254.1);
    expect(DCS_CODES).toHaveLength(112);
    expect(DCS_CODES[0]).toBe('006');
    expect(DCS_CODES[111]).toBe('754');
  });

  it('formats squelch values', () => {
    expect(formatSquelch(0, 0)).toBe('No Tone');
    expect(formatSquelch(1, 12)).toBe('CTCSS 100.0');
    expect(formatSquelch(1, 99)).toBe('CTCSS ?(99)');
    expect(formatSquelch(2, 5)).toBe('DCS 023');
    expect(formatSquelch(3, 0x293)).toBe('NAC 293');
    expect(formatSquelch(3, 0x1)).toBe('NAC 001');
    expect(formatSquelch(9, 1)).toMatch(/Unknown/);
  });

  it('names TSYS types', () => {
    expect(tsysTypeName(4)).toBe('DMR');
    expect(tsysTypeName(9)).toBe('Unknown (9)');
  });
});
