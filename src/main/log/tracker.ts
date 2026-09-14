/**
 * Turns the stream of scanner snapshots into reception open/update/close
 * events. Pure logic, no I/O.
 *
 * A reception is a period with the RF squelch open on one frequency. The
 * scanner's squelch flutters, so a close is only confirmed after it has been
 * shut for `closeDebounceMs`. Channel details often arrive a poll or two
 * after the squelch opens, so an open reception keeps absorbing better
 * information until it closes.
 */
import { NO_ID, parseScanObjectLine } from '@trxcontroller/rcip';
import type { ScannerSnapshot } from '../../shared/ipc';
import type { NewReception } from './db';

export interface OpenReception extends NewReception {
  endedAt: null;
}

export type TrackerEvent =
  | { type: 'open'; reception: OpenReception }
  | { type: 'update'; reception: OpenReception }
  | { type: 'close'; reception: NewReception & { endedAt: number } };

export interface TrackerOptions {
  closeDebounceMs?: number;
}

export type Description = Omit<NewReception, 'startedAt' | 'endedAt' | 'frequencyHz'>;

const FIELDS: (keyof Description)[] = [
  'mode', 'signalType', 'name', 'system', 'scanlist', 'objectType', 'tgid', 'radioId', 'site', 'squelch', 'rssiPeak',
];

export class ReceptionTracker {
  private current: OpenReception | null = null;
  private squelchClosedAt: number | null = null;
  private readonly closeDebounceMs: number;

  constructor(opts: TrackerOptions = {}) {
    this.closeDebounceMs = opts.closeDebounceMs ?? 400;
  }

  get open(): OpenReception | null {
    return this.current;
  }

  update(s: ScannerSnapshot, now = Date.now()): TrackerEvent[] {
    const events: TrackerEvent[] = [];
    const status = s.status;
    if (!status) return events;
    const receiving = status.squelch.rf;

    if (this.current) {
      const freqChanged = status.frequencyHz !== this.current.frequencyHz;
      if (!receiving || freqChanged) {
        if (freqChanged) {
          events.push(this.close(this.squelchClosedAt ?? now));
        } else {
          this.squelchClosedAt ??= now;
          if (now - this.squelchClosedAt >= this.closeDebounceMs) events.push(this.close(this.squelchClosedAt));
        }
      } else {
        this.squelchClosedAt = null;
      }
    }

    if (receiving && !this.current) {
      this.current = { ...describe(s), startedAt: now, endedAt: null, frequencyHz: status.frequencyHz };
      this.squelchClosedAt = null;
      events.push({ type: 'open', reception: this.current });
      return events;
    }

    if (this.current && receiving) {
      const fresh = describe(s);
      let changed = false;
      for (const f of FIELDS) {
        const next = fresh[f];
        const cur = this.current[f];
        // Keep the best value seen: never replace real data with blanks.
        const better = f === 'rssiPeak' ? (next as number) > (cur as number) : next !== '' && next !== null && next !== cur;
        if (better) {
          (this.current as unknown as Record<string, unknown>)[f] = next;
          changed = true;
        }
      }
      if (changed) events.push({ type: 'update', reception: this.current });
    }
    return events;
  }

  /** Close any open reception (e.g. on disconnect). */
  flush(now = Date.now()): TrackerEvent[] {
    return this.current ? [this.close(this.squelchClosedAt ?? now)] : [];
  }

  private close(endedAt: number): TrackerEvent {
    const r = this.current!;
    this.current = null;
    this.squelchClosedAt = null;
    return { type: 'close', reception: { ...r, endedAt: Math.max(endedAt, r.startedAt) } };
  }
}

/** Best current description of what the scanner is receiving. */
export function describe(s: ScannerSnapshot): Description {
  const status = s.status!;
  const h = s.active?.header ?? null;
  const lcd = s.lcd;
  const channelScreen = status.mode === 0x0a && lcd ? parseScanObjectLine(lcd.lines[2] ?? '') : null;
  const onChannel = channelScreen?.flags != null;
  const scanlist = onChannel ? (lcd?.lines[1]?.trim() ?? '') : '';
  const lcdName = onChannel ? (lcd?.lines[3]?.trim() ?? '') : '';
  const idOr = (v: number | undefined): number | null => (v === undefined || v === NO_ID ? null : v);
  return {
    mode: status.rxModeName,
    signalType: lcd?.icons.signalType ? lcd.icons.signalTypeName : '',
    name: h?.objectTag || lcdName,
    system: h?.systemTag ?? '',
    scanlist,
    objectType: (onChannel ? channelScreen?.type : '') || (h ? h.recordingTypeName : ''),
    tgid: idOr(h?.talkgroupId1),
    radioId: idOr(h?.radioId1),
    site: h?.siteName ?? '',
    squelch: h?.squelchText ?? '',
    rssiPeak: status.rssi,
  };
}
