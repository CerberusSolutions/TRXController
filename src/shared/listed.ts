/**
 * The candidates the lookups offer for a frequency, ranked the way the hero's Listed block
 * shows them and the log stores them on each row: every RadioReference system and channel,
 * Ofcom licence and amateur repeater that matched, with where it lies relative to the user.
 * Pure functions shared by main (the tracker stores the list) and the renderer (the hero
 * and the log's expander draw it).
 */
import type { RepeaterMatch, RrConventional, RrInfo, RrSystemInfo, WtrMatch } from './ipc';
import { ctcssHz, rankRepeaters, toneMatches } from './repeaters';
import { conventionalLabel, rrToneMatches } from './rr';
import { lookupRank, type LookupId, type LookupPref } from './sources';

/** One lookup's answer for a frequency, as stored on a log row and listed in the hero. */
export interface Candidate {
  source: LookupId;
  name: string;
  /** Site, talkgroup, county, place, mode, tone: everything but the distance, which the renderer formats in the user's units. */
  detail: string;
  distanceKm: number | null;
  bearingDeg: number | null;
  /** Its tone / colour code matched the one the scanner detected (undefined when it has none to compare). */
  match?: boolean;
  /** Repeater capabilities ("FM · DMR"), drawn as pills. */
  pills?: string;
}

/** A candidate with the tooltip the hero shows; the tooltip is not stored on log rows. */
export interface ListedCandidate extends Candidate {
  key: string;
  title: string;
}

/** Nobody could place it relative to the user: it never outranks one that was. */
export const placed = (c: { distanceKm: number | null }): boolean => c.distanceKm !== null;

export interface CandidateInputs {
  rr: RrInfo | null | undefined;
  licences: readonly WtrMatch[] | undefined;
  repeaters: readonly RepeaterMatch[] | undefined;
  /** The tone the scanner detected ("CTCSS 94.8", "CC 1", "NAC 293"), for the match marks and the repeater order. */
  detectedTone: string | null | undefined;
}

function fromSystem(sys: RrSystemInfo): ListedCandidate {
  const tg = sys.talkgroup;
  return {
    key: `rr-s${sys.sid}`,
    source: 'RRDB',
    name: sys.name,
    detail: [sys.site?.descr, tg ? `${tg.descr || tg.alpha}${tg.category ? ` (${tg.category})` : ''}${tg.enc ? ' · enc' : ''}` : ''].filter(Boolean).join(' · '),
    distanceKm: sys.distanceKm,
    bearingDeg: sys.bearingDeg,
    title: `RadioReference system ${sys.sid}${sys.city ? ` · ${sys.city}` : ''}${sys.site ? ` · site ${sys.site.descr} (${sys.site.location}) NAC ${sys.site.nac}` : ''}${tg ? ` · TG ${tg.tgDec} ${tg.alpha}` : ''}`,
  };
}

function fromConventional(c: RrConventional, i: number, detected: string | null | undefined): ListedCandidate {
  const match = rrToneMatches(c.tone, detected ?? null);
  return {
    key: `rr-c${i}`,
    source: 'RRDB',
    name: c.descr || c.alpha,
    detail: [c.county, c.tone ? `${c.tone}${match === true ? ' ✓' : ''}` : '', c.mode, c.tags[0]].filter(Boolean).join(' · '),
    distanceKm: c.distanceKm,
    bearingDeg: c.bearingDeg,
    ...(match === null ? {} : { match }),
    title: `${conventionalLabel(c)}${c.callsign ? ` · ${c.callsign}` : ''}${c.tags.length ? ` · ${c.tags.join(', ')}` : ''}${match === false ? ' · tone differs from the detected one' : ''}`,
  };
}

function fromLicence(l: WtrMatch): ListedCandidate {
  return {
    key: `wtr-${l.id}`,
    source: 'WTR',
    name: l.licensee,
    detail: [l.mode, l.direction === 'R' ? 'mob' : l.direction === 'T' ? 'base' : ''].filter(Boolean).join(' · '),
    distanceKm: l.distanceKm,
    bearingDeg: l.bearingDeg,
    title: `${l.product} · ${l.emission || 'emission unknown'} · ${l.ngr || 'no grid ref'}${l.direction === 'R' ? ' · base receives here (mobiles transmit)' : ''}`,
  };
}

function fromRepeater(r: RepeaterMatch, detectedHz: number | null): ListedCandidate {
  const match = toneMatches(r, detectedHz);
  return {
    key: `rpt-${r.id}`,
    source: 'UKR',
    name: r.callsign,
    pills: r.modes,
    detail: [r.where ? r.where.charAt(0) + r.where.slice(1).toLowerCase() : '', r.ctcss !== null ? `${r.ctcss.toFixed(1)} Hz${match ? ' ✓' : ''}` : '', r.side === 'input' ? 'input' : ''].filter(Boolean).join(' · '),
    distanceKm: r.distanceKm,
    bearingDeg: r.bearingDeg,
    ...(detectedHz !== null && r.ctcss !== null ? { match } : {}),
    title: `${r.channel || r.band}${r.inputHz ? ` · input ${(r.inputHz / 1e6).toFixed(4)}` : ''} · ${r.locator || 'no locator'}${r.side === 'input' ? ' · you are hearing its input (a mobile)' : ''}${
      match ? ' · CTCSS matches the detected tone' : detectedHz !== null && r.ctcss !== null ? ' · CTCSS differs from the detected tone' : ''
    }`,
  };
}

/** A tone / colour code that matches the detected one is the strongest evidence there is; one that differs is evidence against. */
export const matchScore = (c: { match?: boolean }): number => (c.match === true ? 0 : c.match === undefined ? 1 : 2);

/**
 * Every candidate the enabled lookups offer, ranked: an entry whose tone / colour code matches the
 * one detected first, one whose tone differs last; between them anything placed near the user beats
 * anything nobody can place; then the user's lookup order; within a lookup, nearest first as the
 * lookup returned them.
 */
export function candidatesFor(inputs: CandidateInputs, prefs: readonly LookupPref[]): ListedCandidate[] {
  const out: ListedCandidate[] = [];
  const detected = inputs.detectedTone ?? null;
  const rr = lookupRank(prefs, 'RRDB') !== Infinity ? inputs.rr : null;
  for (const sys of rr?.systems ?? []) out.push(fromSystem(sys));
  (rr?.conventional ?? []).forEach((c, i) => out.push(fromConventional(c, i, detected)));
  if (lookupRank(prefs, 'WTR') !== Infinity) for (const l of inputs.licences ?? []) out.push(fromLicence(l));
  if (lookupRank(prefs, 'UKR') !== Infinity) {
    const hz = ctcssHz(detected);
    for (const r of rankRepeaters(inputs.repeaters ?? [], detected)) out.push(fromRepeater(r, hz));
  }
  return out
    .map((row, i) => ({ row, i, rank: lookupRank(prefs, row.source) }))
    .sort((a, b) => matchScore(a.row) - matchScore(b.row) || Number(placed(b.row)) - Number(placed(a.row)) || a.rank - b.rank || a.i - b.i)
    .map((x) => x.row);
}

/** The stored form: the same list without the tooltip. */
export function storedCandidates(list: readonly ListedCandidate[]): Candidate[] {
  return list.map(({ key: _k, title: _t, ...c }) => c);
}

/** Settings-file / database value to a clean list; anything malformed is dropped. */
export function normaliseCandidates(v: unknown): Candidate[] {
  if (!Array.isArray(v)) return [];
  const out: Candidate[] = [];
  for (const item of v) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    if (o['source'] !== 'RRDB' && o['source'] !== 'WTR' && o['source'] !== 'UKR') continue;
    const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const c: Candidate = {
      source: o['source'],
      name: typeof o['name'] === 'string' ? o['name'] : '',
      detail: typeof o['detail'] === 'string' ? o['detail'] : '',
      distanceKm: num(o['distanceKm']),
      bearingDeg: num(o['bearingDeg']),
    };
    if (typeof o['match'] === 'boolean') c.match = o['match'];
    if (typeof o['pills'] === 'string' && o['pills']) c.pills = o['pills'];
    out.push(c);
  }
  return out;
}
