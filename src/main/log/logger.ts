/** Glue: snapshots in, database rows out, live upserts to the renderer. */
import type { ReceptionRow, ScannerSnapshot } from '../../shared/ipc';
import type { LogDb } from './db';
import { ReceptionTracker, type TrackerOptions } from './tracker';

export class ReceptionLogger {
  private readonly tracker: ReceptionTracker;
  private openId: number | null = null;

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

  private apply(e: ReturnType<ReceptionTracker['update']>[number]): void {
    if (e.type === 'open') {
      const row = this.db.insert(e.reception);
      this.openId = row.id;
      this.onRow(row);
    } else if (this.openId !== null) {
      const row = this.db.update(this.openId, e.reception);
      if (e.type === 'close') this.openId = null;
      if (row) this.onRow(row);
    }
  }
}
