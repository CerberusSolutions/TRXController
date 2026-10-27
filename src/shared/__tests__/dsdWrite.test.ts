import { describe, expect, it } from 'vitest';
import { aliasesOf, applyAliases, followModeOf, setGroupFollow } from '../dsdWrite';

const RADIOS = `; DSD+ 2.523; radio records
; line format: protocol, networkID, group, radio, priority, override, hits, timestamp, "radio alias"
P25,       BEE00.169, 63305,      16732141,   50,  Normal,       2,  2025/09/10 13:59,  "", "FIRE DISPATCH",  57699325
P25,       BEE00.169, 63305,      16734160,   50,  Normal,      38,  2026/10/01 18:59,  ""
P25,       BEE00.169, 63354,      16734046,   50,  Normal,       9,  2026/09/19 17:48,  "Typed in DSD", "CRO SFS 007",    0E362A72
D-Star,    0,         -1,         2112515704, 50,  Normal,       1,  2025/10/12  9:52,  *"G0LGF/ID31"
TIIIStd,   S1,        -2,         366264,     50,  Normal,      12,  2026/10/02 17:37
; 5 records
`;

describe('applyAliases', () => {
  it('names radios whose alias is empty or auto-generated, keeps one typed in DSD+, and leaves every other byte alone', () => {
    const names: Record<string, string> = { 'BEE00.169|16732141': 'Fire Dispatch 1', 'BEE00.169|16734046': 'Ours', '0|2112515704': 'Gary', 'S1|366264': 'Bus 264', 'BEE00.169|16734160': 'Fire Dispatch 1' };
    const r = applyAliases(RADIOS, 'radios', (network, id) => names[`${network}|${id}`] ?? null);
    expect(r.written).toBe(4);
    expect(r.kept).toBe(1);
    expect(r.unchanged).toBe(0);
    const lines = r.text.split('\n');
    // Comments and the talker alias with its hash are untouched; the first quoted field carries the name.
    expect(lines[0]).toBe('; DSD+ 2.523; radio records');
    expect(lines[2]).toBe('P25,       BEE00.169, 63305,      16732141,   50,  Normal,       2,  2025/09/10 13:59,  "Fire Dispatch 1", "FIRE DISPATCH",  57699325');
    expect(lines[3]).toBe('P25,       BEE00.169, 63305,      16734160,   50,  Normal,      38,  2026/10/01 18:59,  "Fire Dispatch 1"');
    // Typed in DSD+: kept.
    expect(lines[4]).toContain('"Typed in DSD", "CRO SFS 007"');
    // The asterisk goes with the auto alias.
    expect(lines[5]).toBe('D-Star,    0,         -1,         2112515704, 50,  Normal,       1,  2025/10/12  9:52,  "Gary"');
    // A line with no alias slot at all gets one.
    expect(lines[6]).toBe('TIIIStd,   S1,        -2,         366264,     50,  Normal,      12,  2026/10/02 17:37,  "Bus 264"');
    expect(lines[7]).toBe('; 5 records');
    // Applying the same names again changes nothing.
    const again = applyAliases(r.text, 'radios', (network, id) => names[`${network}|${id}`] ?? null);
    expect(again.text).toBe(r.text);
    expect(again.written).toBe(0);
    expect(again.unchanged).toBe(4);
  });

  it('works on the groups file, keeps CRLF line ends and quotes a quote', () => {
    const groups = 'P25,       BEE00.169, 46226,      50,  Normal,       7,  2023/07/17 19:13,  ""\r\nTIIIStd,   S1,        366863,     50,  Normal,       2,  2025/09/16  7:46,  "Bus"\r\n';
    const r = applyAliases(groups, 'groups', (network, id) => (network === 'BEE00.169' && id === 46226 ? 'RAFC "FD" Disp' : network === 'S1' ? 'Buses' : null));
    expect(r.written).toBe(1);
    expect(r.kept).toBe(1);
    expect(r.text).toBe('P25,       BEE00.169, 46226,      50,  Normal,       7,  2023/07/17 19:13,  "RAFC ""FD"" Disp"\r\nTIIIStd,   S1,        366863,     50,  Normal,       2,  2025/09/16  7:46,  "Bus"\r\n');
    expect(aliasesOf(r.text, 'groups').get('BEE00.169|46226')).toBe('RAFC "FD" Disp');
  });
});

describe('setGroupFollow', () => {
  const GROUPS = `; DSD+ 2.523; group records
P25,       BEE00.169, 46226,      50,  Normal,       7,  2023/07/17 19:13,  "RAFC FD Disp"
P25,       BEE00.169, 63354,      50,  Normal,     418,  2026/10/02  8:54,  ""
TIIIStd,   S1,        366863,     50,  Normal,       2,  2025/09/16  7:46,  "Bus"
; 3 records; 2 aliases
`;
  const T = new Date(2026, 9, 2, 18, 26).getTime();

  it('sets the priority and override of an existing line and reads them back as a mode', () => {
    const r = setGroupFollow(GROUPS, 'P25', 'BEE00.169', 63354, 'follow', T);
    expect(r.changed).toBe(true);
    expect(r.appended).toBe(false);
    expect(r.text.split('\n')[2]).toBe('P25,       BEE00.169, 63354,      1,  Normal,     418,  2026/10/02  8:54,  ""');
    const lo = setGroupFollow(r.text, 'P25', 'BEE00.169', 63354, 'lockout', T);
    expect(lo.text.split('\n')[2]).toBe('P25,       BEE00.169, 63354,      50,  L/O,     418,  2026/10/02  8:54,  ""');
    expect(setGroupFollow(lo.text, 'P25', 'BEE00.169', 63354, 'lockout', T).changed).toBe(false);
    expect(followModeOf(1, 'Normal')).toBe('follow');
    expect(followModeOf(50, 'L/O')).toBe('lockout');
    expect(followModeOf(50, 'Normal')).toBe('normal');
  });

  it('adds a line after the network\'s last one, or before the record-count comment for a new network', () => {
    const r = setGroupFollow(GROUPS, 'P25', 'BEE00.169', 63357, 'follow', T);
    expect(r.appended).toBe(true);
    expect(r.text.split('\n')[3]).toBe('P25, BEE00.169, 63357, 1, Normal, 0, 2026/10/02 18:26, ""');
    const n = setGroupFollow(GROUPS, 'TIIInonStd', 'L1', 69, 'lockout', T);
    const lines = n.text.split('\n');
    expect(lines[4]).toBe('TIIInonStd, L1, 69, 50, L/O, 0, 2026/10/02 18:26, ""');
    expect(lines[5]).toBe('; 3 records; 2 aliases');
  });
});
