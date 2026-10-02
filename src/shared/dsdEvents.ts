/**
 * DSD+ event recording: every transmission, registration, affiliation, deregistration and alias return DSD+
 * reports is kept in the log database (`dsd_events`), keyed so that the watcher's replay of the event file's
 * tail on each start writes the same rows again without duplicates. The per-day summaries built from it
 * (talkgroups, radios, sites, busy hours, who talks on what) are the System window's History view and the
 * data the network map grows from. The rows are pure data: nothing is written into DSD+'s folder.
 */
import type { DsdCall, DsdEvent, DsdFeed } from './dsd';

export type DsdEventKind = 'call' | 'registration' | 'affiliation' | 'deregistration' | 'alias' | 'neighbour' | 'site';

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
  /** A neighbour row: the neighbouring site. */
  peer: string | null;
  /** A site row: its NAC or colour code ("NAC 167", "CC 15"); a neighbour row: the neighbour's, as DSD+ printed it ("CC=63"). */
  code: string | null;
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
    peer: null,
    code: null,
  };
}

/**
 * A site as the scanner and DSD+ saw it together: its control channel from the scanner's header (DSD+ prints
 * channel numbers), its NAC or colour code from DSD+, its name as DSD+ has it. One row per site, brought up to date.
 */
export function siteEventRow(network: string, site: string, name: string, controlHz: number | null, code: string | null, at: number): DsdEventRow {
  return {
    key: `${network}|site|${site}`,
    at,
    endedAt: null,
    network,
    site,
    kind: 'site',
    type: '',
    tgid: null,
    rid: null,
    target: null,
    channel: null,
    hz: controlHz,
    slot: null,
    enc: false,
    emergency: false,
    flags: '',
    alias: name || null,
    durationS: null,
    accepted: null,
    peer: null,
    code,
  };
}

/** The row for a registration, affiliation, deregistration, alias return or neighbour line; null for any other line. */
export function noteEventRow(ev: DsdEvent, network: string, site: string | null): DsdEventRow | null {
  if (ev.kind === 'neighbour') {
    // One row per pair of sites, its time the latest the list was printed.
    return { key: `${network}|neighbour|${ev.site}|${ev.neighbour}`, at: ev.at, endedAt: null, network, site: ev.site, kind: 'neighbour', type: '', tgid: null, rid: null, target: null, channel: null, hz: null, slot: null, enc: false, emergency: false, flags: '', alias: null, durationS: null, accepted: null, peer: ev.neighbour, code: ev.code };
  }
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
    peer: null,
    code: null,
  };
}

/**
 * The rows one event file line produced: the transmissions it opened, changed or closed (a closing line, a
 * talker joining, a stale call the reducer took as over), or the note it was. Nothing before the first
 * "Current network" line can be attributed, so nothing is recorded until then.
 */
export function eventRows(before: DsdFeed, after: DsdFeed, ev: DsdEvent): DsdEventRow[] {
  const network = after.network?.key;
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
    if (row.kind === 'call' || row.kind === 'alias' || row.kind === 'site') return true;
    const key = row.kind === 'neighbour' ? row.key : `${row.network}|${row.kind}|${row.rid}|${row.tgid ?? ''}|${row.accepted ?? ''}`;
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
  /** DSD+'s name for it, '' when it has none. */
  name: string;
  /** The control channel, from the scanner's header when the two were seen on one call; null until then. */
  controlHz: number | null;
  /** "NAC 167" or "CC 15", null until seen. */
  code: string | null;
  /** The sites it lists as neighbours (DMR), with their codes as DSD+ printed them. */
  neighbours: { site: string; code: string | null }[];
  /** Calls in the period; 0 for a site known only by its facts. */
  calls: number;
  firstAt: number | null;
  lastAt: number | null;
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

const CSV_HEADER = ['time', 'ended', 'network', 'site', 'kind', 'type', 'tgid', 'talkgroup', 'rid', 'radio', 'target', 'channel', 'mhz', 'slot', 'enc', 'emergency', 'flags', 'alias', 'duration_s', 'accepted', 'peer', 'code'];

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

/** The period's summary as one flat CSV: a line per site, talkgroup and radio, with its partners in the last column. */
export function dsdMapCsv(s: DsdDaySummary, names: { tg: (tgid: number) => string; radio: (rid: number) => string }): string {
  const lines = ['kind,id,name,calls,radios,airtime_s,first,last,detail'];
  const row = (kind: string, id: string | number, name: string, calls: number, radios: number | '', seconds: number | '', first: number | null, last: number | null, detail: string): void => {
    lines.push([kind, id, name, calls, radios, seconds, first !== null ? stamp(first) : '', last !== null ? stamp(last) : '', detail].map(csvCell).join(','));
  };
  for (const site of s.sites) {
    const facts = [site.controlHz !== null ? `control ${(site.controlHz / 1e6).toFixed(4)}` : '', site.code ?? '', site.neighbours.length ? `neighbours ${site.neighbours.map((n) => `${n.site}${n.code ? ` (${n.code})` : ''}`).join('; ')}` : ''].filter(Boolean).join(' · ');
    row('site', site.site, site.name, site.calls, '', '', site.firstAt, site.lastAt, facts);
  }
  for (const t of s.talkgroups) row('talkgroup', t.tgid, names.tg(t.tgid), t.calls, t.radios, t.seconds, t.firstAt, t.lastAt, t.topRadios.map((r) => `${names.radio(r.rid) || r.rid} ${r.calls}`).join('; '));
  for (const r of s.radios) {
    const detail = [r.topTalkgroups.map((t) => `${names.tg(t.tgid) || 'TG ' + t.tgid} ${t.calls}`).join('; '), r.privateWith.length ? `private ${r.privateWith.map((p) => `${names.radio(p.rid) || p.rid} ${p.calls}`).join('; ')}` : '', r.affiliatedTg !== null ? `affiliated ${names.tg(r.affiliatedTg) || 'TG ' + r.affiliatedTg}` : ''].filter(Boolean).join(' · ');
    row('radio', r.rid, names.radio(r.rid) || r.alias || '', r.calls, '', r.seconds, r.firstAt, r.lastAt, detail);
  }
  return lines.join('\r\n') + '\r\n';
}

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
        r.peer,
        r.code,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
