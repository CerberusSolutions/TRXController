import { describe, expect, it } from 'vitest';
import { encodeFrame, Key } from '@trxcontroller/rcip';
import { CLOCK_TOLERANCE_S, ScannerSession } from '../scanner/session';
import type { ScannerSnapshot } from '../../shared/ipc';
import { FakeTransport, STATUS_DATA, defaultHandler, factoryFor } from './fakeTransport';

function waitFor(pred: () => boolean, ms = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => {
      if (pred()) return resolve();
      if (Date.now() - t0 > ms) return reject(new Error('timed out waiting'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** An `a` reply whose recording header starts at `d` (the scanner's clock, local time, little-endian stm). */
function activeReply(d: Date): Uint8Array {
  const h = new Uint8Array(320);
  const dv = new DataView(h.buffer);
  const stm = [d.getSeconds(), d.getMinutes(), d.getHours(), d.getDate(), d.getMonth(), d.getFullYear() - 1900, d.getDay(), 0, 0];
  stm.forEach((v, i) => dv.setInt16(25 + i * 2, v, true));
  [...'DMR test'].forEach((c, i) => (h[43 + i] = c.charCodeAt(0)));
  dv.setUint32(152, 456_025_000, false);
  return encodeFrame('a', [0x01, 0x40, ...h]);
}

/** The nine int16 fields of a `t` frame's data. */
function clockFields(frame: Uint8Array, little: boolean): number[] {
  const data = frame.subarray(2, 2 + 18);
  const dv = new DataView(data.buffer, data.byteOffset, 18);
  return Array.from({ length: 9 }, (_, i) => dv.getInt16(i * 2, little));
}

describe('ScannerSession', () => {
  it('sets the clock from the PC on connect when asked, little-endian first', async () => {
    const t = new FakeTransport();
    const pc = new Date(2026, 9, 1, 12, 34, 56);
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 1000, clockOnConnect: () => true, now: () => pc });
    await s.connect('COM7');
    expect(t.commands().slice(0, 2)).toEqual(['V', 't']);
    expect(clockFields(t.written[1]!, true)).toEqual([56, 34, 12, 1, 9, 126, 4, 273, 0]);
    expect(s.getSnapshot().clock).toMatchObject({ sentAt: pc.getTime(), order: 'le', verified: null });
    await s.disconnect();
  });

  it('sends the time as plain numbers, 24-hour, whatever the locale shows', async () => {
    // 18:39:07 on 1 Oct 2026: no "6:39 pm", no "18.39" or "18,39"; hour 18, minute 39, second 7.
    const t = new FakeTransport();
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 1000, clockOnConnect: () => true, now: () => new Date(2026, 9, 1, 18, 39, 7) });
    await s.connect('COM7');
    expect(clockFields(t.written[1]!, true).slice(0, 3)).toEqual([7, 39, 18]);
    await s.disconnect();
  });

  it('leaves the clock alone when the tick is off', async () => {
    const t = new FakeTransport();
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 1000, clockOnConnect: () => false });
    await s.connect('COM7');
    expect(t.commands()).not.toContain('t');
    expect(s.getSnapshot().clock.sentAt).toBeNull();
    await s.disconnect();
  });

  it('confirms the clock from the next transmission, and retries big-endian when it reads far off', async () => {
    const t = new FakeTransport();
    let pc = new Date(2026, 9, 1, 12, 0, 0);
    let scanner = new Date(2026, 9, 1, 12, 0, 3); // set correctly: the first transmission after the send reads 3 s later
    t.handler = (cmd) => (cmd.codeChar === 'a' ? activeReply(scanner) : defaultHandler(cmd));
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 5, activeEveryNCycles: 1, now: () => pc });
    await s.connect('COM7');
    await s.setClock();
    pc = new Date(pc.getTime() + 5000);
    await waitFor(() => s.getSnapshot().clock.verified !== null);
    expect(s.getSnapshot().clock).toMatchObject({ order: 'le', verified: true, offsetS: -2 });
    expect(s.getSnapshot().clock.scannerTime).toBe('2026-10-01T12:00:03');

    // A second send the scanner took the wrong way round: a new transmission reads hours out, so big-endian is tried.
    scanner = new Date(2026, 9, 1, 3, 15, 0);
    await s.setClock();
    pc = new Date(pc.getTime() + 5000);
    await waitFor(() => s.getSnapshot().clock.order === 'be');
    const be = t.written.filter((w) => String.fromCharCode(w[1]!) === 't')[2]!;
    expect(clockFields(be, false)[2]).toBe(12);
    expect(t.commands().filter((c) => c === 't')).toHaveLength(3);
    // Still out after that: reported as not set, with what the scanner read.
    scanner = new Date(2026, 9, 1, 3, 16, 0);
    pc = new Date(pc.getTime() + 5000);
    await waitFor(() => s.getSnapshot().clock.verified !== null);
    expect(s.getSnapshot().clock.verified).toBe(false);
    expect(Math.abs(s.getSnapshot().clock.offsetS!)).toBeGreaterThan(CLOCK_TOLERANCE_S);
    await s.disconnect();
  });

  it('connects, reads the version, and starts polling L and A', async () => {
    const t = new FakeTransport();
    const snaps: ScannerSnapshot[] = [];
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 5, onSnapshot: (x) => snaps.push(x) });
    await s.connect('COM7');
    expect(s.getSnapshot().link.status).toBe('connected');
    expect(s.getSnapshot().version?.model).toBe('TRX-1e');
    await waitFor(() => (s.getSnapshot().stats.responses ?? 0) > 6);
    const snap = s.getSnapshot();
    expect(snap.status?.frequencyHz).toBe(119775000);
    expect(snap.lcd?.lines[3]).toBe('TC NW Deps      ');
    expect(t.commands().slice(0, 3)).toEqual(['V', 'L', 'A']);
    await s.disconnect();
    expect(s.getSnapshot().link.status).toBe('disconnected');
    expect(t.closed).toBe(true);
  });

  it('polls the active channel while squelch is open', async () => {
    const t = new FakeTransport();
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 5 });
    await s.connect('COM7');
    await waitFor(() => t.commands().filter((c) => c === 'a').length >= 2);
    await s.disconnect();
  });

  it('polls the active channel only every Nth cycle while squelch is closed', async () => {
    const t = new FakeTransport();
    t.handler = (cmd) => (cmd.codeChar === 'A' ? encodeFrame('A', new Array(16).fill(0)) : defaultHandler(cmd));
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 2, activeEveryNCycles: 4 });
    await s.connect('COM7');
    await waitFor(() => t.commands().filter((c) => c === 'L').length >= 8);
    await s.disconnect();
    const cmds = t.commands();
    const l = cmds.filter((c) => c === 'L').length;
    const a = cmds.filter((c) => c === 'a').length;
    expect(a).toBeLessThan(l / 2);
    expect(a).toBeGreaterThan(0);
  });

  it('fails to connect when the scanner does not answer the version request', async () => {
    const t = new FakeTransport();
    t.handler = () => null;
    const s = new ScannerSession(factoryFor(t), { timeoutMs: 10 });
    await expect(s.connect('COM7')).rejects.toThrow(/version/);
    expect(s.getSnapshot().link.status).toBe('error');
  });

  it('applies a late LCD reply to the snapshot instead of discarding it', async () => {
    const t = new FakeTransport();
    t.delayMs = 30;
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 1000, timeoutMs: 10 });
    // Version is answered late too, so connect through a fast handler first.
    t.delayMs = 0;
    await s.connect('COM7');
    await waitFor(() => s.getSnapshot().lcd !== null);
    t.delayMs = 30;
    await s.pollOnce(false);
    expect(s.getSnapshot().stats.timeouts).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(s.getSnapshot().stats.late).toBeGreaterThan(0);
    expect(s.getSnapshot().lcd?.lines[3]).toBe('TC NW Deps      ');
    await s.disconnect();
  });

  it('reports unresponsive after repeated timeouts and recovers', async () => {
    const t = new FakeTransport();
    let mute = false;
    t.handler = (cmd) => (mute ? null : defaultHandler(cmd));
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 2, timeoutMs: 5, unresponsiveAfter: 3 });
    // (link timeoutGapMs default 150 ms keeps this test slower but realistic)
    await s.connect('COM7');
    mute = true;
    await waitFor(() => s.getSnapshot().link.status === 'unresponsive', 2000);
    mute = false;
    await waitFor(() => s.getSnapshot().link.status === 'connected', 2000);
    await s.disconnect();
  });

  it('reports a stall, flagged as a scanlist load when the last reply came from a menu', async () => {
    const t = new FakeTransport();
    let mute = false;
    // Main Menu status, then silence: what selecting Scan looks like.
    t.handler = (cmd) => (mute ? null : cmd.codeChar === 'A' ? encodeFrame('A', [0x00, ...STATUS_DATA.slice(1)]) : defaultHandler(cmd));
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 2, timeoutMs: 5, unresponsiveAfter: 3 });
    await s.connect('COM7');
    await waitFor(() => s.getSnapshot().status?.mode === 0x00);
    expect(s.getSnapshot().link.stall).toBeNull();
    mute = true;
    await waitFor(() => s.getSnapshot().link.stall !== null, 2000);
    expect(s.getSnapshot().link.stall?.loading).toBe(true);
    mute = false;
    await waitFor(() => s.getSnapshot().link.stall === null, 2000);
    expect(s.getSnapshot().link.status).toBe('connected');
    await s.disconnect();
  });

  it('a stall while scanning is not called a scanlist load', async () => {
    const t = new FakeTransport();
    let mute = false;
    t.handler = (cmd) => (mute ? null : defaultHandler(cmd));
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 2, timeoutMs: 5, unresponsiveAfter: 3 });
    await s.connect('COM7');
    await waitFor(() => s.getSnapshot().status?.mode === 0x0a);
    mute = true;
    await waitFor(() => s.getSnapshot().link.stall !== null, 2000);
    expect(s.getSnapshot().link.stall?.loading).toBe(false);
    mute = false;
    await waitFor(() => s.getSnapshot().link.stall === null, 2000);
    await s.disconnect();
  });

  it('sends a key then refreshes the display', async () => {
    const t = new FakeTransport();
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 1000 });
    await s.connect('COM7');
    const before = t.commands().length;
    await s.pressKey(Key.MENU);
    const after = t.commands().slice(before);
    expect(after[0]).toBe('K');
    expect(after).toContain('L');
    await s.disconnect();
  });

  it('splits CC Dump noise into lines', async () => {
    const t = new FakeTransport();
    const lines: string[] = [];
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 1000, onCcDump: (l) => lines.push(l) });
    await s.connect('COM7');
    t.inject('P25:T00001234:S0001:CC01:P25TSBK:00 11\r\nMOT:T0000');
    t.inject('5678:S0001:CC02:123 0 ABCD\r\n');
    await new Promise((r) => setTimeout(r, 5));
    expect(lines).toEqual(['P25:T00001234:S0001:CC01:P25TSBK:00 11', 'MOT:T00005678:S0001:CC02:123 0 ABCD']);
    await s.disconnect();
  });

  it('marks the link as error when the transport fails', async () => {
    const t = new FakeTransport();
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 1000 });
    await s.connect('COM7');
    t.fail(new Error('Access denied'));
    await waitFor(() => s.getSnapshot().link.status === 'error');
    expect(s.getSnapshot().link.error).toBe('Access denied');
  });

  it("marks the scanner off on its unsolicited 'P', and on again at the next reply", async () => {
    const t = new FakeTransport();
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 5 });
    await s.connect('COM7');
    expect(s.getSnapshot().power).toBeNull();
    t.inject(encodeFrame('P', [0]));
    await waitFor(() => s.getSnapshot().power?.on === false);
    // Polling carries on; the next answer means it is back.
    await waitFor(() => s.getSnapshot().power?.on === true);
    await s.disconnect();
    expect(s.getSnapshot().power).toBeNull();
  });
});
