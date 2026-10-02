/**
 * Learning a trunked site's channel numbers. On a DMR site that is not in DSD+'s frequencies file, DSD+
 * prints a grant as "Ch=306" and cannot say what frequency that is. The TRX can: when its squelch opens
 * on 167.300 within a couple of seconds of DSD+ granting ch 306, that is one vote for ch 306 = 167.300.
 * Enough consistent votes and the channel is learned: the System window shows the frequency, the TRX
 * marker can match on it, and the learned lines can be pasted into DSDPlus.frequencies, which is what
 * DSD+ needs to voice-follow the site itself. Pure, so it is testable; main feeds it and keeps it on disk.
 */

/** A grant may be stamped up to a second early (DSD+ writes whole seconds) and the TRX stops a moment after it. */
export const PAIR_BEFORE_MS = 1500;
export const PAIR_AFTER_MS = 4000;
/** How long unmatched grants and openings are kept waiting for their other half. */
const KEEP_MS = 10_000;
/**
 * An opening counts only when the scanner has just arrived on the frequency: a stop on a voice channel is a move
 * and an opening together. A scanner parked on a Tier III control channel (a Service Search sat on it) has its
 * squelch flutter there every few seconds, and every grant DSD+ printed found such a re-opening in its window: on
 * the TfL site on 2 Oct 2026 the learner "learned" 1701 and 1716 as the control channel, 139.53125, with every vote.
 */
export const ARRIVAL_MS = 2000;
/** Votes needed, and the share the leading frequency must hold, before a channel counts as learned. */
export const MIN_VOTES = 2;
export const MIN_SHARE = 0.7;

export interface LearnedChannel {
  channel: string;
  /** The learned frequency, null while the votes are too few or too split. */
  hz: number | null;
  /** Votes for the learned frequency, and in all. */
  votes: number;
  total: number;
}

/** What is kept on disk: votes per frequency, per channel, per DSD+ network. */
export type ChannelVotes = Record<string, Record<string, Record<string, number>>>;

interface Grant {
  at: number;
  network: string;
  channel: string;
  used: boolean;
}
interface Opening {
  at: number;
  hz: number;
  used: boolean;
}

export class ChannelLearner {
  private votes: ChannelVotes;
  private grants: Grant[] = [];
  private openings: Opening[] = [];
  private changed = false;

  constructor(saved?: ChannelVotes | null) {
    this.votes = saved ? structuredClone(saved) : {};
  }

  /** DSD+ granted a channel it could not name (a call line with a channel number and no frequency). */
  grant(at: number, network: string, channel: string): void {
    this.grants.push({ at, network, channel, used: false });
    this.tick(at);
  }

  /**
   * The TRX's squelch opened on a frequency (or it moved to another while open). `heldMs` is how long the scanner
   * had already been sitting on the frequency: a re-opening on a frequency it has been parked on (`ARRIVAL_MS` or
   * longer) is squelch flutter on a control channel, never a stop, and casts no vote.
   */
  opening(at: number, hz: number, heldMs = 0): void {
    if (heldMs > ARRIVAL_MS) return;
    this.openings.push({ at, hz, used: false });
    this.tick(at);
  }

  /**
   * Settle every grant whose window has closed (a vote is cast only once nothing more can land in the
   * window, so a second opening can still veto it) and forget stale halves. Main calls it every poll.
   */
  tick(now: number): void {
    for (const g of this.grants) if (!g.used && now - g.at > PAIR_AFTER_MS) this.settle(g);
    this.prune(now);
  }

  /** True once since the last call: something was learned or a vote cast, so the votes are worth saving. */
  takeChanged(): boolean {
    const c = this.changed;
    this.changed = false;
    return c;
  }

  toJSON(): ChannelVotes {
    return this.votes;
  }

  /** The learned (and still-forming) channels of a network, by channel number. */
  learned(network: string): Record<string, LearnedChannel> {
    const out: Record<string, LearnedChannel> = {};
    for (const [channel, byHz] of Object.entries(this.votes[network] ?? {})) {
      let best = 0;
      let bestHz: number | null = null;
      let total = 0;
      for (const [hz, n] of Object.entries(byHz)) {
        total += n;
        if (n > best) {
          best = n;
          bestHz = Number(hz);
        }
      }
      out[channel] = { channel, hz: best >= MIN_VOTES && best / total >= MIN_SHARE ? bestHz : null, votes: best, total };
    }
    return out;
  }

  /** Drop every vote for a network's channel (a wrong frequency learned from a coincidence); it is learned afresh from the next matches. */
  forget(network: string, channel: string): void {
    const net = this.votes[network];
    if (!net || !(channel in net)) return;
    delete net[channel];
    if (Object.keys(net).length === 0) delete this.votes[network];
    this.changed = true;
  }

  /** The frequency a network's channel has been learned as, or null. */
  hzOf(network: string, channel: string): number | null {
    return this.learned(network)[channel]?.hz ?? null;
  }

  private prune(now: number): void {
    this.grants = this.grants.filter((g) => now - g.at < KEEP_MS);
    this.openings = this.openings.filter((o) => now - o.at < KEEP_MS);
  }

  /**
   * Pair a grant with the openings in its window. Two openings on different frequencies, or another
   * grant on a different channel claiming the same opening, are ambiguous and cast no vote.
   */
  private settle(g: Grant): void {
    g.used = true;
    const inWindow = (o: Opening, x: Grant): boolean => o.at - x.at >= -PAIR_BEFORE_MS && o.at - x.at <= PAIR_AFTER_MS;
    const near = this.openings.filter((o) => !o.used && inWindow(o, g));
    if (near.length === 0) return;
    const hz = near[0]!.hz;
    if (near.some((o) => o.hz !== hz)) return;
    if (this.grants.some((x) => x !== g && x.channel !== g.channel && near.some((o) => inWindow(o, x)))) return;
    for (const o of near) o.used = true;
    const byHz = ((this.votes[g.network] ??= {})[g.channel] ??= {});
    byHz[String(hz)] = (byHz[String(hz)] ?? 0) + 1;
    this.changed = true;
  }
}

/**
 * Lines for DSDPlus.frequencies in the form its documentation shows ("TIIInonStd, L1, 15, 306, 167.3000, 0.0, 0":
 * protocol, network, site, channel, frequency in MHz, input frequency, 0), one per learned channel.
 */
export function dsdFrequencyLines(protocol: string, network: string, site: string | null, channels: Record<string, LearnedChannel>): string[] {
  const siteNo = site && site.startsWith(`${network}-`) ? site.slice(network.length + 1) : (site ?? '1');
  return Object.values(channels)
    .filter((c) => c.hz !== null)
    .sort((a, b) => Number(a.channel) - Number(b.channel))
    .map((c) => `${protocol}, ${network}, ${siteNo}, ${c.channel}, ${(c.hz! / 1e6).toFixed(4)}, 0.0, 0`);
}
