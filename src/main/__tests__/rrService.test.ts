import { describe, expect, it } from 'vitest';
import { LogDb } from '../log/db';
import { RrService, pickSite } from '../identities/rrService';
import type { FetchLike } from '../identities/radioreference';
import type { RrSettings } from '../../shared/ipc';
import { rrToneMatches } from '../../shared/rr';

function soap(body: string): string {
  return `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://api.radioreference.com/soap2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}
const RESP: Record<string, string> = {
  searchStateFreq: soap('<ns1:searchStateFreqResponse><return><item><out>417.725</out><in xsi:nil="true"/><descr>USAF Bases UK</descr><alpha></alpha><tone></tone><mode>P25</mode><sid>9876</sid><aid>0</aid><ctid>0</ctid></item><item><out>417.725</out><descr>Conv user</descr><alpha>CONV</alpha><tone>167 NAC</tone><mode>P25</mode><sid>0</sid><aid>0</aid><ctid>2450</ctid></item></return></ns1:searchStateFreqResponse>'),
  getTrsDetails: soap('<ns1:getTrsDetailsResponse><return><sName>USAF Bases UK</sName><sType>16</sType><sFlavor>3</sFlavor><sVoice>2</sVoice><sCity></sCity><lat>0</lat><lon>0</lon><range>0</range><sysid><item><sysid>3A2</sysid><ct></ct><wacn>BEE00</wacn></item></sysid></return></ns1:getTrsDetailsResponse>'),
  getTrsSites: soap('<ns1:getTrsSitesResponse><return><item><siteId>1</siteId><siteNumber>1</siteNumber><siteDescr>Lakenheath</siteDescr><siteLocation>RAF Lakenheath</siteLocation><nac>3A1</nac><lat>52.41</lat><lon>0.56</lon><siteFreqs><item><lcn>1</lcn><freq>417.725</freq><use>c</use></item></siteFreqs></item><item><siteId>2</siteId><siteNumber>2</siteNumber><siteDescr>Croughton</siteDescr><siteLocation>RAF Croughton</siteLocation><nac>167</nac><lat>51.99</lat><lon>-1.19</lon><siteFreqs><item><lcn>1</lcn><freq>417.725</freq><use>c</use></item><item><lcn>2</lcn><freq>419.475</freq><use></use></item></siteFreqs></item></return></ns1:getTrsSitesResponse>'),
  getCountyInfo: soap('<ns1:getCountyInfoResponse><return><ctid>2450</ctid><countyName>Buckinghamshire</countyName><lat>51.8</lat><lon>-0.8</lon><range>25</range></return></ns1:getCountyInfoResponse>'),
  getTrsTalkgroupCats: soap('<ns1:getTrsTalkgroupCatsResponse><return><item><tgCid>7</tgCid><tgCname>Security</tgCname></item></return></ns1:getTrsTalkgroupCatsResponse>'),
  getTrsTalkgroups: soap('<ns1:getTrsTalkgroupsResponse><return><item><tgDec>63305</tgDec><tgAlpha>SEC 1</tgAlpha><tgDescr>Security Dispatch</tgDescr><tgMode>DE</tgMode><enc>1</enc><tgCid>7</tgCid></item></return></ns1:getTrsTalkgroupsResponse>'),
};

function fake(responses = RESP, calls: string[] = []): FetchLike {
  return (async (_url: string, init?: RequestInit) => {
    const op = String((init?.headers as Record<string, string>)['SOAPAction']).split('#')[1]!;
    calls.push(op);
    const xml = responses[op] ?? soap('<SOAP-ENV:Fault><faultcode>AUTH</faultcode><faultstring>Invalid username or password</faultstring></SOAP-ENV:Fault>');
    return { ok: true, status: 200, text: async () => xml } as unknown as Response;
  }) as FetchLike;
}

function make(over: Partial<RrSettings> = {}, opts: { appKey?: string; responses?: Record<string, string>; calls?: string[]; location?: { lat: number | null; lon: number | null; radiusKm: number | null } } = {}) {
  // In memory: a file per service instance was slow enough on the Windows CI runner to time the tests out.
  const db = new LogDb(':memory:');
  const settings: RrSettings = { username: 'steve', password: 'enc:secret', coid: 40, stid: 410, countryName: 'United Kingdom', stateName: 'England', ...over };
  let changes = 0;
  const svc = new RrService({
    db,
    appKey: opts.appKey ?? 'key',
    getSettings: () => settings,
    decrypt: (c) => c.replace(/^enc:/, ''),
    fetchImpl: fake(opts.responses, opts.calls),
    getLocation: () => opts.location ?? { lat: null, lon: null, radiusKm: null },
    onChange: () => changes++,
    spacingMs: 5,
  });
  return { db, svc, settings, changes: () => changes };
}

/** Wait until the service has finished with the given frequencies (nothing queued or in flight), rather than sleeping a fixed time. */
async function settled(svc: RrService, ...hz: number[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (hz.some((h) => svc.info(h)?.pending) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
}

describe('RrService', { timeout: 20_000 }, () => {
  it('is disabled without a key, login or region', () => {
    expect(make({}, { appKey: '' }).svc.enabled).toBe(false);
    expect(make({ password: '' }).svc.enabled).toBe(false);
    expect(make({ stid: null }).svc.enabled).toBe(false);
    expect(make().svc.enabled).toBe(true);
    expect(make({ stid: null }).svc.info(417_725_000)).toBeNull();
    expect(make().svc.status()).toMatchObject({ appKey: true, passwordStore: 'os', username: 'steve', hasPassword: true, stid: 410, enabled: true, cachedFreqs: 0 });
  });

  it('looks a heard frequency up once, pulls the trunked system, then answers from the cache', async () => {
    const calls: string[] = [];
    const { svc, db, changes } = make({}, { calls });
    expect(svc.info(417_725_000)).toMatchObject({ fetchedAt: null, pending: false, systems: [], conventional: [] });
    expect(svc.request(417_725_000)).toBe(true);
    expect(svc.request(417_725_000)).toBe(false); // already queued
    expect(svc.info(417_725_000)?.pending).toBe(true);
    await settled(svc, 417_725_000);
    expect(calls).toEqual(['searchStateFreq', 'getCountyInfo', 'getTrsDetails', 'getTrsSites', 'getTrsTalkgroupCats', 'getTrsTalkgroups']);
    expect(changes()).toBeGreaterThan(0);
    expect(db.rrStats()).toEqual({ freqs: 1, systems: 1, talkgroups: 1 });
    expect(db.rrGetCounty(2450)).toMatchObject({ name: 'Buckinghamshire', lat: 51.8, lon: -0.8 });
    expect(db.rrGetCounty(2450)?.rangeKm).toBeCloseTo(40.2, 0);

    const info = svc.info(417_725_000, { tgid: 63305, nac: '167' });
    expect(info?.pending).toBe(false);
    expect(info?.conventional).toEqual([{ descr: 'Conv user', alpha: 'CONV', tone: '167 NAC', mode: 'P25', callsign: '', tags: [], county: 'Buckinghamshire', distanceKm: null, bearingDeg: null }]);
    expect(info?.systems).toEqual([
      {
        sid: 9876,
        name: 'USAF Bases UK',
        city: '',
        site: { descr: 'Croughton', location: 'RAF Croughton', nac: '167' },
        distanceKm: null,
        bearingDeg: null,
        talkgroup: { tgDec: 63305, alpha: 'SEC 1', descr: 'Security Dispatch', mode: 'DE', enc: 1, category: 'Security' },
      },
    ]);
    // Another talkgroup on the same system needs no network.
    expect(svc.info(417_725_000, { tgid: 1, nac: '3A1' })?.systems[0]).toMatchObject({ site: { descr: 'Lakenheath' }, talkgroup: null });
    expect(svc.request(417_725_000)).toBe(false); // cached and fresh
    expect(calls).toHaveLength(6);
  });

  it('keeps only systems and channels near the user once a location is set', async () => {
    // From Aylesbury: Croughton is ~45 km, Lakenheath ~110 km, Buckinghamshire's centre ~15 km.
    const near = make({}, { location: { lat: 51.82, lon: -0.81, radiusKm: 60 } });
    near.svc.request(417_725_000);
    await settled(near.svc, 417_725_000);
    const info = near.svc.info(417_725_000, { nac: '3A1' });
    // The NAC names Lakenheath, which is out of range, so the system is dropped; the county entry stays.
    expect(info?.systems).toEqual([]);
    expect(info?.conventional[0]).toMatchObject({ descr: 'Conv user', county: 'Buckinghamshire' });
    expect(info?.conventional[0]!.distanceKm).toBeGreaterThan(0);
    // Without a NAC the nearest site on the frequency (Croughton) is picked and is within range.
    expect(near.svc.info(417_725_000)!.systems[0]).toMatchObject({ name: 'USAF Bases UK', site: { descr: 'Croughton' } });
    expect(near.svc.info(417_725_000)!.systems[0]!.distanceKm).toBeGreaterThan(30);

    // From Leeds everything on this frequency is far away.
    const farAway = make({}, { location: { lat: 53.8, lon: -1.55, radiusKm: 60 } });
    farAway.svc.request(417_725_000);
    await settled(farAway.svc, 417_725_000);
    expect(farAway.svc.info(417_725_000)).toMatchObject({ systems: [], conventional: [] });
  });

  it('falls back to the system position when its site has none, and drops a system nobody can place unless its NAC matches', async () => {
    const unplacedSite = { ...RESP, getTrsSites: RESP.getTrsSites!.replace('<lat>51.99</lat><lon>-1.19</lon>', '<lat>0</lat><lon>0</lon>').replace('<lat>52.41</lat><lon>0.56</lon>', '') };
    // System centred on Bradford (Morrisons HQ), 12-mile range: dropped from Aylesbury, kept from Leeds.
    const bradford = { ...unplacedSite, getTrsDetails: RESP.getTrsDetails!.replace('<lat>0</lat><lon>0</lon><range>0</range>', '<lat>53.79</lat><lon>-1.75</lon><range>12</range>') };
    const bucks = make({}, { responses: bradford, location: { lat: 51.82, lon: -0.81, radiusKm: 60 } });
    bucks.svc.request(417_725_000);
    await settled(bucks.svc, 417_725_000);
    expect(bucks.svc.info(417_725_000)?.systems).toEqual([]);
    const leeds = make({}, { responses: bradford, location: { lat: 53.8, lon: -1.55, radiusKm: 60 } });
    leeds.svc.request(417_725_000);
    await settled(leeds.svc, 417_725_000);
    expect(leeds.svc.info(417_725_000)?.systems[0]).toMatchObject({ name: 'USAF Bases UK' });
    expect(leeds.svc.info(417_725_000)?.systems[0]!.distanceKm).toBeGreaterThan(10);
    // Neither the site nor the system is placed: with a location set it is dropped, unless the NAC heard is that site's.
    const unknown = make({}, { responses: unplacedSite, location: { lat: 51.82, lon: -0.81, radiusKm: 60 } });
    unknown.svc.request(417_725_000);
    await settled(unknown.svc, 417_725_000);
    expect(unknown.svc.info(417_725_000)?.systems).toEqual([]);
    expect(unknown.svc.info(417_725_000, { nac: '167' })?.systems[0]).toMatchObject({ name: 'USAF Bases UK', site: { nac: '167' }, distanceKm: null });
    // No location: nothing to judge by, so it stays.
    const anywhere = make({}, { responses: unplacedSite, location: { lat: null, lon: null, radiusKm: null } });
    anywhere.svc.request(417_725_000);
    await settled(anywhere.svc, 417_725_000);
    expect(anywhere.svc.info(417_725_000)?.systems[0]).toMatchObject({ name: 'USAF Bases UK', distanceKm: null });
  });

  it('backs off a failed frequency and empties the queue on a login fault', async () => {
    const calls: string[] = [];
    const { svc } = make({}, { responses: {}, calls });
    svc.request(145_500_000);
    svc.request(145_512_500);
    await settled(svc, 145_500_000, 145_512_500);
    expect(calls).toEqual(['searchStateFreq']);
    expect(svc.info(145_500_000)?.error).toBe('Invalid username or password');
    expect(svc.status().lastError).toBe('Invalid username or password');
    expect(svc.request(145_500_000)).toBe(false); // backing off
    expect(svc.request(145_500_000, true)).toBe(true); // unless forced
    svc.dispose();
  });
});

describe('pickSite / rrToneMatches', () => {
  it('matches a site by frequency, preferring the NAC', () => {
    const sites = [
      { siteId: 1, siteNumber: 1, descr: 'A', location: '', nac: '3A1', ran: null, lat: null, lon: null, freqs: [{ freqMHz: 417.725, use: 'c', colorCode: '', lcn: 1 }] },
      { siteId: 2, siteNumber: 2, descr: 'B', location: '', nac: '167', ran: null, lat: null, lon: null, freqs: [{ freqMHz: 417.725, use: 'c', colorCode: '', lcn: 1 }] },
    ];
    expect(pickSite(sites, 417_725_000, '167')?.descr).toBe('B');
    expect(pickSite(sites, 417_725_000, '0167')?.descr).toBe('B');
    expect(pickSite(sites, 417_725_000, null)?.descr).toBe('A');
    expect(pickSite(sites, 418_000_000, '167')).toBeNull();
    expect(rrToneMatches('94.8 PL', 'CTCSS 94.8')).toBe(true);
    expect(rrToneMatches('023 DPL', 'DCS 023')).toBe(true);
    expect(rrToneMatches('167 NAC', 'NAC 167')).toBe(true);
    expect(rrToneMatches('94.8 PL', 'DCS 023')).toBe(false);
    expect(rrToneMatches('', 'CTCSS 94.8')).toBeNull();
  });
});
