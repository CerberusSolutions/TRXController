import { describe, expect, it } from 'vitest';
import { parseLcd, parseStatus } from '@trxcontroller/rcip';
import type { ScannerSnapshot } from '../../../../shared/ipc';
import { HOLD_GRACE_MS, holdDetails, identify } from '../format';

const STATUS = new Uint8Array(16);
function lcdData(lines: string[]): Uint8Array {
  const d = new Uint8Array(99).fill(0x20);
  lines.forEach((l, r) => { for (let c = 0; c < Math.min(16, l.length); c++) d[r * 16 + c] = l.charCodeAt(c); });
  return d;
}
function snap(over: { rf?: boolean; hz?: number; lcd?: string[] }): ScannerSnapshot {
  const data = new Uint8Array(STATUS);
  data[0] = 0x12;
  data[1] = over.rf === false ? 0 : 3;
  const hz = over.hz ?? 145_637_500;
  data[11] = hz & 0xff; data[12] = (hz >> 8) & 0xff; data[13] = (hz >> 16) & 0xff; data[14] = (hz >>> 24) & 0xff;
  return {
    link: { status: 'connected', port: 'COM7', error: null, stall: null },
    version: null,
    status: parseStatus(data),
    lcd: parseLcd(lcdData(over.lcd ?? ['', '-Service Search-', 'Tune Mode', 'DMR   145.637500', 'Slot:1  Color:15', 'RadioID: 2352157'])),
    active: null,
    radioUser: null,
    licences: [],
    repeaters: [],
    rr: null, rruk: null, lookups: [], confirmed: null,
    stats: { requests: 0, responses: 0, timeouts: 0, late: 0, frameErrors: 0, consecutiveTimeouts: 0, lastRttMs: null },
    updatedAt: 0,
  };
}
const RID = ['', '-Service Search-', 'Tune Mode', 'DMR   145.637500', 'Slot:1  Color:15', 'RadioID: 2352157'];
const TG = ['', '-Service Search-', 'Tune Mode', 'DMR   145.637500', 'Slot:1  Color:15', '   TGID:       9'];

describe('holdDetails', () => {
  it('keeps the TGID and radio ID together while the display alternates them', () => {
    let held = holdDetails(null, snap({ lcd: RID }), 1000);
    expect(held).toMatchObject({ radioId: 2352157, tgid: null, slot: 1, colorCode: 15 });
    held = holdDetails(held, snap({ lcd: TG }), 1200);
    expect(held).toMatchObject({ radioId: 2352157, tgid: 9, slot: 1, colorCode: 15 });
    held = holdDetails(held, snap({ lcd: RID }), 1400);
    expect(held).toMatchObject({ radioId: 2352157, tgid: 9 });
  });

  it('survives a squelch flutter but clears once the signal has been down for the grace period', () => {
    let held = holdDetails(null, snap({ lcd: TG }), 1000);
    held = holdDetails(held, snap({ lcd: TG, rf: false }), 1000 + HOLD_GRACE_MS / 2);
    expect(held?.tgid).toBe(9);
    held = holdDetails(held, snap({ lcd: TG, rf: false }), 1000 + HOLD_GRACE_MS);
    expect(held).toBeNull();
  });

  it('keeps the resolved DMR user on the polls where the display shows the TGID line', () => {
    const user = { id: 2352157, callsign: 'G8CRB', name: 'Steve', city: 'Cambridge', state: 'England', country: 'United Kingdom' };
    let held = holdDetails(null, { ...snap({ lcd: RID }), radioUser: user }, 1000);
    expect(held?.radioUser?.callsign).toBe('G8CRB');
    held = holdDetails(held, { ...snap({ lcd: TG }), radioUser: null }, 1200);
    expect(held).toMatchObject({ radioId: 2352157, tgid: 9 });
    expect(held?.radioUser?.callsign).toBe('G8CRB');
    // A different radio ID drops the stale user until main resolves the new one.
    held = holdDetails(held, { ...snap({ lcd: ['', '-Service Search-', 'Tune Mode', 'DMR   145.637500', 'Slot:1  Color:15', 'RadioID: 1234567'] }), radioUser: null }, 1400);
    expect(held).toMatchObject({ radioId: 1234567, radioUser: null });
  });

  it('starts afresh when the frequency changes', () => {
    let held = holdDetails(null, snap({ lcd: TG }), 1000);
    held = holdDetails(held, snap({ lcd: RID, hz: 145_650_000 }), 1100);
    expect(held).toMatchObject({ frequencyHz: 145_650_000, tgid: null, radioId: 2352157 });
  });

  it('feeds the held talkgroup into the search identity', () => {
    const s = snap({ lcd: RID });
    const held = holdDetails(holdDetails(null, snap({ lcd: TG }), 1000), s, 1100);
    expect(identify(null, s.lcd, s.status, held)).toMatchObject({ name: 'Tune Mode', system: 'Service Search', detail: 'TG 9' });
    expect(identify(null, s.lcd, s.status, null).detail).toBe('Direct frequency entry');
  });
});
