/**
 * Where a name on a log row or in the hero came from. The scanner's own
 * programming is the blank source; the initials name the lookup that filled
 * in what the scanner did not know.
 */
export type LookupSource = '' | 'RRDB' | 'WTR' | 'UKR' | 'RID' | 'MEM' | 'CONF';

export const SOURCE_NAME: Readonly<Record<Exclude<LookupSource, ''>, string>> = {
  RRDB: 'RadioReference database',
  WTR: 'Ofcom Wireless Telegraphy Register',
  UKR: 'RSGB ETCC repeater list (ukrepeater.net)',
  RID: 'radioid.net DMR user database',
  MEM: "scanner's object remembered from an earlier reception on this frequency",
  CONF: 'identity you confirmed by hand (outranks every lookup and the scanner)',
};

/** The lookups a user can order and switch off. The scanner's own programming is always first. */
export type LookupId = 'RRDB' | 'WTR' | 'UKR';

export interface LookupPref {
  id: LookupId;
  enabled: boolean;
}

/** For the UK the licence register beats RadioReference's member-entered channel names. */
export const DEFAULT_LOOKUPS: readonly LookupPref[] = [
  { id: 'WTR', enabled: true },
  { id: 'RRDB', enabled: true },
  { id: 'UKR', enabled: true },
];

/** Settings-file value to a full, ordered list: unknown ids dropped, missing ones appended enabled. */
export function normaliseLookups(v: unknown): LookupPref[] {
  const out: LookupPref[] = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      const id = typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : undefined;
      if ((id === 'RRDB' || id === 'WTR' || id === 'UKR') && !out.some((p) => p.id === id)) {
        out.push({ id, enabled: (item as { enabled?: unknown }).enabled !== false });
      }
    }
  }
  for (const d of DEFAULT_LOOKUPS) if (!out.some((p) => p.id === d.id)) out.push({ ...d });
  return out;
}

/** Position of a lookup in the order, or Infinity when it is switched off. */
export function lookupRank(prefs: readonly LookupPref[], id: LookupId): number {
  const i = prefs.findIndex((p) => p.id === id);
  return i >= 0 && prefs[i]!.enabled ? i : Infinity;
}

export const lookupEnabled = (prefs: readonly LookupPref[], id: LookupId): boolean => lookupRank(prefs, id) !== Infinity;
