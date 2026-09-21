import type { ReceptionRow } from './ipc';
import { point } from './geo';

/** A local calendar date as YYYY-MM-DD, the key the map's Log view works in. */
export function dayKey(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Is `s` a YYYY-MM-DD that names a real local date? */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = dayStart(s);
  return !Number.isNaN(d.getTime()) && dayKey(d) === s;
}

function dayStart(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** The local day as an epoch-ms period, `to` exclusive (DST days are 23 or 25 hours; the Date maths copes). */
export function dayRange(day: string): { from: number; to: number } {
  const start = dayStart(day);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  return { from: start.getTime(), to: end.getTime() };
}

/** The day `n` days on from `day` (negative for back). */
export function shiftDay(day: string, n: number): string {
  const s = dayStart(day);
  return dayKey(new Date(s.getFullYear(), s.getMonth(), s.getDate() + n));
}

/** Was the entry active at any point in the period? An open entry counts up to `now`. */
export function activeIn(r: { startedAt: number; endedAt: number | null }, from: number, to: number, now = Date.now()): boolean {
  return r.startedAt < to && (r.endedAt ?? now) >= from;
}

/** One pin on the day map: every entry placed at the same point, the newest named one naming it. */
export interface DayPin {
  key: string;
  lat: number;
  lon: number;
  /** The newest named entry's name, else its licensee, else the frequency. */
  name: string;
  /** The source behind that name, for the pin's colour ('' for the scanner's own). */
  source: ReceptionRow['source'];
  distanceKm: number | null;
  bearingDeg: number | null;
  /** Entries at this point, newest first. */
  rows: ReceptionRow[];
  /** Distinct frequencies among them. */
  frequencies: number;
}

/** About 50 m: the same placement whatever rounding the sources applied (a register's 4-figure grid reference, a repeater's locator). */
const NEAR = 5e-4;

/**
 * Group a day's entries into one pin per placement. Entries without a believable position are left out
 * (the caller says how many). The pin stands at its newest entry's point and takes the name of the newest
 * entry that has one, so a confirmed identity wins over a licensee credit at the same point. Busiest first.
 */
export function dayPins(rows: ReceptionRow[]): DayPin[] {
  const pins: DayPin[] = [];
  const sorted = [...rows].sort((a, b) => (b.endedAt ?? Number.MAX_SAFE_INTEGER) - (a.endedAt ?? Number.MAX_SAFE_INTEGER) || b.startedAt - a.startedAt || b.id - a.id);
  for (const r of sorted) {
    const at = point(r.lat, r.lon);
    if (!at) continue;
    let pin = pins.find((p) => Math.abs(p.lat - at.lat) < NEAR && Math.abs(p.lon - at.lon) < NEAR);
    if (!pin) {
      pin = { key: `d${at.lat.toFixed(5)},${at.lon.toFixed(5)}`, ...at, name: '', source: r.source, distanceKm: r.distanceKm, bearingDeg: r.bearingDeg, rows: [], frequencies: 0 };
      pins.push(pin);
    }
    pin.rows.push(r);
    if (!pin.name && (r.name || r.licensee)) {
      pin.name = r.name || r.licensee;
      pin.source = r.name ? r.source : r.source || 'WTR';
    }
  }
  for (const pin of pins) {
    pin.frequencies = new Set(pin.rows.map((r) => r.frequencyHz)).size;
    if (!pin.name) pin.name = `${(pin.rows[0]!.frequencyHz / 1e6).toFixed(4)} MHz`;
  }
  return pins.sort((a, b) => b.rows.length - a.rows.length);
}
