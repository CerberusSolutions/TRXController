import { describe, expect, it } from 'vitest';
import { pickRadioName, radioNameSystem } from '../radioNames';

const NAMES = [
  { radioId: 5, system: 'SOT Council', name: 'Chatterley Whitfield Radio User 1' },
  { radioId: 5, system: '', name: 'Any radio 5' },
  { radioId: 7, system: 'P25 Sites', name: 'Radio Seven' },
];

describe('pickRadioName', () => {
  it('prefers the name keyed to the system, then the one keyed to any system', () => {
    expect(pickRadioName(NAMES, 5, 'SOT Council')?.name).toBe('Chatterley Whitfield Radio User 1');
    expect(pickRadioName(NAMES, 5, 'Other System')?.name).toBe('Any radio 5');
    expect(pickRadioName(NAMES, 5, '')?.name).toBe('Any radio 5');
    expect(pickRadioName(NAMES, 5, null)?.name).toBe('Any radio 5');
  });

  it('never crosses systems or radios', () => {
    expect(pickRadioName(NAMES, 7, 'SOT Council')).toBeNull();
    expect(pickRadioName(NAMES, 7, 'P25 Sites')?.name).toBe('Radio Seven');
    expect(pickRadioName(NAMES, 9, 'P25 Sites')).toBeNull();
    expect(pickRadioName(NAMES, null, 'P25 Sites')).toBeNull();
  });
});

describe('radioNameSystem', () => {
  it('keys a trunked object by its system and a conventional one by nothing', () => {
    expect(radioNameSystem({ objectType: 'TGRP', system: 'SOT Council' })).toBe('SOT Council');
    expect(radioNameSystem({ objectType: 'Talkgroup', system: 'County P25' })).toBe('County P25');
    // A conventional DMR radio ID is global, whatever system name a lookup put on the row.
    expect(radioNameSystem({ objectType: 'CONV', system: 'Shopwatch Aylesbury' })).toBe('');
    expect(radioNameSystem({ objectType: 'Search', system: '' })).toBe('');
  });
});
