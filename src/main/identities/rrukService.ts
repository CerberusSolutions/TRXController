/**
 * RadioReference UK lookups for the running scanner, served from the `rruk_freqs` cache and
 * asked of the web only when a heard frequency is not cached for the current location: one
 * call in flight, a short gap between calls, failures backed off per frequency, a bad key
 * emptying the queue. The same shape as RrService, minus the trunked-system fetches (RRUK's
 * search is already filtered to the user's area, so nothing needs placing afterwards).
 */
import type { RrukHalt, RrukInfo, RrukSettings, RrukStatus } from '../../shared/ipc';
import { KM_PER_MILE, placeFrom } from '../../shared/geo';
import type { LogDb } from '../log/db';
import { RRUK_MAX_RANGE_MILES, RrukError, searchRruk, type FetchLike, type RrukResult } from './rruk';

/** Re-ask about a frequency after this long. */
export const RRUK_TTL_MS = 30 * 24 * 3600 * 1000;
/** After a failed lookup, leave that frequency alone for this long. */
export const RRUK_RETRY_AFTER_MS = 10 * 60 * 1000;
/** Gap between consecutive API calls: polite to a per-user key. */
export const RRUK_CALL_SPACING_MS = 1200;
/** After the server refuses a request for anything but the key (a rate limit, a locked address), ask nothing for this long. */
export const RRUK_HALT_MS = 15 * 60 * 1000;
/** After the server could not be reached at all, ask nothing for this long. */
export const RRUK_OFFLINE_PAUSE_MS = 60 * 1000;

/**
 * What a failed call means for every other frequency. A refusal from the server (it answered, `success` false or
 * a non-200 status) is not about the frequency: an invalid key fails every request the same way until the key is
 * changed, and a rate limit or a locked address only gets worse with more requests, so the service stops asking.
 * The RRUK operators asked for exactly this (25 Sep 2026): clients kept sending after a 401 "Invalid API key".
 */
export function haltFor(e: unknown, now: number): RrukHalt {
  const err = e instanceof RrukError ? e : null;
  const message = err?.message ?? (e as Error).message ?? 'RRUK failed';
  if (!err || err.status === null) return { kind: 'offline', message, until: now + RRUK_OFFLINE_PAUSE_MS };
  // "Access denied: This API key is locked to another IP address." (seen 25 Sep 2026) names the key but is about the
  // address: the user fixes it in their RRUK dashboard, so it is a timed pause, not a wait for a new key.
  if (err.status === 429 || /ip address|locked|too many|rate|limit|geo/i.test(message)) return { kind: 'limit', message, until: now + RRUK_HALT_MS };
  if (err.status === 401 || err.status === 403 || /api[ _-]?key|invalid key|unauthori[sz]ed|authenticat|subscri/i.test(message)) return { kind: 'key', message, until: null };
  return { kind: 'refused', message, until: now + RRUK_HALT_MS };
}

export interface RrukServiceOptions {
  db: LogDb;
  getSettings: () => RrukSettings;
  /** Decrypt the stored key; throws or returns '' if it cannot. */
  decrypt: (cipher: string) => string;
  /** A key from the environment for development builds only; '' in a packaged app. */
  devKey?: () => string;
  getLocation?: () => { lat: number | null; lon: number | null; radiusKm: number | null };
  fetchImpl?: FetchLike;
  onChange?: () => void;
  log?: (msg: string) => void;
  now?: () => number;
  spacingMs?: number;
}

export class RrukService {
  private readonly db: LogDb;
  private readonly getSettings: () => RrukSettings;
  private readonly decrypt: (cipher: string) => string;
  private readonly devKey: () => string;
  private readonly getLocation: () => { lat: number | null; lon: number | null; radiusKm: number | null };
  private readonly fetchImpl: FetchLike | undefined;
  private readonly onChange: () => void;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;
  private readonly spacingMs: number;
  private readonly queue: number[] = [];
  private readonly failed = new Map<number, { at: number; message: string }>();
  private readonly checked = new Map<number, number>();
  private inFlight: number | null = null;
  private lastCallAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private halt: RrukHalt | null = null;
  lastError: string | null = null;

  constructor(opts: RrukServiceOptions) {
    this.db = opts.db;
    this.getSettings = opts.getSettings;
    this.decrypt = opts.decrypt;
    this.devKey = opts.devKey ?? (() => '');
    this.getLocation = opts.getLocation ?? (() => ({ lat: null, lon: null, radiusKm: null }));
    this.fetchImpl = opts.fetchImpl;
    this.onChange = opts.onChange ?? (() => {});
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.spacingMs = opts.spacingMs ?? RRUK_CALL_SPACING_MS;
  }

  /** The API key in use: the user's stored one, else a development key from the environment; null when neither. */
  apiKey(): string | null {
    const stored = this.getSettings().apiKey;
    if (stored) {
      try {
        const k = this.decrypt(stored);
        if (k) return k;
      } catch {
        /* fall through to the dev key */
      }
    }
    return this.devKey() || null;
  }

  /** What the query is filtered by: a postcode, else the coordinates; '' when neither is set. */
  private where(): { postcode?: string; lat?: number; lon?: number; rangeMiles: number; scope: string } | null {
    const postcode = this.getSettings().postcode.trim().toUpperCase();
    const loc = this.getLocation();
    const rangeMiles = Math.min(loc.radiusKm != null && loc.radiusKm > 0 ? Math.round(loc.radiusKm / KM_PER_MILE) : RRUK_MAX_RANGE_MILES, RRUK_MAX_RANGE_MILES);
    if (postcode) return { postcode, rangeMiles, scope: `pc:${postcode}|${rangeMiles}` };
    if (loc.lat !== null && loc.lon !== null) return { lat: loc.lat, lon: loc.lon, rangeMiles, scope: `ll:${loc.lat.toFixed(4)},${loc.lon.toFixed(4)}|${rangeMiles}` };
    return null;
  }

  /** Lookups run only with a key and somewhere to search from. */
  get enabled(): boolean {
    return this.apiKey() !== null && this.where() !== null;
  }

  /** After the key or location changes, let every frequency be tried again. */
  resetFailures(): void {
    this.failed.clear();
    this.checked.clear();
    this.halt = null;
    this.lastError = null;
  }

  /** The pause in force, if any: a timed one lapses by itself, a key one holds until the key changes or a test passes. */
  halted(): RrukHalt | null {
    if (this.halt && this.halt.until !== null && this.now() >= this.halt.until) this.halt = null;
    return this.halt;
  }

  status(): RrukStatus {
    return {
      hasKey: this.getSettings().apiKey !== '',
      devKey: this.getSettings().apiKey === '' && this.devKey() !== '',
      postcode: this.getSettings().postcode,
      located: this.where() !== null,
      enabled: this.enabled,
      cachedFreqs: this.db.rrukStats().freqs,
      lastError: this.lastError,
      halted: this.halted(),
    };
  }

  clearCache(): void {
    this.db.rrukClear();
    this.failed.clear();
    this.checked.clear();
    this.queue.length = 0;
    this.onChange();
  }

  /** Ask RRUK who the key belongs to, with a nationwide frequency (PMR446 channel 1) that always answers. */
  async test(): Promise<RrukResult> {
    const key = this.apiKey();
    if (!key) throw new RrukError('Enter your RRUK API key first');
    const w = this.where();
    const r = await searchRruk({ apiKey: key, freqMHz: 446.00625, ...(w ?? { rangeMiles: RRUK_MAX_RANGE_MILES }) }, this.fetchImpl);
    this.resetFailures();
    return r;
  }

  /** What the cache holds for `hz` for the current location; null when RRUK is not set up. Never touches the network. */
  info(hz: number): RrukInfo | null {
    if (!this.enabled) return null;
    const w = this.where()!;
    const cached = this.db.rrukGetFreq(hz);
    const pending = this.inFlight === hz || this.queue.includes(hz);
    const error = this.halted()?.message ?? this.failed.get(hz)?.message ?? null;
    if (!cached || cached.scope !== w.scope) return { frequencyHz: hz, entries: [], fetchedAt: null, pending, error };
    return { frequencyHz: hz, entries: cached.entries, fetchedAt: cached.fetchedAt, pending, error };
  }

  /** Ask for `hz` if it is not cached for this location (or is stale) and not recently failed. True if queued. */
  request(hz: number, force = false): boolean {
    if (!this.enabled) return false;
    // While the server is refusing, nothing is asked, forced or not: only a new key or a passed test resumes a key halt.
    if (this.halted()) return false;
    if (this.inFlight === hz || this.queue.includes(hz)) return false;
    if (!force) {
      const at = this.checked.get(hz);
      if (at !== undefined && this.now() - at < 5000) return false;
      this.checked.set(hz, this.now());
      if (this.checked.size > 500) this.checked.clear();
      const cached = this.db.rrukGetFreq(hz);
      if (cached && cached.scope === this.where()!.scope && this.now() - cached.fetchedAt < RRUK_TTL_MS) return false;
      const f = this.failed.get(hz);
      if (f && this.now() - f.at < RRUK_RETRY_AFTER_MS) return false;
    }
    this.failed.delete(hz);
    this.queue.push(hz);
    this.schedule();
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
    const key = this.apiKey();
    const w = this.where();
    if (!key || !w) return;
    this.inFlight = hz;
    try {
      this.lastCallAt = this.now();
      const r = await searchRruk({ apiKey: key, freqMHz: hz / 1e6, ...w }, this.fetchImpl);
      // The server gives a distance; when it also gives the entry's coordinates and we have the
      // user's, the bearing (and a finer distance) come from those.
      const loc = this.getLocation();
      const here = loc.lat !== null && loc.lon !== null ? { lat: loc.lat, lon: loc.lon } : null;
      const entries = r.entries.map((e) => {
        if (e.nationwide || e.lat === null || e.lon === null || !here) return e;
        const p = placeFrom(here, e.lat, e.lon);
        return { ...e, distanceKm: e.distanceKm ?? p.distanceKm, bearingDeg: e.bearingDeg ?? p.bearingDeg };
      });
      this.db.rrukPutFreq(hz, w.scope, entries, this.now());
      this.log(`${(hz / 1e6).toFixed(4)} MHz: ${entries.length} entries`);
      this.lastError = null;
    } catch (e) {
      const message = e instanceof RrukError ? e.message : (e as Error).message;
      this.failed.set(hz, { at: this.now(), message });
      this.lastError = message;
      // A refusal is about the key, the address or the rate, not the frequency: stop asking (see haltFor).
      this.halt = haltFor(e, this.now());
      this.queue.length = 0;
      this.log(`${(hz / 1e6).toFixed(4)} MHz failed: ${message}; lookups paused (${this.halt.kind}${this.halt.until === null ? ' until the key is changed' : ` for ${Math.round((this.halt.until - this.now()) / 60000)} min`})`);
    } finally {
      this.inFlight = null;
      this.lastCallAt = this.now();
      this.onChange();
      this.schedule();
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.length = 0;
  }
}
