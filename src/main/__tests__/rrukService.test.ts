import { describe, expect, it } from 'vitest';
import { LogDb } from '../log/db';
import { RRUK_HALT_MS, RRUK_OFFLINE_PAUSE_MS, RRUK_UNTESTED, RrukService, haltFor } from '../identities/rrukService';
import { RrukError } from '../identities/rruk';
import type { FetchLike } from '../identities/rruk';
import type { RrukSettings } from '../../shared/ipc';

const ENTRY = { callsign: 'FCC RECYCLING (UK) LIMITED', alpha: '', freq: 453.4375, mode: 'DMR', tone: '', colorCode: '12', ran: '', nac: '', class: 'R', location: 'Steeple Claydon', distance: '4.4', lat: 51.8958, lon: -0.978155, is_trunk: false };

function fake(calls: string[], reply: (url: URL) => { status: number; body: unknown }): FetchLike {
  return (async (url: string) => {
    calls.push(url);
    const r = reply(new URL(url));
    return { ok: r.status < 400, status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) } as unknown as Response;
  }) as FetchLike;
}

function make(over: Partial<RrukSettings> = {}, opts: { devKey?: string; calls?: string[]; reply?: (url: URL) => { status: number; body: unknown }; location?: { lat: number | null; lon: number | null; radiusKm: number | null }; now?: () => number } = {}) {
  const db = new LogDb(':memory:');
  const settings: RrukSettings = { apiKey: 'enc:secret', postcode: '', tested: true, ...over };
  let changes = 0;
  const calls = opts.calls ?? [];
  const svc = new RrukService({
    db,
    getSettings: () => settings,
    decrypt: (c) => c.replace(/^enc:/, ''),
    setTested: (t) => {
      settings.tested = t;
    },
    devKey: () => opts.devKey ?? '',
    getLocation: () => opts.location ?? { lat: 51.8438, lon: -0.9183, radiusKm: 16 },
    fetchImpl: fake(calls, opts.reply ?? (() => ({ status: 200, body: { success: true, user: 'steve', count: 1, data: [ENTRY] } }))),
    onChange: () => changes++,
    spacingMs: 5,
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { db, svc, settings, calls, changes: () => changes };
}

async function settled(svc: RrukService, ...hz: number[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (hz.some((h) => svc.info(h)?.pending) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
}

describe('RrukService', { timeout: 20_000 }, () => {
  it('is enabled with a key and somewhere to search from; a development key stands in when none is stored', () => {
    expect(make().svc.enabled).toBe(true);
    expect(make({ apiKey: '' }).svc.enabled).toBe(false);
    expect(make({ apiKey: '' }, { devKey: 'dev' }).svc.enabled).toBe(true);
    expect(make({ apiKey: '' }, { devKey: 'dev' }).svc.status()).toMatchObject({ hasKey: false, devKey: true, enabled: true, located: true });
    expect(make({}, { location: { lat: null, lon: null, radiusKm: null } }).svc.enabled).toBe(false);
    expect(make({ postcode: 'HP18' }, { location: { lat: null, lon: null, radiusKm: null } }).svc.enabled).toBe(true);
    expect(make({ apiKey: '' }).svc.info(453_437_500)).toBeNull();
  });

  it('asks once per frequency, caches the answer for the location, and adds the bearing from the coordinates', async () => {
    const { svc, calls, changes } = make();
    expect(svc.info(453_437_500)).toMatchObject({ fetchedAt: null, pending: false, entries: [] });
    expect(svc.request(453_437_500)).toBe(true);
    expect(svc.request(453_437_500)).toBe(false);
    expect(svc.info(453_437_500)?.pending).toBe(true);
    await settled(svc, 453_437_500);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!);
    expect(Object.fromEntries(u.searchParams)).toEqual({ api_key: 'secret', freq: '453.4375', lat: '51.84380', lon: '-0.91830', range: '10' });
    const info = svc.info(453_437_500)!;
    expect(info.pending).toBe(false);
    expect(info.entries[0]).toMatchObject({ callsign: 'FCC RECYCLING (UK) LIMITED', code: 'CC 12', direction: 'T' });
    expect(info.entries[0]!.distanceKm).toBeCloseTo(7.08, 1);
    expect(info.entries[0]!.bearingDeg).toBeGreaterThan(320);
    expect(info.entries[0]!.bearingDeg).toBeLessThan(335);
    expect(changes()).toBeGreaterThan(0);
    expect(svc.request(453_437_500)).toBe(false); // cached
    expect(svc.status()).toMatchObject({ cachedFreqs: 1, lastError: null });
  });

  it('prefers the postcode, and treats a cache row from another location as missing', async () => {
    const { svc, calls, settings } = make({ postcode: 'ls1' });
    svc.request(446_006_250);
    await settled(svc, 446_006_250);
    expect(new URL(calls[0]!).searchParams.get('postcode')).toBe('LS1');
    expect(new URL(calls[0]!).searchParams.has('lat')).toBe(false);
    expect(svc.info(446_006_250)?.fetchedAt).not.toBeNull();
    // Move: the cached answer no longer applies and the frequency is asked again.
    settings.postcode = 'HP18';
    svc.resetFailures();
    expect(svc.info(446_006_250)).toMatchObject({ fetchedAt: null, entries: [] });
    expect(svc.request(446_006_250)).toBe(true);
    await settled(svc, 446_006_250);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]!).searchParams.get('postcode')).toBe('HP18');
    svc.clearCache();
    expect(svc.status().cachedFreqs).toBe(0);
  });

  it('stops asking altogether when the key is rejected, until the key changes', async () => {
    const { svc, calls } = make({}, { reply: () => ({ status: 401, body: { success: false, error: 'Invalid API key' } }) });
    svc.request(145_500_000);
    svc.request(145_512_500);
    await settled(svc, 145_500_000, 145_512_500);
    expect(calls).toHaveLength(1);
    expect(svc.info(145_500_000)?.error).toBe('Invalid API key');
    expect(svc.status().lastError).toBe('Invalid API key');
    expect(svc.status().halted).toEqual({ kind: 'key', message: 'Invalid API key', until: null });
    // A frequency never asked about, and a forced ask, both stay unsent: the key is wrong for all of them.
    expect(svc.request(453_437_500)).toBe(false);
    expect(svc.request(453_437_500, true)).toBe(false);
    expect(svc.info(453_437_500)?.error).toBe('Invalid API key');
    expect(calls).toHaveLength(1);
    // A new key (or a passed test) lifts it.
    // The rejection un-tests the key: even after the halt is lifted nothing runs until a Test passes.
    expect(svc.status().tested).toBe(false);
    svc.resetFailures();
    expect(svc.status().halted).toBeNull();
    expect(svc.request(453_437_500)).toBe(false);
    expect(svc.info(453_437_500)?.error).toBe(RRUK_UNTESTED);
    svc.dispose();
  });

  it('never looks anything up until the key has passed a Test', async () => {
    const { svc, calls, settings } = make({ tested: false });
    expect(svc.enabled).toBe(false);
    expect(svc.status()).toMatchObject({ hasKey: true, located: true, tested: false, enabled: false });
    expect(svc.request(145_500_000)).toBe(false);
    expect(svc.info(145_500_000)).toMatchObject({ entries: [], pending: false, error: RRUK_UNTESTED });
    await svc.test();
    expect(settings.tested).toBe(true);
    expect(svc.enabled).toBe(true);
    expect(svc.request(145_500_000)).toBe(true);
    await settled(svc, 145_500_000);
    expect(calls).toHaveLength(2);
    svc.dispose();
  });

  it('a Test that the server refuses for the key leaves it untested', async () => {
    const { svc, settings } = make({}, { reply: () => ({ status: 401, body: { success: false, error: 'Invalid API key' } }) });
    await expect(svc.test()).rejects.toThrow('Invalid API key');
    expect(settings.tested).toBe(false);
    expect(svc.enabled).toBe(false);
    svc.dispose();
  });

  it('pauses for a while after a rate limit or a locked address, then resumes by itself', async () => {
    let t = 1_000_000;
    const { svc, calls } = make({}, { now: () => t, reply: () => ({ status: 403, body: { success: false, error: 'Access denied: This API key is locked to another IP address.' } }) });
    svc.request(145_500_000);
    await settled(svc, 145_500_000);
    expect(calls).toHaveLength(1);
    expect(svc.status().halted).toEqual({ kind: 'limit', message: 'Access denied: This API key is locked to another IP address.', until: t + RRUK_HALT_MS });
    expect(svc.request(145_512_500)).toBe(false);
    t += RRUK_HALT_MS;
    expect(svc.status().halted).toBeNull();
    expect(svc.request(145_512_500)).toBe(true);
    svc.dispose();
  });

  it('classifies the server\'s refusals', () => {
    const now = 5000;
    expect(haltFor(new RrukError('Invalid API key', 401), now)).toEqual({ kind: 'key', message: 'Invalid API key', until: null });
    expect(haltFor(new RrukError('API key not authorised', 200), now).kind).toBe('key');
    expect(haltFor(new RrukError('IP address locked', 200), now)).toEqual({ kind: 'limit', message: 'IP address locked', until: now + RRUK_HALT_MS });
    // Seen in the log on 25 Sep 2026: names the key, but the fix is the address in the RRUK dashboard, so it retries.
    expect(haltFor(new RrukError('Access denied: This API key is locked to another IP address.', 403), now).kind).toBe('limit');
    expect(haltFor(new RrukError('Too many geo locations', 200), now).kind).toBe('limit');
    expect(haltFor(new RrukError('RRUK answered HTTP 429 with no JSON', 429), now).kind).toBe('limit');
    expect(haltFor(new RrukError('RRUK answered HTTP 503 with no JSON', 503), now)).toEqual({ kind: 'refused', message: 'RRUK answered HTTP 503 with no JSON', until: now + RRUK_HALT_MS });
    expect(haltFor(new RrukError('RRUK unreachable: ECONNRESET'), now)).toEqual({ kind: 'offline', message: 'RRUK unreachable: ECONNRESET', until: now + RRUK_OFFLINE_PAUSE_MS });
  });

  it('test() asks about PMR446 channel 1 and reports the account', async () => {
    const { svc, calls } = make({}, { reply: () => ({ status: 200, body: { success: true, user: 'steve', count: 0, data: [] } }) });
    await expect(svc.test()).resolves.toEqual({ user: 'steve', entries: [] });
    expect(new URL(calls[0]!).searchParams.get('freq')).toBe('446.00625');
    await expect(make({ apiKey: '' }).svc.test()).rejects.toThrow(/API key/);
  });
});
