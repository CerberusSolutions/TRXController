/**
 * Scan timeout: the scanner parked on one carrier for longer than the user allows is nudged on.
 * Pure timing logic; the caller presses the key. Only Scan mode counts (a search or Tune Mode is
 * meant to sit on a signal), only while the squelch stays open on one frequency, and once per
 * stop: after the nudge nothing fires again until the squelch closes or the frequency changes.
 */
import type { ScannerSnapshot } from '../../shared/ipc';

export const SCAN_MODE = 0x0a;

export class ScanTimeout {
  private hz: number | null = null;
  private since = 0;
  private fired = false;

  /** True when the key should be pressed now. `timeoutMs` null or 0 switches the timeout off. */
  update(s: ScannerSnapshot, timeoutMs: number | null, now = Date.now()): boolean {
    const st = s.status;
    const parked = st !== null && st.mode === SCAN_MODE && st.squelch.rf && s.link.stall === null;
    if (!parked || timeoutMs === null || timeoutMs <= 0) {
      this.hz = null;
      return false;
    }
    if (this.hz !== st.frequencyHz) {
      this.hz = st.frequencyHz;
      this.since = now;
      this.fired = false;
    }
    if (this.fired || now - this.since < timeoutMs) return false;
    this.fired = true;
    return true;
  }

  /** How long the scanner has sat on the current carrier, ms; null when it is not parked. */
  parkedFor(now = Date.now()): number | null {
    return this.hz === null ? null : now - this.since;
  }
}
