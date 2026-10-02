import { describe, expect, it } from 'vitest';
import { parseDsdRadios } from '../dsdRadios';

// Lines from a DSD+ radio list on a UK P25 system, 1 Oct 2026.
const SAMPLE = `P25,       BEE00.169, 63305,      16732141,   50,  Normal,       2,  2025/09/10 13:59,  "", "FIRE DISPATCH",  57699325
P25,       BEE00.169, 63305,      16734160,   50,  Normal,      38,  2026/10/01 18:59,  ""
P25,       BEE00.169, 63354,      16734046,   50,  Normal,       9,  2026/09/19 17:48,  "", "CRO SFS 007",    0E362A72
P25,       BEE00.169, -2,         16734061,   50,  Normal,      12,  2025/09/10 14:39,  "", "CRO SFS 022",    1531BB25

; a comment
not a radio line
P25,       BEE00.169, -2,         16734068,   50,  Normal,       0,  2025/07/05 13:30,  ""
`;

describe('parseDsdRadios', () => {
  it('reads the radio ID, talkgroup and alias off each line and skips what is not a radio', () => {
    const { radios, skipped } = parseDsdRadios(SAMPLE);
    expect(skipped).toBe(1);
    expect(radios).toHaveLength(5);
    expect(radios[0]).toEqual({ protocol: 'P25', network: 'BEE00.169', tgid: 63305, radioId: 16732141, hits: 2, lastHeard: '2025/09/10 13:59', alias: 'FIRE DISPATCH' });
    // No alias: the quoted string is empty and nothing follows it.
    expect(radios[1]).toMatchObject({ radioId: 16734160, alias: '', hits: 38 });
    // -2 is DSD+'s "no talkgroup".
    expect(radios[3]).toMatchObject({ radioId: 16734061, tgid: null, alias: 'CRO SFS 022' });
    expect(radios[4]).toMatchObject({ radioId: 16734068, alias: '' });
  });

  it('drops the asterisk DSD+ puts on an alias it generated itself', () => {
    const { radios } = parseDsdRadios('D-Star,    0,         -1,         2112515704, 50,  Normal,       1,  2025/10/12  9:52,  *"G0LGF/ID31"');
    expect(radios[0]).toMatchObject({ protocol: 'D-Star', radioId: 2112515704, tgid: null, alias: 'G0LGF/ID31' });
    // An empty auto alias is still no alias.
    expect(parseDsdRadios('NEXEDGE48, 0, 12, 5, 50, Normal, 1, 2025/07/05 9:12, *""').radios[0]!.alias).toBe('');
  });

  it('keeps a comma inside a quoted alias', () => {
    const { radios } = parseDsdRadios('DMR, 1.2, 100, 5, 50, Normal, 1, 2026/10/01 19:21, "", "Chatterley, Whitfield", AB12CD34');
    expect(radios[0]).toMatchObject({ protocol: 'DMR', radioId: 5, tgid: 100, alias: 'Chatterley, Whitfield' });
  });
});
