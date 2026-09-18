import { describe, expect, it } from 'vitest';
import { RrukError, parseRrukResponse, rrukCode, rrukUrl, searchRruk } from '../identities/rruk';

const EXAMPLE = {
  success: true,
  user: 'ScannerFan99',
  count: 1,
  data: [
    { callsign: 'PMR446', alpha: 'PMR446 CH1', freq: 446.00625, mode: 'DMR', tone: '', colorCode: '', ran: '', nac: '', class: 'R', location: 'Nationwide', distance: 'Nationwide', tags: 'Nationwide - PMR446 Digital', is_trunk: false },
  ],
};

describe('RRUK client', () => {
  it('builds the request from a postcode, else coordinates, with the range capped at 50 miles', () => {
    const u = new URL(rrukUrl({ apiKey: 'k', freqMHz: 453.4375, postcode: 'HP18', lat: 51.8, lon: -0.9, rangeMiles: 80 }));
    expect(u.origin + u.pathname).toBe('https://radioreferenceuk.co.uk/api_search.php');
    expect(Object.fromEntries(u.searchParams)).toEqual({ api_key: 'k', freq: '453.4375', postcode: 'HP18', range: '50' });
    const ll = new URL(rrukUrl({ apiKey: 'k', freqMHz: 446.00625, lat: 51.8438, lon: -0.9183, rangeMiles: 10 }));
    expect(Object.fromEntries(ll.searchParams)).toEqual({ api_key: 'k', freq: '446.00625', lat: '51.84380', lon: '-0.91830', range: '10' });
    expect(new URL(rrukUrl({ apiKey: 'k', freqMHz: 145 })).searchParams.get('range')).toBe('50');
  });

  it("parses the documented example: a nationwide entry with no code, placed everywhere", () => {
    const r = parseRrukResponse(EXAMPLE);
    expect(r.user).toBe('ScannerFan99');
    expect(r.entries).toEqual([
      expect.objectContaining({ callsign: 'PMR446', alpha: 'PMR446 CH1', freqMHz: 446.00625, mode: 'DMR', code: '', direction: 'T', location: 'Nationwide', nationwide: true, distanceKm: null, bearingDeg: null, tags: 'Nationwide - PMR446 Digital', isTrunk: false }),
    ]);
  });

  it('parses a placed entry as the web search shows it: miles to km, bearing, address, licence, codes', () => {
    const r = parseRrukResponse({
      success: true,
      user: 'u',
      count: 1,
      data: [{ callsign: 'FCC RECYCLING (UK) LIMITED', alpha: '', freq: '453.4375', mode: 'DMR', tone: '', colorCode: '12', ran: '', nac: '', class: 'R', location: 'Steeple Claydon', distance: '4.4', bearing: 324, lat: '51.8958', long: '-0.978155', place: 'Steeple Claydon', county: 'Buckinghamshire', postcode: 'HP180AF', licence: '1383591/1', group: 'WTR', tags: '', is_trunk: false }],
    });
    const e = r.entries[0]!;
    // class R is RRUK's "you receive it": the base transmits here, so the WTR-style direction is T.
    expect(e).toMatchObject({ callsign: 'FCC RECYCLING (UK) LIMITED', alpha: '', code: 'CC 12', direction: 'T', nationwide: false, bearingDeg: 324, lat: 51.8958, lon: -0.978155, place: 'Steeple Claydon', county: 'Buckinghamshire', postcode: 'HP180AF', licence: '1383591/1', group: 'WTR' });
    expect(e.distanceKm).toBeCloseTo(7.08, 1);
    // "Nationwide" in the location alone is enough, and the generic coordinates / bearing RRUK sends
    // for some nationwide listings are ignored (18 Sep 2026: the API now returns lat, lon and bearing).
    expect(parseRrukResponse({ success: true, data: [{ callsign: 'PMR446', alpha: 'PMR446 CH8', location: 'Nationwide', distance: '', lat: 52.5, lon: -1.5, bearing: 12 }] }).entries[0]).toMatchObject({ nationwide: true, distanceKm: null, bearingDeg: null, lat: null, lon: null });
    // The server's own lat / lon / bearing on a placed entry are taken as sent.
    expect(parseRrukResponse({ success: true, data: [{ callsign: '1/1', alpha: 'X', location: 'Leeds', distance: '4.4 miles', lat: 53.8, lon: -1.55, bearing: 359.6 }] }).entries[0]).toMatchObject({ bearingDeg: 0, lat: 53.8, lon: -1.55 });
    // Entries with neither a name nor a callsign are dropped; 0,0 coordinates count as none.
    expect(parseRrukResponse({ success: true, data: [{ freq: 1 }, { callsign: 'X', lat: 0, lon: 0 }] }).entries).toEqual([expect.objectContaining({ callsign: 'X', lat: null, lon: null })]);
  });

  it('parses a live Ofcom entry: the licence number arrives as the callsign, the licensee as the alpha tag', () => {
    // Captured 18 Sep 2026 from api_search.php with lat/lon and a 10-mile range, after RRUK added
    // lat, lon and bearing for the transmitter site that afternoon.
    const live = { success: true, user: 'Defiant', count: 1, data: [{ callsign: '1383591/1', alpha: 'FCC RECYCLING (UK) LIMITED', freq: 453.4375, mode: 'DMR', tone: '', colorCode: '', ran: '', nac: '', class: 'R', location: 'Steeple Claydon, Buckinghamshire', lat: 51.8958, lon: -0.978155, distance: '4.4 miles', bearing: 325, tags: 'WTR', is_trunk: true }] };
    const r = parseRrukResponse(live);
    expect(r.user).toBe('Defiant');
    const e = r.entries[0]!;
    expect(e).toMatchObject({ callsign: '', alpha: 'FCC RECYCLING (UK) LIMITED', licence: '1383591/1', group: 'WTR', tags: 'WTR', direction: 'T', location: 'Steeple Claydon, Buckinghamshire', lat: 51.8958, lon: -0.978155, bearingDeg: 325, nationwide: false, code: '', isTrunk: true });
    expect(e.distanceKm).toBeCloseTo(7.08, 1);
    // The earlier shape, without coordinates, still parses (a cached answer from before the change).
    const { lat: _a, lon: _b, bearing: _c, ...older } = live.data[0]!;
    expect(parseRrukResponse({ ...live, data: [older] }).entries[0]).toMatchObject({ lat: null, lon: null, bearingDeg: null, licence: '1383591/1' });
  });

  it('turns tones and codes into the form the scanner shows', () => {
    const code = (tone: string, colorCode = '', ran = '', nac = '') => rrukCode({ tone, colorCode, ran, nac });
    expect(code('94.8')).toBe('CTCSS 94.8');
    expect(code('D023')).toBe('DCS 023');
    expect(code('023N')).toBe('DCS 023');
    expect(code('', '12')).toBe('CC 12');
    expect(code('', 'CC 5')).toBe('CC 5');
    expect(code('', '', '3')).toBe('RAN 3');
    expect(code('', '', '', '$293')).toBe('NAC 293');
    expect(code('', '12', '', '293')).toBe('NAC 293');
    expect(code('Toneburst')).toBe('Toneburst');
    expect(code('')).toBe('');
  });

  it('turns a refusal or a non-JSON answer into an RrukError that names the cause', async () => {
    expect(() => parseRrukResponse({ success: false, error: 'Invalid API key' })).toThrow(RrukError);
    expect(() => parseRrukResponse({ success: false, error: 'Invalid API key' })).toThrow('Invalid API key');
    expect(() => parseRrukResponse({ success: false }, 403)).toThrow(/rejected the API key/);
    expect(() => parseRrukResponse('nonsense', 500)).toThrow(/HTTP 500/);
    const html = async () => ({ ok: false, status: 401, text: async () => '<html>login</html>' }) as unknown as Response;
    await expect(searchRruk({ apiKey: 'bad', freqMHz: 1 }, html)).rejects.toThrow(/rejected the API key/);
    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(searchRruk({ apiKey: 'k', freqMHz: 1 }, down)).rejects.toThrow(/unreachable/);
    const ok = async (url: string) => {
      expect(url).toContain('api_key=k');
      return { ok: true, status: 200, text: async () => JSON.stringify(EXAMPLE) } as unknown as Response;
    };
    expect((await searchRruk({ apiKey: 'k', freqMHz: 446.00625 }, ok)).entries).toHaveLength(1);
  });
});
