import { describe, expect, it } from 'vitest';
import type { ReceptionRow } from '../ipc';
import { activeIn, dayKey, dayPins, dayRange, isDayKey, shiftDay } from '../dayMap';

const row = (o: Partial<ReceptionRow>): ReceptionRow => ({
  id: 1,
  startedAt: 1000,
  endedAt: 2000,
  frequencyHz: 453_062_500,
  mode: 'NFM',
  signalType: 'DMR',
  name: '',
  system: '',
  scanlist: '',
  objectType: '',
  tgid: null,
  radioId: null,
  site: '',
  squelch: '',
  tone: '',
  licensee: '',
  source: '',
  scannerName: '',
  wtr: '',
  rrName: '',
  rrSystem: '',
  rpt: '',
  rruk: '',
  distanceKm: null,
  bearingDeg: null,
  lat: null,
  lon: null,
  candidates: [],
  rssiPeak: 0,
  calls: 1,
  hits: 1,
  radioCallsign: null,
  radioName: null,
  ...o,
});

describe('day keys', () => {
  it('formats and validates local calendar dates', () => {
    expect(dayKey(new Date(2026, 8, 21, 13, 5))).toBe('2026-09-21');
    expect(isDayKey('2026-09-21')).toBe(true);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-9-21')).toBe(false);
    expect(isDayKey(20260921)).toBe(false);
  });

  it('steps across month ends and covers the whole local day', () => {
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    const { from, to } = dayRange('2026-09-21');
    expect(new Date(from).getHours()).toBe(0);
    expect(to - from).toBeGreaterThanOrEqual(23 * 3600_000);
    expect(to - from).toBeLessThanOrEqual(25 * 3600_000);
    expect(dayKey(new Date(to - 1))).toBe('2026-09-21');
    expect(dayKey(new Date(to))).toBe('2026-09-22');
  });

  it('counts an entry as active if any of it falls in the period, an open one up to now', () => {
    expect(activeIn({ startedAt: 50, endedAt: 150 }, 100, 200)).toBe(true);
    expect(activeIn({ startedAt: 150, endedAt: 250 }, 100, 200)).toBe(true);
    expect(activeIn({ startedAt: 10, endedAt: 99 }, 100, 200)).toBe(false);
    expect(activeIn({ startedAt: 200, endedAt: 300 }, 100, 200)).toBe(false);
    expect(activeIn({ startedAt: 10, endedAt: null }, 100, 200, 150)).toBe(true);
    expect(activeIn({ startedAt: 10, endedAt: null }, 100, 200, 90)).toBe(false);
  });
});

describe('dayPins', () => {
  it('groups entries at the same placement, names the pin from the newest named one and counts frequencies', () => {
    const pins = dayPins([
      row({ id: 1, startedAt: 1000, endedAt: 2000, lat: 51.7701, lon: -0.8001, licensee: 'Thames Valley Taxis Ltd', source: 'WTR' }),
      row({ id: 2, startedAt: 3000, endedAt: 4000, lat: 51.77, lon: -0.8, name: 'Aylesbury Taxis', source: 'CONF', frequencyHz: 410_775_000 }),
      row({ id: 3, startedAt: 5000, endedAt: 6000, lat: 51.77004, lon: -0.80004 }),
      row({ id: 4, startedAt: 7000, endedAt: 8000, lat: 51.99, lon: -1.19, name: 'Brize', source: 'RRDB' }),
      row({ id: 5, startedAt: 9000, endedAt: null, lat: null, lon: null, name: 'unplaced' }),
      row({ id: 6, startedAt: 9000, endedAt: null, lat: 0, lon: 0, name: 'gulf of guinea' }),
    ]);
    expect(pins.map((p) => [p.name, p.source, p.rows.length, p.frequencies])).toEqual([
      ['Aylesbury Taxis', 'CONF', 3, 2],
      ['Brize', 'RRDB', 1, 1],
    ]);
    expect(pins[0]!.rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(pins[0]!.lat).toBeCloseTo(51.77004, 5);
  });

  it('falls back to the licensee, credited to the WTR, else the frequency', () => {
    const pins = dayPins([row({ id: 1, lat: 51.8, lon: -0.9, licensee: 'NATS' }), row({ id: 2, lat: 51.9, lon: -0.9, frequencyHz: 119_775_000 })]);
    expect(pins.find((p) => p.lat === 51.8)).toMatchObject({ name: 'NATS', source: 'WTR' });
    expect(pins.find((p) => p.lat === 51.9)).toMatchObject({ name: '119.7750 MHz', source: '' });
  });
});
