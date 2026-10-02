/**
 * The channel map of a DMR Tier III network: which frequency each logical slot number (LSN, the channel number
 * DSD+ prints as `Ch=1716`) is on. Tier III numbers channels in pairs, the odd LSN being slot 1 and the even one
 * slot 2 of the same carrier, and lays the carriers out at a fixed step (12.5 kHz as a rule, 6.25 or 25 on some
 * systems), so one known LSN and the step place every channel on the network:
 *
 *   index(LSN) = (LSN − 1) ÷ 2, rounded down      (two LSNs share each index; the index is also the LCN Uniden uses)
 *   hz(LSN)    = base + index(LSN) × step
 *
 * TfL London Buses, 2 Oct 2026: DSD+'s own table had 1607 / 1608 on 139.53125, 1715 / 1716 on 140.20625 and
 * 1735 / 1736 on 140.33125, which is 139.53125 + 54 × 12.5 kHz and + 64 × 12.5 kHz. The anchors (known LSN ↔
 * frequency pairs) come from a neighbour list naming a site's control channel LSN joined to that site's control
 * frequency from the scanner's header, from channels the scanner learned by its squelch openings, and from the
 * user. A plan with more than one frequency range (some 900 MHz systems) does not fit one line: its anchors show
 * as misfits, which is the sign of it. This file is pure and tested; main builds the map, the System window shows it.
 */

export type AnchorSource = 'user' | 'neighbour' | 'learned';

/** One known pairing of a logical slot number and a frequency. */
export interface MapAnchor {
  lsn: number;
  hz: number;
  source: AnchorSource;
  /** Where it came from, for the panel ("site L1-3's control channel, from site L1-15's neighbour list"; "5 votes"). */
  note: string;
}

/** What the user keeps for a network: the step chosen (null = infer, else default) and the anchors typed. */
export interface ChannelMapSettings {
  stepHz: number | null;
  anchors: MapAnchor[];
}

/** The steps Tier III networks are seen to use. */
export const MAP_STEPS = [6250, 12500, 25000] as const;
export const DEFAULT_STEP_HZ = 12500;
/** A predicted frequency this close to an anchor's counts as the same (rounding in a frequencies file). */
const FIT_HZ = 10;

export interface ChannelMap {
  stepHz: number;
  /** The frequency of index 0, so hz(LSN) = baseHz + index × stepHz. */
  baseHz: number;
  /** The step was worked out from the anchors (two or more at different indexes), not chosen or defaulted. */
  inferredStep: boolean;
  /** Every anchor considered, each with whether it lies on the line. */
  anchors: (MapAnchor & { fits: boolean })[];
}

/** The carrier index of a logical slot number: both slots of a carrier share it. */
export const lsnIndex = (lsn: number): number => Math.floor((lsn - 1) / 2);
/** The logical channel number Uniden radios use for the same carrier. */
export const lcnOf = (lsn: number): number => lsnIndex(lsn);
/** The slot a logical slot number is: 1 for odd, 2 for even. */
export const lsnSlot = (lsn: number): 1 | 2 => (lsn % 2 === 1 ? 1 : 2);
/** The two logical slot numbers of a carrier index: slot 1's and slot 2's. */
export const lsnPair = (index: number): [number, number] => [index * 2 + 1, index * 2 + 2];

const PRIORITY: Record<AnchorSource, number> = { user: 0, neighbour: 1, learned: 2 };

/**
 * Build the map from the anchors: one per LSN (the user's over a neighbour list's over a learned one), the step
 * chosen or inferred from the pairs of anchors at different indexes (the step the most pairs agree on, among the
 * known steps; the default with no such pair), and the base from the anchor that puts the most anchors on the
 * line, the higher-priority anchor breaking a tie. Null with no anchors.
 */
export function buildChannelMap(anchors: readonly MapAnchor[], stepHz: number | null): ChannelMap | null {
  const byLsn = new Map<number, MapAnchor>();
  for (const a of [...anchors].sort((x, y) => PRIORITY[x.source] - PRIORITY[y.source])) {
    if (Number.isFinite(a.lsn) && a.lsn >= 1 && Number.isFinite(a.hz) && a.hz > 0 && !byLsn.has(a.lsn)) byLsn.set(a.lsn, a);
  }
  const list = [...byLsn.values()].sort((x, y) => x.lsn - y.lsn);
  if (list.length === 0) return null;

  let step = stepHz;
  let inferred = false;
  if (step === null) {
    // Every pair of anchors at different carriers votes for the step that joins them, if it is a known one.
    const votes = new Map<number, number>();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const di = lsnIndex(list[j]!.lsn) - lsnIndex(list[i]!.lsn);
        if (di === 0) continue;
        const dh = Math.abs(list[j]!.hz - list[i]!.hz) / Math.abs(di);
        const known = MAP_STEPS.find((s) => Math.abs(dh - s) <= FIT_HZ);
        if (known !== undefined) votes.set(known, (votes.get(known) ?? 0) + 1);
      }
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    step = best ? best[0] : DEFAULT_STEP_HZ;
    inferred = best !== undefined;
  }

  // The base: from the reference anchor that puts the most anchors on the line.
  let base = 0;
  let bestFits = -1;
  let bestPriority = Infinity;
  for (const ref of list) {
    const b = ref.hz - lsnIndex(ref.lsn) * step;
    const fits = list.filter((a) => Math.abs(b + lsnIndex(a.lsn) * step - a.hz) <= FIT_HZ).length;
    if (fits > bestFits || (fits === bestFits && PRIORITY[ref.source] < bestPriority)) {
      bestFits = fits;
      bestPriority = PRIORITY[ref.source];
      base = b;
    }
  }
  return {
    stepHz: step,
    baseHz: base,
    inferredStep: inferred,
    anchors: list.map((a) => ({ ...a, fits: Math.abs(base + lsnIndex(a.lsn) * step - a.hz) <= FIT_HZ })),
  };
}

/** The frequency of a logical slot number on the map. */
export const mapHz = (map: ChannelMap, lsn: number): number => map.baseHz + lsnIndex(lsn) * map.stepHz;

/** The slot-1 logical slot number of a frequency on the map, or null when it is not on the grid (within a tenth of a step). */
export function mapLsn(map: ChannelMap, hz: number): number | null {
  const index = Math.round((hz - map.baseHz) / map.stepHz);
  if (index < 0 || Math.abs(map.baseHz + index * map.stepHz - hz) > map.stepHz / 10) return null;
  return index * 2 + 1;
}

/**
 * `DSDPlus.frequencies` lines for the carriers of the logical slot numbers given, one per carrier under its slot-1
 * LSN (DSD+ pairs the even slot itself): `protocol, network, site, LSN, MHz, 0.0, 0`, the comma form of DSD+'s own
 * data files. The site number is the part after the network's prefix of the site ID ("L1-15" → 15).
 */
export function channelMapLines(protocol: string, network: string, site: string | null, lsns: Iterable<number>, map: ChannelMap): string[] {
  const siteNo = site && site.startsWith(`${network}-`) ? site.slice(network.length + 1) : (site ?? '1');
  const indexes = [...new Set([...lsns].filter((n) => Number.isFinite(n) && n >= 1).map(lsnIndex))].sort((a, b) => a - b);
  return indexes.map((i) => `${protocol}, ${network}, ${siteNo}, ${lsnPair(i)[0]}, ${mhzText(map.baseHz + i * map.stepHz)}, 0.0, 0`);
}

/** MHz to four decimals, five when the frequency needs them (139.53125 on a 6.25 kHz grid). */
export function mhzText(hz: number): string {
  const s = (hz / 1e6).toFixed(5);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

/** What the System window shows for a network's channel map: the map, what the user keeps, and the anchors behind it. */
export interface ChannelMapInfo {
  map: ChannelMap | null;
  settings: ChannelMapSettings;
}

/** A logical slot number heard on the network, with how often and the frequency DSD+ itself printed for it, if ever. */
export interface HeardChannel {
  lsn: number;
  calls: number;
  hz: number | null;
  lastAt: number;
}

/**
 * Anchors a neighbour list gives: site S lists its neighbour P with "CC=63", and P's control channel frequency is
 * known (the scanner's header, recorded on P's site row), so LSN 63 is that frequency.
 */
export function neighbourAnchors(
  sites: readonly { site: string; controlHz: number | null; neighbours: readonly { site: string; code: string | null }[] }[],
): MapAnchor[] {
  const control = new Map(sites.filter((s) => s.controlHz !== null).map((s) => [s.site, s.controlHz!]));
  const out: MapAnchor[] = [];
  const seen = new Set<string>();
  for (const s of sites) {
    for (const n of s.neighbours) {
      const m = /CC\s*=\s*(\d+)/i.exec(n.code ?? '');
      const hz = control.get(n.site);
      if (!m || hz === undefined) continue;
      const key = `${n.site}|${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ lsn: Number(m[1]), hz, source: 'neighbour', note: `Site ${n.site}'s control channel, from site ${s.site}'s neighbour list` });
    }
  }
  return out;
}
