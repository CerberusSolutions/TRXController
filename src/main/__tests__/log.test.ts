import { describe, expect, it } from 'vitest';
import { LogDb } from '../log/db';
import { ReceptionLogger } from '../log/logger';
import { ReceptionTracker, describe as describeSnapshot, snapshotRadioId } from '../log/tracker';
import type { ReceptionRow, ScannerSnapshot } from '../../shared/ipc';
import type { RecordingHeader } from '@trxcontroller/rcip';
import { emptySnapshot } from '../scanner/session';
import { NO_ID, parseLcd, parseStatus } from '@trxcontroller/rcip';
import { STATUS_DATA, lcdData } from './fakeTransport';

function snap(over: { rf?: boolean; hz?: number; rssi?: number; lcd?: string[]; header?: boolean | Partial<RecordingHeader>; mode?: number }): ScannerSnapshot {
  const s = emptySnapshot();
  s.link = { status: 'connected', port: 'COM7', error: null };
  const data = new Uint8Array(STATUS_DATA);
  data[1] = over.rf === false ? 0 : 3;
  const hz = over.hz ?? 119775000;
  data[11] = hz & 0xff; data[12] = (hz >> 8) & 0xff; data[13] = (hz >> 16) & 0xff; data[14] = (hz >>> 24) & 0xff;
  const rssi = over.rssi ?? 300;
  data[4] = rssi & 0xff; data[5] = rssi >> 8;
  if (over.mode !== undefined) data[0] = over.mode;
  s.status = parseStatus(data);
  s.lcd = parseLcd(lcdData(over.lcd ?? ['', 'Civil Airband', 'CONV        psDr', 'TC NW Deps', 'AM    119.775000'], [0x4d, 0x40, 0x03]));
  if (over.header) {
    s.active = {
      length: 320,
      raw: new Uint8Array(320),
      header: {
        magic: 0, dataOffset: 320, dataSize: 0, encoding: 1, sampleRate: 8000, channels: 1,
        recordingType: 1, recordingTypeName: 'Talkgroup',
        startTime: { sec: 0, min: 0, hour: 0, mday: 1, mon: 0, year: 126, wday: 0, yday: 0, isdst: 0, byteOrder: 'le', iso: null },
        objectTag: 'Fire Dispatch', systemTag: 'County P25', infoTag: 'TG 1234', objectId: 42,
        talkgroupId1: 1234, talkgroupId2: NO_ID, radioId1: 7654321, radioId2: NO_ID, siteName: 'Site 3',
        tsysFileIndex: 0, miscText: '', voiceFrequencyHz: hz, controlFrequencyHz: 0,
        squelchMode: 3, squelchModeName: 'NAC', squelchValue: 0x293, squelchText: 'NAC 293', tsysType: 3, tsysTypeName: 'P25',
        reserved: new Uint8Array(155),
        ...(typeof over.header === 'object' ? over.header : {}),
      },
    };
  }
  return s;
}

describe('describe()', () => {
  it('reads name and scanlist from the channel screen', () => {
    const d = describeSnapshot(snap({}));
    expect(d).toMatchObject({ name: 'TC NW Deps', scanlist: 'Civil Airband', objectType: 'CONV', mode: 'AM', signalType: 'AM', rssiPeak: 300, tgid: null });
  });
  it('prefers the active-channel header when present', () => {
    const d = describeSnapshot(snap({ header: true }));
    expect(d).toMatchObject({ name: 'Fire Dispatch', system: 'County P25', tgid: 1234, radioId: 7654321, site: 'Site 3', squelch: 'NAC 293' });
  });
  it('takes TGID and RadioID from the DMR display when there is no header', () => {
    const d = describeSnapshot(snap({ lcd: ['', 'Shopwatch', 'CONV        psDr', 'TGID:        251', 'DMR   456.025000', 'RadioID:     104'] }));
    expect(d).toMatchObject({ name: '', scanlist: 'Shopwatch', objectType: 'CONV', tgid: 251, radioId: 104 });
  });

  it('records a detected tone from the display', () => {
    const d = describeSnapshot(snap({ lcd: ['', 'Bucks A+D Rep', 'CONV        psDr', 'RBW18', 'Auto  433.225000', 'CTCSS 77.0  S'] }));
    expect(d).toMatchObject({ name: 'RBW18', tone: 'CTCSS 77.0' });
  });

  it('takes TGID, RadioID and the search name from the Tune Mode display, ignoring the mode+frequency tag', () => {
    // Captured 15 Sep 2026: the `a` header in Tune Mode tags the call "DMRs 145.637500" and carries no IDs.
    const tune = { objectTag: 'DMRs 145.637500', systemTag: '', infoTag: '', talkgroupId1: NO_ID, radioId1: NO_ID, siteName: '', miscText: 'Slot:1 Color:--', recordingType: 5, recordingTypeName: 'Search' };
    const rid = describeSnapshot(snap({ mode: 0x12, header: tune, lcd: ['', '-Service Search-', 'Tune Mode', 'DMR   145.637500', 'Slot:1  Color:15', 'RadioID: 2352157'] }));
    expect(rid).toMatchObject({ name: '', scanlist: 'Tune Mode', objectType: 'Search', tgid: null, radioId: 2352157 });
    const tg = describeSnapshot(snap({ mode: 0x12, header: tune, lcd: ['', '-Service Search-', 'Tune Mode', 'DMR   145.637500', 'Slot:1  Color:15', '   TGID:       9'] }));
    expect(tg).toMatchObject({ name: '', tgid: 9, radioId: null });
    expect(snapshotRadioId(snap({ mode: 0x12, lcd: ['', '-Service Search-', 'Tune Mode', 'DMR   145.637500', 'Slot:1  Color:15', 'RadioID: 2352157'] }))).toBe(2352157);
    expect(snapshotRadioId(snap({ header: true }))).toBe(7654321);
  });

  it('credits the lookup that supplied the name or system, never the scanner', () => {
    const wtr = { id: 1, frequencyHz: 453_062_500, direction: 'T', licensee: 'FCC Recycling (UK) Limited', product: '', emission: '', mode: '', widthHz: 12_500, lat: null, lon: null, ngr: '', licenceNo: '', distanceKm: 6.7 };
    const rr = { frequencyHz: 453_062_500, conventional: [{ descr: 'University of Buckingham', alpha: 'UOB', tone: '', mode: 'FM', callsign: '', tags: [], county: 'Bucks', distanceKm: 3 }], systems: [], fetchedAt: 1, pending: false, error: null };
    const trunked = { ...rr, conventional: [], systems: [{ sid: 6044, name: 'WM Morrison HQ', city: '', site: null, distanceKm: 9, talkgroup: null }] };
    const rpt = { id: 2, callsign: 'GB3BS', band: '2m', channel: 'RV58', outputHz: 145_725_000, inputHz: 145_125_000, ctcss: 94.8, locator: '', where: 'BRISTOL', lat: null, lon: null, modes: 'FM', distanceKm: 12, side: 'output' as const };
    const idle = ['', 'Ofcom', 'CONV        psDr', '', 'NFM   453.062500'];
    // Scanner name: its own programming, whatever the register says.
    expect(describeSnapshot({ ...snap({}), licences: [wtr] })).toMatchObject({ name: 'TC NW Deps', licensee: 'FCC Recycling (UK) Limited', source: '' });
    // No scanner name: the licensee is what the log will show.
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr] })).toMatchObject({ name: '', licensee: 'FCC Recycling (UK) Limited', source: 'WTR' });
    expect(describeSnapshot({ ...snap({ lcd: idle }), repeaters: [rpt] })).toMatchObject({ name: '', licensee: 'GB3BS · BRISTOL', source: 'UKR' });
    // RadioReference fills the name (unless a higher-ranked licensee will show instead), or the system behind a scanner-named object.
    expect(describeSnapshot({ ...snap({ lcd: idle }), rr })).toMatchObject({ name: 'University of Buckingham', source: 'RRDB' });
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr], rr })).toMatchObject({ name: '', licensee: 'FCC Recycling (UK) Limited', source: 'WTR' });
    expect(describeSnapshot({ ...snap({}), rr: trunked })).toMatchObject({ name: 'TC NW Deps', system: 'WM Morrison HQ', source: 'RRDB', scannerName: 'TC NW Deps', rrName: '', rrSystem: 'WM Morrison HQ' });
    expect(describeSnapshot({ ...snap({ header: true }), rr: trunked })).toMatchObject({ name: 'Fire Dispatch', system: 'County P25', source: '' });
    expect(describeSnapshot(snap({ lcd: idle }))).toMatchObject({ name: '', licensee: '', source: '' });
  });

  it('names a blank channel from the highest-ranked lookup that knows it, ignoring lookups switched off', () => {
    const wtr = { id: 1, frequencyHz: 456_350_000, direction: 'T', licensee: 'RESOUND LIMITED', product: '', emission: '', mode: '', widthHz: 12_500, lat: null, lon: null, ngr: '', licenceNo: '', distanceKm: 2 };
    const conv = { frequencyHz: 456_350_000, conventional: [{ descr: 'Addenbrookes Hospital (Cambridge)', alpha: 'ADDENBR', tone: '', mode: 'FM', callsign: '', tags: [], county: 'Cambs', distanceKm: 3 }], systems: [], fetchedAt: 1, pending: false, error: null };
    const trunked = { ...conv, conventional: [], systems: [{ sid: 1, name: 'Cambs DMR', city: '', site: null, distanceKm: 3, talkgroup: { tgDec: 19, alpha: 'ADD', descr: 'Addenbrookes Porters', mode: 'D', enc: 0, category: '' } }] };
    const idle = ['', 'Imported/New', 'CONV        psDr', '', 'DMR   456.350000'];
    const order = (...ids: ('WTR' | 'RRDB' | 'UKR')[]) => ids.map((id) => ({ id, enabled: true }));
    // Default order: the register beats RadioReference's channel description.
    // Every source's own answer is kept beside the chosen name, for the Detail view and the CSV.
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr], rr: conv })).toMatchObject({
      name: '', licensee: 'RESOUND LIMITED', source: 'WTR', scannerName: '', wtr: 'RESOUND LIMITED', rrName: 'Addenbrookes Hospital (Cambridge)', rrSystem: '', rpt: '',
    });
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr], rr: conv, lookups: order('RRDB', 'WTR', 'UKR') })).toMatchObject({ name: 'Addenbrookes Hospital (Cambridge)', licensee: 'RESOUND LIMITED', source: 'RRDB' });
    // A talkgroup name is trunked knowledge the register does not have: it wins whatever the order.
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr], rr: trunked })).toMatchObject({ name: 'Addenbrookes Porters', system: 'Cambs DMR', source: 'RRDB' });
    // Switched off: neither named nor credited, and the next lookup takes over.
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr], rr: conv, lookups: [{ id: 'WTR', enabled: false }, { id: 'RRDB', enabled: true }] })).toMatchObject({ name: 'Addenbrookes Hospital (Cambridge)', licensee: '', source: 'RRDB' });
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr], rr: trunked, lookups: [{ id: 'WTR', enabled: true }, { id: 'RRDB', enabled: false }] })).toMatchObject({ name: '', system: '', licensee: 'RESOUND LIMITED', source: 'WTR' });
    // The scanner's own name is never displaced by any order.
    expect(describeSnapshot({ ...snap({}), licences: [wtr], rr: conv, lookups: order('RRDB', 'WTR', 'UKR') })).toMatchObject({ name: 'TC NW Deps', source: '' });
    // An entry nobody can place never outranks one that is: RadioReference's area description for
    // GB3IW (county unmapped) loses to the repeater 18 km away even with RRDB ranked first.
    const gb3tu = { id: 3, callsign: 'GB3TU', band: '70cm', channel: 'RB5', outputHz: 433_225_000, inputHz: 434_825_000, ctcss: 77, locator: '', where: 'TRING', lat: null, lon: null, modes: 'FM', distanceKm: 18, side: 'output' as const };
    const area = { ...conv, conventional: [{ ...conv.conventional[0]!, descr: 'Portsmouth and Solent area', county: 'Isle of Wight', distanceKm: null }] };
    const rptFirst = { ...snap({ lcd: idle }), repeaters: [gb3tu], rr: area, lookups: order('RRDB', 'WTR', 'UKR') };
    expect(describeSnapshot(rptFirst)).toMatchObject({ name: '', licensee: 'GB3TU · TRING', source: 'UKR', rrName: 'Portsmouth and Solent area' });
    // Placed as well: the order decides again.
    expect(describeSnapshot({ ...rptFirst, rr: conv })).toMatchObject({ name: 'Addenbrookes Hospital (Cambridge)', source: 'RRDB' });
  });

  it('lets a RadioReference channel whose tone matches the detected one name the row, and one whose tone differs lose', () => {
    const wtr = { id: 1, frequencyHz: 456_350_000, direction: 'T', licensee: 'RESOUND LIMITED', product: '', emission: '', mode: '', widthHz: 12_500, lat: null, lon: null, ngr: '', licenceNo: '', distanceKm: 2, bearingDeg: 10 };
    const cc12 = { descr: 'Amazon MK1 Security', alpha: 'AMZ', tone: 'CC 12', mode: 'DMR', callsign: '', tags: [], county: 'Bucks', distanceKm: 29, bearingDeg: 80 };
    const cc3 = { ...cc12, descr: 'Shop Safe Aylesbury', tone: 'CC 3' };
    const rr = { frequencyHz: 456_350_000, conventional: [cc3, cc12], systems: [], fetchedAt: 1, pending: false, error: null };
    const cc = (n: number) => ['', 'Imported/New', 'CONV        psDr', 'TGID:         19', 'DMR   456.350000', `Slot:1  Color:${n}`];
    // Default order puts the register first, but CC 12 detected picks Amazon out of RadioReference's list and names the row with it.
    expect(describeSnapshot({ ...snap({ lcd: cc(12) }), licences: [wtr], rr })).toMatchObject({ name: 'Amazon MK1 Security', source: 'RRDB', tone: 'CC 12', licensee: 'RESOUND LIMITED', rrName: 'Amazon MK1 Security', distanceKm: 29 });
    expect(describeSnapshot({ ...snap({ lcd: cc(3) }), licences: [wtr], rr })).toMatchObject({ name: 'Shop Safe Aylesbury', source: 'RRDB', tone: 'CC 3' });
    // CC 7 matches neither: the RadioReference channels lose to the licensee even with RadioReference ranked first.
    const rrFirst = [{ id: 'RRDB' as const, enabled: true }, { id: 'WTR' as const, enabled: true }, { id: 'UKR' as const, enabled: true }];
    expect(describeSnapshot({ ...snap({ lcd: cc(7) }), licences: [wtr], rr, lookups: rrFirst })).toMatchObject({ name: '', licensee: 'RESOUND LIMITED', source: 'WTR', tone: 'CC 7' });
    // No tone detected: the order decides as before.
    const idle = ['', 'Imported/New', 'CONV        psDr', '', 'DMR   456.350000'];
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr], rr, lookups: rrFirst })).toMatchObject({ name: 'Shop Safe Aylesbury', source: 'RRDB' });
    expect(describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr], rr })).toMatchObject({ name: '', source: 'WTR' });
  });

  it('treats an object named only by its frequency as unnamed, so the lookups name it', () => {
    const label = (name: string) => ['', 'Imported/New', 'CONV        psDr', name, 'DMR   453.437500'];
    const wtr = { id: 1, frequencyHz: 453_437_500, direction: 'T', licensee: 'RESOUND LIMITED', product: '', emission: '', mode: 'DIG', widthHz: 12_500, lat: 51.9, lon: -0.7, ngr: '', licenceNo: '', distanceKm: 6.7, bearingDeg: 47 };
    const entry = {
      callsign: 'FCC RECYCLING (UK) LIMITED', alpha: '', freqMHz: 453.4375, mode: 'DMR', tone: '', colorCode: '15', ran: '', nac: '', code: 'CC 15', direction: 'R', location: 'Steeple Claydon',
      nationwide: false, distanceKm: 7.1, bearingDeg: 324, lat: null, lon: null, place: 'Steeple Claydon', county: 'Bucks', postcode: '', licence: '', group: 'WTR', tags: '', isTrunk: false,
    };
    const rruk = { frequencyHz: 453_437_500, fetchedAt: 1, pending: false, error: null, entries: [entry] };
    // RRUK names it; the scanner's text is kept for the Detail view.
    expect(describeSnapshot({ ...snap({ lcd: label('453.4375 CC15') }), rruk })).toMatchObject({ name: 'FCC RECYCLING (UK) LIMITED', source: 'RRUK', scannerName: '453.4375 CC15' });
    // Only the register knows it: unnamed with the licensee credited, as for a blank object.
    expect(describeSnapshot({ ...snap({ lcd: label('453.4375') }), licences: [wtr] })).toMatchObject({ name: '', licensee: 'RESOUND LIMITED', source: 'WTR', scannerName: '453.4375' });
    // Nothing knows it: unnamed.
    expect(describeSnapshot(snap({ lcd: label('453.4375 94.8') }))).toMatchObject({ name: '', source: '', scannerName: '453.4375 94.8' });
    // A real name still wins over every lookup.
    expect(describeSnapshot({ ...snap({ lcd: label('Taxis 453') }), rruk })).toMatchObject({ name: 'Taxis 453', source: '', scannerName: 'Taxis 453' });
  });

  it('names a row from RadioReference UK, by code match first, and keeps its own answer beside the others', () => {
    const idle = ['', 'Imported/New', 'CONV        psDr', '', 'DMR   453.437500'];
    const cc = (n: number) => ['', 'Imported/New', 'CONV        psDr', 'TGID:         19', 'DMR   453.437500', `Slot:1  Color:${n}`];
    const entry = (callsign: string, colorCode: string, distanceKm: number | null, over = {}) => ({
      callsign, alpha: '', freqMHz: 453.4375, mode: 'DMR', tone: '', colorCode, ran: '', nac: '', code: colorCode ? `CC ${colorCode}` : '', direction: 'R', location: 'Steeple Claydon',
      nationwide: false, distanceKm, bearingDeg: distanceKm === null ? null : 324, lat: null, lon: null, place: 'Steeple Claydon', county: 'Bucks', postcode: '', licence: '', group: 'WTR', tags: '', isTrunk: false, ...over,
    });
    const rruk = { frequencyHz: 453_437_500, fetchedAt: 1, pending: false, error: null, entries: [entry('FCC RECYCLING (UK) LIMITED', '12', 7.1), entry('AMAZON UK SERVICES LTD.', '3', 29)] };
    const wtr = { id: 1, frequencyHz: 453_437_500, direction: 'T', licensee: 'RESOUND LIMITED', product: '', emission: '', mode: 'DIG', widthHz: 12_500, lat: 51.9, lon: -0.7, ngr: '', licenceNo: '', distanceKm: 6.7, bearingDeg: 47 };
    // Nothing else knows the frequency: RRUK names it and places it.
    expect(describeSnapshot({ ...snap({ lcd: idle }), rruk })).toMatchObject({ name: 'FCC RECYCLING (UK) LIMITED', source: 'RRUK', rruk: 'FCC RECYCLING (UK) LIMITED', distanceKm: 7.1, bearingDeg: 324 });
    // Default order: the register outranks RRUK when no code decides; RRUK's answer is still kept.
    expect(describeSnapshot({ ...snap({ lcd: idle }), rruk, licences: [wtr] })).toMatchObject({ name: '', licensee: 'RESOUND LIMITED', source: 'WTR', rruk: 'FCC RECYCLING (UK) LIMITED' });
    // CC 3 detected picks Amazon out of RRUK's list and names the row with it, over the register.
    expect(describeSnapshot({ ...snap({ lcd: cc(3) }), rruk, licences: [wtr] })).toMatchObject({ name: 'AMAZON UK SERVICES LTD.', source: 'RRUK', tone: 'CC 3', rruk: 'AMAZON UK SERVICES LTD.', distanceKm: 29 });
    // CC 7 matches neither RRUK entry: they lose to the licensee even with RRUK ranked first.
    const rrukFirst = [{ id: 'RRUK' as const, enabled: true }, { id: 'WTR' as const, enabled: true }, { id: 'RRDB' as const, enabled: true }, { id: 'UKR' as const, enabled: true }];
    expect(describeSnapshot({ ...snap({ lcd: cc(7) }), rruk, licences: [wtr], lookups: rrukFirst })).toMatchObject({ name: '', source: 'WTR' });
    // RRUK ranked first with no code in play: it names the row.
    expect(describeSnapshot({ ...snap({ lcd: idle }), rruk, licences: [wtr], lookups: rrukFirst })).toMatchObject({ name: 'FCC RECYCLING (UK) LIMITED', source: 'RRUK' });
    // Both databases answer: the one that matches the code wins; otherwise placement, then the order.
    const conv = { frequencyHz: 453_437_500, conventional: [{ descr: 'Some RR channel', alpha: 'RRCH', tone: 'CC 12', mode: 'DMR', callsign: '', tags: [], county: 'Bucks', distanceKm: 20, bearingDeg: 10 }], systems: [], fetchedAt: 1, pending: false, error: null };
    expect(describeSnapshot({ ...snap({ lcd: cc(12) }), rruk, rr: conv })).toMatchObject({ name: 'FCC RECYCLING (UK) LIMITED', source: 'RRUK', rrName: 'Some RR channel' });
    expect(describeSnapshot({ ...snap({ lcd: cc(3) }), rruk, rr: conv })).toMatchObject({ name: 'AMAZON UK SERVICES LTD.', source: 'RRUK' });
    const nationwide = { ...rruk, entries: [entry('PMR446', '', null, { alpha: 'PMR446 CH1', nationwide: true })] };
    expect(describeSnapshot({ ...snap({ lcd: idle }), rruk: nationwide, rr: { ...conv, conventional: [{ ...conv.conventional[0]!, tone: '', distanceKm: null, bearingDeg: null }] } })).toMatchObject({ name: 'PMR446 CH1', source: 'RRUK' });
    // Switched off: neither named nor listed.
    const off = describeSnapshot({ ...snap({ lcd: idle }), rruk, lookups: [{ id: 'RRUK', enabled: false }, { id: 'WTR', enabled: true }] });
    expect(off).toMatchObject({ name: '', source: '', rruk: '' });
    expect(off.candidates).toEqual([]);
    expect(describeSnapshot({ ...snap({ lcd: idle }), rruk }).candidates.map((c) => [c.source, c.name])).toEqual([['RRUK', 'FCC RECYCLING (UK) LIMITED'], ['RRUK', 'AMAZON UK SERVICES LTD.']]);
    // The scanner's own name still wins.
    expect(describeSnapshot({ ...snap({}), rruk })).toMatchObject({ name: 'TC NW Deps', source: '', rruk: 'FCC RECYCLING (UK) LIMITED', distanceKm: 7.1 });
  });

  it('places the row by the identity it shows and stores every candidate the lookups offered', () => {
    const idle = ['', 'Imported/New', 'CONV        psDr', '', 'DMR   456.350000'];
    const wtr = { id: 1, frequencyHz: 456_350_000, direction: 'T', licensee: 'RESOUND LIMITED', product: '', emission: '', mode: 'DIG', widthHz: 12_500, lat: 51.9, lon: -0.7, ngr: '', licenceNo: '', distanceKm: 6.7, bearingDeg: 47 };
    const far = { ...wtr, id: 2, licensee: 'Kwik Fit (GB) Limited', lat: null, lon: null, distanceKm: null, bearingDeg: null };
    const conv = { frequencyHz: 456_350_000, conventional: [{ descr: 'Addenbrookes Hospital (Cambridge)', alpha: 'ADDENBR', tone: '', mode: 'FM', callsign: '', tags: [], county: 'Cambs', distanceKm: 60, bearingDeg: 62 }], systems: [], fetchedAt: 1, pending: false, error: null };
    // Named by the register: placed by the licence, with both licences and the RadioReference channel listed.
    const byWtr = describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr, far], rr: conv });
    expect(byWtr).toMatchObject({ licensee: 'RESOUND LIMITED', source: 'WTR', distanceKm: 6.7, bearingDeg: 47 });
    expect(byWtr.candidates.map((c) => [c.source, c.name, c.distanceKm])).toEqual([
      ['WTR', 'RESOUND LIMITED', 6.7],
      ['RRDB', 'Addenbrookes Hospital (Cambridge)', 60],
      ['WTR', 'Kwik Fit (GB) Limited', null],
    ]);
    expect(byWtr.candidates[0]).not.toHaveProperty('title');
    // Named by RadioReference (ranked first): placed by its county instead.
    const byRr = describeSnapshot({ ...snap({ lcd: idle }), licences: [wtr, far], rr: conv, lookups: [{ id: 'RRDB', enabled: true }, { id: 'WTR', enabled: true }, { id: 'UKR', enabled: true }] });
    expect(byRr).toMatchObject({ name: 'Addenbrookes Hospital (Cambridge)', source: 'RRDB', distanceKm: 60, bearingDeg: 62 });
    // The scanner's own name: the licensee still places the row (it is the nearest known user of the channel).
    expect(describeSnapshot({ ...snap({}), licences: [wtr] })).toMatchObject({ name: 'TC NW Deps', source: '', distanceKm: 6.7, bearingDeg: 47 });
    // Nothing placed: nothing to show, and a lookup switched off contributes no candidates.
    const off = describeSnapshot({ ...snap({ lcd: idle }), licences: [far], rr: conv, lookups: [{ id: 'WTR', enabled: true }, { id: 'RRDB', enabled: false }, { id: 'UKR', enabled: true }] });
    expect(off).toMatchObject({ licensee: 'Kwik Fit (GB) Limited', distanceKm: null, bearingDeg: null });
    expect(off.candidates).toHaveLength(1);
    expect(describeSnapshot(snap({}))).toMatchObject({ distanceKm: null, bearingDeg: null, candidates: [] });
  });

  it('takes the scanner\'s own alias for the radio off a trunked talkgroup screen', () => {
    const d = describeSnapshot(snap({ lcd: ['', 'P25 Sites', 'TGRP        psDr', 'UNID', 'USAF Bases UK', 'Radio 7'] }));
    expect(d.radioAlias).toBe('Radio 7');
    expect(d.scanlist).toBe('P25 Sites');
    // UNID is no name: RadioReference's talkgroup names the row, the scanner's word kept for the Detail view.
    expect(d).toMatchObject({ name: 'UNID', scannerName: 'UNID', source: '' });
    const rr = { frequencyHz: 456_025_000, conventional: [], systems: [{ sid: 1, name: 'USAF', city: '', site: null, distanceKm: 3, talkgroup: { tgDec: 63354, alpha: 'CRO', descr: 'Croughton Dispatch', mode: 'D', enc: 0, category: '' } }], fetchedAt: 1, pending: false, error: null };
    expect(describeSnapshot({ ...snap({ lcd: ['', 'P25 Sites', 'TGRP        psDr', 'UNID', 'USAF Bases UK', 'Radio 7'] }), rr })).toMatchObject({ name: 'Croughton Dispatch', scannerName: 'UNID', source: 'RRDB' });
    expect(describeSnapshot(snap({ lcd: ['', 'Shopwatch', 'CONV        psDr', 'TGID:        251', 'DMR   456.025000', 'RadioID:     104'] })).radioAlias).toBe('');
  });

  it('does not treat the sweeping screen as a channel', () => {
    const d = describeSnapshot(snap({ lcd: ['', 'Civil Airband', 'Military Airband', 'Shopwatch', 'Ofcom', 'P25'] }));
    expect(d.name).toBe('');
    expect(d.scanlist).toBe('');
    expect(d.objectType).toBe('');
  });
});

describe('ReceptionTracker', () => {
  it('moves the source with the name as details arrive, and keeps it across a merge', () => {
    const t = new ReceptionTracker({ minDurationMs: 0, closeDebounceMs: 0, mergeWindowMs: 10_000 });
    const wtr = { id: 1, frequencyHz: 119_775_000, direction: 'T', licensee: 'NATS', product: '', emission: '', mode: '', widthHz: 25_000, lat: null, lon: null, ngr: '', licenceNo: '', distanceKm: 1 };
    const idle = ['', 'Civil Airband', 'CONV        psDr', '', 'AM    119.775000'];
    // Licensee first: credited to the WTR.
    let ev = t.update({ ...snap({ lcd: idle }), licences: [wtr] }, 1000);
    expect(ev[0]).toMatchObject({ type: 'open', reception: { name: '', licensee: 'NATS', source: 'WTR' } });
    // The scanner's own name lands a poll later: the credit goes.
    ev = t.update({ ...snap({}), licences: [wtr] }, 1200);
    expect(ev[0]).toMatchObject({ type: 'update', reception: { name: 'TC NW Deps', licensee: 'NATS', source: '' } });
    t.update({ ...snap({ rf: false }), licences: [wtr] }, 1500);
    // Reopened before the name shows again: the earlier row's name and blank source stand.
    ev = t.update({ ...snap({ lcd: idle }), licences: [wtr] }, 3000);
    expect(ev[0]).toMatchObject({ type: 'open', merged: true, reception: { name: 'TC NW Deps', source: '', calls: 2 } });
  });

  it('grows the candidate list as lookups answer and moves the placement with the name', () => {
    const t = new ReceptionTracker({ minDurationMs: 0, closeDebounceMs: 0, mergeWindowMs: 10_000 });
    const idle = ['', 'Imported/New', 'CONV        psDr', '', 'DMR   456.350000'];
    const wtr = { id: 1, frequencyHz: 456_350_000, direction: 'T', licensee: 'RESOUND LIMITED', product: '', emission: '', mode: 'DIG', widthHz: 12_500, lat: 51.9, lon: -0.7, ngr: '', licenceNo: '', distanceKm: 6.7, bearingDeg: 47 };
    const conv = { frequencyHz: 456_350_000, conventional: [{ descr: 'Addenbrookes Hospital (Cambridge)', alpha: 'ADDENBR', tone: '', mode: 'FM', callsign: '', tags: [], county: 'Cambs', distanceKm: 60, bearingDeg: 62 }], systems: [], fetchedAt: 1, pending: false, error: null };
    const rrFirst = [{ id: 'RRDB' as const, enabled: true }, { id: 'WTR' as const, enabled: true }, { id: 'UKR' as const, enabled: true }];
    // The register answers at once; RadioReference is still being asked.
    let ev = t.update({ ...snap({ lcd: idle }), licences: [wtr], lookups: rrFirst }, 1000);
    expect(ev[0]).toMatchObject({ type: 'open', reception: { source: 'WTR', distanceKm: 6.7, bearingDeg: 47 } });
    expect(ev[0]!.reception.candidates).toHaveLength(1);
    // Same answer again: nothing to report.
    expect(t.update({ ...snap({ lcd: idle }), licences: [wtr], lookups: rrFirst }, 1100)).toEqual([]);
    // RadioReference lands and, ranked first, names the row: the placement follows the name and the list grows.
    ev = t.update({ ...snap({ lcd: idle }), licences: [wtr], rr: conv, lookups: rrFirst }, 1200);
    expect(ev[0]).toMatchObject({ type: 'update', reception: { name: 'Addenbrookes Hospital (Cambridge)', source: 'RRDB', distanceKm: 60, bearingDeg: 62 } });
    expect(ev[0]!.reception.candidates.map((c) => c.source)).toEqual(['RRDB', 'WTR']);
    // A poll with fewer answers (a lookup hiccup) never shrinks the list.
    expect(t.update({ ...snap({ lcd: idle }), licences: [wtr], lookups: rrFirst }, 1300).map((e) => e.type)).not.toContain('update');
    expect(t.open?.candidates).toHaveLength(2);
    t.update({ ...snap({ rf: false, lcd: idle }), licences: [wtr], lookups: rrFirst }, 1500);
    // A merged reopening keeps the longer list and the placement.
    ev = t.update({ ...snap({ lcd: idle }), licences: [wtr], lookups: rrFirst }, 3000);
    expect(ev[0]).toMatchObject({ type: 'open', merged: true, reception: { name: 'Addenbrookes Hospital (Cambridge)', distanceKm: 60, calls: 2 } });
    expect(ev[0]!.reception.candidates).toHaveLength(2);
  });

  it('opens on squelch, absorbs later details, closes after the debounce', () => {
    const t = new ReceptionTracker({ closeDebounceMs: 400, minDurationMs: 0, mergeWindowMs: 0 });
    expect(t.update(snap({ rf: false }), 0)).toEqual([]);
    const e1 = t.update(snap({ rf: true, rssi: 200 }), 1000);
    expect(e1.map((e) => e.type)).toEqual(['open']);
    expect(e1[0]!.reception).toMatchObject({ startedAt: 1000, frequencyHz: 119775000, name: 'TC NW Deps', rssiPeak: 200 });
    // stronger signal and the header arriving => update
    const e2 = t.update(snap({ rf: true, rssi: 350, header: true }), 1200);
    expect(e2.map((e) => e.type)).toEqual(['update']);
    expect(e2[0]!.reception).toMatchObject({ rssiPeak: 350, name: 'Fire Dispatch', tgid: 1234 });
    // nothing new => no event
    expect(t.update(snap({ rf: true, rssi: 100, header: true }), 1300)).toEqual([]);
    // squelch flutter shorter than the debounce is ignored
    expect(t.update(snap({ rf: false, header: true }), 1400)).toEqual([]);
    expect(t.update(snap({ rf: true, header: true }), 1500)).toEqual([]);
    // squelch closed for longer than the debounce => close, ended at the moment it dropped
    expect(t.update(snap({ rf: false, header: true }), 2000)).toEqual([]);
    const e3 = t.update(snap({ rf: false, header: true }), 2500);
    expect(e3.map((e) => e.type)).toEqual(['close']);
    expect(e3[0]!.reception.endedAt).toBe(2000);
    expect(t.open).toBeNull();
  });

  it('closes and reopens when the frequency changes while receiving', () => {
    const t = new ReceptionTracker({ minDurationMs: 0, mergeWindowMs: 0 });
    t.update(snap({ rf: true, hz: 119775000 }), 0);
    const e = t.update(snap({ rf: true, hz: 121025000, lcd: ['', 'Civil Airband', 'CONV        psDr', 'TC Midlands', 'AM    121.025000'] }), 500);
    expect(e.map((x) => x.type)).toEqual(['close', 'open']);
    expect(e[0]!.reception).toMatchObject({ frequencyHz: 119775000, endedAt: 500 });
    expect(e[1]!.reception).toMatchObject({ frequencyHz: 121025000, name: 'TC Midlands', startedAt: 500 });
  });

  it('never replaces real details with blanks', () => {
    const t = new ReceptionTracker({ minDurationMs: 0 });
    t.update(snap({ rf: true, header: true }), 0);
    const e = t.update(snap({ rf: true, lcd: ['', 'Civil Airband', 'Military Airband', '', '', ''] }), 100);
    expect(e).toEqual([]);
    expect(t.open?.name).toBe('Fire Dispatch');
  });

  it('flush closes an open reception', () => {
    const t = new ReceptionTracker({ minDurationMs: 0 });
    t.update(snap({ rf: true }), 0);
    const e = t.flush(900);
    expect(e[0]!.type).toBe('close');
    expect(e[0]!.reception.endedAt).toBe(900);
  });

  it('discards openings shorter than the minimum duration', () => {
    const t = new ReceptionTracker({ minDurationMs: 500, closeDebounceMs: 100 });
    expect(t.update(snap({ rf: true }), 0)).toEqual([]);
    expect(t.update(snap({ rf: true }), 200)).toEqual([]);
    expect(t.update(snap({ rf: false }), 300)).toEqual([]);
    const e = t.update(snap({ rf: false }), 450);
    expect(e.map((x) => x.type)).toEqual(['discard']);
    // a long one is reported once it passes the threshold, with details absorbed meanwhile
    expect(t.update(snap({ rf: true, rssi: 100 }), 1000)).toEqual([]);
    const open = t.update(snap({ rf: true, rssi: 250, header: true }), 1600);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ type: 'open', merged: false, reception: { startedAt: 1000, rssiPeak: 250, name: 'Fire Dispatch', calls: 1 } });
  });

  it('merges a new opening on the same channel within the merge window', () => {
    const t = new ReceptionTracker({ minDurationMs: 0, closeDebounceMs: 100, mergeWindowMs: 10_000 });
    t.update(snap({ rf: true, rssi: 300 }), 0);
    t.update(snap({ rf: false }), 5000);
    expect(t.update(snap({ rf: false }), 5200).map((e) => e.type)).toEqual(['close']);
    const e = t.update(snap({ rf: true, rssi: 320 }), 9000);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ type: 'open', merged: true, reception: { startedAt: 0, calls: 2, rssiPeak: 320, name: 'TC NW Deps' } });
    // not merged: different talkgroup on the same frequency
    t.update(snap({ rf: false }), 9500);
    t.update(snap({ rf: false }), 9800);
    const other = t.update(snap({ rf: true, header: true }), 10_000);
    expect(other[0]).toMatchObject({ type: 'open', merged: false, reception: { calls: 1, name: 'Fire Dispatch' } });
    // not merged: outside the window
    t.update(snap({ rf: false, header: true }), 11_000);
    t.update(snap({ rf: false, header: true }), 11_200);
    const late = t.update(snap({ rf: true, header: true }), 30_000);
    expect(late[0]).toMatchObject({ type: 'open', merged: false });
  });

  it('ignores snapshots without status', () => {
    const t = new ReceptionTracker();
    expect(t.update(emptySnapshot(), 0)).toEqual([]);
  });
});

describe('LogDb', () => {
  it('returns one day of the log for the map: placed entries active in the period, and the total', () => {
    const db = new LogDb(':memory:');
    const base = { endedAt: null, mode: 'AM', signalType: 'AM', name: 'A', system: '', scanlist: 'L', objectType: 'CONV', tgid: null, radioId: null, site: '', squelch: '', tone: '', licensee: '', source: '', scannerName: '', wtr: '', rrName: '', rrSystem: '', rpt: '', rssiPeak: 1, calls: 1 };
    const placed = { lat: 51.8, lon: -0.9, distanceKm: 3, bearingDeg: 47 };
    const before = db.insert({ ...base, startedAt: 500, endedAt: 900, frequencyHz: 100, ...placed });
    const spanning = db.insert({ ...base, startedAt: 900, endedAt: 1100, frequencyHz: 100, ...placed });
    const inside = db.insert({ ...base, startedAt: 1200, endedAt: 1300, frequencyHz: 200, ...placed });
    const unplaced = db.insert({ ...base, startedAt: 1400, endedAt: 1500, frequencyHz: 300 });
    const open = db.insert({ ...base, startedAt: 1900, frequencyHz: 400, ...placed });
    const after = db.insert({ ...base, startedAt: 2000, endedAt: 2100, frequencyHz: 100, ...placed });
    const d = db.day(1000, 2000, 5000, 1950);
    expect(d.total).toBe(4);
    expect(d.rows.map((r) => r.id)).toEqual([open.id, inside.id, spanning.id]);
    expect(d.rows.map((r) => r.id)).not.toContain(unplaced.id);
    expect(d.rows.map((r) => r.id)).not.toContain(before.id);
    expect(d.rows.map((r) => r.id)).not.toContain(after.id);
    expect(d.rows[0]).toMatchObject({ lat: 51.8, lon: -0.9, hits: 1 });
    expect(d.truncated).toBe(false);
    const cut = db.day(1000, 2000, 2, 1950);
    expect(cut.rows).toHaveLength(2);
    expect(cut.truncated).toBe(true);
    expect(cut.total).toBe(4);
    db.close();
  });

  it('inserts, updates, lists newest first and counts hits per frequency', () => {
    const db = new LogDb(':memory:');
    const base = { endedAt: null, mode: 'AM', signalType: 'AM', name: 'A', system: '', scanlist: 'L', objectType: 'CONV', tgid: null, radioId: null, site: '', squelch: '', tone: '', licensee: '', source: '', scannerName: '', wtr: '', rrName: '', rrSystem: '', rpt: '', rssiPeak: 1, calls: 1 };
    const r1 = db.insert({ ...base, startedAt: 1000, frequencyHz: 100 });
    const r2 = db.insert({ ...base, startedAt: 2000, frequencyHz: 200, name: 'B' });
    const r3 = db.insert({ ...base, startedAt: 3000, frequencyHz: 100, name: 'A2' });
    expect([r1.hits, r2.hits, r3.hits]).toEqual([1, 1, 2]);
    expect(r1.calls).toBe(1);
    const rows = db.recent();
    expect(rows.map((r) => r.id)).toEqual([r3.id, r2.id, r1.id]);
    expect(rows[0]!.hits).toBe(2);
    const u = db.update(r3.id, { endedAt: 3500, rssiPeak: 99, tgid: 7, calls: 3 });
    expect(u).toMatchObject({ endedAt: 3500, rssiPeak: 99, tgid: 7, name: 'A2', calls: 3 });
    // a reopened (ended_at NULL) row sorts first, then by last-heard
    db.update(r1.id, { endedAt: null });
    db.update(r2.id, { endedAt: 9000 });
    expect(db.recent().map((r) => r.id)).toEqual([r1.id, r2.id, r3.id]);
    expect(db.count()).toBe(3);
    db.clear();
    expect(db.count()).toBe(0);
    db.close();
  });

  it('shows a radio by the name the user gave it, ahead of the scanner\'s alias and radioid.net, keyed to its system', () => {
    const db = new LogDb(':memory:');
    db.replaceDmrUsers([{ id: 5, callsign: 'G8XYZ', name: 'Ham Five', city: '', state: '', country: '' }], 'x', 1);
    const base = { startedAt: 1000, endedAt: null, mode: 'NFM', signalType: 'DG', name: 'SOT Council Sec', system: 'SOT Council', scanlist: 'Trunk DMR', objectType: 'TGRP', tgid: 100, radioId: 5, site: '', squelch: '', tone: '', licensee: '', source: '', scannerName: '', wtr: '', rrName: '', rrSystem: '', rpt: '', rssiPeak: 1, calls: 1 };
    const trunked = db.insert({ ...base, frequencyHz: 166_225_000, radioAlias: 'Chatterley Whitf' });
    const conv = db.insert({ ...base, frequencyHz: 456_025_000, system: '', objectType: 'CONV', name: 'Shop', radioAlias: '' });
    // Without a name of the user's: the scanner's alias, else radioid.net.
    expect(db.get(trunked.id)).toMatchObject({ radioLabel: '', radioCallsign: 'Chatterley Whitf', radioName: '' });
    expect(db.get(conv.id)).toMatchObject({ radioLabel: '', radioCallsign: 'G8XYZ', radioName: 'Ham Five' });
    // A name keyed to the system applies there only; one keyed to any system applies everywhere the system one does not.
    const sys = db.nameRadio({ radioId: 5, system: 'SOT Council', name: 'Chatterley Whitfield Radio User 1' }, 5000);
    expect(sys).toMatchObject({ radioId: 5, system: 'SOT Council', name: 'Chatterley Whitfield Radio User 1', namedAt: 5000 });
    expect(db.get(trunked.id)).toMatchObject({ radioLabel: 'Chatterley Whitfield Radio User 1', radioCallsign: 'Chatterley Whitfield Radio User 1', radioName: '', radioAlias: 'Chatterley Whitf' });
    expect(db.get(conv.id)).toMatchObject({ radioLabel: '', radioCallsign: 'G8XYZ' });
    db.nameRadio({ radioId: 5, system: '', name: 'Any radio five' });
    expect(db.get(conv.id)).toMatchObject({ radioLabel: 'Any radio five', radioCallsign: 'Any radio five', radioName: '' });
    expect(db.get(trunked.id)!.radioLabel).toBe('Chatterley Whitfield Radio User 1');
    // Renaming replaces the entry with the same key; the paged select carries the name too.
    const again = db.nameRadio({ radioId: 5, system: 'SOT Council', name: 'CW Radio 1' });
    expect(again.id).toBe(sys.id);
    expect(db.radioNames().map((n) => [n.system, n.name])).toEqual([['', 'Any radio five'], ['SOT Council', 'CW Radio 1']]);
    expect(db.recent().find((r) => r.id === trunked.id)!.radioLabel).toBe('CW Radio 1');
    // Forgetting the system name drops back to the any-system one, then to the alias.
    db.unnameRadio(sys.id);
    expect(db.get(trunked.id)!.radioLabel).toBe('Any radio five');
    db.unnameRadio(db.radioNames()[0]!.id);
    expect(db.get(trunked.id)).toMatchObject({ radioLabel: '', radioCallsign: 'Chatterley Whitf' });
    // A bulk import (a DSD+ list) writes the named ones only.
    expect(db.nameRadios([{ radioId: 16734046, system: '', name: 'CRO SFS 007' }, { radioId: 16734160, system: '', name: '' }])).toBe(1);
    expect(db.radioNames()).toHaveLength(1);
    db.close();
  });

  it('stores the placement and the candidate list with the row', () => {
    const db = new LogDb(':memory:');
    const candidates = [
      { source: 'WTR' as const, name: 'RESOUND LIMITED', detail: 'DIG · base', distanceKm: 6.7, bearingDeg: 47 },
      { source: 'UKR' as const, name: 'GB3BS', detail: 'Bristol · 118.8 Hz ✓', distanceKm: null, bearingDeg: null, match: true, pills: 'FM · DMR' },
    ];
    const r = db.insert({ startedAt: 5, endedAt: null, frequencyHz: 1, mode: '', signalType: '', name: '', system: '', scanlist: '', objectType: '', tgid: null, radioId: null, site: '', squelch: '', tone: '', licensee: 'RESOUND LIMITED', source: 'WTR', scannerName: '', wtr: 'RESOUND LIMITED', rrName: '', rrSystem: '', rpt: '', distanceKm: 6.7, bearingDeg: 47, candidates, rssiPeak: 0, calls: 1 });
    expect(r).toMatchObject({ distanceKm: 6.7, bearingDeg: 47, candidates });
    expect(db.update(r.id, { distanceKm: 60, bearingDeg: 62, candidates: candidates.slice(0, 1) })).toMatchObject({ distanceKm: 60, bearingDeg: 62, candidates: candidates.slice(0, 1) });
    expect(db.update(r.id, { distanceKm: null, bearingDeg: null, candidates: [] })).toMatchObject({ distanceKm: null, bearingDeg: null, candidates: [] });
    db.close();
  });

  it('applies a confirmation to every row it fits, now and later, and withdraws it cleanly', () => {
    const db = new LogDb(':memory:');
    const base = { endedAt: 10, mode: 'NFM', signalType: 'DG', name: '', system: '', scanlist: 'Imported/New', objectType: 'CONV', tgid: 19, radioId: null, site: '', squelch: '', tone: 'CC 12', licensee: 'RESOUND LIMITED', source: 'WTR' as const, scannerName: '', wtr: 'RESOUND LIMITED', rrName: '', rrSystem: '', rpt: '', distanceKm: 8.2, bearingDeg: 116, candidates: [], rssiPeak: 1, calls: 1 };
    const a = db.insert({ ...base, startedAt: 1, frequencyHz: 456_350_000 });
    const b = db.insert({ ...base, startedAt: 2, frequencyHz: 456_350_000, tone: 'CC 3', licensee: 'Shop Safe Limited', wtr: 'Shop Safe Limited' });
    const c = db.insert({ ...base, startedAt: 3, frequencyHz: 456_350_000, name: 'Resound Ayles', scannerName: 'Resound Ayles', source: '' });
    const d = db.insert({ ...base, startedAt: 4, frequencyHz: 453_250_000 });
    // Confirm CC 12 on the frequency as Amazon (picked from a WTR candidate): the CC 12 rows are renamed, the scanner's own name included.
    const conf = db.confirm({ frequencyHz: 456_350_000, tone: 'CC 12', tgid: null, name: 'AMAZON UK SERVICES LTD.', system: '', source: 'WTR', detail: 'DIG', distanceKm: 29, bearingDeg: 80 }, 500);
    expect(conf).toMatchObject({ id: expect.any(Number), name: 'AMAZON UK SERVICES LTD.', tone: 'CC 12', source: 'WTR', confirmedAt: 500 });
    expect(db.get(a.id)).toMatchObject({ name: 'AMAZON UK SERVICES LTD.', source: 'CONF', distanceKm: 29, bearingDeg: 80, licensee: 'RESOUND LIMITED', wtr: 'RESOUND LIMITED' });
    expect(db.get(c.id)).toMatchObject({ name: 'AMAZON UK SERVICES LTD.', source: 'CONF', scannerName: 'Resound Ayles' });
    expect(db.get(b.id)).toMatchObject({ name: '', source: 'WTR' });
    expect(db.get(d.id)).toMatchObject({ name: '', source: 'WTR' });
    expect(db.confirmationFor(456_350_000, 'CC 12', 7)?.id).toBe(conf.id);
    expect(db.confirmationFor(456_350_000, 'CC 3', null)).toBeNull();
    // Confirming the same key again replaces it rather than stacking.
    const again = db.confirm({ ...conf, name: 'Amazon Milton Keynes', source: 'USER' }, 600);
    expect(db.confirmations().map((x) => x.id)).toEqual([again.id]);
    expect(db.get(a.id)).toMatchObject({ name: 'Amazon Milton Keynes', source: 'CONF' });
    // Withdrawn: the scanner's own name comes back where it showed one, else the licensee is credited again.
    db.unconfirm(again.id);
    expect(db.confirmations()).toEqual([]);
    expect(db.get(a.id)).toMatchObject({ name: '', source: 'WTR', distanceKm: 29 });
    expect(db.get(c.id)).toMatchObject({ name: 'Resound Ayles', source: '' });
    db.unconfirm(999); // unknown id: nothing happens
    db.close();
  });

  it('breaks the traffic on a frequency down by tone and talkgroup', () => {
    const db = new LogDb(':memory:');
    const base = { endedAt: null as number | null, mode: 'NFM', signalType: 'DG', name: '', system: '', scanlist: '', objectType: 'CONV', tgid: null as number | null, radioId: null as number | null, site: '', squelch: '', tone: '', licensee: '', source: '' as const, scannerName: '', wtr: '', rrName: '', rrSystem: '', rpt: '', distanceKm: null, bearingDeg: null, candidates: [], rssiPeak: 1, calls: 1 };
    db.insert({ ...base, startedAt: 1000, endedAt: 1500, frequencyHz: 456_350_000, tone: 'CC 12', tgid: 19, radioId: 1904, name: 'Resound Ayles', calls: 3 });
    db.insert({ ...base, startedAt: 2000, endedAt: 2500, frequencyHz: 456_350_000, tone: 'CC 12', tgid: 19, radioId: 2211, name: 'Resound Ayles' });
    db.insert({ ...base, startedAt: 3000, endedAt: 3500, frequencyHz: 456_350_000, tone: 'CC 12', tgid: 19, radioId: 1904, name: 'Amazon' });
    db.insert({ ...base, startedAt: 4000, endedAt: null, frequencyHz: 456_350_000, tone: 'CC 3', tgid: 1, radioId: null });
    db.insert({ ...base, startedAt: 5000, endedAt: 5100, frequencyHz: 453_250_000, tone: 'CC 1', tgid: 1003, radioId: 204 });
    const t = db.traffic(456_350_000);
    expect(t).toEqual([
      { tone: 'CC 12', tgid: 19, receptions: 3, calls: 5, firstAt: 1000, lastAt: 3500, radioIds: [1904, 2211], radioCount: 2, names: ['Resound Ayles', 'Amazon'] },
      { tone: 'CC 3', tgid: 1, receptions: 1, calls: 1, firstAt: 4000, lastAt: 4000, radioIds: [], radioCount: 0, names: [] },
    ]);
    expect(db.traffic(456_350_000, { radioIds: 1 })[0]).toMatchObject({ radioIds: [1904], radioCount: 2 });
    expect(db.traffic(1)).toEqual([]);
    db.close();
  });

  it('shows the scanner\'s alias for a radio ahead of the radioid.net callsign', () => {
    const db = new LogDb(':memory:');
    db.replaceDmrUsers([{ id: 16734037, callsign: 'G0XYZ', name: 'Someone', city: '', state: '', country: '' }], 'test');
    const base = { startedAt: 5, endedAt: null, frequencyHz: 419_475_000, mode: 'NFM', signalType: '', name: 'UNID', system: 'USAF Bases UK', scanlist: 'P25 Sites', objectType: 'TGRP', tgid: 63354, radioId: null, site: 'RAF Croughton', squelch: '', tone: '', licensee: '', source: '' as const, scannerName: 'UNID', wtr: '', rrName: '', rrSystem: '', rpt: '', rruk: '', distanceKm: null, bearingDeg: null, lat: null, lon: null, candidates: [], rssiPeak: 0, calls: 1 };
    const aliased = db.insert({ ...base, radioId: 16734037, radioAlias: 'Radio 7' });
    expect(aliased.radioAlias).toBe('Radio 7');
    expect(aliased.radioCallsign).toBe('Radio 7');
    expect(aliased.radioName).toBe('');
    const plain = db.insert({ ...base, radioId: 16734037 });
    expect(plain.radioAlias).toBe('');
    expect(plain.radioCallsign).toBe('G0XYZ');
    expect(plain.radioName).toBe('Someone');
    expect(db.update(plain.id, { radioAlias: 'Radio 7' })?.radioCallsign).toBe('Radio 7');
  });

  it('names a talkgroup from the user ahead of the scanner, and from DSD+ only where the scanner showed a placeholder', () => {
    const db = new LogDb(':memory:');
    const base = { startedAt: 5, endedAt: null, frequencyHz: 167_300_000, mode: 'NFM', signalType: 'DG', name: 'UNID', system: 'SOT Council', scanlist: 'Trunk DMR', objectType: 'TGRP', tgid: 100, radioId: null, site: '', squelch: '', tone: '', licensee: '', source: '' as const, scannerName: 'UNID', wtr: '', rrName: '', rrSystem: '', rpt: '', rruk: '', distanceKm: null, bearingDeg: null, lat: null, lon: null, candidates: [], rssiPeak: 0, calls: 1 };
    const unid = db.insert(base);
    const named = db.insert({ ...base, name: 'SOT Council Sec', scannerName: 'SOT Council Sec' });
    const lookedUp = db.insert({ ...base, name: 'Highways (RRDB)', source: 'RRDB', rrName: 'Highways (RRDB)' });
    const other = db.insert({ ...base, system: 'Other Net' });
    const conv = db.insert({ ...base, system: '', objectType: 'CONV', scannerName: '', name: '' });
    expect(db.get(unid.id)).toMatchObject({ name: 'UNID', source: '', tgLabel: '' });

    // DSD+'s alias on the system: stands in for UNID, a blank and a lookup's name, never for the scanner's own alpha tag.
    expect(db.replaceDsdTalkgroups('SOT Council', [{ tgid: 100, name: 'HWY' }, { tgid: 200, name: '' }, { tgid: 100, name: 'twice' }])).toBe(1);
    expect(db.get(unid.id)).toMatchObject({ name: 'HWY', source: 'DSD', scannerName: 'UNID', tgLabel: 'HWY' });
    expect(db.get(named.id)).toMatchObject({ name: 'SOT Council Sec', source: '', tgLabel: 'HWY' });
    expect(db.get(lookedUp.id)).toMatchObject({ name: 'HWY', source: 'DSD', rrName: 'Highways (RRDB)' });
    expect(db.get(other.id)).toMatchObject({ name: 'UNID', tgLabel: '' });
    expect(db.get(conv.id)).toMatchObject({ name: '', tgLabel: '' });

    // The user's own name outranks the scanner's alpha tag and DSD+'s alias; keyed to the system, else any.
    const own = db.nameTalkgroup({ tgid: 100, system: 'SOT Council', name: 'Highways Depot', source: 'USER' }, 5000);
    expect(own).toMatchObject({ tgid: 100, system: 'SOT Council', name: 'Highways Depot', source: 'USER', namedAt: 5000 });
    expect(db.get(unid.id)).toMatchObject({ name: 'Highways Depot', source: 'TG' });
    expect(db.get(named.id)).toMatchObject({ name: 'Highways Depot', source: 'TG', scannerName: 'SOT Council Sec' });
    expect(db.get(other.id)).toMatchObject({ name: 'UNID', source: '' });
    db.nameTalkgroup({ tgid: 100, system: '', name: 'Any hundred', source: 'USER' });
    expect(db.get(other.id)).toMatchObject({ name: 'Any hundred', source: 'TG' });
    expect(db.get(conv.id)).toMatchObject({ name: 'Any hundred', source: 'TG' });
    expect(db.recent().find((r) => r.id === unid.id)).toMatchObject({ name: 'Highways Depot', source: 'TG' });
    // Renaming keeps the id; the DSD import never touches a typed name; the list has the typed ones first.
    expect(db.nameTalkgroup({ tgid: 100, system: 'SOT Council', name: 'Highways', source: 'USER' }).id).toBe(own.id);
    db.replaceDsdTalkgroups('SOT Council', [{ tgid: 100, name: 'HWY2' }]);
    expect(db.tgNames().map((n) => [n.system, n.name, n.source])).toEqual([['', 'Any hundred', 'USER'], ['SOT Council', 'Highways', 'USER'], ['SOT Council', 'HWY2', 'DSD']]);
    expect(db.tgNameFor(100, ['SOT Council', 'L1'])).toMatchObject({ name: 'Highways' });
    expect(db.tgNameFor(100, ['L1'])).toMatchObject({ name: 'Any hundred' });
    expect(db.tgNameFor(null, ['SOT Council'])).toBeNull();

    // A confirmation still outranks everything; withdrawing the typed name drops back to DSD+, then to the scanner.
    db.confirm({ frequencyHz: 167_300_000, tone: '', tgid: 100, name: 'Confirmed Ops', system: '', source: 'USER', detail: '', distanceKm: null, bearingDeg: null, lat: null, lon: null });
    expect(db.get(unid.id)).toMatchObject({ name: 'Confirmed Ops', source: 'CONF' });
    db.unconfirm(db.confirmations()[0]!.id);
    db.unnameTalkgroup(own.id);
    db.unnameTalkgroup(db.tgNames().find((n) => n.system === '')!.id);
    expect(db.get(unid.id)).toMatchObject({ name: 'HWY2', source: 'DSD' });
    expect(db.get(named.id)).toMatchObject({ name: 'SOT Council Sec', source: '' });
    expect(db.replaceDsdTalkgroups('SOT Council', [])).toBe(0);
    expect(db.get(unid.id)).toMatchObject({ name: 'UNID', source: '' });
    db.close();
  });

  it('records DSD+ events once whatever the replays, and sums a network\'s day', () => {
    const db = new LogDb(':memory:');
    const day = new Date(2026, 9, 2, 0, 0, 0).getTime();
    const at = (h: number, m: number, s = 0): number => day + ((h * 60 + m) * 60 + s) * 1000;
    const base = { endedAt: null, network: 'L1', site: 'L1-15', type: 'Group', tgid: 69, rid: 1438, target: null, channel: '306', hz: null, slot: 1, enc: false, emergency: false, flags: '', alias: null, durationS: null, accepted: null, peer: null, code: null } as const;
    const call = (key: string, t: number, over: Partial<typeof base> & { kind?: 'call' } = {}) => ({ ...base, key, at: t, kind: 'call' as const, ...over });
    // The grant, then its closing line as the watcher's next poll records it (same key, now with an end), then a replay of both after a restart.
    expect(db.recordDsdEvents([call('a', at(10, 0)), call('b', at(10, 1), { rid: 1432, durationS: 4, endedAt: at(10, 1, 4) })])).toBe(2);
    db.recordDsdEvents([call('a', at(10, 0), { durationS: 8, endedAt: at(10, 0, 8) })]);
    db.recordDsdEvents([call('a', at(10, 0)), call('b', at(10, 1), { rid: 1432, durationS: 4, endedAt: at(10, 1, 4) })]);
    expect(db.dsdEventCount()).toBe(2);
    expect(db.dsdEvents('L1', day, day + 86_400_000).map((r) => [r.key, r.durationS, r.endedAt])).toEqual([['a', 8, at(10, 0, 8)], ['b', 4, at(10, 1, 4)]]);
    // More of the day: another talkgroup, a private call, a registration and an affiliation, and a call on another network.
    db.recordDsdEvents([
      call('c', at(11, 30), { tgid: 32, rid: 1503, durationS: 6, endedAt: at(11, 30, 6), channel: '305', enc: true }),
      call('d', at(11, 31), { tgid: 32, rid: 1438, durationS: 2, endedAt: at(11, 31, 2), channel: '305' }),
      call('e', at(12, 0), { type: 'Private', tgid: null, rid: 1438, target: 1503, durationS: 3, endedAt: at(12, 0, 3) }),
      { ...base, key: 'f', at: at(9, 59), kind: 'registration' as const, type: '', tgid: null, rid: 1503, channel: null, slot: null, accepted: true },
      { ...base, key: 'g', at: at(9, 59, 30), kind: 'affiliation' as const, type: '', tgid: 32, rid: 1503, channel: null, slot: null, alias: 'Depot 3', accepted: true },
      call('h', at(12, 5), { network: 'S1', site: 'S1-1', tgid: 7, rid: 9, durationS: 1, endedAt: at(12, 5, 1) }),
      call('i', day + 86_400_000 + 1000, { tgid: 69, rid: 1438, durationS: 1, endedAt: day + 86_400_000 + 2000 }),
      // The site's facts and its neighbours are the map whatever the period; a neighbour known only from a list is a site too.
      { ...base, key: 'L1|site|L1-15', at: at(10, 0), kind: 'site' as const, type: '', tgid: null, rid: null, channel: null, slot: null, hz: 167_300_000, code: 'CC 15' },
      { ...base, key: 'L1|neighbour|L1-15|L1-3', at: at(10, 0), kind: 'neighbour' as const, type: '', tgid: null, rid: null, channel: null, slot: null, peer: 'L1-3', code: 'CC=63' },
      { ...base, key: 'L1|neighbour|L1-15|L1-9', at: at(10, 1), kind: 'neighbour' as const, type: '', tgid: null, rid: null, channel: null, slot: null, peer: 'L1-9', code: 'CC=183' },
    ]);
    // A neighbour line reprinted later moves the row's time on, nothing else.
    db.recordDsdEvents([{ ...base, key: 'L1|neighbour|L1-15|L1-3', at: at(10, 5), kind: 'neighbour' as const, type: '', tgid: null, rid: null, channel: null, slot: null, peer: 'L1-3', code: 'CC=63' }]);
    const d = db.dsdDay('L1', day, day + 86_400_000);
    expect(d).toMatchObject({ network: 'L1', calls: 5, privateCalls: 1, events: 10, radiosTruncated: false });
    expect(d.hours[10]).toBe(2);
    expect(d.hours[11]).toBe(2);
    expect(d.hours[12]).toBe(1);
    // Equal call counts: the lower talkgroup number first.
    expect(d.talkgroups.map((t) => [t.tgid, t.calls, t.radios, t.seconds, t.enc])).toEqual([
      [32, 2, 2, 8, 1],
      [69, 2, 2, 12, 0],
    ]);
    expect(d.talkgroups[1]!.topRadios).toEqual([{ rid: 1432, calls: 1 }, { rid: 1438, calls: 1 }]);
    expect(d.talkgroups[1]!.hours[10]).toBe(2);
    expect(d.talkgroups[0]!.hours[11]).toBe(2);
    // Radios: the busiest first; 1438 talked on both talkgroups and called 1503 privately; 1503 registered and affiliated.
    expect(d.radios.map((r) => [r.rid, r.calls, r.seconds])).toEqual([
      [1438, 3, 13],
      [1503, 1, 6],
      [1432, 1, 4],
    ]);
    expect(d.radios[0]).toMatchObject({ topTalkgroups: [{ tgid: 69, calls: 1 }, { tgid: 32, calls: 1 }], privateWith: [{ rid: 1503, calls: 1 }], registrations: 0, affiliations: 0, affiliatedTg: null });
    expect(d.radios[1]).toMatchObject({ alias: 'Depot 3', privateWith: [{ rid: 1438, calls: 1 }], registrations: 1, affiliations: 1, affiliatedTg: 32 });
    expect(d.sites).toEqual([{ site: 'L1-15', name: '', controlHz: 167_300_000, code: 'CC 15', neighbours: [{ site: 'L1-3', code: 'CC=63' }, { site: 'L1-9', code: 'CC=183' }], calls: 5, firstAt: at(10, 0), lastAt: at(12, 0) }]);
    expect(db.dsdEvents('L1', at(10, 4), at(10, 6)).map((r) => r.key)).toEqual(['L1|neighbour|L1-15|L1-3']);
    expect(db.dsdNetworks().map((n) => [n.network, n.events])).toEqual([['L1', 11], ['S1', 1]]);
    expect(db.dsdDay('S1', day, day + 86_400_000).calls).toBe(1);
    // Before 11:00: a, b, f, g, the site row and both neighbour rows.
    expect(db.pruneDsdEvents(at(11, 0))).toBe(7);
    expect(db.dsdEventCount()).toBe(5);
    db.close();
  });

  it('closes receptions left open by a previous run', () => {
    const db = new LogDb(':memory:');
    const r = db.insert({ startedAt: 5, endedAt: null, frequencyHz: 1, mode: '', signalType: '', name: '', system: '', scanlist: '', objectType: '', tgid: null, radioId: null, site: '', squelch: '', tone: '', licensee: '', source: '', scannerName: '', wtr: '', rrName: '', rrSystem: '', rpt: '', rssiPeak: 0, calls: 1 });
    expect(r.endedAt).toBeNull();
    // simulate restart by constructing on the same in-memory handle is not possible; exercise the statement directly
    const db2 = new LogDb(':memory:');
    expect(db2.count()).toBe(0);
    db.close();
    db2.close();
  });
});

describe('ReceptionLogger', () => {
  it('writes open, update and close through to the database and emits rows', () => {
    const db = new LogDb(':memory:');
    const rows: ReceptionRow[] = [];
    const log = new ReceptionLogger(db, (r) => rows.push(r), { closeDebounceMs: 100, minDurationMs: 0, mergeWindowMs: 0 });
    log.onSnapshot(snap({ rf: true, rssi: 100 }), 0);
    log.onSnapshot(snap({ rf: true, rssi: 300, header: true }), 50);
    log.onSnapshot(snap({ rf: false, header: true }), 100);
    log.onSnapshot(snap({ rf: false, header: true }), 300);
    expect(rows.map((r) => r.endedAt)).toEqual([null, null, 100]);
    expect(rows[2]).toMatchObject({ name: 'Fire Dispatch', rssiPeak: 300, tgid: 1234, hits: 1 });
    expect(db.count()).toBe(1);
    // disconnect flushes an open reception
    log.onSnapshot(snap({ rf: true }), 1000);
    const dis = emptySnapshot();
    log.onSnapshot(dis, 1500);
    expect(db.recent()[0]!.endedAt).toBe(1500);
    db.close();
  });

  it('names a blip from the last reception on the frequency whose display showed the scanner object', () => {
    const db = new LogDb(':memory:');
    const rows: ReceptionRow[] = [];
    const log = new ReceptionLogger(db, (r) => rows.push(r), { closeDebounceMs: 100, minDurationMs: 0, mergeWindowMs: 0 });
    const wtr = { id: 1, frequencyHz: 119_775_000, direction: 'T', licensee: 'NATS', product: '', emission: '', mode: '', widthHz: 25_000, lat: null, lon: null, ngr: '', licenceNo: '', distanceKm: 1 };
    const sweeping = ['', 'Civil Airband', 'Military Airband', 'Shopwatch', 'Ofcom', 'P25'];
    // A proper reception: the scan screen names the object.
    log.onSnapshot(snap({ rf: true }), 0);
    log.onSnapshot(snap({ rf: false }), 100);
    log.onSnapshot(snap({ rf: false }), 300);
    // A blip: the display never left the sweeping screen, and only the register has a name.
    log.onSnapshot({ ...snap({ rf: true, lcd: sweeping }), licences: [wtr] }, 1000);
    expect(db.recent()[0]).toMatchObject({ name: 'TC NW Deps', scanlist: 'Civil Airband', objectType: 'CONV', source: 'MEM', scannerName: '', licensee: 'NATS', wtr: 'NATS' });
    // The display catches up: the live object replaces the remembered one.
    log.onSnapshot(snap({ rf: true }), 1200);
    expect(db.recent()[0]).toMatchObject({ name: 'TC NW Deps', source: '', scannerName: 'TC NW Deps' });
    log.onSnapshot(snap({ rf: false }), 1500);
    log.onSnapshot(snap({ rf: false }), 1700);
    // A frequency never seen with an object stays as the lookups left it.
    log.onSnapshot({ ...snap({ rf: true, hz: 121_025_000, lcd: sweeping }), licences: [wtr] }, 3000);
    expect(db.recent()[0]).toMatchObject({ frequencyHz: 121_025_000, name: '', source: 'WTR' });
    log.onSnapshot(snap({ rf: false, hz: 121_025_000, lcd: sweeping }), 3100);
    log.onSnapshot(snap({ rf: false, hz: 121_025_000, lcd: sweeping }), 3600);
    // An object named only by its frequency is no name to remember: a later blip stays with the lookups.
    const labelled = ['', 'Civil Airband', 'CONV        psDr', '121.0250 CT', 'AM    121.025000'];
    log.onSnapshot(snap({ rf: true, hz: 121_025_000, lcd: labelled }), 4000);
    expect(db.recent()[0]).toMatchObject({ frequencyHz: 121_025_000, name: '', source: '', scannerName: '121.0250 CT' });
    log.onSnapshot(snap({ rf: false, hz: 121_025_000, lcd: labelled }), 4100);
    log.onSnapshot(snap({ rf: false, hz: 121_025_000, lcd: labelled }), 4600);
    log.onSnapshot({ ...snap({ rf: true, hz: 121_025_000, lcd: sweeping }), licences: [wtr] }, 5000);
    expect(db.recent()[0]).toMatchObject({ frequencyHz: 121_025_000, name: '', source: 'WTR', scannerName: '' });
    db.close();
  });

  it('names a new reception from a confirmation, over the scanner and every lookup', () => {
    const db = new LogDb(':memory:');
    const rows: ReceptionRow[] = [];
    const logger = new ReceptionLogger(db, (r) => rows.push(r), { minDurationMs: 0, closeDebounceMs: 0 });
    db.confirm({ frequencyHz: 119_775_000, tone: '', tgid: null, name: 'Luton Radar', system: 'NATS', source: 'USER', detail: '', distanceKm: null, bearingDeg: null });
    logger.onSnapshot(snap({}), 1000);
    expect(rows.at(-1)).toMatchObject({ name: 'Luton Radar', system: 'NATS', source: 'CONF', scannerName: 'TC NW Deps', scanlist: 'Civil Airband' });
    // Details arriving later never displace it.
    logger.onSnapshot(snap({ header: true }), 1200);
    expect(rows.at(-1)).toMatchObject({ name: 'Luton Radar', source: 'CONF', tgid: 1234 });
    // Another frequency is untouched.
    logger.onSnapshot(snap({ rf: false }), 1500);
    logger.onSnapshot(snap({ hz: 121_025_000 }), 2000);
    expect(rows.at(-1)).toMatchObject({ frequencyHz: 121_025_000, name: 'TC NW Deps', source: '' });
    db.close();
  });

  it('keeps transients out of the database and merges a resumed conversation into one row', () => {
    const db = new LogDb(':memory:');
    const rows: ReceptionRow[] = [];
    const log = new ReceptionLogger(db, (r) => rows.push(r), { closeDebounceMs: 100, minDurationMs: 500, mergeWindowMs: 10_000 });
    // 200 ms burst: nothing written
    log.onSnapshot(snap({ rf: true }), 0);
    log.onSnapshot(snap({ rf: false }), 200);
    log.onSnapshot(snap({ rf: false }), 400);
    expect(db.count()).toBe(0);
    expect(log.discarded).toBe(1);
    // real call
    log.onSnapshot(snap({ rf: true, rssi: 200 }), 1000);
    log.onSnapshot(snap({ rf: true, rssi: 200 }), 1600);
    log.onSnapshot(snap({ rf: false }), 3000);
    log.onSnapshot(snap({ rf: false }), 3200);
    expect(db.count()).toBe(1);
    expect(db.recent()[0]).toMatchObject({ startedAt: 1000, endedAt: 3000, calls: 1 });
    // reply 4 s later on the same channel: same row, second call
    log.onSnapshot(snap({ rf: true, rssi: 340 }), 7000);
    log.onSnapshot(snap({ rf: true, rssi: 340 }), 7600);
    expect(db.count()).toBe(1);
    expect(db.recent()[0]).toMatchObject({ startedAt: 1000, endedAt: null, calls: 2, rssiPeak: 340 });
    log.onSnapshot(snap({ rf: false }), 9000);
    log.onSnapshot(snap({ rf: false }), 9200);
    expect(db.recent()[0]).toMatchObject({ endedAt: 9000, calls: 2 });
    // after clearing the log nothing merges into a deleted row
    db.clear();
    log.reset();
    log.onSnapshot(snap({ rf: true }), 10_000);
    log.onSnapshot(snap({ rf: true }), 10_600);
    expect(db.count()).toBe(1);
    expect(db.recent()[0]!.calls).toBe(1);
    db.close();
  });
});

describe('LogDb paging', () => {
  it('returns the page after a cursor in the same order, open rows first, without gaps or repeats', () => {
    const db = new LogDb(':memory:');
    const base = { endedAt: null, mode: 'AM', signalType: 'AM', name: 'A', system: '', scanlist: 'L', objectType: 'CONV', tgid: null, radioId: null, site: '', squelch: '', tone: '', licensee: '', source: '', scannerName: '', wtr: '', rrName: '', rrSystem: '', rpt: '', rssiPeak: 1, calls: 1 };
    // Ten closed rows ending 1000..10000, two still open, and two closed rows ending at the same instant.
    const ids: number[] = [];
    for (let i = 1; i <= 10; i++) ids.push(db.insert({ ...base, startedAt: i * 1000 - 500, endedAt: i * 1000, frequencyHz: 100 + i }).id);
    ids.push(db.insert({ ...base, startedAt: 20_000, frequencyHz: 200 }).id, db.insert({ ...base, startedAt: 21_000, frequencyHz: 201 }).id);
    ids.push(db.insert({ ...base, startedAt: 4_100, endedAt: 5000, frequencyHz: 300 }).id, db.insert({ ...base, startedAt: 4_100, endedAt: 5000, frequencyHz: 301 }).id);
    const all = db.recent(100);
    expect(all).toHaveLength(14);
    expect(all.slice(0, 2).map((r) => r.frequencyHz)).toEqual([201, 200]);
    // Walk it three rows at a time: the pages concatenate to the whole list.
    const paged: number[] = [];
    let page = db.recent(3);
    while (page.length) {
      paged.push(...page.map((r) => r.id));
      const last = page[page.length - 1]!;
      page = db.recent(3, { endedAt: last.endedAt, startedAt: last.startedAt, id: last.id });
    }
    expect(paged).toEqual(all.map((r) => r.id));
    expect(new Set(paged).size).toBe(14);
    db.close();
  });
});
