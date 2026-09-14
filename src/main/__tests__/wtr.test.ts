import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyEmission, dedupe, distanceKm, readWtrCsv, type WtrRow } from '../identities/wtr';
import { LogDb } from '../log/db';

const HEADER =
  'Licence Number,License Issue Date,SID_LAT_N_S,SID_LAT_DEG,SID_LAT_MIN,SID_LAT_SEC,SID_LONG_E_W,SID_LONG_DEG,SID_LONG_MIN,SID_LONG_SEC,NGR,Frequency (Hz),Station Type,Channel Width (Hz),Height Above Sea Level,Antenna ERP,Antenna ERP Unit,Antenna ERP Type,Antenna Type,Antenna Gain,Antenna AZIMUTH,Horizontal Elements,Vertical Elements,Antenna Height,Antenna Location,EFL_UPPER_LOWER,Antenna Direction,Antenna Elevation,Antenna Polarisation,Antenna Name,Feeding Loss,Fade Margin,Emission Code,Licencee Surname,Licencee First Name,Licencee Company,Status,Tradeable,Publishable,Product Code,Product Description,Latitude(Deg),Longitude(Deg)';

function row(o: Partial<Record<'lic' | 'ngr' | 'hz' | 'st' | 'width' | 'em' | 'sur' | 'first' | 'co' | 'status' | 'prod' | 'lat' | 'lon', string>>): string {
  const f = new Array(43).fill('-');
  f[0] = o.lic ?? '1420595/1';
  f[10] = o.ngr ?? 'TQ 35351 91725';
  f[11] = o.hz ?? '461925000';
  f[12] = o.st ?? 'T';
  f[13] = o.width ?? '12500';
  f[32] = o.em ?? '11K0G3EJN';
  f[33] = o.sur ?? '-';
  f[34] = o.first ?? '-';
  f[35] = o.co ?? 'Ninehundred Communications Group Limited';
  f[36] = o.status ?? 'Live';
  f[40] = o.prod ?? 'BR Tech Assigned';
  f[41] = o.lat ?? '51.60809863';
  f[42] = o.lon ?? '-0.04679522';
  return f.join(',');
}

describe('classifyEmission', () => {
  it('splits analogue from digital by the signal-nature digit', () => {
    expect(classifyEmission('11K0G3EJN', 12500)).toBe('NFM');
    expect(classifyEmission('16K0G3EJN', 25000)).toBe('FM');
    expect(classifyEmission('11K0F3DJN', 12500)).toBe('NFM');
    expect(classifyEmission('8K30F1W', 12500)).toBe('DIG');
    expect(classifyEmission('12K5G7W', 12500)).toBe('DIG');
    expect(classifyEmission('7M00D7W', 7000000)).toBe('DIG');
    expect(classifyEmission('-', 12500)).toBe('');
    expect(classifyEmission('', 0)).toBe('');
  });
});

describe('dedupe', () => {
  const base: WtrRow = { frequencyHz: 461925000, direction: 'T', licensee: 'Acme', product: 'BR Tech Assigned', emission: '11K0G3EJN', mode: 'NFM', widthHz: 12500, lat: 51.6, lon: -0.04, ngr: 'TQ', licenceNo: '1' };
  it('prefers digital over analogue for the same frequency, licensee and location, and merges directions', () => {
    const out = dedupe([base, { ...base, direction: 'R', emission: '8K30F1W', mode: 'DIG' }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ mode: 'DIG', emission: '8K30F1W', direction: 'TR' });
  });
  it('keeps different licensees and locations apart', () => {
    const out = dedupe([base, { ...base, licensee: 'Other' }, { ...base, lat: 52 }]);
    expect(out).toHaveLength(3);
  });
});

describe('readWtrCsv', () => {
  it('keeps 25-1300 MHz voice/data channels, drops wide links, dedupes, and reads people as licensees', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtr-'));
    const csv = join(dir, 'WTR.csv');
    writeFileSync(
      csv,
      '\uFEFF' + HEADER + '\r\n' +
        row({}) + '\r\n' +
        row({ st: 'R', em: '8K30F1W' }) + '\r\n' + // same assignment, digital, receive side
        row({ hz: '7500000000', width: '7000000', em: '7M00D7W', prod: 'Fixed Links' }) + '\r\n' + // out of band and too wide
        row({ hz: '160000000', width: '28000000', em: '28M0D7W' }) + '\r\n' + // in band but too wide
        row({ hz: '145500000', co: '-', sur: 'Keswick', first: 'Adam', lat: '-', lon: '-' }) + '\r\n' + // person, no location
        row({ hz: '12000000' }) + '\r\n', // below 25 MHz
    );
    const p = await readWtrCsv(csv);
    expect(p.read).toBe(6);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ frequencyHz: 461925000, mode: 'DIG', direction: 'TR', licensee: 'Ninehundred Communications Group Limited', product: 'BR Tech Assigned' });
    expect(p.rows[1]).toMatchObject({ frequencyHz: 145500000, licensee: 'Adam Keswick', lat: null, lon: null });
  });

  it('rejects a file that is not the WTR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wtr-'));
    const csv = join(dir, 'user.csv');
    writeFileSync(csv, 'RADIO_ID,CALLSIGN\n1,G4ABC\n');
    await expect(readWtrCsv(csv)).rejects.toThrow(/Ofcom WTR/);
  });
});

describe('LogDb WTR lookup', () => {
  it('matches by channel, sorts by distance, applies a radius, and stamps receptions', () => {
    const db = new LogDb(':memory:');
    const mk = (o: Partial<WtrRow>): WtrRow => ({ frequencyHz: 453187500, direction: 'T', licensee: 'X', product: 'BR Tech Assigned', emission: '11K0G3EJN', mode: 'NFM', widthHz: 12500, lat: 51.5, lon: -0.1, ngr: '', licenceNo: '', ...o });
    db.replaceWtr(
      [
        mk({ licensee: 'Far Ltd', lat: 53.5, lon: -2.2 }),
        mk({ licensee: 'Near Ltd', lat: 51.52, lon: -0.12, mode: 'DIG', emission: '8K30F1W' }),
        mk({ licensee: 'Nowhere Ltd', lat: null, lon: null }),
        mk({ licensee: 'Other channel', frequencyHz: 453200000 }),
      ],
      'WTR.csv',
      5,
    );
    expect(db.identityStats()).toMatchObject({ wtrLicences: 4, wtrImportedAt: 5, wtrSource: 'WTR.csv' });
    const all = db.lookupWtr(453187500, { lat: 51.5, lon: -0.1 });
    expect(all.map((m) => m.licensee)).toEqual(['Near Ltd', 'Far Ltd', 'Nowhere Ltd']);
    expect(all[0]!.distanceKm).toBeGreaterThan(1);
    expect(all[0]!.distanceKm).toBeLessThan(5);
    expect(all[2]!.distanceKm).toBeNull();
    const near = db.lookupWtr(453187500, { lat: 51.5, lon: -0.1, radiusKm: 50 });
    expect(near.map((m) => m.licensee)).toEqual(['Near Ltd', 'Nowhere Ltd']);
    // within ±3.125 kHz matches; the neighbouring 12.5 kHz channel does not
    expect(db.lookupWtr(453190000).length).toBe(3);
    expect(db.lookupWtr(453193750).length).toBe(0);
    expect(db.lookupWtr(453175000).length).toBe(0);
    expect(distanceKm(51.5, -0.1, 51.5, -0.1)).toBe(0);
    const r = db.insert({ startedAt: 1, endedAt: 2, frequencyHz: 453187500, mode: '', signalType: '', name: '', system: '', scanlist: '', objectType: '', tgid: null, radioId: null, site: '', squelch: '', tone: '', licensee: 'Near Ltd', rssiPeak: 0, calls: 1 });
    expect(r.licensee).toBe('Near Ltd');
    db.close();
  });
});
