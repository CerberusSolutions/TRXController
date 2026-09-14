import { describe, expect, it } from 'vitest';
import { encodeFrame, Key } from '@trxcontroller/rcip';
import { ScannerSession } from '../scanner/session';
import type { ScannerSnapshot } from '../../shared/ipc';
import { FakeTransport, defaultHandler, factoryFor } from './fakeTransport';

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

describe('ScannerSession', () => {
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

  it('reports unresponsive after repeated timeouts and recovers', async () => {
    const t = new FakeTransport();
    let mute = false;
    t.handler = (cmd) => (mute ? null : defaultHandler(cmd));
    const s = new ScannerSession(factoryFor(t), { pollIntervalMs: 2, timeoutMs: 5, unresponsiveAfter: 3 });
    await s.connect('COM7');
    mute = true;
    await waitFor(() => s.getSnapshot().link.status === 'unresponsive', 2000);
    mute = false;
    await waitFor(() => s.getSnapshot().link.status === 'connected', 2000);
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
});
