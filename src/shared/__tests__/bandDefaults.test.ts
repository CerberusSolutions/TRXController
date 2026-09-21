import { describe, expect, it } from 'vitest';
import { defaultModulation } from '../bandDefaults';

describe('defaultModulation', () => {
  it('is AM on the civil and military airbands', () => {
    expect(defaultModulation(118.1e6)).toBe('AM');
    expect(defaultModulation(136.975e6)).toBe('AM');
    expect(defaultModulation(243e6)).toBe('AM');
    expect(defaultModulation(399.9e6)).toBe('AM');
  });
  it('is FM on VHF Marine', () => {
    expect(defaultModulation(156.8e6)).toBe('FM');
    expect(defaultModulation(161.975e6)).toBe('FM');
  });
  it('is NFM on the 12.5 kHz bands', () => {
    expect(defaultModulation(27.60125e6)).toBe('NFM');
    expect(defaultModulation(70.45e6)).toBe('NFM');
    expect(defaultModulation(145.5e6)).toBe('NFM');
    expect(defaultModulation(153.5e6)).toBe('NFM');
    expect(defaultModulation(433.5e6)).toBe('NFM');
    expect(defaultModulation(446.00625e6)).toBe('NFM');
    expect(defaultModulation(137e6)).toBe('NFM');
    expect(defaultModulation(400e6)).toBe('NFM');
  });
});
