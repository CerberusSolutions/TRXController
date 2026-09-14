/** Small JSON settings file in userData, owned by the main process. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Settings } from '../shared/ipc';

export const DEFAULT_SETTINGS: Settings = { lat: null, lon: null, radiusKm: 60 };

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
  };
}
