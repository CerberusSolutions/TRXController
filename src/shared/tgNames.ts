/**
 * Names for talkgroups: the user's own ("TG 100 on SOT Council is Highways Depot"), and DSD+'s aliases from
 * its groups file. The scanner shows UNID (or a bare number) for a talkgroup its wildcard object caught, and
 * its own alpha tags are cut to the display's 16 characters, so this is where a readable name lives.
 *
 * Keyed by talkgroup ID plus `system`: the scanner's system tag on a trunked object (talkgroup IDs are local
 * to a system), '' for any system. DSD+ keys by its own network ID ("L1", "BEE00.169"), which main maps onto
 * the scanner's system tag once the two have been seen on one call; until then the alias is keyed to the
 * network ID and the hero looks it up by both.
 *
 * Rank: a confirmed identity, then a name the user typed (over the scanner's own alpha tag, which is what
 * the user programmed and may be truncated), then the scanner's own name, then DSD+'s alias (which only
 * fills in a placeholder), then the lookups.
 */

export type TgNameSource = 'USER' | 'DSD';

export interface TgName {
  id: number;
  /** The scanner's system tag (or the DSD+ network ID until it is mapped); '' = any system. */
  system: string;
  tgid: number;
  name: string;
  source: TgNameSource;
  /** ms since epoch */
  namedAt: number;
}

export type NewTgName = Omit<TgName, 'id' | 'namedAt'>;

/**
 * The name that applies to `tgid` heard on one of `systems` (the scanner's system tag, then the DSD+
 * network it is parked on, then ''): the user's own name on the most specific system first, else DSD+'s
 * alias on the most specific system. Null when neither knows it.
 */
export function pickTgName<T extends Pick<TgName, 'system' | 'tgid' | 'source'>>(list: readonly T[], tgid: number | null | undefined, systems: readonly (string | null | undefined)[]): T | null {
  if (tgid === null || tgid === undefined) return null;
  const order = tgSystems(systems);
  let best: T | null = null;
  let bestScore = Infinity;
  for (const n of list) {
    if (n.tgid !== tgid) continue;
    const i = order.indexOf(n.system);
    if (i < 0) continue;
    const score = (n.source === 'USER' ? 0 : 100) + i;
    if (score < bestScore) {
      best = n;
      bestScore = score;
    }
  }
  return best;
}

/** The systems a talkgroup name may be keyed to, most specific first and '' (any system) last, without repeats. */
export function tgSystems(systems: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const s of systems) if (s && !out.includes(s)) out.push(s);
  out.push('');
  return out;
}

/** The system a talkgroup is keyed by when named from a reception: the trunked system's tag, '' elsewhere. */
export function tgNameSystem(r: { objectType: string; system: string }): string {
  return /^(TGRP|Talkgroup)$/i.test(r.objectType) ? r.system : '';
}
