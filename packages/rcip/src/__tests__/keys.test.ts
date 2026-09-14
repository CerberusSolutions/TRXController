import { describe, expect, it } from 'vitest';
import { KEY_LABELS, Key, PROVISIONAL_KEYS, digitKey, isKeyCode, keyLabel, keyName } from '../keys';

describe('key table', () => {
  it('matches the spec table', () => {
    expect(Key.MENU).toBe(17);
    expect(Key.SEL).toBe(9);
    expect(Key.SKIP).toBe(1);
    expect(Key.WX).toBe(3);
    expect(Key.ATT).toBe(15);
    expect(Key.PRI).toBe(5);
    expect(Key.FN).toBe(12);
    expect(Key.DECIMAL).toBe(19);
    expect([Key.DIGIT_1, Key.DIGIT_2, Key.DIGIT_3, Key.DIGIT_4, Key.DIGIT_5]).toEqual([29, 22, 30, 23, 31]);
    expect([Key.DIGIT_6, Key.DIGIT_7, Key.DIGIT_8, Key.DIGIT_9, Key.DIGIT_0]).toEqual([24, 32, 25, 33, 26]);
    expect([Key.KNOB_CW, Key.KNOB_CCW, Key.KNOB_PUSH, Key.POWER]).toEqual([40, 41, 43, 44]);
  });

  it('assigns the four unlabelled codes to the arrows as observed on the TRX-1e', () => {
    expect(Key.UP).toBe(8);
    expect(Key.DOWN).toBe(10);
    expect(Key.LEFT).toBe(16);
    expect(Key.RIGHT).toBe(2);
    expect(PROVISIONAL_KEYS).toEqual(['LEFT']);
  });

  it('has unique codes and a label for every key', () => {
    const codes = Object.values(Key);
    expect(new Set(codes).size).toBe(codes.length);
    for (const name of Object.keys(Key) as (keyof typeof Key)[]) expect(KEY_LABELS[name]).toBeTruthy();
  });

  it('maps codes back to names', () => {
    expect(keyName(17)).toBe('MENU');
    expect(keyName(99)).toBeUndefined();
    expect(keyLabel(9)).toBe('PLAY/SEL/PAUSE');
    expect(keyLabel(99)).toBe('key 99');
    expect(isKeyCode(44)).toBe(true);
    expect(isKeyCode(0)).toBe(false);
  });

  it('maps digit characters', () => {
    expect(digitKey('0')).toBe(Key.DIGIT_0);
    expect(digitKey('7')).toBe(Key.DIGIT_7);
    expect(digitKey('.')).toBe(Key.DECIMAL);
    expect(digitKey('x')).toBeUndefined();
  });
});
