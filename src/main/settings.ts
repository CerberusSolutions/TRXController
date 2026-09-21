/** Small JSON settings file in userData, owned by the main process. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MAP_MIN_WINDOW, type RrSettings, type RrukSettings, type Settings, type WindowState } from '../shared/ipc';
import { normaliseUnits } from '../shared/geo';
import { DEFAULT_LOOKUPS, normaliseLookups } from '../shared/sources';

export const DEFAULT_RR: RrSettings = { username: '', password: '', coid: null, stid: null, countryName: '', stateName: '' };
export const DEFAULT_RRUK: RrukSettings = { apiKey: '', postcode: '' };
export const DEFAULT_SETTINGS: Settings = { lat: null, lon: null, radiusKm: 60, units: 'km', scanTimeoutS: null, port: null, autoConnect: true, window: null, mapDock: null, mapWindow: null, programmingRecent: [], rr: { ...DEFAULT_RR }, rruk: { ...DEFAULT_RRUK }, lookups: DEFAULT_LOOKUPS.map((p) => ({ ...p })) };

export class SettingsStore {
  private value: Settings;

  constructor(private readonly path: string) {
    this.value = { ...DEFAULT_SETTINGS };
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>;
        this.value = sanitize({ ...DEFAULT_SETTINGS, ...raw });
      }
    } catch {
      /* corrupt file: keep defaults */
    }
  }

  get(): Settings {
    return { ...this.value };
  }

  set(patch: Partial<Settings>): Settings {
    this.value = sanitize({ ...this.value, ...patch });
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.value, null, 2));
    return this.get();
  }
}

export function sanitize(s: Settings): Settings {
  const num = (v: unknown, min: number, max: number): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
  return {
    lat: num(s.lat, -90, 90),
    lon: num(s.lon, -180, 180),
    radiusKm: num(s.radiusKm, 1, 5000),
    units: normaliseUnits(s.units),
    scanTimeoutS: typeof s.scanTimeoutS === 'number' && Number.isFinite(s.scanTimeoutS) && s.scanTimeoutS >= 3 && s.scanTimeoutS <= 600 ? Math.round(s.scanTimeoutS) : null,
    port: typeof s.port === 'string' && s.port.trim() !== '' ? s.port.trim() : null,
    autoConnect: s.autoConnect !== false,
    window: sanitizeWindow(s.window),
    mapDock: s.mapDock === 'left' || s.mapDock === 'right' ? s.mapDock : null,
    mapWindow: sanitizeWindow(s.mapWindow, MAP_MIN_WINDOW),
    programmingRecent: Array.isArray(s.programmingRecent) ? [...new Set(s.programmingRecent.filter((d): d is string => typeof d === 'string' && d.trim() !== ''))].slice(0, 8) : [],
    rr: sanitizeRr(s.rr),
    rruk: sanitizeRruk(s.rruk),
    lookups: normaliseLookups(s.lookups),
  };
}

function sanitizeRr(r: unknown): RrSettings {
  if (typeof r !== 'object' || r === null) return { ...DEFAULT_RR };
  const o = r as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const id = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
  return {
    username: text(o['username']),
    password: typeof o['password'] === 'string' ? o['password'] : '',
    coid: id(o['coid']),
    stid: id(o['stid']),
    countryName: text(o['countryName']),
    stateName: text(o['stateName']),
  };
}

function sanitizeRruk(r: unknown): RrukSettings {
  if (typeof r !== 'object' || r === null) return { ...DEFAULT_RRUK };
  const o = r as Record<string, unknown>;
  return {
    apiKey: typeof o['apiKey'] === 'string' ? o['apiKey'] : '',
    postcode: typeof o['postcode'] === 'string' ? o['postcode'].trim().toUpperCase().slice(0, 10) : '',
  };
}

export const MIN_WINDOW = { width: 900, height: 600 };

function sanitizeWindow(w: unknown, min: { width: number; height: number } = MIN_WINDOW): WindowState | null {
  if (typeof w !== 'object' || w === null) return null;
  const o = w as Record<string, unknown>;
  const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
  const x = int(o['x']);
  const y = int(o['y']);
  const width = int(o['width']);
  const height = int(o['height']);
  if (x === null || y === null || width === null || height === null) return null;
  if (width < min.width || height < min.height) return null;
  return { x, y, width, height, maximized: o['maximized'] === true };
}
