import { describe, expect, it } from 'vitest';
import type { RepeaterMatch, RrInfo, WtrMatch } from '../ipc';
import { candidatesFor, normaliseCandidates, storedCandidates } from '../listed';
import { DEFAULT_LOOKUPS } from '../sources';

const wtr = (id: number, licensee: string, distanceKm: number | null, over: Partial<WtrMatch> = {}): WtrMatch => ({
  id, frequencyHz: 453_062_500, direction: 'T', licensee, product: 'BR Tech Assigned', emission: '8K30F1W', mode: 'DIG', widthHz: 12_500,
  lat: null, lon: null, ngr: '', licenceNo: '', distanceKm, bearingDeg: distanceKm === null ? null : 47, ...over,
});
const rpt = (id: number, callsign: string, ctcss: number | null, distanceKm: number | null): RepeaterMatch => ({
  id, callsign, band: '2M', channel: 'RV53', outputHz: 145_662_500, inputHz: 145_062_500, ctcss, locator: '', where: 'BRISTOL', lat: null, lon: null,
  modes: 'FM · DMR', distanceKm, bearingDeg: distanceKm === null ? null : 250, side: 'output',
});
const rr: RrInfo = {
  frequencyHz: 453_062_500, fetchedAt: 1, pending: false, error: null,
  systems: [{ sid: 9, name: 'Cambs DMR', city: 'Cambridge', site: { descr: 'Addenbrookes', location: 'Cambridge', nac: '' }, distanceKm: 60, bearingDeg: 60, talkgroup: { tgDec: 19, alpha: 'ADD', descr: 'Porters', mode: 'D', enc: 0, category: 'Hospital' } }],
  conventional: [{ descr: 'University of Buckingham', alpha: 'UOB', tone: 'CC 13', mode: 'DMR', callsign: '', tags: ['Education'], county: 'Bucks', distanceKm: 3.2, bearingDeg: 47 }],
};

describe('candidatesFor', () => {
  it('lists every lookup answer, placed ones first, then in the lookup order, with the match marked', () => {
    const list = candidatesFor({ rr, licences: [wtr(1, 'Kwik Fit', null), wtr(2, 'University of Buckingham', 3.2)], repeaters: [], detectedTone: null }, DEFAULT_LOOKUPS);
    expect(list.map((c) => [c.source, c.name, c.distanceKm])).toEqual([
      ['WTR', 'University of Buckingham', 3.2],
      ['RRDB', 'Cambs DMR', 60],
      ['RRDB', 'University of Buckingham', 3.2],
      ['WTR', 'Kwik Fit', null],
    ]);
    expect(list[2]).toMatchObject({ detail: 'Bucks · CC 13 · DMR · Education', bearingDeg: 47 });
    expect(list[2]).not.toHaveProperty('match');
    expect(list[1]!.detail).toBe('Addenbrookes · Porters (Hospital)');
    expect(list[0]!.title).toContain('BR Tech Assigned');
    // The distance is never baked into the detail: the renderer formats it in the user's units.
    expect(list.some((c) => /km/.test(c.detail))).toBe(false);
  });

  it('puts a tone / colour-code match first whatever the order, and a mismatch last', () => {
    const licences = [wtr(1, 'Kwik Fit', null), wtr(2, 'University of Buckingham', 3.2)];
    // CC 13 detected: RadioReference's CC 13 entry leads, even unplaced and ranked last.
    const far = { ...rr, conventional: [{ ...rr.conventional[0]!, distanceKm: null, bearingDeg: null }] };
    const list = candidatesFor({ rr: far, licences, repeaters: [], detectedTone: 'CC 13' }, [{ id: 'WTR', enabled: true }, { id: 'UKR', enabled: true }, { id: 'RRDB', enabled: true }]);
    expect(list.map((c) => [c.source, c.name])).toEqual([
      ['RRDB', 'University of Buckingham'],
      ['WTR', 'University of Buckingham'],
      ['RRDB', 'Cambs DMR'],
      ['WTR', 'Kwik Fit'],
    ]);
    expect(list[0]).toMatchObject({ match: true, detail: 'Bucks · CC 13 ✓ · DMR · Education' });
    // CC 5 detected: the CC 13 entry sinks below everything, placed or not.
    const miss = candidatesFor({ rr, licences, repeaters: [], detectedTone: 'CC 5' }, DEFAULT_LOOKUPS);
    expect(miss.map((c) => [c.source, c.name])).toEqual([
      ['WTR', 'University of Buckingham'],
      ['RRDB', 'Cambs DMR'],
      ['WTR', 'Kwik Fit'],
      ['RRDB', 'University of Buckingham'],
    ]);
    expect(miss[3]).toMatchObject({ match: false });
  });

  it('drops lookups that are switched off and leads with the repeater whose tone matches', () => {
    const list = candidatesFor(
      { rr, licences: [wtr(1, 'Kwik Fit', 5)], repeaters: [rpt(1, 'GB3BS', 118.8, 21), rpt(2, 'GB3AA', 94.8, 28)], detectedTone: 'CTCSS 94.8' },
      [{ id: 'UKR', enabled: true }, { id: 'RRDB', enabled: false }, { id: 'WTR', enabled: true }],
    );
    // GB3AA's tone matches, so it leads; GB3BS's differs, so it sinks below the licence that has no tone to compare.
    expect(list.map((c) => [c.source, c.name])).toEqual([
      ['UKR', 'GB3AA'],
      ['WTR', 'Kwik Fit'],
      ['UKR', 'GB3BS'],
    ]);
    expect(list[0]).toMatchObject({ match: true, pills: 'FM · DMR', detail: 'Bristol · 94.8 Hz ✓' });
    expect(list[2]).toMatchObject({ match: false });
  });

  it('stores the list without the tooltips and reads it back leniently', () => {
    const list = candidatesFor({ rr, licences: [wtr(1, 'Kwik Fit', 5)], repeaters: [], detectedTone: null }, DEFAULT_LOOKUPS);
    const stored = storedCandidates(list);
    expect(stored[0]).not.toHaveProperty('title');
    expect(stored[0]).not.toHaveProperty('key');
    expect(normaliseCandidates(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(normaliseCandidates('junk')).toEqual([]);
    expect(normaliseCandidates([{ source: 'XYZ', name: 'no' }, { source: 'WTR', name: 'ok', distanceKm: 'far' }])).toEqual([
      { source: 'WTR', name: 'ok', detail: '', distanceKm: null, bearingDeg: null },
    ]);
  });
});
