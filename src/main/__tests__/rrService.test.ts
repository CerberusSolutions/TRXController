import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  searchStateFreq: soap('<ns1:searchStateFreqResponse><return><item><out>417.725</out><in xsi:nil="true"/><descr>USAF Bases UK</descr><alpha></alpha><tone></tone><mode>P25</mode><sid>9876</sid><aid>0</aid><ctid>0</ctid></item><item><out>417.725</out><descr>Conv user</descr><alpha>CONV</alpha><tone>167 NAC</tone><mode>P25</mode><sid>0</sid><aid>0</aid><ctid>0</ctid></item></return></ns1:searchStateFreqResponse>'),
  getTrsDetails: soap('<ns1:getTrsDetailsResponse><return><sName>USAF Bases UK</sName><sType>16</sType><sFlavor>3</sFlavor><sVoice>2</sVoice><sCity></sCity><sysid><item><sysid>3A2</sysid><ct></ct><wacn>BEE00</wacn></item></sysid></return></ns1:getTrsDetailsResponse>'),
  getTrsSites: soap('<ns1:getTrsSitesResponse><return><item><siteId>1</siteId><siteNumber>1</siteNumber><siteDescr>Lakenheath</siteDescr><siteLocation>RAF Lakenheath</siteLocation><nac>3A1</nac><siteFreqs><item><lcn>1</lcn><freq>417.725</freq><use>c</use></item></siteFreqs></item><item><siteId>2</siteId><siteNumber>2</siteNumber><siteDescr>Croughton</siteDescr><siteLocation>RAF Croughton</siteLocation><nac>167</nac><siteFreqs><item><lcn>1</lcn><freq>417.725</freq><use>c</use></item><item><lcn>2</lcn><freq>419.475</freq><use></use></item></siteFreqs></item></return></ns1:getTrsSitesResponse>'),
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

function make(over: Partial<RrSettings> = {}, opts: { appKey?: string; responses?: Record<string, string>; calls?: string[] } = {}) {
  const db = new LogDb(join(mkdtempSync(join(tmpdir(), 'rr-')), 'log.sqlite'));
  const settings: RrSettings = { username: 'steve', password: 'enc:secret', coid: 40, stid: 410, countryName: 'United Kingdom', stateName: 'England', ...over };
  let changes = 0;
  const svc = new RrService({
    db,
    appKey: opts.appKey ?? 'key',
    getSettings: () => settings,
    decrypt: (c) => c.replace(/^enc:/, ''),
    fetchImpl: fake(opts.responses, opts.calls),
    onChange: () => changes++,
    spacingMs: 5,
  });
  return { db, svc, settings, changes: () => changes };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

describe('RrService', () => {
  it('is disabled without a key, login or region', () => {
    expect(make({}, { appKey: '' }).svc.enabled).toBe(false);
    expect(make({ password: '' }).svc.enabled).toBe(false);
    expect(make({ stid: null }).svc.enabled).toBe(false);
    expect(make().svc.enabled).toBe(true);
    expect(make({ stid: null }).svc.info(417_725_000)).toBeNull();
    expect(make().svc.status()).toMatchObject({ appKey: true, username: 'steve', hasPassword: true, stid: 410, enabled: true, cachedFreqs: 0 });
  });

  it('looks a heard frequency up once, pulls the trunked system, then answers from the cache', async () => {
    const calls: string[] = [];
    const { svc, db, changes } = make({}, { calls });
    expect(svc.info(417_725_000)).toMatchObject({ fetchedAt: null, pending: false, systems: [], conventional: [] });
    expect(svc.request(417_725_000)).toBe(true);
    expect(svc.request(417_725_000)).toBe(false); // already queued
    expect(svc.info(417_725_000)?.pending).toBe(true);
    await settle();
    expect(calls).toEqual(['searchStateFreq', 'getTrsDetails', 'getTrsSites', 'getTrsTalkgroupCats', 'getTrsTalkgroups']);
    expect(changes()).toBeGreaterThan(0);
    expect(db.rrStats()).toEqual({ freqs: 1, systems: 1, talkgroups: 1 });

    const info = svc.info(417_725_000, { tgid: 63305, nac: '167' });
    expect(info?.pending).toBe(false);
    expect(info?.conventional).toEqual([{ descr: 'Conv user', alpha: 'CONV', tone: '167 NAC', mode: 'P25', callsign: '', tags: [] }]);
    expect(info?.systems).toEqual([
      {
        sid: 9876,
        name: 'USAF Bases UK',
        city: '',
        site: { descr: 'Croughton', location: 'RAF Croughton', nac: '167' },
        talkgroup: { tgDec: 63305, alpha: 'SEC 1', descr: 'Security Dispatch', mode: 'DE', enc: 1, category: 'Security' },
      },
    ]);
    // Another talkgroup on the same system needs no network.
    expect(svc.info(417_725_000, { tgid: 1, nac: '3A1' })?.systems[0]).toMatchObject({ site: { descr: 'Lakenheath' }, talkgroup: null });
    expect(svc.request(417_725_000)).toBe(false); // cached and fresh
    expect(calls).toHaveLength(5);
  });

  it('backs off a failed frequency and empties the queue on a login fault', async () => {
    const calls: string[] = [];
    const { svc } = make({}, { responses: {}, calls });
    svc.request(145_500_000);
    svc.request(145_512_500);
    await settle();
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
