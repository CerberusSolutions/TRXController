/**
 * Identities the user has confirmed by hand: "on this frequency (with this tone / talkgroup)
 * it is X". A confirmation outranks everything, the scanner's own programming included,
 * since the point of confirming is to correct what the scanner or a lookup got wrong.
 */
import type { LookupId } from './sources';

export interface Confirmation {
  id: number;
  frequencyHz: number;
  /** The tone / colour code / NAC the reception showed when confirmed ("CC 13", "CTCSS 94.8"); '' = whatever the tone. */
  tone: string;
  /** The talkgroup it applies to; null = whatever the talkgroup. */
  tgid: number | null;
  name: string;
  system: string;
  /** Which lookup the pick came from, or USER for a name typed in. */
  source: LookupId | 'USER';
  detail: string;
  distanceKm: number | null;
  bearingDeg: number | null;
  /** ms since epoch */
  confirmedAt: number;
}

export type NewConfirmation = Omit<Confirmation, 'id' | 'confirmedAt'>;

/**
 * The confirmation that applies to a reception: the most specific of those on its frequency
 * whose tone and talkgroup do not contradict it (a blank tone / null talkgroup matches anything).
 */
export function pickConfirmation<T extends Pick<Confirmation, 'frequencyHz' | 'tone' | 'tgid'>>(
  list: readonly T[],
  hz: number,
  tone: string | null | undefined,
  tgid: number | null | undefined,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const c of list) {
    if (c.frequencyHz !== hz) continue;
    if (c.tone !== '' && c.tone !== (tone ?? '')) continue;
    if (c.tgid !== null && c.tgid !== (tgid ?? null)) continue;
    const score = (c.tone !== '' ? 2 : 0) + (c.tgid !== null ? 1 : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
