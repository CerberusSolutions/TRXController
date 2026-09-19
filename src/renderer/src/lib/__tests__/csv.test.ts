import { describe, expect, it } from 'vitest';
import type { ReceptionRow } from '../../../../shared/ipc';
import { ALPHA_TAG_MAX, EZSCAN_HEADER, LOG_CSV_HEADER, alphaTag, candidatesText, csvCell, ezModeOf, ezObjects, ezToneOf, frequencyTag, logToCsv, objectCode, toCsv } from '../csv';

const base: ReceptionRow = {
  id: 1, startedAt: Date.UTC(2026, 8, 17, 8, 12, 1), endedAt: Date.UTC(2026, 8, 17, 8, 12, 17), frequencyHz: 453_062_500, mode: 'FM', signalType: 'DMR',
  name: 'University of Buckingham', system: '', scanlist: 'Tune Mode', objectType: 'Search', tgid: 1, radioId: 206, site: '', squelch: 'No Tone',
  tone: 'CC 13', rssiPeak: 275, hits: 28, calls: 2, radioCallsign: null, radioName: null, licensee: 'University of Buckingham', source: 'RRDB', scannerName: '', wtr: 'University of Buckingham', rrName: 'University of Buckingham', rrSystem: '', rpt: '', rruk: 'UNIVERSITY OF BUCKINGHAM',
  distanceKm: 3.24, bearingDeg: 47,
  candidates: [
    { source: 'RRDB', name: 'University of Buckingham', detail: 'Bucks · CC 13 ✓', distanceKm: 3.24, bearingDeg: 47, match: true },
    { source: 'WTR', name: 'University of Buckingham', detail: 'DIG · base', distanceKm: 3.24, bearingDeg: 47 },
    { source: 'WTR', name: 'Kwik Fit (GB) Limited', detail: 'DIG', distanceKm: null, bearingDeg: null },
  ],
};

describe('csv', () => {
  it('quotes only what needs quoting', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });

  it("maps the scanner's codes and modes onto EZ Scan's columns", () => {
    expect(ezToneOf('CTCSS 94.8')).toEqual(['CTCSS', '94.8']);
    expect(ezToneOf('DCS 023')).toEqual(['DCS', '023']);
    expect(ezToneOf('NAC 293')).toEqual(['NAC', '293']);
    expect(ezToneOf('CC 12')).toEqual(['Search', '']);
    expect(ezToneOf('')).toEqual(['Search', '']);
    expect(ezModeOf({ mode: 'NFM', signalType: 'NFM' }, 'CC 12')).toEqual(['DMR', 'Digital']);
    expect(ezModeOf({ mode: 'NFM', signalType: 'DG' }, '')).toEqual(['DMR', 'Digital']);
    expect(ezModeOf({ mode: 'NFM', signalType: 'ENC' }, 'NAC 167')).toEqual(['P25', 'Digital']);
    expect(ezModeOf({ mode: 'NFM', signalType: 'NFM' }, 'RAN 1')).toEqual(['NXDN', 'Digital']);
    expect(ezModeOf({ mode: 'AM', signalType: 'AM' }, '')).toEqual(['AM', 'Auto']);
    expect(ezModeOf({ mode: 'NFM', signalType: 'NFM' }, 'CTCSS 94.8')).toEqual(['NFM', 'Auto']);
    expect(ezModeOf({ mode: 'FM', signalType: 'FM' }, '')).toEqual(['FM', 'Auto']);
    expect(ezModeOf({ mode: 'Unknown (7)', signalType: '' }, '')).toEqual(['AUTO', 'Auto']);
    // The detected code, else the programmed squelch, else nothing.
    expect(objectCode({ tone: 'CC 13', squelch: 'CTCSS 100.0' })).toBe('CC 13');
    expect(objectCode({ tone: '', squelch: 'CTCSS 100.0' })).toBe('CTCSS 100.0');
    expect(objectCode({ tone: '', squelch: 'No Tone' })).toBe('');
    expect(frequencyTag(453_062_500)).toBe('453.0625');
    expect(frequencyTag(145_500_000)).toBe('145.500');
  });

  it('cuts the alpha tag to 16 characters, falling back to the scanner label, then the frequency', () => {
    expect(alphaTag({ row: base, frequencyHz: base.frequencyHz })).toBe('University of Bu');
    expect(alphaTag({ row: base, frequencyHz: base.frequencyHz }).length).toBe(ALPHA_TAG_MAX);
    expect(alphaTag({ row: { ...base, name: '', scannerName: '453.0625 CC13' }, frequencyHz: base.frequencyHz })).toBe('453.0625 CC13');
    expect(alphaTag({ row: { ...base, name: '', scannerName: '' }, frequencyHz: base.frequencyHz })).toBe('453.0625');
    expect(alphaTag({ row: { ...base, name: '  Thames  Valley   Taxis Ltd ' }, frequencyHz: 1 })).toBe('Thames Valley Ta');
    expect(alphaTag({ row: { ...base, name: 'GB3AA · BRISTOL' }, frequencyHz: 1 })).toBe('GB3AA BRISTOL');
    expect(alphaTag({ row: { ...base, name: 'Café ✓ Radio' }, frequencyHz: 1 })).toBe('Caf Radio');
  });

  it('folds the log into one object per frequency and code, newest named row naming it', () => {
    const rows: ReceptionRow[] = [
      { ...base, id: 5, startedAt: base.startedAt + 90_000, endedAt: null, name: '', calls: 1, rssiPeak: 200 }, // newest, still open, unnamed
      { ...base, id: 4, startedAt: base.startedAt + 60_000, endedAt: base.startedAt + 70_000, name: 'Univ of Bucks', calls: 3, rssiPeak: 310 },
      { ...base, id: 3, tone: 'CC 3', name: 'Someone else' }, // same frequency, another colour code: its own object
      { ...base, id: 2, frequencyHz: 145_500_000, tone: '', squelch: 'No Tone', mode: 'NFM', signalType: 'NFM', name: '', scannerName: '' },
      base,
    ];
    const objs = ezObjects(rows);
    expect(objs.map((o) => [o.frequencyHz, o.code, o.row.id, o.receptions, o.calls, o.rssiPeak, o.lastHeard])).toEqual([
      [145_500_000, '', 2, 1, 2, 275, base.endedAt],
      [453_062_500, 'CC 13', 4, 3, 6, 310, null],
      [453_062_500, 'CC 3', 3, 1, 2, 275, base.endedAt],
    ]);
    expect(objs[1]!.firstHeard).toBe(base.startedAt);
  });

  it("writes EZ Scan's 32 columns as its own export does, then the log's", () => {
    const csv = logToCsv([base, { ...base, id: 2, frequencyHz: 145_500_000, tone: 'CTCSS 94.8', squelch: 'No Tone', mode: 'NFM', signalType: 'NFM', name: 'GB3AA', tgid: null, candidates: [] }]);
    expect(csv.startsWith('"AlphaTag","Frequency","Tone Type","Tone",')).toBe(true);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    const [header, l1, l2, rest] = csv.split('\r\n');
    expect(header).toBe(LOG_CSV_HEADER.map((h) => `"${h}"`).join(','));
    expect(EZSCAN_HEADER).toHaveLength(32);
    // Analogue with a tone: CTCSS, NFM, the DMR columns blank, no scanlist yet.
    expect(l1).toContain('"GB3AA",145.500000,"CTCSS","94.8","Yes",2.0,"No","No","Yes","No","Leave","No","No","NFM","Auto","Off","No","55555555",,,,,"None",500,500,"No",,,,,0,"",');
    // DMR with a colour code: Search for the tone, the code in Color Code, talkgroup and slot wildcards.
    expect(l2).toContain('"University of Bu",453.062500,"Search","","Yes",2.0,"No","No","Yes","No","Leave","No","No","DMR","Digital","Off","No","55555555",,,,,"None",500,500,"No",*,13,*,,0,"",');
    expect(l2).toContain(',2,275,DMR,University of Buckingham,,Tune Mode,Search,1,CC 13,No Tone,,University of Buckingham,RRDB,,University of Buckingham,University of Buckingham,,,UNIVERSITY OF BUCKINGHAM,3.2,47,');
    expect(candidatesText(base)).toBe('RRDB University of Buckingham · Bucks · CC 13 ✓ (3.2 km 047°) | WTR University of Buckingham · DIG · base (3.2 km 047°) | WTR Kwik Fit (GB) Limited · DIG');
    expect(l2!.endsWith(candidatesText(base))).toBe(true);
    expect(rest).toBe('');
    expect(l1!.split(',').length).toBeGreaterThanOrEqual(LOG_CSV_HEADER.length);
    // Rows from before placement existed export blanks, not errors.
    expect(logToCsv([{ ...base, distanceKm: null, bearingDeg: null, candidates: [] }]).split('\r\n')[1]).toMatch(/UNIVERSITY OF BUCKINGHAM,,,$/);
  });
});
