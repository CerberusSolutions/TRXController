/**
 * The DSD+ link: what TRXController reads from DSD+'s folder as it runs. DSD+ has no interface for other
 * programs (its TCP link is its own audio and tuning channel to FMPx, private and version-locked), but it
 * writes everything to files and reads its data files back while running, so files are the link, in both
 * directions. Read here: `DSDPlus.event` (one line per control-channel event, appended as they happen),
 * `DSDPlus.radios` (every radio seen, with the user's aliases and the P25 talker aliases) and
 * `DSDPlus.groups` (every talkgroup seen, with aliases). Formats from DSD+ 2.523 files, 2 Oct 2026.
 */

/** A line of `DSDPlus.event`, parsed. `at` is local time in ms since the epoch. */
export type DsdEvent =
  | DsdCallEvent
  | { kind: 'network'; at: number; id: string; name: string }
  | { kind: 'site'; at: number; id: string; name: string }
  | { kind: 'alias'; at: number; network: string; rid: number; alias: string }
  | { kind: 'registration'; at: number; rid: number; alias: string | null; tg: number | null; accepted: boolean }
  | { kind: 'affiliation'; at: number; rid: number; alias: string | null; tg: number | null; accepted: boolean }
  | { kind: 'deregistration'; at: number; rid: number; alias: string | null }
  | { kind: 'start'; at: number; version: string }
  /** A DMR site's neighbour list, one line per neighbour, reprinted every few seconds ("L1-15 neighbor:  Site L1-3; CC=63"). */
  | { kind: 'neighbour'; at: number; site: string; neighbour: string; code: string | null; text: string }
  | { kind: 'other'; at: number; text: string };

/**
 * A voice call line. DSD+ writes one when a transmission is granted (with the channel) and one when it
 * ends (with the duration, no channel); a talker joining a call already on a channel gets a line with
 * neither.
 */
export interface DsdCallEvent {
  kind: 'call';
  at: number;
  /** P25 NAC (hex text as DSD+ prints it), DMR colour code, or NXDN RAN, whichever the line carried. */
  nac: string | null;
  dcc: number | null;
  ran: number | null;
  /** Group, Private or Voice (D-Star / Fusion, where the IDs are callsigns). */
  type: 'Group' | 'Private' | 'Voice';
  enc: boolean;
  emergency: boolean;
  /** Broadcast, transmit-interrupt or OVCM variants, as DSD+ labels them. */
  flags: string[];
  tg: number | null;
  rid: number | null;
  /** Private calls: the called radio. */
  target: number | null;
  /** The callsign on a D-Star / Fusion voice call (`Src=M0JKT`). */
  callsign: string | null;
  /** The alias DSD+ shows for the radio ("[CRO SFS 046]"). */
  alias: string | null;
  /** The channel as DSD+ printed it ("418.875" or a channel number "1625"). */
  channel: string | null;
  /** The voice frequency in Hz when the channel was printed in MHz. */
  hz: number | null;
  slot: number | null;
  alg: string | null;
  keyId: string | null;
  /** The transmission's length, on its closing line. */
  durationS: number | null;
}

/** One transmission (a PTT) as the System window lists it. */
export interface DsdCall {
  id: number;
  startedAt: number;
  lastAt: number;
  type: DsdCallEvent['type'];
  enc: boolean;
  emergency: boolean;
  flags: string[];
  tg: number | null;
  rid: number | null;
  target: number | null;
  callsign: string | null;
  alias: string | null;
  channel: string | null;
  hz: number | null;
  slot: number | null;
  alg: string | null;
  keyId: string | null;
  durationS: number | null;
  /** True until the closing line (or a timeout) ends it. */
  open: boolean;
}

/** A line worth showing beneath the calls: registrations, affiliations, alias returns. */
export interface DsdNote {
  at: number;
  text: string;
}

/** What the event file has told us, kept small: the current network and site, recent calls, recent notes. */
export interface DsdFeed {
  version: string | null;
  network: { id: string; name: string } | null;
  site: { id: string; name: string } | null;
  nac: string | null;
  dcc: number | null;
  calls: DsdCall[];
  notes: DsdNote[];
  lastEventAt: number | null;
  nextId: number;
}

export const EMPTY_FEED: DsdFeed = { version: null, network: null, site: null, nac: null, dcc: null, calls: [], notes: [], lastEventAt: null, nextId: 1 };

/** How many calls and notes the feed keeps. */
export const FEED_CALLS = 60;
export const FEED_NOTES = 24;
/** A transmission with no closing line is taken as over after this long. */
export const CALL_OPEN_MS = 30_000;
/** A channel-less call line this soon after a call on the same talkgroup ended is a talker on that call's channel (P25 hang time). */
export const CHANNEL_HANG_MS = 10_000;

const LINE_RE = /^(\d{4})\/(\d\d)\/(\d\d)\s+(\d{1,2}):(\d\d):(\d\d)\s+(.*)$/;
const PREFIX_RE = /^(?:NAC=([0-9A-Fa-f]+)\s+|DCC=(\d+)\s+|RAN=(\d+)\s+)?(?:RAS\s+)?/;
const CALL_RE = /^((?:\w+ )*?)(Group|Private|Voice) call;\s*(.*)$/;

/** Parse one line of `DSDPlus.event`; null for a blank line or one without a timestamp. */
export function parseDsdEventLine(line: string): DsdEvent | null {
  const m = LINE_RE.exec(line.trim());
  if (!m) return null;
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).getTime();
  const rest = m[7]!.trim();
  const p = PREFIX_RE.exec(rest)!;
  const nac = p[1] ?? null;
  const dcc = p[2] !== undefined ? Number(p[2]) : null;
  const ran = p[3] !== undefined ? Number(p[3]) : null;
  const msg = rest.slice(p[0].length).trim();

  let c: RegExpExecArray | null;
  if ((c = CALL_RE.exec(msg))) {
    const words = c[1]!.trim().split(/\s+/).filter(Boolean);
    const args = c[3]!;
    const num = (key: string): number | null => {
      const r = new RegExp(`\\b${key}=(\\d+)`).exec(args);
      return r ? Number(r[1]) : null;
    };
    const text = (key: string): string | null => new RegExp(`\\b${key}=(\\S+)`).exec(args)?.[1] ?? null;
    const channel = text('Ch');
    const dur = /\s(\d+)s$/.exec(args);
    const src = text('Src');
    return {
      kind: 'call',
      at,
      nac,
      dcc,
      ran,
      type: c[2] as DsdCallEvent['type'],
      enc: words.includes('Enc'),
      emergency: words.includes('Emerg'),
      flags: words.filter((w) => w !== 'Enc' && w !== 'Emerg'),
      tg: num('TG'),
      rid: num('RID') ?? (src && /^\d+$/.test(src) ? Number(src) : null),
      target: num('Tgt'),
      callsign: src && !/^\d+$/.test(src) ? src : null,
      alias: /\[([^\]]*)\]/.exec(args)?.[1]?.trim() || null,
      channel,
      hz: channel && /^\d{1,4}\.\d{3,6}$/.test(channel) ? Math.round(Number(channel) * 1e6) : null,
      slot: num('Slot'),
      alg: text('Alg'),
      keyId: text('KeyID'),
      durationS: dur ? Number(dur[1]) : null,
    };
  }
  if ((c = /^Current (network|site):\s+(\S+)(?:\s+(.*))?$/.exec(msg))) {
    return { kind: c[1] as 'network' | 'site', at, id: c[2]!, name: (c[3] ?? '').trim() };
  }
  if ((c = /^Alias server returned talker alias "([^"]*)" for (\S+)-(\d+)$/.exec(msg))) {
    return { kind: 'alias', at, network: c[2]!, rid: Number(c[3]), alias: c[1]! };
  }
  if ((c = /^(Registration|Affiliation|Deregistration); RID=(\d+)(?:\s+\[([^\]]*)\])?(?:\s+TG=(\d+))?(?:\s+(\w+))?\s*$/.exec(msg))) {
    const kind = c[1]!.toLowerCase() as 'registration' | 'affiliation' | 'deregistration';
    const rid = Number(c[2]);
    const alias = c[3]?.trim() || null;
    if (kind === 'deregistration') return { kind, at, rid, alias };
    return { kind, at, rid, alias, tg: c[4] !== undefined ? Number(c[4]) : null, accepted: /^ACCEPT/i.test(c[5] ?? '') };
  }
  if ((c = /^DSD\+ (\S+)/.exec(msg))) return { kind: 'start', at, version: c[1]! };
  if ((c = /^(\S+) neighbou?r:\s+Site (\S+?)(?:;\s*(.*))?$/i.exec(msg))) return { kind: 'neighbour', at, site: c[1]!, neighbour: c[2]!, code: c[3]?.trim() || null, text: msg };
  return { kind: 'other', at, text: msg };
}

/** Lines worth a note beneath the calls: everything but the chatter DSD+ repeats every few seconds. */
function noteText(ev: DsdEvent): string | null {
  switch (ev.kind) {
    case 'alias':
      return `Alias for ${ev.rid}: ${ev.alias}`;
    case 'registration':
      return `Registration ${ev.rid}${ev.alias ? ` ${ev.alias}` : ''}${ev.tg !== null ? ` TG ${ev.tg}` : ''}${ev.accepted ? '' : ' (refused)'}`;
    case 'affiliation':
      return `Affiliation ${ev.rid}${ev.alias ? ` ${ev.alias}` : ''}${ev.tg !== null ? ` → TG ${ev.tg}` : ''}${ev.accepted ? '' : ' (refused)'}`;
    case 'deregistration':
      return `Deregistration ${ev.rid}${ev.alias ? ` ${ev.alias}` : ''}`;
    case 'start':
      return `DSD+ ${ev.version} started`;
    case 'neighbour':
      return ev.text;
    case 'other':
      return /^(Private Call Alert|Emerg|Affiliation Request)/.test(ev.text) ? ev.text : null;
    default:
      return null;
  }
}

/**
 * Fold one event into the feed. A call line with a channel opens a transmission; one with a duration
 * closes the open transmission of the same talkgroup and radio; one with neither is a new talker on the
 * channel the talkgroup already has. Pure, so it is testable and the renderer could replay it.
 */
export function reduceDsdEvent(feed: DsdFeed, ev: DsdEvent): DsdFeed {
  const next: DsdFeed = { ...feed, lastEventAt: Math.max(feed.lastEventAt ?? 0, ev.at) };
  switch (ev.kind) {
    case 'network':
      // DSD+ retuned to another system: its site, codes, calls and notes (a site's neighbour list) belong to the old one.
      if (feed.network && feed.network.id !== ev.id) Object.assign(next, { site: null, nac: null, dcc: null, calls: [], notes: [] });
      next.network = { id: ev.id, name: ev.name };
      return next;
    case 'site':
      // DSD+ prints the bare site number first ("2.7") and the full one ("BEE00.169-2.7  RAF Croughton") after.
      if (feed.site && ev.name === '' && feed.site.id.endsWith(`-${ev.id}`)) return next;
      next.site = { id: ev.id, name: ev.name };
      return next;
    case 'start':
      next.version = ev.version;
      break;
    case 'call': {
      if (ev.nac) next.nac = ev.nac;
      if (ev.dcc !== null) next.dcc = ev.dcc;
      const calls = feed.calls.map((c) => (c.open && ev.at - c.lastAt > CALL_OPEN_MS ? { ...c, open: false } : c));
      const same = (c: DsdCall): boolean => c.tg === ev.tg && c.type === ev.type && (ev.rid === null || c.rid === null || c.rid === ev.rid) && (ev.target === null || c.target === ev.target) && (ev.callsign === null || c.callsign === ev.callsign);
      const i = calls.findIndex((c) => c.open && same(c));
      const closing = ev.durationS !== null;
      if (i >= 0 && !(ev.channel !== null && calls[i]!.channel !== null && calls[i]!.channel !== ev.channel)) {
        // The open transmission's closing line, or a repeat of its grant.
        const c = calls[i]!;
        calls[i] = { ...c, lastAt: ev.at, rid: c.rid ?? ev.rid, alias: ev.alias ?? c.alias, channel: c.channel ?? ev.channel, hz: c.hz ?? ev.hz, slot: c.slot ?? ev.slot, alg: c.alg ?? ev.alg, keyId: c.keyId ?? ev.keyId, durationS: ev.durationS ?? c.durationS, enc: c.enc || ev.enc, open: !closing };
        next.calls = calls;
        return next;
      }
      // A new transmission. With no channel of its own it is a talker joining the talkgroup's call, open or
      // just ended (P25 prints those without a channel), so it takes that call's channel; a channel-less line
      // with no such call (DSD+ in a state where it prints no channels at all, seen on a TfL site on 2 Oct
      // 2026, when every private call took the channel of one an hour earlier) gets none.
      const last = calls.find((c) => c.tg === ev.tg && c.type === ev.type && c.channel !== null && (ev.type !== 'Private' || c.target === ev.target) && (c.open || ev.at - c.lastAt <= CHANNEL_HANG_MS));
      const call: DsdCall = {
        id: feed.nextId,
        startedAt: ev.at,
        lastAt: ev.at,
        type: ev.type,
        enc: ev.enc,
        emergency: ev.emergency,
        flags: ev.flags,
        tg: ev.tg,
        rid: ev.rid,
        target: ev.target,
        callsign: ev.callsign,
        alias: ev.alias,
        channel: ev.channel ?? last?.channel ?? null,
        hz: ev.hz ?? (ev.channel === null ? (last?.hz ?? null) : null),
        slot: ev.slot,
        alg: ev.alg,
        keyId: ev.keyId,
        durationS: ev.durationS,
        open: !closing,
      };
      next.nextId = feed.nextId + 1;
      next.calls = [call, ...calls].slice(0, FEED_CALLS);
      return next;
    }
    default:
      break;
  }
  const text = noteText(ev);
  // A site's neighbour list is printed again every few seconds: the same note is kept once, at its newest time.
  if (text) next.notes = [{ at: ev.at, text }, ...feed.notes.filter((n) => n.text !== text)].slice(0, FEED_NOTES);
  return next;
}

/** A talkgroup's line in `DSDPlus.groups`. */
export interface DsdGroup {
  protocol: string;
  network: string;
  tgid: number;
  hits: number;
  lastHeard: string;
  alias: string;
}

import type { LearnedChannel } from './dsdChannels';

/** What the Data dialog and the top-bar pill show about the link. */
export interface DsdStatus {
  /** The DSD+ folder, or null when the link is off. */
  folder: string | null;
  /** Something stopped the watcher reading the folder. */
  error: string | null;
  event: { found: boolean; size: number; lastEventAt: number | null };
  radios: { found: boolean; named: number; importedAt: number | null };
  groups: { found: boolean; count: number };
  /** Talkgroup aliases from the groups file for the feed's current network, by TGID. */
  tgNames: Record<number, string>;
  /** The scanner's system tag the feed's current network is known as (learned from a call both saw), or null until then. */
  system: string | null;
  /** The protocol DSD+'s groups file records for the feed's current network ("TIIInonStd", "P25"), for its frequencies-file lines. */
  protocol: string | null;
  /** Channel numbers of the feed's current network learned from the TRX's squelch openings, by channel. */
  channels: Record<string, LearnedChannel>;
  feed: DsdFeed;
  /** Events recorded in the log database since the folder was set (`dsd_events`). */
  recorded: number;
  /** True while events keep arriving: the newest is younger than `ALIVE_MS`. */
  alive: boolean;
}

/** How recent the newest event must be for the link to count as live. */
export const ALIVE_MS = 120_000;

export const EMPTY_DSD_STATUS: DsdStatus = {
  folder: null,
  error: null,
  event: { found: false, size: 0, lastEventAt: null },
  radios: { found: false, named: 0, importedAt: null },
  groups: { found: false, count: 0 },
  tgNames: {},
  system: null,
  protocol: null,
  channels: {},
  feed: EMPTY_FEED,
  recorded: 0,
  alive: false,
};
