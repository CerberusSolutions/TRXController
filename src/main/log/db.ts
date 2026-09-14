/**
 * Reception log on Node's built-in SQLite (node:sqlite), which Electron 44
 * bundles via Node 24. No native module, no rebuild.
 */
import { DatabaseSync } from 'node:sqlite';
import type { DmrUser, IdentityStats, ReceptionRow, WtrLicence, WtrMatch } from '../../shared/ipc';
import { distanceKm } from '../identities/wtr';

export type NewReception = Omit<ReceptionRow, 'id' | 'hits' | 'radioCallsign' | 'radioName'>;

/** How far a heard frequency may be from a licensed one to count as the same channel. */
export const WTR_TOLERANCE_HZ = 3_125;

/** Newest activity first: open rows, then by last-heard, then by start. */
const ORDER_SQL = 'ORDER BY COALESCE(r.ended_at, 9223372036854775807) DESC, r.started_at DESC, r.id DESC';

const ROW_SQL = `SELECT r.*,
  (SELECT COUNT(*) FROM receptions h WHERE h.frequency_hz = r.frequency_hz) AS hits,
  u.callsign AS radio_callsign, u.name AS radio_name
  FROM receptions r LEFT JOIN dmr_users u ON u.id = r.radio_id`;

export class LogDb {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS receptions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at   INTEGER NOT NULL,
        ended_at     INTEGER,
        frequency_hz INTEGER NOT NULL,
        mode         TEXT NOT NULL DEFAULT '',
        signal_type  TEXT NOT NULL DEFAULT '',
        name         TEXT NOT NULL DEFAULT '',
        system       TEXT NOT NULL DEFAULT '',
        scanlist     TEXT NOT NULL DEFAULT '',
        object_type  TEXT NOT NULL DEFAULT '',
        tgid         INTEGER,
        radio_id     INTEGER,
        site         TEXT NOT NULL DEFAULT '',
        squelch      TEXT NOT NULL DEFAULT '',
        tone         TEXT NOT NULL DEFAULT '',
        rssi_peak    INTEGER NOT NULL DEFAULT 0,
        calls        INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS receptions_started ON receptions(started_at DESC);
      CREATE INDEX IF NOT EXISTS receptions_freq ON receptions(frequency_hz);
      CREATE TABLE IF NOT EXISTS dmr_users (
        id       INTEGER PRIMARY KEY,
        callsign TEXT NOT NULL DEFAULT '',
        name     TEXT NOT NULL DEFAULT '',
        city     TEXT NOT NULL DEFAULT '',
        state    TEXT NOT NULL DEFAULT '',
        country  TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wtr_licences (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        frequency_hz INTEGER NOT NULL,
        direction    TEXT NOT NULL DEFAULT '-',
        licensee     TEXT NOT NULL,
        product      TEXT NOT NULL DEFAULT '',
        emission     TEXT NOT NULL DEFAULT '',
        mode         TEXT NOT NULL DEFAULT '',
        width_hz     INTEGER NOT NULL DEFAULT 0,
        lat          REAL,
        lon          REAL,
        ngr          TEXT NOT NULL DEFAULT '',
        licence_no   TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS wtr_freq ON wtr_licences(frequency_hz);
    `);
    this.migrate();
    // A reception left open by a crash has no end time; close it at its start.
    this.db.exec('UPDATE receptions SET ended_at = started_at WHERE ended_at IS NULL');
  }

  /** Add columns introduced after the first release to databases created before them. */
  private migrate(): void {
    const cols = (this.db.prepare('PRAGMA table_info(receptions)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('calls')) this.db.exec('ALTER TABLE receptions ADD COLUMN calls INTEGER NOT NULL DEFAULT 1');
    if (!cols.includes('tone')) this.db.exec("ALTER TABLE receptions ADD COLUMN tone TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('licensee')) this.db.exec("ALTER TABLE receptions ADD COLUMN licensee TEXT NOT NULL DEFAULT ''");
  }

  insert(r: NewReception): ReceptionRow {
    const res = this.db
      .prepare(
        `INSERT INTO receptions (started_at, ended_at, frequency_hz, mode, signal_type, name, system, scanlist,
           object_type, tgid, radio_id, site, squelch, tone, licensee, rssi_peak, calls)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.startedAt, r.endedAt, r.frequencyHz, r.mode, r.signalType, r.name, r.system, r.scanlist,
        r.objectType, r.tgid, r.radioId, r.site, r.squelch, r.tone ?? '', r.licensee ?? '', r.rssiPeak, r.calls ?? 1,
      );
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, r: Partial<NewReception>): ReceptionRow | undefined {
    const cols: string[] = [];
    const vals: (number | string | null)[] = [];
    const map: Record<string, string> = {
      startedAt: 'started_at', endedAt: 'ended_at', frequencyHz: 'frequency_hz', mode: 'mode',
      signalType: 'signal_type', name: 'name', system: 'system', scanlist: 'scanlist', objectType: 'object_type',
      tgid: 'tgid', radioId: 'radio_id', site: 'site', squelch: 'squelch', tone: 'tone', licensee: 'licensee', rssiPeak: 'rssi_peak', calls: 'calls',
    };
    for (const [k, v] of Object.entries(r)) {
      const col = map[k];
      if (!col || v === undefined) continue;
      cols.push(`${col} = ?`);
      vals.push(v as number | string | null);
    }
    if (cols.length) {
      this.db.prepare(`UPDATE receptions SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    return this.get(id);
  }

  get(id: number): ReceptionRow | undefined {
    const row = this.db.prepare(`${ROW_SQL} WHERE r.id = ?`).get(id);
    return row ? toRow(row as unknown as Raw) : undefined;
  }

  recent(limit = 500): ReceptionRow[] {
    const rows = this.db.prepare(`${ROW_SQL} ${ORDER_SQL} LIMIT ?`).all(limit);
    return (rows as unknown as Raw[]).map(toRow);
  }

  // --- DMR user database -------------------------------------------------

  /** Replace the DMR user table with the given rows, in one transaction. */
  replaceDmrUsers(rows: Iterable<DmrUser>, source: string, now = Date.now()): number {
    const ins = this.db.prepare('INSERT OR REPLACE INTO dmr_users (id, callsign, name, city, state, country) VALUES (?, ?, ?, ?, ?, ?)');
    let n = 0;
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM dmr_users');
      for (const u of rows) {
        ins.run(u.id, u.callsign, u.name, u.city, u.state, u.country);
        n++;
      }
      this.setMeta('dmr_users.imported_at', String(now));
      this.setMeta('dmr_users.source', source);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }

  lookupDmrUser(id: number): DmrUser | undefined {
    const r = this.db.prepare('SELECT id, callsign, name, city, state, country FROM dmr_users WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? { id: Number(r['id']), callsign: String(r['callsign']), name: String(r['name']), city: String(r['city']), state: String(r['state']), country: String(r['country']) } : undefined;
  }

  identityStats(): IdentityStats {
    const n = Number((this.db.prepare('SELECT COUNT(*) AS n FROM dmr_users').get() as { n: number }).n);
    const at = this.getMeta('dmr_users.imported_at');
    const w = Number((this.db.prepare('SELECT COUNT(*) AS n FROM wtr_licences').get() as { n: number }).n);
    const wat = this.getMeta('wtr.imported_at');
    return {
      dmrUsers: n,
      importedAt: at ? Number(at) : null,
      source: this.getMeta('dmr_users.source'),
      wtrLicences: w,
      wtrImportedAt: wat ? Number(wat) : null,
      wtrSource: this.getMeta('wtr.source'),
    };
  }

  // --- Ofcom WTR -----------------------------------------------------------

  replaceWtr(rows: Iterable<Omit<WtrLicence, 'id'>>, source: string, now = Date.now()): number {
    const ins = this.db.prepare(
      'INSERT INTO wtr_licences (frequency_hz, direction, licensee, product, emission, mode, width_hz, lat, lon, ngr, licence_no) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let n = 0;
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM wtr_licences');
      for (const r of rows) {
        ins.run(r.frequencyHz, r.direction, r.licensee, r.product, r.emission, r.mode, r.widthHz, r.lat, r.lon, r.ngr, r.licenceNo);
        n++;
      }
      this.setMeta('wtr.imported_at', String(now));
      this.setMeta('wtr.source', source);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }

  /**
   * Licences on `hz` within ±WTR_TOLERANCE_HZ (a quarter of the 12.5 kHz
   * raster, so a frequency matches its own channel only), nearest first when
   * a location is given, limited to `radiusKm` if set. Licences without a
   * location sort last.
   */
  lookupWtr(hz: number, opts: { lat?: number | null; lon?: number | null; radiusKm?: number | null; limit?: number } = {}): WtrMatch[] {
    const rows = this.db
      .prepare('SELECT * FROM wtr_licences WHERE frequency_hz BETWEEN ? AND ?')
      .all(hz - WTR_TOLERANCE_HZ, hz + WTR_TOLERANCE_HZ) as unknown as RawWtr[];
    const out: WtrMatch[] = [];
    for (const r of rows) {
      const lic = toWtr(r);
      const distance =
        opts.lat != null && opts.lon != null && lic.lat !== null && lic.lon !== null ? distanceKm(opts.lat, opts.lon, lic.lat, lic.lon) : null;
      if (opts.radiusKm != null && distance !== null && distance > opts.radiusKm) continue;
      out.push({ ...lic, distanceKm: distance });
    }
    out.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.licensee.localeCompare(b.licensee));
    return out.slice(0, opts.limit ?? 5);
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  }

  private getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? r.value : null;
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM receptions').get() as { n: number }).n);
  }

  clear(): void {
    this.db.exec('DELETE FROM receptions');
  }

  close(): void {
    this.db.close();
  }
}

interface RawWtr {
  id: number;
  frequency_hz: number;
  direction: string;
  licensee: string;
  product: string;
  emission: string;
  mode: string;
  width_hz: number;
  lat: number | null;
  lon: number | null;
  ngr: string;
  licence_no: string;
}

function toWtr(r: RawWtr): WtrLicence {
  return {
    id: Number(r.id),
    frequencyHz: Number(r.frequency_hz),
    direction: r.direction,
    licensee: r.licensee,
    product: r.product,
    emission: r.emission,
    mode: r.mode,
    widthHz: Number(r.width_hz),
    lat: r.lat === null ? null : Number(r.lat),
    lon: r.lon === null ? null : Number(r.lon),
    ngr: r.ngr,
    licenceNo: r.licence_no,
  };
}

interface Raw {
  id: number;
  started_at: number;
  ended_at: number | null;
  frequency_hz: number;
  mode: string;
  signal_type: string;
  name: string;
  system: string;
  scanlist: string;
  object_type: string;
  tgid: number | null;
  radio_id: number | null;
  site: string;
  squelch: string;
  tone: string;
  licensee: string;
  rssi_peak: number;
  calls: number;
  hits: number;
  radio_callsign: string | null;
  radio_name: string | null;
}

function toRow(r: Raw): ReceptionRow {
  return {
    id: Number(r.id),
    startedAt: Number(r.started_at),
    endedAt: r.ended_at === null ? null : Number(r.ended_at),
    frequencyHz: Number(r.frequency_hz),
    mode: r.mode,
    signalType: r.signal_type,
    name: r.name,
    system: r.system,
    scanlist: r.scanlist,
    objectType: r.object_type,
    tgid: r.tgid === null ? null : Number(r.tgid),
    radioId: r.radio_id === null ? null : Number(r.radio_id),
    site: r.site,
    squelch: r.squelch,
    tone: r.tone ?? '',
    licensee: r.licensee ?? '',
    rssiPeak: Number(r.rssi_peak),
    calls: Number(r.calls),
    hits: Number(r.hits),
    radioCallsign: r.radio_callsign ?? null,
    radioName: r.radio_name ?? null,
  };
}
