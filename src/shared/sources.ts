/**
 * Where a name on a log row or in the hero came from. The scanner's own
 * programming is the blank source; the initials name the lookup that filled
 * in what the scanner did not know.
 */
export type LookupSource = '' | 'RRDB' | 'WTR' | 'UKR' | 'RID';

export const SOURCE_NAME: Readonly<Record<Exclude<LookupSource, ''>, string>> = {
  RRDB: 'RadioReference database',
  WTR: 'Ofcom Wireless Telegraphy Register',
  UKR: 'RSGB ETCC repeater list (ukrepeater.net)',
  RID: 'radioid.net DMR user database',
};
