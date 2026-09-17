/**
 * Turns the stream of scanner snapshots into reception open/update/close
 * events. Pure logic, no I/O.
 *
 * A reception is a period with the RF squelch open on one frequency.
 *
 * - Nothing is reported until the squelch has been open for `minDurationMs`,
 *   so noise bursts and the scanner's brief pauses on a chattering frequency
 *   never become rows ("discard" events are emitted for them instead).
 * - The squelch flutters, so a close is only confirmed after it has been shut
 *   for `closeDebounceMs`.
 * - A new opening on the same frequency and channel within `mergeWindowMs`
 *   of the previous close continues that reception ("open" with
 *   `merged: true`): first-heard stays, last-heard and the call count move.
 * - Channel details often arrive a poll or two after the squelch opens, so an
 *   open reception keeps absorbing better information until it closes.
 */
import { NO_ID, isModeFrequencyText, parseScanScreen, parseSearchScreen } from '@trxcontroller/rcip';
import type { ScannerSnapshot } from '../../shared/ipc';
import type { NewReception } from './db';
import { rankRepeaters, repeaterLabel } from '../../shared/repeaters';
import type { LookupSource } from '../../shared/sources';

export interface OpenReception extends NewReception {
  endedAt: null;
}

export type ClosedReception = NewReception & { endedAt: number };

export type TrackerEvent =
  | { type: 'open'; reception: OpenReception; merged: boolean }
  | { type: 'update'; reception: OpenReception }
  | { type: 'close'; reception: ClosedReception }
  | { type: 'discard'; reception: ClosedReception };

export interface TrackerOptions {
  closeDebounceMs?: number;
  minDurationMs?: number;
  mergeWindowMs?: number;
}

export type Description = Omit<NewReception, 'startedAt' | 'endedAt' | 'frequencyHz' | 'calls'>;

/** Fields merged value by value; `source` travels with the name, system and licensee instead (see `sourceAfter`). */
const FIELDS: Exclude<keyof Description, 'source'>[] = [
  'mode', 'signalType', 'name', 'system', 'scanlist', 'objectType', 'tgid', 'radioId', 'site', 'squelch', 'tone', 'licensee', 'rssiPeak',
];

/**
 * The source after `fresh` has been merged into `base` (blanks in `fresh` never replace
 * values in `base`): a fresh name or system brings its own source; a fresh licensee only
 * matters while there is no name or system for it to hide behind.
 */
export function sourceAfter(base: Description, fresh: Description): LookupSource {
  if (fresh.name !== '' || fresh.system !== '') return fresh.source;
  if (fresh.licensee !== '' && base.name === '' && base.system === '') return fresh.source;
  return base.source;
}

export class ReceptionTracker {
  private current: OpenReception | null = null;
  private committed = false;
  private squelchClosedAt: number | null = null;
  private lastClosed: ClosedReception | null = null;
  private readonly closeDebounceMs: number;
  private readonly minDurationMs: number;
  private readonly mergeWindowMs: number;

  constructor(opts: TrackerOptions = {}) {
    this.closeDebounceMs = opts.closeDebounceMs ?? 400;
    this.minDurationMs = opts.minDurationMs ?? 500;
    this.mergeWindowMs = opts.mergeWindowMs ?? 10_000;
  }

  /** The reception being tracked, whether or not it has been reported yet. */
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
      if (freqChanged) {
        events.push(this.close(this.squelchClosedAt ?? now));
      } else if (!receiving) {
        this.squelchClosedAt ??= now;
        if (now - this.squelchClosedAt >= this.closeDebounceMs) events.push(this.close(this.squelchClosedAt));
      } else {
        this.squelchClosedAt = null;
      }
    }

    if (receiving && !this.current) {
      this.current = { ...describe(s), startedAt: now, endedAt: null, frequencyHz: status.frequencyHz, calls: 1 };
      this.committed = false;
      this.squelchClosedAt = null;
    }

    if (this.current && receiving) {
      const changed = this.absorb(describe(s));
      if (!this.committed) {
        if (now - this.current.startedAt >= this.minDurationMs) {
          this.committed = true;
          events.push(this.commit(now));
        }
      } else if (changed) {
        events.push({ type: 'update', reception: this.current });
      }
    }
    return events;
  }

  /** Close any open reception (e.g. on disconnect). */
  flush(now = Date.now()): TrackerEvent[] {
    return this.current ? [this.close(this.squelchClosedAt ?? now)] : [];
  }

  /** Forget the previous reception so nothing merges into it (e.g. after the log is cleared). */
  reset(): void {
    this.lastClosed = null;
  }

  /** Merge fresh details into the current reception; true if anything improved. */
  private absorb(fresh: Description): boolean {
    let changed = false;
    const cur = this.current!;
    const source = sourceAfter(cur, fresh);
    for (const f of FIELDS) {
      const next = fresh[f];
      const prev = cur[f];
      // Keep the best value seen: never replace real data with blanks.
      const better = f === 'rssiPeak' ? (next as number) > (prev as number) : next !== '' && next !== null && next !== prev;
      if (better) {
        (cur as unknown as Record<string, unknown>)[f] = next;
        changed = true;
      }
    }
    if (source !== cur.source) {
      cur.source = source;
      changed = true;
    }
    return changed;
  }

  /** First report of the current reception, continuing the previous row if it is the same conversation. */
  private commit(now: number): TrackerEvent {
    const cur = this.current!;
    const prev = this.lastClosed;
    const sameChannel =
      prev !== null &&
      prev.frequencyHz === cur.frequencyHz &&
      (prev.name === '' || cur.name === '' || prev.name === cur.name) &&
      (prev.tgid === null || cur.tgid === null || prev.tgid === cur.tgid) &&
      cur.startedAt - prev.endedAt <= this.mergeWindowMs;
    if (sameChannel && prev) {
      const merged: OpenReception = {
        ...prev,
        ...cur,
        startedAt: prev.startedAt,
        endedAt: null,
        calls: prev.calls + 1,
        rssiPeak: Math.max(prev.rssiPeak, cur.rssiPeak),
        source: sourceAfter(prev, cur),
      };
      // Blanks in the new opening must not erase what the earlier one knew.
      for (const f of FIELDS) {
        if ((merged[f] === '' || merged[f] === null) && prev[f] !== '' && prev[f] !== null) {
          (merged as unknown as Record<string, unknown>)[f] = prev[f];
        }
      }
      this.current = merged;
      this.lastClosed = null;
      return { type: 'open', reception: merged, merged: true };
    }
    void now;
    return { type: 'open', reception: cur, merged: false };
  }

  private close(endedAt: number): TrackerEvent {
    const r = this.current!;
    const closed: ClosedReception = { ...r, endedAt: Math.max(endedAt, r.startedAt) };
    this.current = null;
    this.squelchClosedAt = null;
    if (!this.committed) return { type: 'discard', reception: closed };
    this.committed = false;
    this.lastClosed = closed;
    return { type: 'close', reception: closed };
  }
}

/** Best current description of what the scanner is receiving. */
export function describe(s: ScannerSnapshot): Description {
  const status = s.status!;
  const h = s.active?.header ?? null;
  const lcd = s.lcd;
  const screen = status.mode === 0x0a && lcd ? parseScanScreen(lcd) : null;
  // Tune Mode / Service Search: no object, so the header's tag is just the
  // mode and frequency; the search name stands in for the scanlist and the
  // IDs come off the display.
  const search = !screen && lcd ? parseSearchScreen(lcd) : null;
  const details = screen ?? search;
  const idOr = (v: number | undefined): number | null => (v === undefined || v === NO_ID ? null : v);
  const tag = h?.objectTag ?? '';
  // RadioReference fills in what the scanner's programming leaves blank: the talkgroup or channel name, and the system.
  const rrSys = s.rr?.systems[0];
  // Descriptions are the readable names; alpha tags are short codes and only stand in when there is no description.
  const rrName = rrSys?.talkgroup?.descr || rrSys?.talkgroup?.alpha || s.rr?.conventional[0]?.descr || s.rr?.conventional[0]?.alpha || '';
  const scannerName = (search && isModeFrequencyText(tag) ? '' : tag) || screen?.name || '';
  const name = scannerName || rrName;
  const system = h?.systemTag || rrSys?.name || '';
  // Amateur bands are not in the WTR; the repeater whose tone matches (or the nearest) stands in for the licensee.
  const wtr = s.licences?.[0]?.licensee || '';
  const licensee = wtr || (s.repeaters?.length ? repeaterLabel(rankRepeaters(s.repeaters, details?.detectedTone)[0]!) : '');
  // What the log should credit: the lookup behind the name, or behind the system when the scanner
  // named the object itself, or behind the licensee when that is all there is to show.
  const source: LookupSource =
    (scannerName === '' && rrName !== '') || (!h?.systemTag && system !== '')
      ? 'RRDB'
      : name === '' && system === '' && licensee !== ''
        ? wtr ? 'WTR' : 'UKR'
        : '';
  return {
    mode: status.rxModeName,
    signalType: lcd?.icons.signalType ? lcd.icons.signalTypeName : '',
    name,
    system,
    scanlist: screen?.scanlist ?? search?.name ?? '',
    objectType: screen?.type || (h ? h.recordingTypeName : search ? 'Search' : ''),
    tgid: idOr(h?.talkgroupId1) ?? details?.tgid ?? null,
    radioId: idOr(h?.radioId1) ?? details?.radioId ?? null,
    site: h?.siteName ?? '',
    squelch: h?.squelchText ?? '',
    tone: details?.detectedTone ?? '',
    licensee,
    source,
    rssiPeak: status.rssi,
  };
}

/** The radio ID currently on the display or in the `a` header, for the DMR user lookup; null if none. */
export function snapshotRadioId(s: ScannerSnapshot): number | null {
  return s.status ? describe(s).radioId : null;
}
