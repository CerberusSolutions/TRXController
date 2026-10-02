import { describe, expect, it } from 'vitest';
import { CALL_OPEN_MS, EMPTY_FEED, parseDsdEventLine, reduceDsdEvent, type DsdEvent, type DsdFeed } from '../dsd';
import { parseDsdGroups } from '../dsdRadios';

// Lines from a real DSDPlus.event (DSD+ 2.523), 1-2 Oct 2026.
const P25 = [
  '2026/10/01  18:42:15  DSD+ 2.523 / Fast Lane Release',
  '2026/10/01  18:42:16  Alias server returned talker alias "CRO SFS 007" for BEE00.169-16734046',
  '2026/10/01  18:42:32  NAC=167  Current site:  2.7',
  '2026/10/01  18:42:32  NAC=167  Current network:  BEE00.169  USAF Bases United Kingdom',
  '2026/10/01  18:42:32  NAC=167  Current site:  BEE00.169-2.7  RAF Croughton',
  '2026/10/01  18:59:01  NAC=167  Enc Group call; TG=63354  RID=16734081  Ch=418.875  Alg=AES  KeyID=1405 (5125)',
  '2026/10/01  18:59:02  NAC=167  Enc Group call; TG=63354  RID=16734081    Alg=AES  KeyID=1405 (5125)  3s',
  '2026/10/01  18:59:06  NAC=167  Enc Group call; TG=63354  RID=16734000    Alg=AES  KeyID=1405 (5125)',
  '2026/10/01  18:59:15  NAC=167  Registration; RID=16734160    ACCEPT',
  '2026/10/01  18:59:15  NAC=167  Affiliation; RID=16734160   TG=63305    ACCEPT',
  '2026/10/01  20:20:17  NAC=167  Enc Group call; TG=63354  RID=16734085 [CRO SFS 046]  Ch=419.475  Alg=AES  KeyID=1405 (5125)',
  '2026/10/01  20:20:18  NAC=167  Enc Group call; TG=63354  RID=16734085 [CRO SFS 046]    Alg=AES  KeyID=1405 (5125)  3s',
  '2026/10/02  09:42:41  NAC=167  Deregistration; RID=16734165 [CRO FIRE 10.3]',
];

const hms = (t: number): string => new Date(t).toTimeString().slice(0, 8);
const events = (lines: string[]): DsdEvent[] => lines.map((l) => parseDsdEventLine(l)!).filter(Boolean);
const feedOf = (lines: string[]): DsdFeed => events(lines).reduce(reduceDsdEvent, EMPTY_FEED);

describe('parseDsdEventLine', () => {
  it('reads a P25 grant with its channel, encryption and later its closing duration', () => {
    const grant = parseDsdEventLine(P25[5]!);
    expect(grant).toMatchObject({ kind: 'call', nac: '167', type: 'Group', enc: true, tg: 63354, rid: 16734081, channel: '418.875', hz: 418_875_000, alg: 'AES', keyId: '1405', durationS: null });
    expect(new Date((grant as { at: number }).at).getHours()).toBe(18);
    expect(parseDsdEventLine(P25[6]!)).toMatchObject({ kind: 'call', tg: 63354, rid: 16734081, channel: null, hz: null, durationS: 3 });
    expect(parseDsdEventLine(P25[10]!)).toMatchObject({ kind: 'call', rid: 16734085, alias: 'CRO SFS 046', hz: 419_475_000 });
  });

  it('reads DMR, NXDN, D-Star and private-call forms', () => {
    expect(parseDsdEventLine('2026/10/02  09:10:20  DCC=12  RAS  Group call; TG=69  RID=1430   Slot=2  6s')).toMatchObject({ kind: 'call', dcc: 12, nac: null, tg: 69, rid: 1430, slot: 2, durationS: 6, channel: null, enc: false });
    expect(parseDsdEventLine('2025/09/10  14:50:23  DCC=9  Enc TXI Group call; TG=7  RID=704  Ch=3  4s')).toMatchObject({ kind: 'call', enc: true, flags: ['TXI'], channel: '3', hz: null, durationS: 4 });
    expect(parseDsdEventLine('2024/08/10  09:57:17  Bcast Group call; TG=235500  RID=235208  Ch=1625')).toMatchObject({ kind: 'call', flags: ['Bcast'], tg: 235500, channel: '1625', hz: null });
    expect(parseDsdEventLine('2024/08/10  09:57:30  Private call; Tgt=362571  Src=366256  Ch=1643')).toMatchObject({ kind: 'call', type: 'Private', target: 362571, rid: 366256, channel: '1643' });
    expect(parseDsdEventLine('2025/01/23  16:41:50  DCC=0  Emerg Private call; Tgt=5999  Src=360453   Slot=1  6s')).toMatchObject({ kind: 'call', type: 'Private', emergency: true, target: 5999, rid: 360453, slot: 1, durationS: 6 });
    expect(parseDsdEventLine('2025/10/12  10:05:28  Voice call; Tgt=**********  Src=M0JKT    1s')).toMatchObject({ kind: 'call', type: 'Voice', callsign: 'M0JKT', rid: null, durationS: 1 });
    expect(parseDsdEventLine('2025/07/05  09:15:16  RAN=1  Registration; RID=352   TG=4    ACCEPTED')).toMatchObject({ kind: 'registration', rid: 352, tg: 4, accepted: true });
  });

  it('reads site, network, alias, registration and start lines, and leaves the rest as other', () => {
    expect(parseDsdEventLine(P25[0]!)).toMatchObject({ kind: 'start', version: '2.523' });
    expect(parseDsdEventLine(P25[1]!)).toMatchObject({ kind: 'alias', network: 'BEE00.169', rid: 16734046, alias: 'CRO SFS 007' });
    expect(parseDsdEventLine(P25[3]!)).toMatchObject({ kind: 'network', id: 'BEE00.169', name: 'USAF Bases United Kingdom' });
    expect(parseDsdEventLine(P25[4]!)).toMatchObject({ kind: 'site', id: 'BEE00.169-2.7', name: 'RAF Croughton' });
    expect(parseDsdEventLine(P25[2]!)).toMatchObject({ kind: 'site', id: '2.7', name: '' });
    expect(parseDsdEventLine(P25[9]!)).toMatchObject({ kind: 'affiliation', rid: 16734160, tg: 63305, accepted: true, alias: null });
    expect(parseDsdEventLine(P25[12]!)).toMatchObject({ kind: 'deregistration', rid: 16734165, alias: 'CRO FIRE 10.3' });
    expect(parseDsdEventLine('2026/10/02  08:58:07  DCC=15  RAS  No data for current site found in DSDPlus.frequencies file')).toMatchObject({ kind: 'other', text: 'No data for current site found in DSDPlus.frequencies file' });
    expect(parseDsdEventLine('')).toBeNull();
    expect(parseDsdEventLine('not a line')).toBeNull();
  });
});

describe('reduceDsdEvent', () => {
  it('builds the network, site and a transmission per grant, closed by its duration line', () => {
    const feed = feedOf(P25);
    expect(feed.version).toBe('2.523');
    expect(feed.network).toEqual({ id: 'BEE00.169', name: 'USAF Bases United Kingdom', key: 'BEE00.169 USAF Bases United Kingdom' });
    // The bare "2.7" site line never replaces the named one.
    expect(feed.site).toEqual({ id: 'BEE00.169-2.7', name: 'RAF Croughton' });
    expect(feed.nac).toBe('167');
    expect(feed.calls.map((c) => [c.rid, c.hz, c.durationS, c.open])).toEqual([
      [16734085, 419_475_000, 3, false],
      // 16734000 joined on 418.875 with no grant line of its own and never got a closing line: closed as stale by the next event.
      [16734000, 418_875_000, null, false],
      [16734081, 418_875_000, 3, false],
    ]);
    expect(feed.calls[0]!.alias).toBe('CRO SFS 046');
    expect(feed.notes.map((n) => n.text)).toEqual(['Deregistration 16734165 CRO FIRE 10.3', 'Affiliation 16734160 → TG 63305', 'Registration 16734160', 'Alias for 16734046: CRO SFS 007', 'DSD+ 2.523 started']);
    expect(feed.lastEventAt).toBe(parseDsdEventLine(P25[12]!)!.at);
  });

  it('keeps a repeated note (a neighbour list) once, at its newest time', () => {
    const feed = feedOf([
      '2026/10/02  09:52:07  DCC=15  RAS  L1-15 neighbor:  Site L1-3; CC=63',
      '2026/10/02  09:52:08  DCC=15  RAS  L1-15 neighbor:  Site L1-12; CC=243',
      '2026/10/02  09:52:37  DCC=15  RAS  L1-15 neighbor:  Site L1-3; CC=63',
    ]);
    expect(feed.notes.map((n) => [hms(n.at), n.text])).toEqual([
      ['09:52:37', 'L1-15 neighbor:  Site L1-3; CC=63'],
      ['09:52:08', 'L1-15 neighbor:  Site L1-12; CC=243'],
    ]);
  });

  it('drops the old site, codes, calls and notes when DSD+ moves to another network', () => {
    const feed = feedOf([
      ...P25,
      '2026/10/02  10:20:00  DCC=15  RAS  L1-15 neighbor:  Site L1-3; CC=63',
      '2026/10/02  10:20:01  DCC=15  Current network:  L1  PTT Systems',
      '2026/10/02  10:20:01  DCC=15  Current site:  L1-15',
    ]);
    expect(feed.network).toEqual({ id: 'L1', name: 'PTT Systems', key: 'L1 PTT Systems' });
    expect(feed.site).toEqual({ id: 'L1-15', name: '' });
    expect(feed.nac).toBeNull();
    expect(feed.calls).toEqual([]);
    expect(feed.notes).toEqual([]);
    // The same network announced again keeps everything.
    const again = reduceDsdEvent(feedOf(P25), parseDsdEventLine(P25[3]!)!);
    expect(again.calls).toHaveLength(3);
    expect(again.site?.name).toBe('RAF Croughton');
  });

  it('keeps the system through DSD+ decoding voice on the control channel, and tells two systems both called L1 apart', () => {
    // TfL, 2 Oct 2026: on a Hytera site the control channel's own slots carry audio, and while DSD+ decodes it the
    // network line comes without its name and the site as a bare number.
    const tfl = [
      '2026/10/02  09:51:00  DCC=15  Current network:  L1  TfL',
      '2026/10/02  09:51:00  DCC=15  Current site:  L1-1  London Buses 139.53125c',
      '2026/10/02  09:52:00  DCC=15  Group call; TG=334084  RID=333519  Ch=1716',
      '2026/10/02  10:42:00  Current network:  L1',
      '2026/10/02  10:42:00  Current site:  1',
      '2026/10/02  10:42:35  Private call; Tgt=371931  Src=374513  Slot=2',
      '2026/10/02  10:42:36  DTMF: 41',
    ];
    const feed = feedOf(tfl);
    expect(feed.network).toEqual({ id: 'L1', name: 'TfL', key: 'L1 TfL' });
    expect(feed.site).toEqual({ id: 'L1-1', name: 'London Buses 139.53125c' });
    expect(feed.calls).toHaveLength(2);
    expect(feed.notes.map((n) => n.text)).toEqual(['DTMF: 41']);
    // A nameless network seen first takes its name from the line that brings it, without a reset.
    const late = feedOf([tfl[3]!, tfl[5]!, tfl[0]!]);
    expect(late.network).toEqual({ id: 'L1', name: 'TfL', key: 'L1 TfL' });
    expect(late.calls).toHaveLength(1);
    // Another system that also calls itself L1 is a retune.
    const moved = feedOf([...tfl, '2026/10/02  11:00:00  DCC=15  Current network:  L1  PTT Systems', '2026/10/02  11:00:00  DCC=15  Current site:  L1-15']);
    expect(moved.network).toEqual({ id: 'L1', name: 'PTT Systems', key: 'L1 PTT Systems' });
    expect(moved.site).toEqual({ id: 'L1-15', name: '' });
    expect(moved.calls).toEqual([]);
    expect(moved.notes).toEqual([]);
  });

  it('gives a channel-less call line no channel unless a call on its talkgroup is open or just ended', () => {
    // DSD+ on the TfL site, 2 Oct 2026: no Ch= on any line for an hour, the slot only.
    const feed = feedOf([
      '2026/10/02  10:32:11  Current network:  S1  TfL',
      '2026/10/02  10:32:16  Private call; Tgt=370258  Src=374502  Ch=1736',
      '2026/10/02  10:32:44  Private call; Tgt=370258  Src=374502  28s',
      '2026/10/02  10:42:35  Private call; Tgt=371931  Src=374513  Slot=2',
      '2026/10/02  10:46:09  Private call; Tgt=295487  Src=300735  Slot=1',
      '2026/10/02  10:46:15  Private call; Tgt=295487  Src=300735  Slot=1  5s',
      '2026/10/02  10:50:42  Group call; TG=333851  RID=333488  Slot=2',
      '2026/10/02  10:50:44  Group call; TG=333851  RID=333490  Slot=2',
    ]);
    expect(feed.calls.map((c) => [c.rid, c.channel, c.slot, c.durationS])).toEqual([
      [333490, null, 2, null],
      [333488, null, 2, null],
      [300735, null, 1, 5],
      [374513, null, 2, null],
      [374502, '1736', null, 28],
    ]);
  });

  it('closes a transmission that never got a closing line once it goes quiet', () => {
    const grant = parseDsdEventLine('2026/10/02  10:00:00  DCC=12  Group call; TG=69  RID=1430  Ch=306')!;
    const later = parseDsdEventLine('2026/10/02  10:01:00  DCC=12  Group call; TG=32  RID=1503  Ch=307')!;
    let feed = reduceDsdEvent(EMPTY_FEED, grant);
    expect(feed.calls[0]!.open).toBe(true);
    feed = reduceDsdEvent(feed, later);
    expect(later.at - grant.at).toBeGreaterThan(CALL_OPEN_MS);
    expect(feed.calls.map((c) => [c.tg, c.open])).toEqual([[32, true], [69, false]]);
  });

  it('starts a new transmission when the same radio is granted another channel', () => {
    const feed = feedOf([
      '2026/10/01  20:20:17  NAC=167  Enc Group call; TG=63354  RID=16734085  Ch=418.875  Alg=AES  KeyID=1405 (5125)',
      '2026/10/01  20:20:18  NAC=167  Enc Group call; TG=63354  RID=16734085  Ch=419.475  Alg=AES  KeyID=1405 (5125)',
    ]);
    expect(feed.calls.map((c) => c.hz)).toEqual([419_475_000, 418_875_000]);
  });
});

describe('parseDsdGroups', () => {
  it('reads talkgroup lines with their aliases and skips the comments', () => {
    const { groups, skipped } = parseDsdGroups(`
; DSD+ 2.523; group records
P25,       BEE00.169, 46226,      50,  Normal,       7,  2023/07/17 19:13,  "RAFC FD Disp"
P25,       BEE00.169, 63354,      50,  Normal,     418,  2026/10/02  8:54,  ""
TIIIStd,   S1,        366863,     50,  Normal,       2,  2025/09/16  7:46,  "Bus"
; 517 records; 10 aliases
`);
    expect(skipped).toBe(0);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual({ protocol: 'P25', network: 'BEE00.169', tgid: 46226, priority: 50, override: 'Normal', hits: 7, lastHeard: '2023/07/17 19:13', alias: 'RAFC FD Disp' });
    expect(groups[1]!.alias).toBe('');
    expect(groups[2]).toMatchObject({ network: 'S1', tgid: 366863, alias: 'Bus' });
  });
});
