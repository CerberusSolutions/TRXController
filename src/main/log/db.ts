/**
 * Reception log on Node's built-in SQLite (node:sqlite), which Electron 44
 * bundles via Node 24. No native module, no rebuild.
 */
import { DatabaseSync } from 'node:sqlite';
import type { ReceptionRow } from '../../shared/ipc';

export type NewReception = Omit<ReceptionRow, 'id' | 'hits'>;

const HITS_SQL = '(SELECT COUNT(*) FROM receptions h WHERE h.frequency_hz = r.frequency_hz) AS hits';

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
        rssi_peak    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS receptions_started ON receptions(started_at DESC);
      CREATE INDEX IF NOT EXISTS receptions_freq ON receptions(frequency_hz);
    `);
    // A reception left open by a crash has no end time; close it at its start.
    this.db.exec('UPDATE receptions SET ended_at = started_at WHERE ended_at IS NULL');
  }

  insert(r: NewReception): ReceptionRow {
    const res = this.db
      .prepare(
        `INSERT INTO receptions (started_at, ended_at, frequency_hz, mode, signal_type, name, system, scanlist,
           object_type, tgid, radio_id, site, squelch, rssi_peak)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.startedAt, r.endedAt, r.frequencyHz, r.mode, r.signalType, r.name, r.system, r.scanlist,
        r.objectType, r.tgid, r.radioId, r.site, r.squelch, r.rssiPeak,
      );
    return this.get(Number(res.lastInsertRowid))!;
  }

  update(id: number, r: Partial<NewReception>): ReceptionRow | undefined {
    const cols: string[] = [];
    const vals: (number | string | null)[] = [];
    const map: Record<string, string> = {
      startedAt: 'started_at', endedAt: 'ended_at', frequencyHz: 'frequency_hz', mode: 'mode',
      signalType: 'signal_type', name: 'name', system: 'system', scanlist: 'scanlist', objectType: 'object_type',
      tgid: 'tgid', radioId: 'radio_id', site: 'site', squelch: 'squelch', rssiPeak: 'rssi_peak',
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
    const row = this.db.prepare(`SELECT r.*, ${HITS_SQL} FROM receptions r WHERE r.id = ?`).get(id);
    return row ? toRow(row as unknown as Raw) : undefined;
  }

  recent(limit = 500): ReceptionRow[] {
    const rows = this.db.prepare(`SELECT r.*, ${HITS_SQL} FROM receptions r ORDER BY r.started_at DESC, r.id DESC LIMIT ?`).all(limit);
    return (rows as unknown as Raw[]).map(toRow);
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
  rssi_peak: number;
  hits: number;
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
    rssiPeak: Number(r.rssi_peak),
    hits: Number(r.hits),
  };
}
