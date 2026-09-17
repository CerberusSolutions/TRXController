/**
 * RadioReference lookups for the running scanner: what does RadioReference
 * say about the frequency the scanner has stopped on?
 *
 * Everything is served from the SQLite cache (`rr_*` tables) synchronously;
 * the web service is only asked when a heard frequency is not cached, at most
 * one call in flight and a short gap between calls, so a busy scanner does not
 * hammer the API. A trunked hit pulls the system's details, sites and full
 * talkgroup list once and keeps them, after which every talkgroup on that
 * system resolves offline. Failures back off per frequency.
 */
import type { RrConventional, RrInfo, RrSettings, RrStatus, RrSystemInfo } from '../../shared/ipc';
import type { LogDb } from '../log/db';
import { RrClient, RrError, type FetchLike, type RrFreqHit, type RrSite, type RrSystemSummary } from './radioreference';
import { distanceKm } from './wtr';

/** Re-ask about a frequency after this long. */
export const FREQ_TTL_MS = 30 * 24 * 3600 * 1000;
/** Re-fetch a system's sites and talkgroups after this long. */
export const SYSTEM_TTL_MS = 90 * 24 * 3600 * 1000;
/** After a failed lookup, leave that frequency alone for this long. */
export const RETRY_AFTER_MS = 10 * 60 * 1000;
/** Gap between consecutive API calls. */
export const CALL_SPACING_MS = 1200;
/** Frequencies within this of a RadioReference entry count as the same channel. */
const MATCH_TOLERANCE_HZ = 3_125;

export interface RrServiceOptions {
  db: LogDb;
  appKey: string;
  getSettings: () => RrSettings;
  /** Decrypt the stored password; throws or returns '' if it cannot. */
  decrypt: (cipher: string) => string;
  /**
   * The user's location and radius (the WTR settings). A region-wide search
   * returns every system and channel in England on a frequency; only those
   * with a site or county within the radius are kept. No location: keep all.
   */
  getLocation?: () => { lat: number | null; lon: number | null; radiusKm: number | null };
  fetchImpl?: FetchLike;
  /** Called after the cache changes, so the caller can refresh what it shows. */
  onChange?: () => void;
  log?: (msg: string) => void;
  now?: () => number;
  /** Gap between API calls; tests shorten it. */
  spacingMs?: number;
}

export class RrService {
  private readonly db: LogDb;
  private readonly appKey: string;
  private readonly getSettings: () => RrSettings;
  private readonly decrypt: (cipher: string) => string;
  private readonly getLocation: () => { lat: number | null; lon: number | null; radiusKm: number | null };
  private readonly fetchImpl: FetchLike | undefined;
  private readonly onChange: () => void;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;
  private readonly spacingMs: number;
  private readonly queue: number[] = [];
  private readonly failed = new Map<number, { at: number; message: string }>();
  private inFlight: number | null = null;
  private lastCallAt = 0;
  /** When each frequency was last checked against the cache, so a long reception does not re-check every poll. */
  private readonly checked = new Map<number, number>();
  private timer: NodeJS.Timeout | null = null;
  lastError: string | null = null;

  constructor(opts: RrServiceOptions) {
    this.db = opts.db;
    this.appKey = opts.appKey;
    this.getSettings = opts.getSettings;
    this.decrypt = opts.decrypt;
    this.getLocation = opts.getLocation ?? (() => ({ lat: null, lon: null, radiusKm: null }));
    this.fetchImpl = opts.fetchImpl;
    this.onChange = opts.onChange ?? (() => {});
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.spacingMs = opts.spacingMs ?? CALL_SPACING_MS;
  }

  /** After the account changes, let every frequency be tried again. */
  resetFailures(): void {
    this.failed.clear();
    this.checked.clear();
    this.lastError = null;
  }

  /** A client for the current account, or null when the account, region or app key is missing. */
  client(): RrClient | null {
    const s = this.getSettings();
    if (!this.appKey || !s.username || !s.password) return null;
    let password = '';
    try {
      password = this.decrypt(s.password);
    } catch {
      return null;
    }
    if (!password) return null;
    return new RrClient({ username: s.username, password, appKey: this.appKey }, this.fetchImpl);
  }

  /** Lookups run only with an account, a region and an app key. */
  get enabled(): boolean {
    return this.client() !== null && this.getSettings().stid !== null;
  }

  status(): RrStatus {
    const s = this.getSettings();
    const stats = this.db.rrStats();
    return {
      appKey: this.appKey !== '',
      username: s.username,
      hasPassword: s.password !== '',
      coid: s.coid,
      stid: s.stid,
      countryName: s.countryName,
      stateName: s.stateName,
      enabled: this.enabled,
      cachedFreqs: stats.freqs,
      cachedSystems: stats.systems,
      cachedTalkgroups: stats.talkgroups,
      lastError: this.lastError,
    };
  }

  /** Forget cached lookups and failures (after a region change, say). */
  clearCache(): void {
    this.db.rrClear();
    this.failed.clear();
    this.checked.clear();
    this.queue.length = 0;
    this.onChange();
  }

  /**
   * What the cache holds for `hz`, resolved for the reception in hand. Null
   * when RadioReference is not set up. Never touches the network.
   */
  info(hz: number, ctx: { tgid?: number | null; nac?: string | null } = {}): RrInfo | null {
    const stid = this.getSettings().stid;
    if (stid === null || !this.enabled) return null;
    const cached = this.db.rrGetFreq(hz, stid);
    const pending = this.inFlight === hz || this.queue.includes(hz);
    const error = this.failed.get(hz)?.message ?? null;
    if (!cached) return { frequencyHz: hz, conventional: [], systems: [], fetchedAt: null, pending, error };
    const loc = this.getLocation();
    const here = loc.lat !== null && loc.lon !== null ? { lat: loc.lat, lon: loc.lon } : null;
    const radius = loc.radiusKm ?? 60;
    const far = (d: number | null, slack = 0): boolean => here !== null && d !== null && d > radius + slack;

    const conventional: RrConventional[] = [];
    for (const h of cached.hits) {
      if (h.sid !== null) continue;
      const county = h.ctid !== null ? this.db.rrGetCounty(h.ctid) : null;
      const d = here && county && county.lat !== null && county.lon !== null ? distanceKm(here.lat, here.lon, county.lat, county.lon) : null;
      // A county entry is local if its centre is within the radius plus the county's own coverage range.
      if (far(d, county?.rangeKm ?? 0)) continue;
      conventional.push({ descr: h.descr, alpha: h.alpha, tone: h.tone, mode: h.mode, callsign: h.callsign, tags: h.tags, county: county?.name ?? '', distanceKm: d });
    }
    conventional.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));

    const systems: RrSystemInfo[] = [];
    const seen = new Set<number>();
    for (const h of cached.hits) {
      if (h.sid === null || seen.has(h.sid)) continue;
      seen.add(h.sid);
      const sys = this.db.rrGetSystem(h.sid);
      if (!sys) {
        // Details not fetched (yet): with a location set there is nothing to place it by, so it waits.
        if (!here) systems.push({ sid: h.sid, name: h.descr || h.alpha || `System ${h.sid}`, city: '', site: null, distanceKm: null, talkgroup: null });
        continue;
      }
      const site = pickSite(sys.sites, hz, ctx.nac ?? null, here);
      // Distance to the site when RadioReference places it, else to the system's own centre
      // (allowing its coverage range); many UK sites carry no coordinates but the system does.
      const siteD = here && site && site.lat !== null && site.lon !== null ? distanceKm(here.lat, here.lon, site.lat, site.lon) : null;
      const sysD = here && sys.system.lat !== null && sys.system.lon !== null ? distanceKm(here.lat, here.lon, sys.system.lat, sys.system.lon) : null;
      const d = siteD ?? sysD;
      if (siteD !== null ? far(siteD) : far(sysD, sys.system.rangeKm ?? 0)) continue;
      // A region-wide search returns every system in England on the frequency, so with a location
      // set a system nobody can place is more likely far away than near: it is dropped unless the
      // site's NAC matches the one heard, which places it well enough on its own.
      const nacMatch = site !== null && ctx.nac != null && site.nac.replace(/^0+/, '').toUpperCase() === ctx.nac.replace(/^0+/, '').toUpperCase();
      if (here && d === null && !nacMatch) continue;
      const tg = ctx.tgid != null ? this.db.rrGetTalkgroup(h.sid, ctx.tgid) : null;
      systems.push({
        sid: h.sid,
        name: sys.system.name,
        city: sys.system.city,
        site: site ? { descr: site.descr, location: site.location, nac: site.nac } : null,
        distanceKm: d,
        talkgroup: tg ? { tgDec: tg.tgDec, alpha: tg.alpha, descr: tg.descr, mode: tg.mode, enc: tg.enc, category: tg.category } : null,
      });
    }
    systems.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
    return { frequencyHz: hz, conventional, systems, fetchedAt: cached.fetchedAt, pending, error };
  }

  /** Ask for `hz` if it is not cached (or is stale) and not recently failed. Returns true if a lookup was queued. */
  request(hz: number, force = false): boolean {
    const stid = this.getSettings().stid;
    if (stid === null || !this.enabled) return false;
    if (this.inFlight === hz || this.queue.includes(hz)) return false;
    if (!force) {
      const at = this.checked.get(hz);
      if (at !== undefined && this.now() - at < 5000) return false;
      this.checked.set(hz, this.now());
      if (this.checked.size > 500) this.checked.clear();
      const cached = this.db.rrGetFreq(hz, stid);
      if (cached && this.now() - cached.fetchedAt < FREQ_TTL_MS && this.systemsFresh(cached.hits)) return false;
      const f = this.failed.get(hz);
      if (f && this.now() - f.at < RETRY_AFTER_MS) return false;
    }
    this.failed.delete(hz);
    this.queue.push(hz);
    this.schedule();
    return true;
  }

  private systemsFresh(hits: RrFreqHit[]): boolean {
    for (const h of hits) {
      if (h.sid === null) continue;
      const sys = this.db.rrGetSystem(h.sid);
      if (!sys || this.now() - sys.fetchedAt > SYSTEM_TTL_MS) return false;
    }
    return true;
  }

  private schedule(): void {
    if (this.timer || this.inFlight !== null || this.queue.length === 0) return;
    const wait = Math.max(0, this.lastCallAt + this.spacingMs - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, wait);
  }

  private async run(): Promise<void> {
    const hz = this.queue.shift();
    if (hz === undefined) return;
    const client = this.client();
    const stid = this.getSettings().stid;
    if (!client || stid === null) return;
    this.inFlight = hz;
    try {
      this.lastCallAt = this.now();
      const hits = await client.searchStateFreq(stid, hz / 1e6);
      this.db.rrPutFreq(hz, stid, hits, this.now());
      this.log(`${(hz / 1e6).toFixed(4)} MHz: ${hits.length} entries`);
      // Counties place conventional entries on the map; each is fetched once.
      for (const ctid of new Set(hits.filter((h) => h.sid === null && h.ctid !== null).map((h) => h.ctid!))) {
        if (this.db.rrGetCounty(ctid)) continue;
        await this.pause();
        const county = await client.getCountyInfo(ctid);
        this.db.rrPutCounty(county, this.now());
        this.log(`county ${ctid} "${county.name}"`);
      }
      for (const h of hits) {
        if (h.sid === null) continue;
        const sys = this.db.rrGetSystem(h.sid);
        if (sys && this.now() - sys.fetchedAt < SYSTEM_TTL_MS) continue;
        await this.pause();
        const [system, sites] = await Promise.all([client.getTrsDetails(h.sid), client.getTrsSites(h.sid)]);
        await this.pause();
        const talkgroups = await client.getTrsTalkgroups(h.sid);
        this.db.rrPutSystem(system, sites, talkgroups, this.now());
        const at = system.lat !== null ? ` at ${system.lat.toFixed(2)},${system.lon!.toFixed(2)}` : ' (no position)';
        this.log(`system ${h.sid} "${system.name}"${at}: ${sites.length} sites (${sites.filter((x) => x.lat !== null).length} placed), ${talkgroups.length} talkgroups`);
      }
      this.lastError = null;
    } catch (e) {
      const message = e instanceof RrError ? e.message : (e as Error).message;
      this.failed.set(hz, { at: this.now(), message });
      this.lastError = message;
      this.log(`${(hz / 1e6).toFixed(4)} MHz failed: ${message}`);
      // A bad login fails every frequency the same way: stop asking.
      if (e instanceof RrError && /user|password|auth|key|subscri/i.test(e.message)) this.queue.length = 0;
    } finally {
      this.inFlight = null;
      this.lastCallAt = this.now();
      this.onChange();
      this.schedule();
    }
  }

  private pause(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.spacingMs));
  }

  /** Stop any scheduled work (on quit). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
  }
}

/** The site using `hz`; when several do, the one whose NAC matches, else the nearest, else the first. */
export function pickSite(sites: RrSite[], hz: number, nac: string | null, here: { lat: number; lon: number } | null = null): RrSite | null {
  const onFreq = sites.filter((s) => s.freqs.some((f) => Math.abs(Math.round(f.freqMHz * 1e6) - hz) <= MATCH_TOLERANCE_HZ));
  if (onFreq.length === 0) return null;
  if (nac) {
    const want = nac.replace(/^0+/, '').toUpperCase();
    const byNac = onFreq.find((s) => s.nac.replace(/^0+/, '').toUpperCase() === want);
    if (byNac) return byNac;
  }
  if (here) {
    const d = (s: RrSite): number => (s.lat !== null && s.lon !== null ? distanceKm(here.lat, here.lon, s.lat, s.lon) : 1e9);
    return [...onFreq].sort((a, b) => d(a) - d(b))[0]!;
  }
  return onFreq[0]!;
}

export type { RrSystemSummary };
