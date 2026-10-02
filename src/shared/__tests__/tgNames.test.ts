import { describe, expect, it } from 'vitest';
import { pickTgName, tgNameSystem, tgSystems } from '../tgNames';

describe('pickTgName', () => {
  const list = [
    { id: 1, system: 'SOT Council', tgid: 100, name: 'Highways Depot', source: 'USER' as const },
    { id: 2, system: 'L1', tgid: 100, name: 'HWY', source: 'DSD' as const },
    { id: 3, system: '', tgid: 100, name: 'Any 100', source: 'USER' as const },
    { id: 4, system: 'L1', tgid: 69, name: 'Bus Ops', source: 'DSD' as const },
    { id: 5, system: '', tgid: 69, name: 'Sixty-nine', source: 'DSD' as const },
  ];

  it("takes the user's name on the most specific system first, then DSD+'s alias", () => {
    expect(pickTgName(list, 100, ['SOT Council', 'L1'])?.id).toBe(1);
    // No tag yet (Tune Mode, or the network not matched): the user's any-system name beats DSD+'s on the network.
    expect(pickTgName(list, 100, ['L1'])?.id).toBe(3);
    expect(pickTgName(list, 69, ['SOT Council', 'L1'])?.id).toBe(4);
    expect(pickTgName(list, 69, ['Other'])?.id).toBe(5);
    expect(pickTgName(list, 69, [])?.id).toBe(5);
    expect(pickTgName(list, 7, ['L1'])).toBeNull();
    expect(pickTgName(list, null, ['L1'])).toBeNull();
  });

  it('orders the systems most specific first with any-system last and no repeats', () => {
    expect(tgSystems(['SOT Council', null, 'L1', 'SOT Council', undefined, ''])).toEqual(['SOT Council', 'L1', '']);
    expect(tgSystems([])).toEqual(['']);
  });

  it('keys a talkgroup to the trunked system only', () => {
    expect(tgNameSystem({ objectType: 'TGRP', system: 'SOT Council' })).toBe('SOT Council');
    expect(tgNameSystem({ objectType: 'Talkgroup', system: 'P25 Sites' })).toBe('P25 Sites');
    expect(tgNameSystem({ objectType: 'CONV', system: 'Shopwatch' })).toBe('');
    expect(tgNameSystem({ objectType: 'Search', system: '' })).toBe('');
  });
});
