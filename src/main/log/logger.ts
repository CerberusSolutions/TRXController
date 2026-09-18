/** Glue: snapshots in, database rows out, live upserts to the renderer. */
import { isFrequencyLabel } from '@trxcontroller/rcip';
import type { ReceptionRow, ScannerSnapshot } from '../../shared/ipc';
import type { LogDb, NewReception } from './db';
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

  /**
   * A reception the display never named (a blip too short for the object screen, or a search
   * landing on a programmed frequency) takes the scanner's object from the last reception on
   * that frequency which showed it, marked MEM so it is never mistaken for a live reading. A
   * live object arriving later replaces it, since the tracker then carries `scannerName`. An object
   * named only by its frequency counts as unnamed here too, as it does in the tracker.
   */
  private remember(r: NewReception): NewReception {
    if (r.scannerName !== '' && !isFrequencyLabel(r.scannerName)) return r;
    const mem = this.db.lastScannerObject(r.frequencyHz);
    if (!mem) return r;
    return { ...r, name: mem.name, scanlist: r.scanlist || mem.scanlist, objectType: r.objectType || mem.objectType, system: r.system || mem.system, source: 'MEM' };
  }

  /**
   * An identity the user confirmed for the frequency (and the tone / talkgroup in hand) outranks
   * everything, the scanner's own programming included: that is what confirming is for. The other
   * sources' columns keep what they said, so the Detail view still shows the disagreement.
   */
  private confirm(r: NewReception): NewReception {
    const c = this.db.confirmationFor(r.frequencyHz, r.tone, r.tgid);
    if (!c) return r;
    return { ...r, name: c.name, system: c.system || r.system, source: 'CONF', distanceKm: c.distanceKm ?? r.distanceKm, bearingDeg: c.bearingDeg ?? r.bearingDeg };
  }

  private apply(ev: TrackerEvent): void {
    const e = ev.type === 'discard' ? ev : { ...ev, reception: this.confirm(this.remember(ev.reception)) };
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
