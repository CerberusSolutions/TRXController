import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCtcss, readRepeaterCsv } from '../identities/repeaters';
import { LogDb } from '../log/db';
import { ctcssHz, rankRepeaters, repeaterLabel } from '../../shared/repeaters';

// Header and rows as ukrepeater.net's repeaterlist_all.csv has them (16 Sep 2026), trailing comma included.
const CSV = [
  '"CALL","BAND","CHAN","txMHz","rxMHz","CTCSS","QTHR","WHERE","lat","lon","ANALOG","DMR","DSTAR","FUSION",',
  '2E0CJT,70CM,DVU12,439.150000,430.150000,,IO93,BARNSLEY,53.5,-1.4,,Y,,,',
  'GB3AA,2M,RV53,145.662500,145.062500,94.8,IO81RO,BRISTOL,51.591,-2.539,Y,,,,',
  'GB3WR,2M,RV53,145.662500,145.062500,94.8 ,IO81VK,WELLS,51.21,-2.63,Y,,,Y,',
  'GB3BS,2M,RV53,145.662500,145.062500,118.8,IO81QM,BRISTOL,51.5,-2.6,Y,Y,Y,Y,',
  'GB3OLD,70CM,RB08,433.200000,434.800000,1750,JO02,HAVERHILL,52.1,0.4,Y,,,,',
  'GB3NA,70CM,RU70,430.875000,438.475000,not applicable,IO91,READING,,,,Y,,,',
  'GB3AA,2M,RV53,145.662500,145.062500,94.8,IO81RO,BRISTOL,51.591,-2.539,Y,,,,',
  ',2M,,145.500000,,,,NOWHERE,0,0,Y,,,,',
].join('\r\n');

describe('parseCtcss', () => {
  it('reads sub-audible tones and ignores everything else', () => {
    expect(parseCtcss('94.8')).toBe(94.8);
    expect(parseCtcss('103.5 ')).toBe(103.5);
    expect(parseCtcss('67')).toBe(67);
    expect(parseCtcss('')).toBeNull();
    expect(parseCtcss('not applicable')).toBeNull();
    expect(parseCtcss('1750')).toBeNull();
  });
});

describe('readRepeaterCsv', () => {
  it('reads the ETCC list, drops duplicates and rows without a callsign or output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpt-'));
    const csv = join(dir, 'repeaterlist_all.csv');
    writeFileSync(csv, '﻿' + CSV + '\r\n');
    const p = await readRepeaterCsv(csv);
    expect(p.read).toBe(8);
    expect(p.skipped).toBe(2);
    expect(p.rows).toHaveLength(6);
    expect(p.rows[0]).toMatchObject({ callsign: '2E0CJT', band: '70CM', channel: 'DVU12', outputHz: 439_150_000, inputHz: 430_150_000, ctcss: null, locator: 'IO93', where: 'BARNSLEY', lat: 53.5, lon: -1.4, modes: 'DMR' });
    expect(p.rows[1]).toMatchObject({ callsign: 'GB3AA', outputHz: 145_662_500, inputHz: 145_062_500, ctcss: 94.8, modes: 'FM' });
    expect(p.rows[3]).toMatchObject({ callsign: 'GB3BS', modes: 'FM · DMR · D-STAR · Fusion' });
    expect(p.rows[4]).toMatchObject({ callsign: 'GB3OLD', ctcss: null });
    expect(p.rows[5]).toMatchObject({ callsign: 'GB3NA', ctcss: null, lat: null, lon: null, modes: 'DMR' });
  });

  it('rejects a file that is not the repeater list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpt-'));
    const csv = join(dir, 'WTR.csv');
    writeFileSync(csv, 'Licence Number,Frequency (Hz)\n1,145500000\n');
    await expect(readRepeaterCsv(csv)).rejects.toThrow(/ETCC repeater list/);
  });
});

describe('LogDb repeaters', () => {
  it('imports, counts and looks up by output or input, nearest first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rpt-'));
    const csv = join(dir, 'repeaterlist_all.csv');
    writeFileSync(csv, CSV + '\n');
    const db = new LogDb(join(dir, 'log.sqlite'));
    const parsed = await readRepeaterCsv(csv);
    expect(db.replaceRepeaters(parsed.rows, 'repeaterlist_all.csv', 1000)).toBe(6);
    expect(db.identityStats()).toMatchObject({ repeaters: 6, repeatersImportedAt: 1000, repeatersSource: 'repeaterlist_all.csv' });

    // Three repeaters share RV53; from Bath the Bristol ones come first, nearest of those leading.
    const out = db.lookupRepeaters(145_662_500, { lat: 51.38, lon: -2.36 });
    expect(out.map((r) => r.callsign)).toEqual(['GB3BS', 'GB3AA', 'GB3WR']);
    expect(out[0]).toMatchObject({ callsign: 'GB3BS', side: 'output', channel: 'RV53' });
    expect(out[0]!.distanceKm).toBeGreaterThan(20);

    // The input frequency matches too, flagged as such.
    expect(db.lookupRepeaters(145_062_500).map((r) => [r.callsign, r.side])).toEqual([
      ['GB3AA', 'input'], ['GB3BS', 'input'], ['GB3WR', 'input'],
    ]);
    // Off channel: nothing.
    expect(db.lookupRepeaters(145_675_000)).toEqual([]);
    db.close();
  });
});

describe('rankRepeaters', () => {
  it('puts the repeater whose CTCSS matches the detected tone first, then output before input, then nearest', () => {
    const base = { id: 0, band: '2M', channel: 'RV53', outputHz: 145_662_500, inputHz: 145_062_500, locator: '', where: '', lat: null, lon: null, modes: 'FM' };
    const aa = { ...base, id: 1, callsign: 'GB3AA', ctcss: 94.8, distanceKm: 25, side: 'output' as const };
    const bs = { ...base, id: 2, callsign: 'GB3BS', ctcss: 118.8, distanceKm: 20, side: 'output' as const };
    const wr = { ...base, id: 3, callsign: 'GB3WR', ctcss: 94.8, distanceKm: 40, side: 'input' as const };
    expect(rankRepeaters([bs, wr, aa], 'CTCSS 94.8').map((r) => r.callsign)).toEqual(['GB3AA', 'GB3WR', 'GB3BS']);
    expect(rankRepeaters([bs, wr, aa], null).map((r) => r.callsign)).toEqual(['GB3BS', 'GB3AA', 'GB3WR']);
    expect(rankRepeaters([bs, wr, aa], 'DCS 023').map((r) => r.callsign)).toEqual(['GB3BS', 'GB3AA', 'GB3WR']);
    expect(ctcssHz('CTCSS 77.0')).toBe(77);
    expect(ctcssHz('NAC 167')).toBeNull();
    expect(repeaterLabel({ callsign: 'GB3AA', where: 'BRISTOL' })).toBe('GB3AA · BRISTOL');
  });
});
