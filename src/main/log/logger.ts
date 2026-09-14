/** Glue: snapshots in, database rows out, live upserts to the renderer. */
import type { ReceptionRow, ScannerSnapshot } from '../../shared/ipc';
import type { LogDb } from './db';
import { ReceptionTracker, type TrackerEvent, type TrackerOptions } from './tracker';

export class ReceptionLogger {
  private readonly tracker: ReceptionTracker;
  private openId: number | null = null;
  private lastClosedId: number | null = null;
  /** Squelch openings too short to log, since start-up. */
  discarded = 0;

  constructor(
    private readonly db: LogDb,
    private readonly onRow: (row: ReceptionRow) => void,
    opts: TrackerOptions = {},
  ) {
    this.tracker = new ReceptionTracker(opts);
  }

  onSnapshot(s: ScannerSnapshot, now = Date.now()): void {
    for (const e of this.tracker.update(s, now)) this.apply(e);
    if (s.link.status === 'disconnected' || s.link.status === 'error') {
      for (const e of this.tracker.flush(now)) this.apply(e);
    }
  }

  flush(now = Date.now()): void {
    for (const e of this.tracker.flush(now)) this.apply(e);
  }

  /** Forget the previous row so nothing merges into it (e.g. after the log is cleared). */
  reset(): void {
    this.openId = null;
    this.lastClosedId = null;
    this.tracker.reset();
  }

  private apply(e: TrackerEvent): void {
    switch (e.type) {
      case 'open': {
        if (e.merged && this.lastClosedId !== null) {
          const row = this.db.update(this.lastClosedId, e.reception);
          this.openId = this.lastClosedId;
          this.lastClosedId = null;
          if (row) this.onRow(row);
        } else {
          // A merged event with no row to merge into (should not happen after
          // reset(), but be safe): start a fresh row rather than inherit counts.
          const fresh = e.merged ? { ...e.reception, calls: 1 } : e.reception;
          const row = this.db.insert(fresh);
          this.openId = row.id;
          this.onRow(row);
        }
        break;
      }
      case 'update': {
        if (this.openId === null) break;
        const row = this.db.update(this.openId, e.reception);
        if (row) this.onRow(row);
        break;
      }
      case 'close': {
        if (this.openId === null) break;
        const row = this.db.update(this.openId, e.reception);
        this.lastClosedId = this.openId;
        this.openId = null;
        if (row) this.onRow(row);
        break;
      }
      case 'discard':
        this.discarded++;
        break;
    }
  }
}
