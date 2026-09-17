import { describe, expect, it } from 'vitest';
import { pickConfirmation } from '../confirm';

describe('pickConfirmation', () => {
  const any = { id: 1, frequencyHz: 456_350_000, tone: '', tgid: null };
  const cc12 = { id: 2, frequencyHz: 456_350_000, tone: 'CC 12', tgid: null };
  const cc12tg19 = { id: 3, frequencyHz: 456_350_000, tone: 'CC 12', tgid: 19 };
  const other = { id: 4, frequencyHz: 453_250_000, tone: '', tgid: null };
  const list = [any, cc12, cc12tg19, other];

  it('takes the most specific confirmation that does not contradict the reception', () => {
    expect(pickConfirmation(list, 456_350_000, 'CC 12', 19)?.id).toBe(3);
    expect(pickConfirmation(list, 456_350_000, 'CC 12', 7)?.id).toBe(2);
    expect(pickConfirmation(list, 456_350_000, 'CC 12', null)?.id).toBe(2);
    expect(pickConfirmation(list, 456_350_000, 'CC 3', 19)?.id).toBe(1);
    expect(pickConfirmation(list, 456_350_000, '', null)?.id).toBe(1);
    expect(pickConfirmation(list, 453_250_000, 'CC 1', 1)?.id).toBe(4);
    expect(pickConfirmation(list, 1, '', null)).toBeNull();
  });

  it('never applies a keyed confirmation to a reception without that key', () => {
    expect(pickConfirmation([cc12, cc12tg19], 456_350_000, '', null)).toBeNull();
    expect(pickConfirmation([cc12tg19], 456_350_000, 'CC 12', null)).toBeNull();
  });
});

describe('detectedCode', () => {
  it('is the detected tone, else the DMR colour code', async () => {
    const { detectedCode } = await import('../rr');
    expect(detectedCode({ detectedTone: 'CTCSS 94.8', colorCode: null })).toBe('CTCSS 94.8');
    expect(detectedCode({ detectedTone: null, colorCode: 12 })).toBe('CC 12');
    expect(detectedCode({ detectedTone: 'NAC 293', colorCode: 12 })).toBe('NAC 293');
    expect(detectedCode({ detectedTone: null, colorCode: null })).toBeNull();
    expect(detectedCode(null)).toBeNull();
  });
});
