import { describe, expect, it } from 'vitest';
import { encodeFrame, getLcd, getStatus, getVersion, sendKey, Key } from '@trxcontroller/rcip';
import { ScannerLink } from '../scanner/link';
import { FakeTransport } from './fakeTransport';

describe('ScannerLink', () => {
  it('resolves a request with the matching response frame', async () => {
    const t = new FakeTransport();
    const link = new ScannerLink(t);
    const f = await link.request(getStatus(), 'A');
    expect(f?.codeChar).toBe('A');
    expect(f?.data.length).toBe(16);
    expect(link.stats.responses).toBe(1);
    expect(link.stats.lastRttMs).not.toBeNull();
  });

  it('reassembles responses delivered in small chunks', async () => {
    const t = new FakeTransport();
    t.chunkSize = 7;
    const link = new ScannerLink(t);
    const f = await link.request(getLcd(), 'L');
    expect(f?.data.length).toBe(99);
  });

  it('serialises concurrent requests in call order', async () => {
    const t = new FakeTransport();
    t.delayMs = 5;
    const link = new ScannerLink(t);
    const [v, a, l] = await Promise.all([link.request(getVersion(), 'V'), link.request(getStatus(), 'A'), link.request(getLcd(), 'L')]);
    expect([v?.codeChar, a?.codeChar, l?.codeChar]).toEqual(['V', 'A', 'L']);
    expect(t.commands()).toEqual(['V', 'A', 'L']);
  });

  it('times out when the scanner does not answer and recovers afterwards', async () => {
    const t = new FakeTransport();
    let mute = true;
    const base = t.handler;
    t.handler = (cmd) => (mute ? null : base(cmd));
    const link = new ScannerLink(t, { timeoutMs: 20 });
    expect(await link.request(getStatus(), 'A')).toBeNull();
    expect(link.stats.timeouts).toBe(1);
    expect(link.stats.consecutiveTimeouts).toBe(1);
    mute = false;
    expect((await link.request(getStatus(), 'A'))?.codeChar).toBe('A');
    expect(link.stats.consecutiveTimeouts).toBe(0);
  });

  it('discards a late response to a timed-out request', async () => {
    const t = new FakeTransport();
    t.delayMs = 40;
    const unexpected: string[] = [];
    const link = new ScannerLink(t, { timeoutMs: 10, onUnexpectedFrame: (f) => unexpected.push(f.codeChar) });
    expect(await link.request(getStatus(), 'A')).toBeNull();
    await new Promise((r) => setTimeout(r, 60));
    expect(unexpected).toEqual(['A']);
  });

  it('routes non-frame bytes to onNoise', async () => {
    const t = new FakeTransport();
    const noise: string[] = [];
    const link = new ScannerLink(t, { onNoise: (b) => noise.push(new TextDecoder().decode(b)) });
    t.inject('P25:T00001234:S0001:CC01:P25TSBK:00 11 22\r\n');
    await link.request(getStatus(), 'A');
    expect(noise.join('')).toContain('P25TSBK');
  });

  it('send() writes no-response commands and rejects request-type codes', async () => {
    const t = new FakeTransport();
    const link = new ScannerLink(t, { sendGapMs: 1 });
    await link.send(sendKey(Key.MENU));
    expect(t.commands()).toEqual(['K']);
    expect(() => link.send(getStatus())).toThrow(/no-response/);
  });

  it('counts frame errors and keeps going', async () => {
    const t = new FakeTransport();
    const errors: string[] = [];
    const link = new ScannerLink(t, { onFrameError: (m) => errors.push(m) });
    const bad = encodeFrame('P', [1]);
    bad[bad.length - 1] ^= 0xff;
    t.inject(bad);
    const f = await link.request(getStatus(), 'A');
    expect(f?.codeChar).toBe('A');
    expect(errors.length).toBeGreaterThan(0);
    expect(link.stats.frameErrors).toBeGreaterThan(0);
  });

  it('resolves pending requests with null on close', async () => {
    const t = new FakeTransport();
    t.handler = () => null;
    const link = new ScannerLink(t, { timeoutMs: 1000 });
    const p = link.request(getStatus(), 'A');
    await link.close();
    expect(await p).toBeNull();
    expect(t.closed).toBe(true);
  });
});
