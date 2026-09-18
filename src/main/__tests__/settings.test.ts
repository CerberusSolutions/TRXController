import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsStore, sanitize } from '../settings';

describe('sanitize', () => {
  it('keeps a trimmed port and defaults autoConnect on', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, port: ' COM7 ' })).toMatchObject({ port: 'COM7', autoConnect: true });
  });

  it('drops an empty or non-string port', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, port: '' }).port).toBeNull();
  });

  it('keeps the scan timeout to a sensible number of seconds, or off', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, scanTimeoutS: 30 }).scanTimeoutS).toBe(30);
    expect(sanitize({ ...DEFAULT_SETTINGS, scanTimeoutS: 12.6 }).scanTimeoutS).toBe(13);
    expect(sanitize({ ...DEFAULT_SETTINGS, scanTimeoutS: 1 }).scanTimeoutS).toBeNull();
    expect(sanitize({ ...DEFAULT_SETTINGS, scanTimeoutS: 'soon' as never }).scanTimeoutS).toBeNull();
    expect(sanitize({ ...DEFAULT_SETTINGS, scanTimeoutS: undefined as never }).scanTimeoutS).toBeNull();
  });

  it('keeps the distance units to km or miles', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, units: 'mi' }).units).toBe('mi');
    expect(sanitize({ ...DEFAULT_SETTINGS, units: 'furlongs' as never }).units).toBe('km');
    expect(sanitize({ ...DEFAULT_SETTINGS, units: undefined as never }).units).toBe('km');
  });

  it('keeps the lookup order, drops unknown lookups and slots missing ones in enabled at their default place', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, lookups: [{ id: 'RRDB', enabled: false }, { id: 'X' }, { id: 'RRDB', enabled: true }] as never }).lookups).toEqual([
      { id: 'WTR', enabled: true },
      { id: 'RRUK', enabled: true },
      { id: 'RRDB', enabled: false },
      { id: 'UKR', enabled: true },
    ]);
    // A file from before RRUK existed: it goes in above RadioReference, where the default puts it, not at the end.
    expect(sanitize({ ...DEFAULT_SETTINGS, lookups: [{ id: 'RRDB', enabled: true }, { id: 'WTR', enabled: true }, { id: 'UKR', enabled: true }] }).lookups.map((p) => p.id)).toEqual(['RRDB', 'RRUK', 'WTR', 'UKR']);
    expect(sanitize({ ...DEFAULT_SETTINGS, lookups: 'all' as never }).lookups).toEqual(DEFAULT_SETTINGS.lookups);
    expect(sanitize({ ...DEFAULT_SETTINGS, port: 7 as unknown as string }).port).toBeNull();
  });

  it('only an explicit false switches autoConnect off', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, autoConnect: false }).autoConnect).toBe(false);
    expect(sanitize({ ...DEFAULT_SETTINGS, autoConnect: undefined as unknown as boolean }).autoConnect).toBe(true);
  });
});

describe('sanitize window placement', () => {
  it('rounds a valid placement and keeps the maximised flag', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, window: { x: 10.4, y: 20, width: 1320, height: 780, maximized: true } }).window).toEqual({
      x: 10,
      y: 20,
      width: 1320,
      height: 780,
      maximized: true,
    });
  });

  it('drops a placement smaller than the minimum window or missing a field', () => {
    expect(sanitize({ ...DEFAULT_SETTINGS, window: { x: 0, y: 0, width: 400, height: 780, maximized: false } }).window).toBeNull();
    expect(sanitize({ ...DEFAULT_SETTINGS, window: { x: 0, y: 0, width: 1320 } as never }).window).toBeNull();
    expect(sanitize({ ...DEFAULT_SETTINGS, window: 'big' as never }).window).toBeNull();
  });
});

describe('SettingsStore', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('remembers the port across instances and a disconnect turns auto-connect off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trx-settings-'));
    dirs.push(dir);
    const path = join(dir, 'settings.json');
    const a = new SettingsStore(path);
    expect(a.get()).toEqual(DEFAULT_SETTINGS);
    a.set({ port: 'COM7', autoConnect: true });
    a.set({ autoConnect: false });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ port: 'COM7', autoConnect: false, radiusKm: 60 });
    expect(new SettingsStore(path).get()).toMatchObject({ port: 'COM7', autoConnect: false });
  });

  it('a location patch leaves the port alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'trx-settings-'));
    dirs.push(dir);
    const s = new SettingsStore(join(dir, 'settings.json'));
    s.set({ port: 'COM3' });
    expect(s.set({ lat: 51.8, lon: -0.8, radiusKm: 40 })).toMatchObject({ port: 'COM3', lat: 51.8, autoConnect: true });
  });
});
