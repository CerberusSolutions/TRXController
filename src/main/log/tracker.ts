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
import { point } from '../../shared/geo';
import { NO_ID, isFrequencyLabel, isModeFrequencyText, parseScanScreen, parseSearchScreen } from '@trxcontroller/rcip';
import type { ScannerSnapshot } from '../../shared/ipc';
import type { NewReception } from './db';
import { candidatesFor, placed as isPlaced, rrukName, storedCandidates } from '../../shared/listed';
import { rankRepeaters, repeaterLabel } from '../../shared/repeaters';
import { detectedCode, rrToneMatches } from '../../shared/rr';
import { lookupRank, type LookupId, type LookupSource } from '../../shared/sources';

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

/**
 * Fields merged value by value; `source` travels with the name, system and licensee instead (see
 * `sourceAfter`), and the placement (`distanceKm`, `bearingDeg`) with the licensee and name too,
 * so a row is never placed by one identity and named by another.
 */
const FIELDS: Exclude<keyof Description, 'source' | 'distanceKm' | 'bearingDeg' | 'lat' | 'lon' | 'candidates'>[] = [
  'mode', 'signalType', 'name', 'system', 'scanlist', 'objectType', 'tgid', 'radioId', 'site', 'squelch', 'tone', 'licensee',
  'scannerName', 'wtr', 'rrName', 'rrSystem', 'rpt', 'rruk', 'rssiPeak',
];

/** The placement travels with the identity exactly as `sourceAfter` moves the source; an unplaced row takes any placement offered. */
type Placement = { distanceKm: number | null; bearingDeg: number | null; lat: number | null; lon: number | null };
const placementOf = (d: Placement): Placement => ({ distanceKm: d.distanceKm, bearingDeg: d.bearingDeg, lat: d.lat, lon: d.lon });

function placementAfter(base: Description, fresh: Description): Placement {
  const takeFresh = fresh.name !== '' || fresh.system !== '' || (fresh.licensee !== '' && base.name === '' && base.system === '') || base.distanceKm === null;
  return takeFresh && fresh.distanceKm !== null ? placementOf(fresh) : placementOf(base);
}

/** The candidate list grows as lookups answer (RadioReference lands a while after the squelch opens); a shorter fresh list never replaces a longer one. */
function candidatesAfter(base: Description, fresh: Description): Description['candidates'] {
  if (fresh.candidates.length === 0 || fresh.candidates.length < base.candidates.length) return base.candidates;
  return JSON.stringify(fresh.candidates) === JSON.stringify(base.candidates) ? base.candidates : fresh.candidates;
}

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
    const place = placementAfter(cur, fresh);
    if (place.distanceKm !== cur.distanceKm || place.bearingDeg !== cur.bearingDeg || place.lat !== cur.lat || place.lon !== cur.lon) {
      cur.distanceKm = place.distanceKm;
      cur.bearingDeg = place.bearingDeg;
      cur.lat = place.lat;
      cur.lon = place.lon;
      changed = true;
    }
    const candidates = candidatesAfter(cur, fresh);
    if (candidates !== cur.candidates) {
      cur.candidates = candidates;
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
        ...placementAfter(prev, cur),
        candidates: candidatesAfter(prev, cur),
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
  // The user's lookup order (Data menu): a lookup switched off ranks Infinity and contributes nothing.
  const rank = (id: LookupId): number => lookupRank(s.lookups, id);
  const rrOn = rank('RRDB') !== Infinity;
  const rrukOn = rank('RRUK') !== Infinity;
  // RadioReference fills in what the scanner's programming leaves blank: the talkgroup or channel name, and the system.
  const rrSys = rrOn ? s.rr?.systems[0] : undefined;
  // The channel each online database lists for this reception: the one whose tone / colour code matches
  // the detected one if any does (several users are listed on a shared channel), else the first (nearest).
  const detected = detectedCode(details);
  const toneScore = (t: string): number => ({ true: 0, null: 1, false: 2 })[String(rrToneMatches(t, detected))] ?? 1;
  const rrConv = rrOn && s.rr?.conventional.length ? [...s.rr.conventional].sort((a, b) => toneScore(a.tone) - toneScore(b.tone))[0] : undefined;
  const rrukBest = rrukOn && s.rruk?.entries.length ? [...s.rruk.entries].sort((a, b) => toneScore(a.code) - toneScore(b.code))[0] : undefined;
  // Descriptions are the readable names; alpha tags are short codes and only stand in when there is no description.
  const rrTalkgroup = rrSys?.talkgroup?.descr || rrSys?.talkgroup?.alpha || '';
  const rrChannel = rrConv?.descr || rrConv?.alpha || '';
  const rruk = rrukBest ? rrukName(rrukBest) : '';
  // The channel description in play: RadioReference's or RRUK's, whichever matches the detected code,
  // else is placed, else ranks higher in the lookup order.
  interface Desc { src: 'RRDB' | 'RRUK'; name: string; place: Placement; placed: boolean; match: boolean | null }
  const descs: Desc[] = [];
  if (rrConv && rrChannel) descs.push({ src: 'RRDB', name: rrChannel, place: rrConv, placed: isPlaced(rrConv), match: rrToneMatches(rrConv.tone, detected) });
  if (rrukBest && rruk) descs.push({ src: 'RRUK', name: rruk, place: rrukBest, placed: isPlaced(rrukBest), match: rrukBest.code ? rrToneMatches(rrukBest.code, detected) : null });
  const mScore = (m: boolean | null): number => (m === true ? 0 : m === null ? 1 : 2);
  const desc = descs.sort((a, b) => mScore(a.match) - mScore(b.match) || Number(b.placed) - Number(a.placed) || rank(a.src) - rank(b.src))[0];
  const scannerName = (search && isModeFrequencyText(tag) ? '' : tag) || screen?.name || '';
  // An object named only by its frequency, with or without the fingerprint notes a user adds while
  // identifying it ("453.0625 CC15"), carries no identity: the lookups name it as if it were blank,
  // while the Detail view's Scanner column keeps the scanner's text.
  const named = isFrequencyLabel(scannerName) ? '' : scannerName;
  // The licensee: the higher-ranked of the register and the repeater list that has a match. Amateur
  // bands are not in the WTR; the repeater whose tone matches (or the nearest) stands in there.
  const wtr = rank('WTR') !== Infinity ? s.licences?.[0]?.licensee || '' : '';
  const bestRpt = rank('UKR') !== Infinity && s.repeaters?.length ? rankRepeaters(s.repeaters, detected)[0]! : null;
  const rpt = bestRpt ? repeaterLabel(bestRpt) : '';
  const licSrc: LookupSource = wtr && rpt ? (rank('WTR') <= rank('UKR') ? 'WTR' : 'UKR') : wtr ? 'WTR' : rpt ? 'UKR' : '';
  const licensee = licSrc === 'WTR' ? wtr : licSrc === 'UKR' ? rpt : '';
  // Whether the chosen licensee could be placed relative to the user: an entry nobody can place never
  // outranks one that is, whatever the order.
  const licPlaced = licSrc === 'WTR' ? s.licences![0]!.distanceKm !== null : licSrc === 'UKR' ? bestRpt!.distanceKm !== null : false;
  // A channel description whose code matches the detected one wins whatever the order (the registers
  // know no codes); one whose code differs loses to any licensee; otherwise the order and placement decide.
  const licenseeWins =
    licensee !== '' &&
    (desc === undefined || desc.match === false || (desc.match !== true && (rank(licSrc as LookupId) < rank(desc.src) || (licPlaced && !desc.placed))));
  // The name: the scanner's own, else RadioReference's talkgroup (a licence register knows no
  // talkgroups), else the channel description unless the licensee will show in its place.
  const descName = rrTalkgroup || (desc && !licenseeWins ? desc.name : '');
  const descSrc: LookupSource = rrTalkgroup ? 'RRDB' : desc && !licenseeWins ? desc.src : '';
  const name = named || descName;
  const system = h?.systemTag || rrSys?.name || '';
  // What the log should credit: the lookup behind the name, or behind the system when the scanner
  // named the object itself, or behind the licensee when that is all there is to show.
  const source: LookupSource =
    named === '' && descName !== ''
      ? descSrc
      : !h?.systemTag && system !== ''
        ? 'RRDB'
        : name === '' && system === '' && licensee !== ''
          ? licSrc
          : '';
  // Where the row's identity lies: the licensee's licence or repeater, or the database's site / county /
  // entry when a database supplied the name; whichever placed the row when the other is unknown.
  const licPlace = licSrc === 'WTR' ? s.licences![0]! : licSrc === 'UKR' ? bestRpt! : null;
  const descPlace = rrTalkgroup || (system !== '' && !h?.systemTag) ? rrSys : (desc?.place ?? rrSys ?? rrConv);
  const first = source === 'RRDB' || source === 'RRUK' ? descPlace : licPlace;
  const second = source === 'RRDB' || source === 'RRUK' ? licPlace : descPlace;
  const placedBy = first?.distanceKm != null ? first : second?.distanceKm != null ? second : (first ?? second);
  const candidates = storedCandidates(candidatesFor({ rr: s.rr, rruk: s.rruk, licences: s.licences, repeaters: s.repeaters, detectedTone: detected }, s.lookups));
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
    tone: detected ?? '',
    licensee,
    source,
    // Every source's own answer, for the log's Detail view and the CSV, whatever the order chose.
    scannerName,
    wtr,
    rrName: rrTalkgroup || rrChannel,
    rrSystem: rrSys?.name ?? '',
    rpt,
    rruk,
    distanceKm: placedBy?.distanceKm ?? null,
    bearingDeg: placedBy?.bearingDeg ?? null,
    ...(point(placedBy?.lat, placedBy?.lon) ?? { lat: null, lon: null }),
    candidates,
    rssiPeak: status.rssi,
  };
}

/** The radio ID currently on the display or in the `a` header, for the DMR user lookup; null if none. */
export function snapshotRadioId(s: ScannerSnapshot): number | null {
  return s.status ? describe(s).radioId : null;
}
