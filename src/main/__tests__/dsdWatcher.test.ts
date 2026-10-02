import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DsdWatcher, EVENT_FILE, GROUPS_FILE, POLL_MS, RADIOS_FILE, SEED_BYTES, SETTLE_MS } from '../dsd/watcher';
import type { DsdStatus } from '../../shared/dsd';
import type { NewRadioName } from '../../shared/radioNames';

const EVENTS = [
  '2026/10/01  18:42:15  DSD+ 2.523 / Fast Lane Release',
  '2026/10/01  18:42:32  NAC=167  Current network:  BEE00.169  USAF Bases United Kingdom',
  '2026/10/01  18:42:32  NAC=167  Current site:  BEE00.169-2.7  RAF Croughton',
  '2026/10/01  18:59:01  NAC=167  Enc Group call; TG=63354  RID=16734081  Ch=418.875  Alg=AES  KeyID=1405 (5125)',
].join('\r\n') + '\r\n';
const RADIOS = 'P25,       BEE00.169, 63354,      16734046,   50,  Normal,       9,  2026/09/19 17:48,  "", "CRO SFS 007",    0E362A72\r\nP25,       BEE00.169, 63354,      16734000,   50,  Normal,     119,  2026/10/02  8:36,  ""\r\n';
const GROUPS = 'P25,       BEE00.169, 46226,      50,  Normal,       7,  2023/07/17 19:13,  "RAFC FD Disp"\r\nP25,       BEE00.167, 63354,      50,  Normal,       1,  2024/07/17  7:02,  "Salisbury Plain Army"\r\n';
// A network DSD+ reclassified: the older lines say TIIIStd, the newer TIIInonStd, which is what its status bar shows now.
const DMR_GROUPS = 'TIIIStd,   L1,        21,         50,  Normal,      27,  2025/09/03 13:52,  ""\r\nTIIInonStd,L1,        69,         50,  Normal,     193,  2026/10/02  9:25,  ""\r\nTIIInonStd,L1,        32,         50,  Normal,      71,  2026/10/02  9:23,  ""\r\n';

describe('DsdWatcher', () => {
  let dir: string;
  let now: number;
  let named: NewRadioName[][];
  let talkgroups: [string, { tgid: number; name: string }[]][];
  let updates: { status: DsdStatus; radiosChanged: boolean }[];
  let w: DsdWatcher;
  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'dsd-'));
    now = new Date(2026, 9, 1, 18, 59, 30).getTime();
    named = [];
    talkgroups = [];
    updates = [];
    w = new DsdWatcher({
      nameRadios: (list) => (named.push(list), list.length),
      nameTalkgroups: (network, list) => (talkgroups.push([network, list]), list.length),
      systemOf: (network) => (network === 'BEE00.169' ? 'USAF Bases UK' : null),
      onChange: (status, radiosChanged) => updates.push({ status, radiosChanged }),
      now: () => now,
    });
  });
  afterEach(() => {
    w.stop();
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });
  const tick = (ms = POLL_MS): void => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  it('seeds from the tail of the event file, then follows appended lines, and reads the data files', () => {
    writeFileSync(join(dir, EVENT_FILE), EVENTS);
    writeFileSync(join(dir, RADIOS_FILE), RADIOS);
    writeFileSync(join(dir, GROUPS_FILE), GROUPS);
    w.setFolder(dir);
    let s = w.status();
    expect(s.folder).toBe(dir);
    expect(s.feed.network).toEqual({ id: 'BEE00.169', name: 'USAF Bases United Kingdom' });
    expect(s.feed.site?.name).toBe('RAF Croughton');
    expect(s.feed.calls.map((c) => c.rid)).toEqual([16734081]);
    expect(s.alive).toBe(true);
    // The radios and groups files are read at first sight: one named radio, the other network's talkgroup left out of tgNames.
    expect(named).toEqual([[{ radioId: 16734046, system: '', name: 'CRO SFS 007' }]]);
    expect(s.radios).toMatchObject({ found: true, named: 1 });
    expect(s.groups).toEqual({ found: true, count: 2 });
    expect(s.tgNames).toEqual({ 46226: 'RAFC FD Disp' });
    expect(s.system).toBe('USAF Bases UK');
    // Every network's aliases go to the log's talkgroup names, once per change of the set.
    expect(talkgroups).toEqual([['BEE00.169', [{ tgid: 46226, name: 'RAFC FD Disp' }]], ['BEE00.167', [{ tgid: 63354, name: 'Salisbury Plain Army' }]]]);
    expect(updates.some((u) => u.radiosChanged)).toBe(true);
    w.reimportGroups();
    expect(talkgroups).toHaveLength(4);

    // A line appended, and a fragment that waits for its line end.
    appendFileSync(join(dir, EVENT_FILE), '2026/10/01  18:59:02  NAC=167  Enc Group call; TG=63354  RID=16734081    Alg=AES  KeyID=1405 (5125)  3s\r\n2026/10/01  18:59:06  NAC=167  Enc Group');
    tick();
    s = w.status();
    expect(s.feed.calls[0]).toMatchObject({ rid: 16734081, durationS: 3, open: false });
    appendFileSync(join(dir, EVENT_FILE), ' call; TG=63354  RID=16734000    Alg=AES  KeyID=1405 (5125)\r\n');
    tick();
    expect(w.status().feed.calls.map((c) => c.rid)).toEqual([16734000, 16734081]);

    // DSD+ rewrites the radios file with a new alias: imported once the write has settled, and the log told.
    updates.length = 0;
    writeFileSync(join(dir, RADIOS_FILE), RADIOS.replace('""\r\n', '"", "CRO SFS 001", 12345678\r\n'));
    tick();
    expect(named).toHaveLength(1);
    tick(SETTLE_MS);
    expect(named).toHaveLength(2);
    expect(named[1]).toEqual([
      { radioId: 16734046, system: '', name: 'CRO SFS 007' },
      { radioId: 16734000, system: '', name: 'CRO SFS 001' },
    ]);
    expect(updates.some((u) => u.radiosChanged)).toBe(true);
    // The same content written again is not re-imported.
    writeFileSync(join(dir, RADIOS_FILE), RADIOS.replace('""\r\n', '"", "CRO SFS 001", 12345678\r\n') + '\r\n');
    tick();
    tick(SETTLE_MS);
    expect(named).toHaveLength(2);

    // Quiet for two minutes: no longer alive, and said so once.
    updates.length = 0;
    tick(130_000);
    expect(w.status().alive).toBe(false);
    expect(updates.length).toBeGreaterThan(0);
  });

  it('finds the network and site lines beyond the tail window on a chatty DMR site', () => {
    const chatter = Array.from({ length: 4000 }, (_, i) => `2026/10/02  09:${String(Math.floor(i / 100)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}  DCC=15  RAS  NAK: REGISTRATION DENIED  Tgt=${400 + (i % 50)}  Src=REGI`).join('\r\n');
    expect(chatter.length).toBeGreaterThan(SEED_BYTES);
    writeFileSync(
      join(dir, EVENT_FILE),
      ['2026/10/02  08:58:00  NAC=167  Current network:  L1  PTT Systems', '2026/10/02  08:58:00  NAC=167  Current site:  L1-4.3', '2026/10/02  08:58:06  Current site:  L1-15', chatter, '2026/10/02  09:48:52  DCC=15  RAS  Group call; TG=69  RID=1425  Ch=306', ''].join('\r\n'),
    );
    w.setFolder(dir);
    const s = w.status();
    expect(s.feed.network).toEqual({ id: 'L1', name: 'PTT Systems' });
    expect(s.feed.site).toEqual({ id: 'L1-15', name: '' });
    expect(s.protocol).toBeNull();
    // The groups file names the protocol: the newest line's, since DSD+ reclassified the site.
    writeFileSync(join(dir, GROUPS_FILE), DMR_GROUPS);
    tick();
    expect(w.status().protocol).toBe('TIIInonStd');
    expect(s.feed.dcc).toBe(15);
    expect(s.feed.calls.map((c) => [c.tg, c.channel])).toEqual([[69, '306']]);
  });

  it('copes with an empty folder, a truncated event file and switching off', () => {
    w.setFolder(dir);
    expect(w.status()).toMatchObject({ event: { found: false }, radios: { found: false }, alive: false, error: null });
    writeFileSync(join(dir, EVENT_FILE), EVENTS);
    tick();
    expect(w.status().event.found).toBe(true);
    expect(w.status().feed.calls).toHaveLength(1);
    // Replaced by a shorter file (DSD+ restarted with a fresh log): read from the top again.
    writeFileSync(join(dir, EVENT_FILE), '2026/10/01  19:00:00  NAC=167  Group call; TG=1  RID=104  Ch=418.875\r\n');
    tick();
    expect(w.status().feed.calls.map((c) => c.tg)).toEqual([1, 63354]);
    w.setFolder(null);
    expect(w.status()).toMatchObject({ folder: null, feed: { calls: [] } });
  });
});
