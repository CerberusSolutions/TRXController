import { describe, expect, it } from 'vitest';
import type { ReceptionRow } from '../../../../shared/ipc';
import { LOG_CSV_HEADER, csvCell, logToCsv, toCsv } from '../csv';

describe('csv', () => {
  it('quotes only what needs quoting', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(toCsv(['a', 'b'], [[1, 'x,y']])).toBe('a,b\r\n1,"x,y"\r\n');
  });

  it("writes one line per log row with the table's fields", () => {
    const row = {
      id: 1, startedAt: Date.UTC(2026, 8, 17, 8, 12, 1), endedAt: Date.UTC(2026, 8, 17, 8, 12, 17), frequencyHz: 453_062_500, mode: 'FM', signalType: 'DMR',
      name: 'University of Buckingham', system: '', scanlist: 'Tune Mode', objectType: 'Search', tgid: 1, radioId: 206, site: '', squelch: 'No Tone',
      tone: 'CC 13', rssiPeak: 275, hits: 28, calls: 2, radioCallsign: null, radioName: null, licensee: 'University of Buckingham', source: 'RRDB', scannerName: '', wtr: 'University of Buckingham', rrName: 'University of Buckingham', rrSystem: '', rpt: '',
    } as ReceptionRow;
    const csv = logToCsv([row]);
    const [header, line, rest] = csv.split('\r\n');
    expect(header).toBe(LOG_CSV_HEADER.join(','));
    expect(line).toContain(',16.0,2,453.062500,FM,DMR,University of Buckingham,,Tune Mode,Search,1,206,,,CC 13,No Tone,,University of Buckingham,RRDB,,University of Buckingham,University of Buckingham,,,275,28');
    expect(rest).toBe('');
  });
});
