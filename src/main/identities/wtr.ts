/**
 * Ofcom Wireless Telegraphy Register (WTR) import.
 *
 * The CSV has one row per station per frequency (Station Type T = the base
 * transmits here, R = it receives here, i.e. mobiles transmit). We keep the
 * scanner-relevant subset: 25-1300 MHz, Live, channel width up to 200 kHz
 * (drops fixed links, radar, AIS, satellite), and collapse duplicates of the
 * same frequency + licensee + location, preferring digital emission over
 * analogue when both are listed.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { WtrLicence } from '../../shared/ipc';
import { splitCsvLine } from './radioid';

export interface WtrFilter {
  minHz: number;
  maxHz: number;
  maxWidthHz: number;
}

export const DEFAULT_WTR_FILTER: WtrFilter = { minHz: 25_000_000, maxHz: 1_300_000_000, maxWidthHz: 200_000 };

export type WtrRow = Omit<WtrLicence, 'id'>;

/**
 * Classify an ITU emission designator: signal nature digit 3 = analogue,
 * 1/2/7/9 = digital. Width from the leading bandwidth (e.g. 11K0, 12K5, 7M00).
 */
export function classifyEmission(code: string, widthHz: number): string {
  const m = /^(\d+[KMH]\d*)([A-Z])([0-9X])([A-Z])/.exec(code.trim().toUpperCase());
  if (!m) return '';
  const nature = m[3]!;
  if (nature === '3') return widthHz >= 20_000 ? 'FM' : 'NFM';
  if ('1279X'.includes(nature)) return 'DIG';
  return '';
}

const DIGITAL_RANK: Record<string, number> = { DIG: 3, NFM: 2, FM: 1, '': 0 };

interface Cols {
  licence: number;
  ngr: number;
  freq: number;
  station: number;
  width: number;
  emission: number;
  surname: number;
  first: number;
  company: number;
  status: number;
  product: number;
  lat: number;
  lon: number;
}

function mapCols(header: string[]): Cols | null {
  const norm = header.map((h) => h.trim().toLowerCase());
  const find = (...names: string[]): number => norm.findIndex((h) => names.includes(h));
  const cols: Cols = {
    licence: find('licence number', 'license number'),
    ngr: find('ngr'),
    freq: find('frequency (hz)', 'frequency'),
    station: find('station type'),
    width: find('channel width (hz)', 'channel width'),
    emission: find('emission code'),
    surname: find('licencee surname', 'licensee surname'),
    first: find('licencee first name', 'licensee first name'),
    company: find('licencee company', 'licensee company'),
    status: find('status'),
    product: find('product description'),
    lat: find('latitude(deg)', 'latitude'),
    lon: find('longitude(deg)', 'longitude'),
  };
  return cols.freq >= 0 && cols.company >= 0 ? cols : null;
}

function num(s: string | undefined): number | null {
  if (!s || s === '-') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function rowToLicence(f: string[], c: Cols): WtrRow | null {
  const get = (i: number): string => (i >= 0 && i < f.length ? f[i]!.trim() : '');
  const frequencyHz = num(get(c.freq));
  if (frequencyHz === null || frequencyHz <= 0) return null;
  const company = get(c.company);
  const person = [get(c.first), get(c.surname)].filter((x) => x && x !== '-').join(' ');
  const licensee = company && company !== '-' ? company : person;
  if (!licensee) return null;
  const widthHz = num(get(c.width)) ?? 0;
  const emission = get(c.emission) === '-' ? '' : get(c.emission);
  const station = get(c.station);
  const lat = num(get(c.lat));
  const lon = num(get(c.lon));
  const located = lat !== null && lon !== null && !(lat === 0 && lon === 0);
  return {
    frequencyHz,
    direction: station === 'T' || station === 'R' ? station : '-',
    licensee,
    product: get(c.product),
    emission,
    mode: classifyEmission(emission, widthHz),
    widthHz,
    lat: located ? lat : null,
    lon: located ? lon : null,
    ngr: get(c.ngr) === '-' ? '' : get(c.ngr),
    licenceNo: get(c.licence),
  };
}

export function passesFilter(r: WtrRow, status: string, flt: WtrFilter): boolean {
  if (status && status !== 'Live') return false;
  if (r.frequencyHz < flt.minHz || r.frequencyHz > flt.maxHz) return false;
  if (r.widthHz > flt.maxWidthHz) return false;
  return true;
}

/** Merge duplicates of frequency + licensee + location; digital beats analogue; directions combine. */
export function dedupe(rows: Iterable<WtrRow>): WtrRow[] {
  const map = new Map<string, WtrRow>();
  for (const r of rows) {
    const key = `${r.frequencyHz}|${r.licensee.toLowerCase()}|${r.lat ?? ''}|${r.lon ?? ''}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
      continue;
    }
    if ((DIGITAL_RANK[r.mode] ?? 0) > (DIGITAL_RANK[prev.mode] ?? 0)) {
      prev.mode = r.mode;
      prev.emission = r.emission;
      prev.widthHz = r.widthHz;
    }
    if (r.direction !== '-' && !prev.direction.includes(r.direction)) {
      prev.direction = prev.direction === '-' ? r.direction : 'TR';
    }
    if (!prev.product && r.product) prev.product = r.product;
  }
  return [...map.values()];
}

export interface WtrParseStats {
  rows: WtrRow[];
  read: number;
  kept: number;
  skipped: number;
}

export async function readWtrCsv(path: string, flt: WtrFilter = DEFAULT_WTR_FILTER): Promise<WtrParseStats> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let cols: Cols | null = null;
  const kept: WtrRow[] = [];
  let read = 0;
  let skipped = 0;
  let first = true;
  for await (const raw of rl) {
    const line = first ? raw.replace(/^\uFEFF/, '') : raw;
    first = false;
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    if (!cols) {
      cols = mapCols(f);
      if (!cols) throw new Error('Not an Ofcom WTR export: expected "Frequency (Hz)" and "Licencee Company" columns');
      continue;
    }
    read++;
    const r = rowToLicence(f, cols);
    if (!r || !passesFilter(r, cols.status >= 0 ? (f[cols.status] ?? '') : '', flt)) {
      skipped++;
      continue;
    }
    kept.push(r);
  }
  const rows = dedupe(kept);
  return { rows, read, kept: rows.length, skipped };
}

/** Great-circle distance in km (kept here for the importer's callers; the maths lives in shared/geo). */
export { distanceKm } from '../../shared/geo';
