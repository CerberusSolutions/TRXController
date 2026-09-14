/**
 * Parser for the radioid.net DMR user database. Accepts the CSV export
 * (header-driven, so column order does not matter) and the JSON export
 * ({ "results": [ { radio_id, callsign, name, surname, city, state, country } ] }
 * or a plain array). Pure functions over text; the importer streams the file.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { DmrUser } from '../../shared/ipc';

/** Split one CSV line, honouring double quotes and doubled-quote escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface ColumnMap {
  id: number;
  callsign: number;
  firstName: number;
  lastName: number;
  name: number;
  city: number;
  state: number;
  country: number;
}

const ALIASES: Record<keyof ColumnMap, string[]> = {
  id: ['radio_id', 'radioid', 'id', 'dmr_id', 'dmrid'],
  callsign: ['callsign', 'call', 'call_sign'],
  firstName: ['first_name', 'firstname', 'fname', 'name'],
  lastName: ['last_name', 'lastname', 'surname', 'lname'],
  name: ['full_name', 'fullname'],
  city: ['city', 'town'],
  state: ['state', 'county', 'region'],
  country: ['country'],
};

/** Work out which column is which from a header row; null if it is not a header. */
export function mapColumns(header: string[]): ColumnMap | null {
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  const find = (keys: string[]): number => norm.findIndex((h) => keys.includes(h));
  const id = find(ALIASES.id);
  const callsign = find(ALIASES.callsign);
  if (id < 0 || callsign < 0) return null;
  // "name" means first name in the radioid.net CSV when a surname column exists.
  const lastName = find(ALIASES.lastName);
  let firstName = find(ALIASES.firstName);
  let name = find(ALIASES.name);
  if (lastName < 0 && firstName >= 0 && norm[firstName] === 'name') {
    name = firstName;
    firstName = -1;
  }
  return { id, callsign, firstName, lastName, name, city: find(ALIASES.city), state: find(ALIASES.state), country: find(ALIASES.country) };
}

/** Default layout of radioid.net's user.csv when no header is present. */
export const DEFAULT_COLUMNS: ColumnMap = { id: 0, callsign: 1, firstName: 2, lastName: 3, name: -1, city: 4, state: 5, country: 6 };

export function rowToUser(fields: string[], cols: ColumnMap): DmrUser | null {
  const get = (i: number): string => (i >= 0 && i < fields.length ? fields[i]! : '');
  const id = Number(get(cols.id));
  const callsign = get(cols.callsign);
  if (!Number.isInteger(id) || id <= 0 || !callsign) return null;
  const name = cols.name >= 0 ? get(cols.name) : [get(cols.firstName), get(cols.lastName)].filter(Boolean).join(' ');
  return { id, callsign: callsign.toUpperCase(), name: name.trim(), city: get(cols.city), state: get(cols.state), country: get(cols.country) };
}

interface JsonUser {
  radio_id?: number | string;
  id?: number | string;
  callsign?: string;
  name?: string;
  fname?: string;
  surname?: string;
  city?: string;
  state?: string;
  country?: string;
}

export function jsonToUsers(text: string): DmrUser[] {
  const parsed = JSON.parse(text) as { results?: JsonUser[] } | JsonUser[];
  const list = Array.isArray(parsed) ? parsed : (parsed.results ?? []);
  const out: DmrUser[] = [];
  for (const j of list) {
    const id = Number(j.radio_id ?? j.id);
    const callsign = (j.callsign ?? '').trim();
    if (!Number.isInteger(id) || id <= 0 || !callsign) continue;
    const name = [j.name ?? j.fname ?? '', j.surname ?? ''].filter(Boolean).join(' ').trim();
    out.push({ id, callsign: callsign.toUpperCase(), name, city: j.city ?? '', state: j.state ?? '', country: j.country ?? '' });
  }
  return out;
}

export interface ParseStats {
  users: DmrUser[];
  skipped: number;
  columns: ColumnMap;
  hadHeader: boolean;
}

/** Stream a CSV file into users. Memory: the result array only (hundreds of thousands of small objects). */
export async function readUserCsv(path: string): Promise<ParseStats> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  const users: DmrUser[] = [];
  let skipped = 0;
  let cols: ColumnMap | null = null;
  let hadHeader = false;
  let first = true;
  for await (const raw of rl) {
    const line = first ? raw.replace(/^﻿/, '') : raw;
    first = false;
    if (!line.trim()) continue;
    const fields = splitCsvLine(line);
    if (!cols) {
      const mapped = mapColumns(fields);
      if (mapped) {
        cols = mapped;
        hadHeader = true;
        continue;
      }
      cols = DEFAULT_COLUMNS;
    }
    const u = rowToUser(fields, cols);
    if (u) users.push(u);
    else skipped++;
  }
  return { users, skipped, columns: cols ?? DEFAULT_COLUMNS, hadHeader };
}

export async function readUserFile(path: string): Promise<ParseStats> {
  if (/\.json$/i.test(path)) {
    const text = await readFile(path, 'utf8');
    const users = jsonToUsers(text);
    return { users, skipped: 0, columns: DEFAULT_COLUMNS, hadHeader: true };
  }
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path} is not a file`);
  return readUserCsv(path);
}
