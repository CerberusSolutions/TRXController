import { describe, expect, it } from 'vitest';
import { EMPTY_FEED, parseDsdEventLine, reduceDsdEvent, type DsdEvent, type DsdFeed } from '../dsd';
import { NOTE_REPEAT_MS, NoteThrottle, callEventRow, dsdEventsCsv, dsdMapCsv, eventRows, noteEventRow, siteEventRow, type DsdDaySummary } from '../dsdEvents';

const LINES = [
  '2026/10/01  18:42:32  NAC=167  Current network:  BEE00.169  USAF Bases United Kingdom',
  '2026/10/01  18:42:33  NAC=167  Current site:  BEE00.169-2.7  RAF Croughton',
  '2026/10/01  18:42:40  NAC=167  Registration; RID=16734160  TG=63305  ACCEPT',
  '2026/10/01  18:42:41  NAC=167  Affiliation; RID=16734160 [CRO FIRE 10.3]  TG=63305  ACCEPT',
  '2026/10/01  18:42:50  NAC=167  Enc Group call; TG=63354  RID=16734085 [CRO SFS 046]  Ch=419.475  Alg=AES  KeyID=1405',
  '2026/10/01  18:42:53  NAC=167  Enc Group call; TG=63354  RID=16734085 [CRO SFS 046]  Alg=AES  KeyID=1405 (5125)  3s',
  '2026/10/02  10:32:11  Private call; Tgt=296062  Src=300740  Ch=1735',
];
const events = (lines: string[]): DsdEvent[] => lines.map((l) => parseDsdEventLine(l)!);

describe('eventRows', () => {
  it('records nothing before the network is known, then notes and transmissions as they open and close', () => {
    const all: ReturnType<typeof eventRows>[] = [];
    let feed: DsdFeed = EMPTY_FEED;
    for (const ev of events(LINES)) {
      const next = reduceDsdEvent(feed, ev);
      all.push(eventRows(feed, next, ev));
      feed = next;
    }
    // The network and site lines are not events; the registration and affiliation are notes with the site attached.
    expect(all[0]).toEqual([]);
    expect(all[1]).toEqual([]);
    expect(all[2]).toMatchObject([{ kind: 'registration', rid: 16734160, tgid: 63305, accepted: true, network: 'BEE00.169', site: 'BEE00.169-2.7', alias: null }]);
    expect(all[3]).toMatchObject([{ kind: 'affiliation', rid: 16734160, tgid: 63305, alias: 'CRO FIRE 10.3' }]);
    // The grant opens the transmission (no end yet); the closing line updates the same key with its end and length.
    expect(all[4]).toMatchObject([{ kind: 'call', type: 'Group', tgid: 63354, rid: 16734085, hz: 419_475_000, enc: true, endedAt: null, durationS: null, alias: 'CRO SFS 046' }]);
    expect(all[5]).toMatchObject([{ kind: 'call', durationS: 3, endedAt: all[4]![0]!.at + 3000 }]);
    expect(all[5]![0]!.key).toBe(all[4]![0]!.key);
    // A private call carries its target and a bare channel number.
    expect(all[6]).toMatchObject([{ kind: 'call', type: 'Private', tgid: null, rid: 300740, target: 296062, channel: '1735', hz: null }]);
    expect(all[6]![0]!.key).toBe('BEE00.169|call|' + all[6]![0]!.at + '|Private||300740|296062|');
  });

  it('keys a transmission by its grant time and IDs, and a note by its time and radio', () => {
    const call = callEventRow({ id: 1, startedAt: 1000, lastAt: 4000, type: 'Group', enc: false, emergency: true, flags: ['Bcast'], tg: 69, rid: 1438, target: null, callsign: null, alias: null, channel: '306', hz: null, slot: 2, alg: null, keyId: null, durationS: null, open: false }, 'L1', 'L1-15');
    expect(call).toMatchObject({ key: 'L1|call|1000|Group|69|1438||', at: 1000, endedAt: 4000, flags: 'Bcast', emergency: true, slot: 2, channel: '306' });
    expect(noteEventRow({ kind: 'deregistration', at: 5000, rid: 7, alias: null }, 'L1', null)).toMatchObject({ key: 'L1|deregistration|5000|7|', kind: 'deregistration', rid: 7, tgid: null, accepted: null });
    expect(noteEventRow({ kind: 'other', at: 5000, text: 'x' }, 'L1', null)).toBeNull();
    expect(noteEventRow({ kind: 'alias', at: 6000, network: 'L1', rid: 9, alias: 'Bus 4' }, 'L1', null)).toMatchObject({ kind: 'alias', alias: 'Bus 4' });
    // A neighbour line is one row per pair of sites, a site row one per site.
    const nb = parseDsdEventLine('2026/10/02  09:52:07  DCC=15  RAS  L1-15 neighbor:  Site L1-3; CC=63')!;
    expect(nb).toMatchObject({ kind: 'neighbour', site: 'L1-15', neighbour: 'L1-3', code: 'CC=63', text: 'L1-15 neighbor:  Site L1-3; CC=63' });
    expect(noteEventRow(nb, 'L1', 'L1-15')).toMatchObject({ key: 'L1|neighbour|L1-15|L1-3', kind: 'neighbour', site: 'L1-15', peer: 'L1-3', code: 'CC=63' });
    expect(siteEventRow('L1', 'L1-15', '', 167_300_000, 'CC 15', 5000)).toMatchObject({ key: 'L1|site|L1-15', kind: 'site', site: 'L1-15', hz: 167_300_000, code: 'CC 15', alias: null, at: 5000 });
  });

  it('keeps a radio\'s repeated registration once per ten minutes, and every call', () => {
    const t = new NoteThrottle();
    const reg = (at: number, rid = 1503, tg: number | null = 32): ReturnType<typeof noteEventRow> => noteEventRow({ kind: 'registration', at, rid, alias: null, tg, accepted: true }, 'L1', null);
    expect(t.keep(reg(1000)!)).toBe(true);
    expect(t.keep(reg(1000 + 60_000)!)).toBe(false);
    expect(t.keep(reg(1000 + 60_000, 1504)!)).toBe(true);
    expect(t.keep(reg(1000 + 60_000, 1503, 33)!)).toBe(true);
    expect(t.keep(reg(1000 + NOTE_REPEAT_MS)!)).toBe(true);
    expect(t.keep(noteEventRow({ kind: 'deregistration', at: 2000, rid: 1503, alias: null }, 'L1', null)!)).toBe(true);
    const call = callEventRow({ id: 1, startedAt: 1000, lastAt: 1000, type: 'Group', enc: false, emergency: false, flags: [], tg: 69, rid: 1503, target: null, callsign: null, alias: null, channel: null, hz: null, slot: null, alg: null, keyId: null, durationS: null, open: true }, 'L1', null);
    expect(t.keep(call)).toBe(true);
    expect(t.keep(call)).toBe(true);
    // A site's neighbour list is reprinted every few seconds: one pass per pair per ten minutes.
    const nb = noteEventRow(parseDsdEventLine('2026/10/02  09:52:07  DCC=15  RAS  L1-15 neighbor:  Site L1-3; CC=63')!, 'L1', 'L1-15')!;
    expect(t.keep(nb)).toBe(true);
    expect(t.keep({ ...nb, at: nb.at + 30_000 })).toBe(false);
    expect(t.keep({ ...nb, at: nb.at + NOTE_REPEAT_MS })).toBe(true);
    t.reset();
    expect(t.keep(reg(1000)!)).toBe(true);
  });

  it('writes the day as CSV with the names resolved', () => {
    const row = callEventRow({ id: 1, startedAt: new Date(2026, 9, 2, 10, 32, 11).getTime(), lastAt: 0, type: 'Group', enc: true, emergency: false, flags: [], tg: 69, rid: 1438, target: null, callsign: null, alias: 'Bus, "4"', channel: null, hz: 167_300_000, slot: 1, alg: 'AES', keyId: null, durationS: 8, open: false }, 'L1', 'L1-15');
    const csv = dsdEventsCsv([row], { tg: (t) => (t === 69 ? 'Bus Ops' : ''), radio: (r) => (r === 1438 ? 'Depot 4' : '') });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('time,ended,network,site,kind,type,tgid,talkgroup,rid,radio,target,channel,mhz,slot,enc,emergency,flags,alias,duration_s,accepted,peer,code');
    expect(lines[1]).toBe('2026-10-02 10:32:11,2026-10-02 10:32:19,L1,L1-15,call,Group,69,Bus Ops,1438,Depot 4,,,167.3000,1,1,0,,"Bus, ""4""",8,,,');
    expect(lines[2]).toBe('');
  });

  it('writes the map as one flat CSV: sites, talkgroups and radios with their partners', () => {
    const t0 = new Date(2026, 9, 2, 10, 0, 0).getTime();
    const s: DsdDaySummary = {
      network: 'L1', from: t0, to: t0 + 3600_000, calls: 3, privateCalls: 1, events: 5, hours: new Array<number>(24).fill(0),
      sites: [{ site: 'L1-15', name: '', controlHz: 167_300_000, code: 'CC 15', neighbours: [{ site: 'L1-3', code: 'CC=63' }], calls: 3, firstAt: t0, lastAt: t0 + 60_000 }],
      talkgroups: [{ tgid: 69, calls: 2, radios: 2, seconds: 12, firstAt: t0, lastAt: t0 + 60_000, enc: 0, emergency: 0, topRadios: [{ rid: 1438, calls: 1 }, { rid: 1432, calls: 1 }], hours: [] }],
      radios: [{ rid: 1438, calls: 2, seconds: 9, firstAt: t0, lastAt: t0 + 60_000, alias: 'Depot 4', topTalkgroups: [{ tgid: 69, calls: 1 }], privateWith: [{ rid: 1503, calls: 1 }], registrations: 1, affiliations: 1, affiliatedTg: 32 }],
      radiosTruncated: false,
    };
    const lines = dsdMapCsv(s, { tg: (tg) => (tg === 69 ? 'Bus Ops' : ''), radio: (rid) => (rid === 1438 ? 'Depot 4' : '') }).split('\r\n');
    expect(lines).toEqual([
      'kind,id,name,calls,radios,airtime_s,first,last,detail',
      'site,L1-15,,3,,,2026-10-02 10:00:00,2026-10-02 10:01:00,control 167.3000 · CC 15 · neighbours L1-3 (CC=63)',
      'talkgroup,69,Bus Ops,2,2,12,2026-10-02 10:00:00,2026-10-02 10:01:00,Depot 4 1; 1432 1',
      'radio,1438,Depot 4,2,,9,2026-10-02 10:00:00,2026-10-02 10:01:00,Bus Ops 1 · private 1503 1 · affiliated TG 32',
      '',
    ]);
  });
});
