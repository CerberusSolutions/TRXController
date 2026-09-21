import type { Modulation } from './programming';

/**
 * The modulation a new channel starts with, from its frequency, on the UK's band plans: AM on the civil
 * (108-137 MHz) and military (225-400 MHz) airbands, FM on VHF Marine (156-162.025 MHz, still 25 kHz channels
 * with 5 kHz deviation), and NFM everywhere else, since UK amateur simplex, PMR446 and business radio are
 * all 12.5 kHz spaced with 2.5 kHz deviation, where a wide filter only admits the neighbours and noise.
 * It is a starting point for a channel the user has not set a mode on, never applied over one they have.
 */
export function defaultModulation(hz: number): Modulation {
  if (hz >= 108e6 && hz < 137e6) return 'AM';
  if (hz >= 225e6 && hz < 400e6) return 'AM';
  if (hz >= 156e6 && hz <= 162.025e6) return 'FM';
  return 'NFM';
}
