/**
 * UK amateur repeater list from the RSGB's Emerging Technology Coordination
 * Committee (ETCC), https://ukrepeater.net/csvfiles.html ("repeaterlist_all.csv").
 * One row per repeater or gateway: callsign, band, channel, txMHz (what the
 * repeater transmits, i.e. what a scanner hears), rxMHz (its input), CTCSS,
 * locator, place, lat/lon and Y flags for ANALOG / DMR / DSTAR / FUSION.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Repeater } from '../../shared/ipc';
import { splitCsvLine } from './radioid';

export type RepeaterRow = Omit<Repeater, 'id'>;

interface Cols {
  call: number;
  band: number;
  chan: number;
  tx: number;
  rx: number;
  ctcss: number;
  locator: number;
  where: number;
  lat: number;
  lon: number;
  analog: number;
  dmr: number;
  dstar: number;
  fusion: number;
}

function mapCols(header: string[]): Cols | null {
  const norm = header.map((h) => h.trim().toLowerCase());
  const find = (...names: string[]): number => norm.findIndex((h) => names.includes(h));
  const cols: Cols = {
    call: find('call', 'callsign'),
    band: find('band'),
    chan: find('chan', 'channel'),
    tx: find('txmhz', 'tx'),
    rx: find('rxmhz', 'rx'),
    ctcss: find('ctcss', 'tone'),
    locator: find('qthr', 'locator'),
    where: find('where', 'location'),
    lat: find('lat', 'latitude'),
    lon: find('lon', 'longitude'),
    analog: find('analog', 'analogue', 'fm'),
    dmr: find('dmr'),
    dstar: find('dstar', 'd-star'),
    fusion: find('fusion', 'ysf'),
  };
  return cols.call >= 0 && cols.tx >= 0 ? cols : null;
}

function mhz(s: string): number | null {
  const v = Number(s.trim());
  return Number.isFinite(v) && v > 0 ? Math.round(v * 1e6) : null;
}

/** CTCSS in Hz, or null for blank, "not applicable", a 1750 Hz toneburst or anything else that is not a sub-audible tone. */
export function parseCtcss(s: string): number | null {
  const v = Number(s.trim());
  return Number.isFinite(v) && v >= 60 && v <= 260 ? v : null;
}

export function rowToRepeater(f: string[], c: Cols): RepeaterRow | null {
  const get = (i: number): string => (i >= 0 && i < f.length ? f[i]!.trim() : '');
  const callsign = get(c.call).toUpperCase();
  const outputHz = mhz(get(c.tx));
  if (!callsign || outputHz === null) return null;
  const flag = (i: number): boolean => /^y/i.test(get(i));
  const modes: string[] = [];
  if (flag(c.analog)) modes.push('FM');
  if (flag(c.dmr)) modes.push('DMR');
  if (flag(c.dstar)) modes.push('D-STAR');
  if (flag(c.fusion)) modes.push('Fusion');
  const lat = Number(get(c.lat));
  const lon = Number(get(c.lon));
  const located = get(c.lat) !== '' && get(c.lon) !== '' && Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  return {
    callsign,
    band: get(c.band).toUpperCase(),
    channel: get(c.chan).toUpperCase(),
    outputHz,
    inputHz: mhz(get(c.rx)),
    ctcss: parseCtcss(get(c.ctcss)),
    locator: get(c.locator).toUpperCase(),
    where: get(c.where),
    lat: located ? lat : null,
    lon: located ? lon : null,
    modes: modes.join(' · '),
  };
}

export interface RepeaterParseStats {
  rows: RepeaterRow[];
  read: number;
  skipped: number;
}

export async function readRepeaterCsv(path: string): Promise<RepeaterParseStats> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let cols: Cols | null = null;
  const rows: RepeaterRow[] = [];
  const seen = new Set<string>();
  let read = 0;
  let skipped = 0;
  let first = true;
  for await (const raw of rl) {
    const line = first ? raw.replace(/^﻿/, '') : raw;
    first = false;
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    if (!cols) {
      cols = mapCols(f);
      if (!cols) throw new Error('Not an ETCC repeater list: expected "CALL" and "txMHz" columns');
      continue;
    }
    read++;
    const r = rowToRepeater(f, cols);
    const key = r ? `${r.callsign}|${r.outputHz}` : '';
    if (!r || seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    rows.push(r);
  }
  return { rows, read, skipped };
}
