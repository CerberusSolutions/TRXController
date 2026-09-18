/**
 * Reception log on Node's built-in SQLite (node:sqlite), which Electron 44
 * bundles via Node 24. No native module, no rebuild.
 */
import { DatabaseSync } from 'node:sqlite';
import type { DmrUser, IdentityStats, ReceptionRow, Repeater, RepeaterMatch, RrukEntry, TrafficGroup, WtrLicence, WtrMatch } from '../../shared/ipc';
import type { LookupSource } from '../../shared/sources';
import { pickConfirmation, type Confirmation, type NewConfirmation } from '../../shared/confirm';
import { placeFrom } from '../../shared/geo';
import { normaliseCandidates } from '../../shared/listed';
import { isFrequencyLabel } from '@trxcontroller/rcip';
import type { RrCounty, RrFreqHit, RrSite, RrSystemSummary, RrTalkgroup } from '../identities/radioreference';

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
      CREATE TABLE IF NOT EXISTS repeaters (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        callsign  TEXT NOT NULL,
        band      TEXT NOT NULL DEFAULT '',
        channel   TEXT NOT NULL DEFAULT '',
        output_hz INTEGER NOT NULL,
        input_hz  INTEGER,
        ctcss     REAL,
        locator   TEXT NOT NULL DEFAULT '',
        place     TEXT NOT NULL DEFAULT '',
        lat       REAL,
        lon       REAL,
        modes     TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS repeaters_output ON repeaters(output_hz);
      CREATE INDEX IF NOT EXISTS repeaters_input ON repeaters(input_hz);
      CREATE TABLE IF NOT EXISTS rr_freqs (
        frequency_hz INTEGER NOT NULL,
        stid         INTEGER NOT NULL,
        fetched_at   INTEGER NOT NULL,
        hits         TEXT NOT NULL,
        PRIMARY KEY (frequency_hz, stid)
      );
      CREATE TABLE IF NOT EXISTS rr_systems (
        sid        INTEGER PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        system     TEXT NOT NULL,
        sites      TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rr_counties (
        ctid       INTEGER PRIMARY KEY,
        fetched_at INTEGER NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        lat        REAL,
        lon        REAL,
        range_km   REAL
      );
      CREATE TABLE IF NOT EXISTS rruk_freqs (
        frequency_hz INTEGER PRIMARY KEY,
        scope        TEXT NOT NULL DEFAULT '',
        fetched_at   INTEGER NOT NULL,
        entries      TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS confirmations (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        frequency_hz INTEGER NOT NULL,
        tone         TEXT NOT NULL DEFAULT '',
        tgid         INTEGER,
        name         TEXT NOT NULL,
        system       TEXT NOT NULL DEFAULT '',
        source       TEXT NOT NULL DEFAULT 'USER',
        detail       TEXT NOT NULL DEFAULT '',
        distance_km  REAL,
        bearing_deg  INTEGER,
        confirmed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS confirmations_freq ON confirmations(frequency_hz);
      CREATE TABLE IF NOT EXISTS rr_talkgroups (
        sid      INTEGER NOT NULL,
        tg_dec   INTEGER NOT NULL,
        alpha    TEXT NOT NULL DEFAULT '',
        descr    TEXT NOT NULL DEFAULT '',
        mode     TEXT NOT NULL DEFAULT '',
        enc      INTEGER NOT NULL DEFAULT 0,
        slot     TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        tags     TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (sid, tg_dec)
      );
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
    if (!cols.includes('source')) this.db.exec("ALTER TABLE receptions ADD COLUMN source TEXT NOT NULL DEFAULT ''");
    for (const c of ['scanner_name', 'wtr', 'rr_name', 'rr_system', 'rpt']) {
      if (!cols.includes(c)) this.db.exec(`ALTER TABLE receptions ADD COLUMN ${c} TEXT NOT NULL DEFAULT ''`);
    }
    if (!cols.includes('rruk')) this.db.exec("ALTER TABLE receptions ADD COLUMN rruk TEXT NOT NULL DEFAULT ''");
    if (!cols.includes('distance_km')) this.db.exec('ALTER TABLE receptions ADD COLUMN distance_km REAL');
    if (!cols.includes('bearing_deg')) this.db.exec('ALTER TABLE receptions ADD COLUMN bearing_deg INTEGER');
    if (!cols.includes('candidates')) this.db.exec("ALTER TABLE receptions ADD COLUMN candidates TEXT NOT NULL DEFAULT '[]'");
  }

  insert(r: NewReception): ReceptionRow {
    const res = this.db
      .prepare(
        `INSERT INTO receptions (started_at, ended_at, frequency_hz, mode, signal_type, name, system, scanlist,
           object_type, tgid, radio_id, site, squelch, tone, licensee, source, scanner_name, wtr, rr_name, rr_system, rpt, rruk,
           distance_km, bearing_deg, candidates, rssi_peak, calls)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.startedAt, r.endedAt, r.frequencyHz, r.mode, r.signalType, r.name, r.system, r.scanlist,
        r.objectType, r.tgid, r.radioId, r.site, r.squelch, r.tone ?? '', r.licensee ?? '', r.source ?? '',
        r.scannerName ?? '', r.wtr ?? '', r.rrName ?? '', r.rrSystem ?? '', r.rpt ?? '', r.rruk ?? '',
        r.distanceKm ?? null, r.bearingDeg ?? null, JSON.stringify(r.candidates ?? []), r.rssiPeak, r.calls ?? 1,
      );
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, r: Partial<NewReception>): ReceptionRow | undefined {
    const cols: string[] = [];
    const vals: (number | string | null)[] = [];
    const map: Record<string, string> = {
      startedAt: 'started_at', endedAt: 'ended_at', frequencyHz: 'frequency_hz', mode: 'mode',
      signalType: 'signal_type', name: 'name', system: 'system', scanlist: 'scanlist', objectType: 'object_type',
      tgid: 'tgid', radioId: 'radio_id', site: 'site', squelch: 'squelch', tone: 'tone', licensee: 'licensee', source: 'source',
      scannerName: 'scanner_name', wtr: 'wtr', rrName: 'rr_name', rrSystem: 'rr_system', rpt: 'rpt', rruk: 'rruk',
      distanceKm: 'distance_km', bearingDeg: 'bearing_deg', candidates: 'candidates', rssiPeak: 'rssi_peak', calls: 'calls',
    };
    for (const [k, v] of Object.entries(r)) {
      const col = map[k];
      if (!col || v === undefined) continue;
      cols.push(`${col} = ?`);
      vals.push(k === 'candidates' ? JSON.stringify(v ?? []) : (v as number | string | null));
    }
    if (cols.length) {
      this.db.prepare(`UPDATE receptions SET ${cols.join(', ')} WHERE id = ?`).run(...vals, id);
    }
    return this.get(id);
  }

  /**
   * The scanner's own object for a frequency, from the latest reception whose display showed it
   * (rows from before `scanner_name` existed count when the scanner named them).
   */
  lastScannerObject(hz: number): { name: string; scanlist: string; objectType: string; system: string } | null {
    // An object named only by its frequency ("453.0625 CC15") is no name to remember.
    const row = (
      this.db
        .prepare(
          `SELECT CASE WHEN scanner_name != '' THEN scanner_name ELSE name END AS name, scanlist, object_type, system
           FROM receptions WHERE frequency_hz = ? AND (scanner_name != '' OR (source = '' AND name != ''))
           ORDER BY started_at DESC, id DESC LIMIT 25`,
        )
        .all(hz) as { name: string; scanlist: string; object_type: string; system: string }[]
    ).find((r) => !isFrequencyLabel(r.name));
    return row ? { name: row.name, scanlist: row.scanlist, objectType: row.object_type, system: row.system } : null;
  }

  // --- Confirmed identities ------------------------------------------------

  /**
   * Record that a frequency (with this tone / talkgroup) is `c.name`, replacing an earlier
   * confirmation with the same key, and rename every logged reception it applies to.
   */
  confirm(c: NewConfirmation, now = Date.now()): Confirmation {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM confirmations WHERE frequency_hz = ? AND tone = ? AND tgid IS ?').run(c.frequencyHz, c.tone, c.tgid);
      const res = this.db
        .prepare(
          `INSERT INTO confirmations (frequency_hz, tone, tgid, name, system, source, detail, distance_km, bearing_deg, confirmed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(c.frequencyHz, c.tone, c.tgid, c.name, c.system, c.source, c.detail, c.distanceKm, c.bearingDeg, now);
      const saved = this.confirmation(Number(res.lastInsertRowid))!;
      this.applyConfirmations(c.frequencyHz);
      this.db.exec('COMMIT');
      return saved;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Forget a confirmation; the rows it renamed go back to the scanner's name, else the licensee. */
  unconfirm(id: number): void {
    const c = this.confirmation(id);
    if (!c) return;
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM confirmations WHERE id = ?').run(id);
      this.applyConfirmations(c.frequencyHz);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  confirmation(id: number): Confirmation | null {
    const r = this.db.prepare('SELECT * FROM confirmations WHERE id = ?').get(id) as unknown as RawConfirmation | undefined;
    return r ? toConfirmation(r) : null;
  }

  confirmations(): Confirmation[] {
    return (this.db.prepare('SELECT * FROM confirmations ORDER BY frequency_hz, tone, tgid').all() as unknown as RawConfirmation[]).map(toConfirmation);
  }

  /** The confirmation that applies to a reception on `hz` with this tone / talkgroup, if any. */
  confirmationFor(hz: number, tone: string | null | undefined, tgid: number | null | undefined): Confirmation | null {
    const rows = (this.db.prepare('SELECT * FROM confirmations WHERE frequency_hz = ?').all(hz) as unknown as RawConfirmation[]).map(toConfirmation);
    return pickConfirmation(rows, hz, tone, tgid);
  }

  /**
   * Bring every reception on `hz` in line with the confirmations that now apply: the confirmed name
   * where one does, else back to what the scanner or the lookups said (rows only ever carry CONF
   * while a confirmation stands). Returns the ids of the rows changed.
   */
  private applyConfirmations(hz: number): number[] {
    const confs = (this.db.prepare('SELECT * FROM confirmations WHERE frequency_hz = ?').all(hz) as unknown as RawConfirmation[]).map(toConfirmation);
    const rows = this.db.prepare('SELECT * FROM receptions WHERE frequency_hz = ?').all(hz) as unknown as Raw[];
    const changed: number[] = [];
    for (const r of rows) {
      const c = pickConfirmation(confs, hz, r.tone, r.tgid);
      const next = c ? confirmed(r, c) : r.source === 'CONF' ? unconfirmed(r) : null;
      if (!next) continue;
      this.db
        .prepare('UPDATE receptions SET name = ?, system = ?, source = ?, distance_km = ?, bearing_deg = ? WHERE id = ?')
        .run(next.name, next.system, next.source, next.distance_km, next.bearing_deg, r.id);
      changed.push(Number(r.id));
    }
    return changed;
  }

  // --- Traffic analysis ----------------------------------------------------

  /** What has been heard on `hz`, grouped by tone / colour code and talkgroup, busiest first. */
  traffic(hz: number, opts: { groups?: number; radioIds?: number; names?: number } = {}): TrafficGroup[] {
    const groups = this.db
      .prepare(
        `SELECT tone, tgid, COUNT(*) AS n, SUM(calls) AS calls, MIN(started_at) AS first_at, MAX(COALESCE(ended_at, started_at)) AS last_at
         FROM receptions WHERE frequency_hz = ? GROUP BY tone, tgid ORDER BY n DESC, last_at DESC LIMIT ?`,
      )
      .all(hz, opts.groups ?? 12) as { tone: string; tgid: number | null; n: number; calls: number; first_at: number; last_at: number }[];
    const ids = this.db.prepare(
      `SELECT radio_id, MAX(COALESCE(ended_at, started_at)) AS last_at FROM receptions
       WHERE frequency_hz = ? AND tone = ? AND tgid IS ? AND radio_id IS NOT NULL GROUP BY radio_id ORDER BY last_at DESC`,
    );
    const names = this.db.prepare(
      `SELECT name, COUNT(*) AS n FROM receptions WHERE frequency_hz = ? AND tone = ? AND tgid IS ? AND name != '' GROUP BY name ORDER BY n DESC LIMIT ?`,
    );
    return groups.map((g) => {
      const rids = (ids.all(hz, g.tone, g.tgid) as { radio_id: number }[]).map((r) => Number(r.radio_id));
      return {
        tone: g.tone,
        tgid: g.tgid === null ? null : Number(g.tgid),
        receptions: Number(g.n),
        calls: Number(g.calls),
        firstAt: Number(g.first_at),
        lastAt: Number(g.last_at),
        radioIds: rids.slice(0, opts.radioIds ?? 6),
        radioCount: rids.length,
        names: (names.all(hz, g.tone, g.tgid, opts.names ?? 3) as { name: string }[]).map((r) => r.name),
      };
    });
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
    const rp = Number((this.db.prepare('SELECT COUNT(*) AS n FROM repeaters').get() as { n: number }).n);
    const rat = this.getMeta('repeaters.imported_at');
    return {
      dmrUsers: n,
      importedAt: at ? Number(at) : null,
      source: this.getMeta('dmr_users.source'),
      wtrLicences: w,
      wtrImportedAt: wat ? Number(wat) : null,
      wtrSource: this.getMeta('wtr.source'),
      repeaters: rp,
      repeatersImportedAt: rat ? Number(rat) : null,
      repeatersSource: this.getMeta('repeaters.source'),
    };
  }

  // --- ETCC repeaters ------------------------------------------------------

  replaceRepeaters(rows: Iterable<Omit<Repeater, 'id'>>, source: string, now = Date.now()): number {
    const ins = this.db.prepare(
      'INSERT INTO repeaters (callsign, band, channel, output_hz, input_hz, ctcss, locator, place, lat, lon, modes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let n = 0;
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM repeaters');
      for (const r of rows) {
        ins.run(r.callsign, r.band, r.channel, r.outputHz, r.inputHz, r.ctcss, r.locator, r.where, r.lat, r.lon, r.modes);
        n++;
      }
      this.setMeta('repeaters.imported_at', String(now));
      this.setMeta('repeaters.source', source);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return n;
  }

  /**
   * Repeaters whose output (or, failing that, input) is `hz` within
   * ±WTR_TOLERANCE_HZ, nearest first when a location is given. No radius
   * limit: repeaters are sparse and a distant one on the channel is still
   * the likely answer.
   */
  lookupRepeaters(hz: number, opts: { lat?: number | null; lon?: number | null; limit?: number } = {}): RepeaterMatch[] {
    const lo = hz - WTR_TOLERANCE_HZ;
    const hi = hz + WTR_TOLERANCE_HZ;
    const rows = this.db
      .prepare('SELECT * FROM repeaters WHERE output_hz BETWEEN ? AND ? OR input_hz BETWEEN ? AND ?')
      .all(lo, hi, lo, hi) as unknown as RawRepeater[];
    const out: RepeaterMatch[] = [];
    for (const r of rows) {
      const rep = toRepeater(r);
      const side: RepeaterMatch['side'] = Math.abs(rep.outputHz - hz) <= WTR_TOLERANCE_HZ ? 'output' : 'input';
      out.push({ ...rep, ...placeFrom(here(opts), rep.lat, rep.lon), side });
    }
    out.sort((a, b) => (a.side === b.side ? 0 : a.side === 'output' ? -1 : 1) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9) || a.callsign.localeCompare(b.callsign));
    return out.slice(0, opts.limit ?? 5);
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
      const place = placeFrom(here(opts), lic.lat, lic.lon);
      if (opts.radiusKm != null && place.distanceKm !== null && place.distanceKm > opts.radiusKm) continue;
      out.push({ ...lic, ...place });
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

  // --- RadioReference cache -------------------------------------------------

  rrGetFreq(hz: number, stid: number): { fetchedAt: number; hits: RrFreqHit[] } | null {
    const r = this.db.prepare('SELECT fetched_at, hits FROM rr_freqs WHERE frequency_hz = ? AND stid = ?').get(hz, stid) as
      | { fetched_at: number; hits: string }
      | undefined;
    if (!r) return null;
    try {
      return { fetchedAt: Number(r.fetched_at), hits: JSON.parse(r.hits) as RrFreqHit[] };
    } catch {
      return null;
    }
  }

  rrPutFreq(hz: number, stid: number, hits: RrFreqHit[], now = Date.now()): void {
    this.db.prepare('INSERT OR REPLACE INTO rr_freqs (frequency_hz, stid, fetched_at, hits) VALUES (?, ?, ?, ?)').run(hz, stid, now, JSON.stringify(hits));
  }

  rrGetSystem(sid: number): { fetchedAt: number; system: RrSystemSummary; sites: RrSite[] } | null {
    const r = this.db.prepare('SELECT fetched_at, system, sites FROM rr_systems WHERE sid = ?').get(sid) as
      | { fetched_at: number; system: string; sites: string }
      | undefined;
    if (!r) return null;
    try {
      return { fetchedAt: Number(r.fetched_at), system: JSON.parse(r.system) as RrSystemSummary, sites: JSON.parse(r.sites) as RrSite[] };
    } catch {
      return null;
    }
  }

  rrPutSystem(system: RrSystemSummary, sites: RrSite[], talkgroups: RrTalkgroup[], now = Date.now()): void {
    const ins = this.db.prepare(
      'INSERT OR REPLACE INTO rr_talkgroups (sid, tg_dec, alpha, descr, mode, enc, slot, category, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.db.exec('BEGIN');
    try {
      this.db.prepare('INSERT OR REPLACE INTO rr_systems (sid, fetched_at, system, sites) VALUES (?, ?, ?, ?)').run(system.sid, now, JSON.stringify(system), JSON.stringify(sites));
      this.db.prepare('DELETE FROM rr_talkgroups WHERE sid = ?').run(system.sid);
      for (const t of talkgroups) ins.run(system.sid, t.tgDec, t.alpha, t.descr, t.mode, t.enc, t.slot, t.category, t.tags.join(' · '));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  rrGetTalkgroup(sid: number, tgDec: number): RrTalkgroup | null {
    const r = this.db.prepare('SELECT * FROM rr_talkgroups WHERE sid = ? AND tg_dec = ?').get(sid, tgDec) as
      | { tg_dec: number; alpha: string; descr: string; mode: string; enc: number; slot: string; category: string; tags: string }
      | undefined;
    if (!r) return null;
    return { tgDec: Number(r.tg_dec), alpha: r.alpha, descr: r.descr, mode: r.mode, enc: Number(r.enc), slot: r.slot, category: r.category, tags: r.tags ? r.tags.split(' · ') : [] };
  }

  rrGetCounty(ctid: number): RrCounty | null {
    const r = this.db.prepare('SELECT * FROM rr_counties WHERE ctid = ?').get(ctid) as
      | { ctid: number; name: string; lat: number | null; lon: number | null; range_km: number | null }
      | undefined;
    if (!r) return null;
    return { ctid: Number(r.ctid), name: r.name, lat: r.lat === null ? null : Number(r.lat), lon: r.lon === null ? null : Number(r.lon), rangeKm: r.range_km === null ? null : Number(r.range_km) };
  }

  rrPutCounty(c: RrCounty, now = Date.now()): void {
    this.db.prepare('INSERT OR REPLACE INTO rr_counties (ctid, fetched_at, name, lat, lon, range_km) VALUES (?, ?, ?, ?, ?, ?)').run(c.ctid, now, c.name, c.lat, c.lon, c.rangeKm);
  }

  // --- RadioReference UK cache ---------------------------------------------

  rrukGetFreq(hz: number): { scope: string; fetchedAt: number; entries: RrukEntry[] } | null {
    const r = this.db.prepare('SELECT scope, fetched_at, entries FROM rruk_freqs WHERE frequency_hz = ?').get(hz) as
      | { scope: string; fetched_at: number; entries: string }
      | undefined;
    if (!r) return null;
    try {
      return { scope: r.scope, fetchedAt: Number(r.fetched_at), entries: JSON.parse(r.entries) as RrukEntry[] };
    } catch {
      return null;
    }
  }

  rrukPutFreq(hz: number, scope: string, entries: RrukEntry[], now = Date.now()): void {
    this.db.prepare('INSERT OR REPLACE INTO rruk_freqs (frequency_hz, scope, fetched_at, entries) VALUES (?, ?, ?, ?)').run(hz, scope, now, JSON.stringify(entries));
  }

  rrukStats(): { freqs: number } {
    return { freqs: Number((this.db.prepare('SELECT COUNT(*) AS n FROM rruk_freqs').get() as { n: number }).n) };
  }

  rrukClear(): void {
    this.db.exec('DELETE FROM rruk_freqs');
  }

  rrStats(): { freqs: number; systems: number; talkgroups: number } {
    const n = (sql: string): number => Number((this.db.prepare(sql).get() as { n: number }).n);
    return { freqs: n('SELECT COUNT(*) AS n FROM rr_freqs'), systems: n('SELECT COUNT(*) AS n FROM rr_systems'), talkgroups: n('SELECT COUNT(*) AS n FROM rr_talkgroups') };
  }

  rrClear(): void {
    this.db.exec('DELETE FROM rr_freqs; DELETE FROM rr_systems; DELETE FROM rr_talkgroups; DELETE FROM rr_counties');
  }

  close(): void {
    this.db.close();
  }
}

interface RawConfirmation {
  id: number;
  frequency_hz: number;
  tone: string;
  tgid: number | null;
  name: string;
  system: string;
  source: string;
  detail: string;
  distance_km: number | null;
  bearing_deg: number | null;
  confirmed_at: number;
}

function toConfirmation(r: RawConfirmation): Confirmation {
  return {
    id: Number(r.id),
    frequencyHz: Number(r.frequency_hz),
    tone: r.tone,
    tgid: r.tgid === null ? null : Number(r.tgid),
    name: r.name,
    system: r.system,
    source: (r.source === 'RRDB' || r.source === 'WTR' || r.source === 'UKR' ? r.source : 'USER') as Confirmation['source'],
    detail: r.detail,
    distanceKm: r.distance_km === null ? null : Number(r.distance_km),
    bearingDeg: r.bearing_deg === null ? null : Number(r.bearing_deg),
    confirmedAt: Number(r.confirmed_at),
  };
}

type Renamed = Pick<Raw, 'name' | 'system' | 'source' | 'distance_km' | 'bearing_deg'>;

/** A row as the confirmation says it is; null when it already is. */
function confirmed(r: Raw, c: Confirmation): Renamed | null {
  const next: Renamed = { name: c.name, system: c.system || r.system, source: 'CONF', distance_km: c.distanceKm ?? r.distance_km, bearing_deg: c.bearingDeg ?? r.bearing_deg };
  return next.name === r.name && next.system === r.system && r.source === 'CONF' && next.distance_km === r.distance_km && next.bearing_deg === r.bearing_deg ? null : next;
}

/** A row with its confirmation withdrawn: the scanner's own name if it showed one, else unnamed with the licensee credited. */
function unconfirmed(r: Raw): Renamed {
  const licSrc: LookupSource = r.wtr && r.wtr === r.licensee ? 'WTR' : r.rpt && r.rpt === r.licensee ? 'UKR' : '';
  return {
    name: r.scanner_name,
    system: r.rr_system && r.system === r.rr_system ? r.system : r.scanner_name ? r.system : '',
    source: r.scanner_name ? '' : r.licensee ? licSrc : '',
    distance_km: r.distance_km,
    bearing_deg: r.bearing_deg,
  };
}

/** The user's location from lookup options, or null when either coordinate is missing. */
function here(opts: { lat?: number | null; lon?: number | null }): { lat: number; lon: number } | null {
  return opts.lat != null && opts.lon != null ? { lat: opts.lat, lon: opts.lon } : null;
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

interface RawRepeater {
  id: number;
  callsign: string;
  band: string;
  channel: string;
  output_hz: number;
  input_hz: number | null;
  ctcss: number | null;
  locator: string;
  place: string;
  lat: number | null;
  lon: number | null;
  modes: string;
}

function toRepeater(r: RawRepeater): Repeater {
  return {
    id: Number(r.id),
    callsign: r.callsign,
    band: r.band,
    channel: r.channel,
    outputHz: Number(r.output_hz),
    inputHz: r.input_hz === null ? null : Number(r.input_hz),
    ctcss: r.ctcss === null ? null : Number(r.ctcss),
    locator: r.locator,
    where: r.place,
    lat: r.lat === null ? null : Number(r.lat),
    lon: r.lon === null ? null : Number(r.lon),
    modes: r.modes,
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
  source: string;
  scanner_name: string;
  wtr: string;
  rr_name: string;
  rr_system: string;
  rpt: string;
  rruk: string;
  distance_km: number | null;
  bearing_deg: number | null;
  candidates: string;
  rssi_peak: number;
  calls: number;
  hits: number;
  radio_callsign: string | null;
  radio_name: string | null;
}

function parseCandidates(json: string | null | undefined): ReceptionRow['candidates'] {
  if (!json) return [];
  try {
    return normaliseCandidates(JSON.parse(json));
  } catch {
    return [];
  }
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
    source: (r.source ?? '') as LookupSource,
    scannerName: r.scanner_name ?? '',
    wtr: r.wtr ?? '',
    rrName: r.rr_name ?? '',
    rrSystem: r.rr_system ?? '',
    rpt: r.rpt ?? '',
    rruk: r.rruk ?? '',
    distanceKm: r.distance_km === null || r.distance_km === undefined ? null : Number(r.distance_km),
    bearingDeg: r.bearing_deg === null || r.bearing_deg === undefined ? null : Number(r.bearing_deg),
    candidates: parseCandidates(r.candidates),
    rssiPeak: Number(r.rssi_peak),
    calls: Number(r.calls),
    hits: Number(r.hits),
    radioCallsign: r.radio_callsign ?? null,
    radioName: r.radio_name ?? null,
  };
}
