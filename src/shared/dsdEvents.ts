/**
 * DSD+ event recording: every transmission, registration, affiliation, deregistration and alias return DSD+
 * reports is kept in the log database (`dsd_events`), keyed so that the watcher's replay of the event file's
 * tail on each start writes the same rows again without duplicates. The per-day summaries built from it
 * (talkgroups, radios, sites, busy hours, who talks on what) are the System window's History view and the
 * data the network map grows from. The rows are pure data: nothing is written into DSD+'s folder.
 */
import type { DsdCall, DsdEvent, DsdFeed } from './dsd';

export type DsdEventKind = 'call' | 'registration' | 'affiliation' | 'deregistration' | 'alias';

/** One recorded event. A call row is one transmission, updated as its closing line lands. */
export interface DsdEventRow {
  /** Identity of the event across replays: network, kind, time and the IDs. */
  key: string;
  at: number;
  /** A call's end (its closing line, or when it was taken as over); null while open. */
  endedAt: number | null;
  network: string;
  site: string | null;
  kind: DsdEventKind;
  /** Group, Private or Voice on a call; '' otherwise. */
  type: string;
  tgid: number | null;
  rid: number | null;
  /** The called radio on a private call. */
  target: number | null;
  channel: string | null;
  hz: number | null;
  slot: number | null;
  enc: boolean;
  emergency: boolean;
  /** Bcast / TXI / OVCM, space-separated. */
  flags: string;
  /** The alias DSD+ printed with the radio, if any. */
  alias: string | null;
  durationS: number | null;
  /** Registration / affiliation accepted; null where that does not apply. */
  accepted: boolean | null;
}

/** The row for a transmission as the feed holds it. */
export function callEventRow(c: DsdCall, network: string, site: string | null): DsdEventRow {
  return {
    key: `${network}|call|${c.startedAt}|${c.type}|${c.tg ?? ''}|${c.rid ?? ''}|${c.target ?? ''}|${c.callsign ?? ''}`,
    at: c.startedAt,
    endedAt: c.open ? null : c.durationS !== null ? c.startedAt + c.durationS * 1000 : c.lastAt,
    network,
    site,
    kind: 'call',
    type: c.type,
    tgid: c.tg,
    rid: c.rid,
    target: c.target,
    channel: c.channel,
    hz: c.hz,
    slot: c.slot,
    enc: c.enc,
    emergency: c.emergency,
    flags: c.flags.join(' '),
    alias: c.alias ?? c.callsign,
    durationS: c.durationS,
    accepted: null,
  };
}

/** The row for a registration, affiliation, deregistration or alias return; null for any other line. */
export function noteEventRow(ev: DsdEvent, network: string, site: string | null): DsdEventRow | null {
  if (ev.kind !== 'registration' && ev.kind !== 'affiliation' && ev.kind !== 'deregistration' && ev.kind !== 'alias') return null;
  const tg = ev.kind === 'registration' || ev.kind === 'affiliation' ? ev.tg : null;
  const accepted = ev.kind === 'registration' || ev.kind === 'affiliation' ? ev.accepted : null;
  return {
    key: `${network}|${ev.kind}|${ev.at}|${ev.rid}|${tg ?? ''}`,
    at: ev.at,
    endedAt: null,
    network,
    site,
    kind: ev.kind,
    type: '',
    tgid: tg,
    rid: ev.rid,
    target: null,
    channel: null,
    hz: null,
    slot: null,
    enc: false,
    emergency: false,
    flags: '',
    alias: ev.alias,
    durationS: null,
    accepted,
  };
}

/**
 * The rows one event file line produced: the transmissions it opened, changed or closed (a closing line, a
 * talker joining, a stale call the reducer took as over), or the note it was. Nothing before the first
 * "Current network" line can be attributed, so nothing is recorded until then.
 */
export function eventRows(before: DsdFeed, after: DsdFeed, ev: DsdEvent): DsdEventRow[] {
  const network = after.network?.id;
  if (!network) return [];
  const site = after.site?.id ?? null;
  if (ev.kind !== 'call') {
    const row = noteEventRow(ev, network, site);
    return row ? [row] : [];
  }
  const prev = new Map(before.calls.map((c) => [c.id, c]));
  const rows: DsdEventRow[] = [];
  for (const c of after.calls) {
    const p = prev.get(c.id);
    if (!p || p.open !== c.open || p.lastAt !== c.lastAt || p.durationS !== c.durationS || p.rid !== c.rid || p.alias !== c.alias) rows.push(callEventRow(c, network, site));
  }
  return rows;
}

/** A radio's repeated registration, affiliation or deregistration within this long of its last recorded one is not kept. */
export const NOTE_REPEAT_MS = 10 * 60_000;
/** Recorded events older than this are pruned when the log opens. */
export const DSD_KEEP_DAYS = 90;

/**
 * Keeps the registration traffic in bounds: a busy DMR site re-registers every radio every few minutes
 * (hundreds of lines a minute), and one row per radio, talkgroup and ten minutes says the same thing.
 * Calls always pass.
 */
export class NoteThrottle {
  private readonly last = new Map<string, number>();

  keep(row: DsdEventRow): boolean {
    if (row.kind === 'call' || row.kind === 'alias') return true;
    const key = `${row.network}|${row.kind}|${row.rid}|${row.tgid ?? ''}|${row.accepted ?? ''}`;
    const at = this.last.get(key);
    if (at !== undefined && row.at - at < NOTE_REPEAT_MS && row.at >= at) return false;
    this.last.set(key, row.at);
    // The map is bounded: forget the oldest entries once it grows past a busy site's population.
    if (this.last.size > 20_000) {
      for (const k of this.last.keys()) {
        this.last.delete(k);
        if (this.last.size <= 10_000) break;
      }
    }
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}

// --- Day summaries ------------------------------------------------------------------------------

/** A talkgroup's day: who used it, how much, when. */
export interface DsdTgSummary {
  tgid: number;
  calls: number;
  radios: number;
  /** Seconds of transmissions with a known length. */
  seconds: number;
  firstAt: number;
  lastAt: number;
  enc: number;
  emergency: number;
  /** The radios heard on it, busiest first (a handful). */
  topRadios: { rid: number; calls: number }[];
  /** Calls per hour of the day, 24 entries. */
  hours: number[];
}

/** A radio's day: what it talked on, how much, and its registrations. */
export interface DsdRadioSummary {
  rid: number;
  calls: number;
  seconds: number;
  firstAt: number;
  lastAt: number;
  /** The alias DSD+ printed most recently for it. */
  alias: string | null;
  /** The talkgroups it talked on, busiest first (a handful). */
  topTalkgroups: { tgid: number; calls: number }[];
  /** Radios it called or was called by privately, most often first. */
  privateWith: { rid: number; calls: number }[];
  registrations: number;
  affiliations: number;
  /** The talkgroup it last affiliated to, if any. */
  affiliatedTg: number | null;
}

export interface DsdSiteSummary {
  site: string;
  calls: number;
  firstAt: number;
  lastAt: number;
}

/** One network's day, as the History view shows it. */
export interface DsdDaySummary {
  network: string;
  from: number;
  to: number;
  calls: number;
  privateCalls: number;
  events: number;
  /** Calls per hour of the day, 24 entries. */
  hours: number[];
  talkgroups: DsdTgSummary[];
  radios: DsdRadioSummary[];
  sites: DsdSiteSummary[];
  /** The radio list is cut here (busiest first) when a site registers thousands. */
  radiosTruncated: boolean;
}

/** A network the recording has rows for. */
export interface DsdNetworkSummary {
  network: string;
  events: number;
  firstAt: number;
  lastAt: number;
}

/** How many radios a day summary carries at most. */
export const DAY_RADIOS = 2000;
/** How many partners / talkgroups / radios each summary line lists. */
export const TOP_N = 8;

const CSV_HEADER = ['time', 'ended', 'network', 'site', 'kind', 'type', 'tgid', 'talkgroup', 'rid', 'radio', 'target', 'channel', 'mhz', 'slot', 'enc', 'emergency', 'flags', 'alias', 'duration_s', 'accepted'];

const csvCell = (v: string | number | boolean | null): string => {
  if (v === null) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const stamp = (t: number): string => {
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** The day's events as CSV (CRLF, no BOM), the names resolved by the caller. */
export function dsdEventsCsv(rows: readonly DsdEventRow[], names: { tg: (tgid: number) => string; radio: (rid: number) => string }): string {
  const lines = [CSV_HEADER.join(',')];
  for (const r of rows) {
    lines.push(
      [
        stamp(r.at),
        r.endedAt !== null ? stamp(r.endedAt) : '',
        r.network,
        r.site ?? '',
        r.kind,
        r.type,
        r.tgid,
        r.tgid !== null ? names.tg(r.tgid) : '',
        r.rid,
        r.rid !== null ? names.radio(r.rid) : '',
        r.target,
        r.channel,
        r.hz !== null ? (r.hz / 1e6).toFixed(4) : '',
        r.slot,
        r.enc,
        r.emergency,
        r.flags,
        r.alias,
        r.durationS,
        r.accepted,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
