import { describe, expect, it } from 'vitest';
import { parseStatus } from '@trxcontroller/rcip';
import { emptySnapshot } from '../scanner/session';
import { ScanTimeout } from '../scanner/scanTimeout';
import { STATUS_DATA } from './fakeTransport';
import type { ScannerSnapshot } from '../../shared/ipc';

function snap(over: { rf?: boolean; hz?: number; mode?: number; stall?: boolean } = {}): ScannerSnapshot {
  const s = emptySnapshot();
  s.link = { status: 'connected', port: 'COM7', error: null, stall: over.stall ? { since: 0, loading: false } : null };
  const data = new Uint8Array(STATUS_DATA);
  data[0] = over.mode ?? 0x0a;
  data[1] = over.rf === false ? 0 : 3;
  const hz = over.hz ?? 456_350_000;
  data[11] = hz & 0xff; data[12] = (hz >> 8) & 0xff; data[13] = (hz >> 16) & 0xff; data[14] = (hz >>> 24) & 0xff;
  s.status = parseStatus(data);
  return s;
}

describe('ScanTimeout', () => {
  it('fires once after the limit on one carrier, then not again until the squelch closes', () => {
    const t = new ScanTimeout();
    expect(t.update(snap(), 10_000, 0)).toBe(false);
    expect(t.update(snap(), 10_000, 9_999)).toBe(false);
    expect(t.parkedFor(9_999)).toBe(9_999);
    expect(t.update(snap(), 10_000, 10_000)).toBe(true);
    expect(t.update(snap(), 10_000, 25_000)).toBe(false);
    // Squelch closes, opens again on the same frequency: the clock restarts.
    expect(t.update(snap({ rf: false }), 10_000, 26_000)).toBe(false);
    expect(t.parkedFor(26_000)).toBeNull();
    expect(t.update(snap(), 10_000, 30_000)).toBe(false);
    expect(t.update(snap(), 10_000, 39_000)).toBe(false);
    expect(t.update(snap(), 10_000, 40_000)).toBe(true);
  });

  it('restarts the clock when the frequency changes', () => {
    const t = new ScanTimeout();
    t.update(snap({ hz: 1_000_000 }), 10_000, 0);
    expect(t.update(snap({ hz: 2_000_000 }), 10_000, 9_000)).toBe(false);
    expect(t.update(snap({ hz: 2_000_000 }), 10_000, 18_000)).toBe(false);
    expect(t.update(snap({ hz: 2_000_000 }), 10_000, 19_000)).toBe(true);
  });

  it('never fires outside Scan mode, while the scanner is stalled, or when switched off', () => {
    const t = new ScanTimeout();
    expect(t.update(snap({ mode: 0x12 }), 10_000, 0)).toBe(false);
    expect(t.update(snap({ mode: 0x12 }), 10_000, 60_000)).toBe(false);
    expect(t.update(snap({ stall: true }), 10_000, 70_000)).toBe(false);
    expect(t.update(snap({ stall: true }), 10_000, 90_000)).toBe(false);
    expect(t.update(snap(), null, 100_000)).toBe(false);
    expect(t.update(snap(), null, 200_000)).toBe(false);
    expect(t.update(snap(), 0, 300_000)).toBe(false);
    // Switched on mid-stop: the clock starts then, not from the first opening.
    expect(t.update(snap(), 10_000, 300_000)).toBe(false);
    expect(t.update(snap(), 10_000, 309_000)).toBe(false);
    expect(t.update(snap(), 10_000, 310_000)).toBe(true);
  });
});
