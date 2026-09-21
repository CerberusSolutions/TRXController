import { describe, expect, it } from 'vitest';
import { CG_HEADER, OBJECT_RECORD, decode, parseCdat, parseObject } from '../programming/cdat';
import { keystream } from '../programming/keystream';

/** A blank object record with the constants every real one carries. */
function record(o: { name: string; hz: number; mod?: number; tone?: number; toneIdx?: number; skip?: boolean; led?: [number, number, number]; lists?: number[]; b40?: number; b122?: number; b123?: number; backlight?: number; delay?: number }): Uint8Array {
  const r = new Uint8Array(OBJECT_RECORD);
  r[0] = 0x7e;
  r[2] = 0x60;
  r[39] = o.skip ? 0x0a : 0x02;
  r[40] = o.b40 ?? 0x04;
  for (let i = 0; i < 16; i++) r[49 + i] = i < o.name.length ? o.name.charCodeAt(i) : 0x20;
  r[66] = o.delay ?? 20;
  if (o.led) {
    r[68] = 1;
    [r[69], r[70], r[71]] = o.led;
  }
  r[81] = o.backlight ?? 0;
  r.set([0x55, 0x55, 0x55, 0x55, 0x32, 0x32], 82);
  r[90] = 0xff;
  r[98] = o.hz & 0xff;
  r[99] = (o.hz >>> 8) & 0xff;
  r[100] = (o.hz >>> 16) & 0xff;
  r[101] = (o.hz >>> 24) & 0xff;
  r[102] = o.mod ?? 0;
  r[103] = o.tone ?? 0;
  r[104] = o.toneIdx ?? 0;
  r[122] = o.b122 ?? 0;
  r[123] = o.b123 ?? 0;
  for (const n of o.lists ?? []) r[12 + ((n - 1) >> 3)] |= 1 << ((n - 1) & 7);
  return r;
}

const ascii = (s: string, n: number): Uint8Array => {
  const b = new Uint8Array(n).fill(0x20);
  for (let i = 0; i < Math.min(n, s.length); i++) b[i] = s.charCodeAt(i);
  return b;
};

function cg(records: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(CG_HEADER + records.length * OBJECT_RECORD);
  out[0] = 0x13;
  out.set(ascii('9+PG-Y#3[cZ$t\\m]T', 17), 2);
  records.forEach((r, i) => out.set(r, CG_HEADER + i * OBJECT_RECORD));
  return out;
}

describe('CDAT keystream', () => {
  it('is 13,568 bytes and decoding is its own inverse', () => {
    expect(keystream().length).toBe(13568);
    const plain = new Uint8Array(30000).map((_, i) => i & 0xff);
    expect(decode(decode(plain))).toEqual(plain);
    // A blank file decodes to the key itself, which is how the key was recovered.
    expect(decode(new Uint8Array(20))).toEqual(keystream().subarray(0, 20));
  });
});

describe('object records', () => {
  it('reads name, frequency, modulation, tone, flags, LED and scanlists as EZ Scan shows them', () => {
    const r = parseObject(record({ name: 'GB3AA', hz: 145_662_500, mod: 2, tone: 1, toneIdx: 10, lists: [1, 16, 200], led: [0xff, 0x00, 0xff] }), 7);
    expect(r).toMatchObject({ index: 7, name: 'GB3AA', frequencyHz: 145_662_500, modulation: 'NFM', dmode: 'Auto', tone: { type: 'CTCSS', value: '94.8' }, skip: false, backlight: 'Leave', delayS: 2, led: { on: true, colour: '#FF00FF' }, digital: false, colourCode: null, nxdn: false, scanlists: [1, 16, 200] });
  });

  it('tells AM, FM, NFM, DMR, NXDN and AUTO apart, and the digital mode and search squelch', () => {
    expect(parseObject(record({ name: 'a', hz: 1e8, mod: 0 }), 0).modulation).toBe('AM');
    expect(parseObject(record({ name: 'a', hz: 1e8, mod: 1 }), 0).modulation).toBe('FM');
    expect(parseObject(record({ name: 'a', hz: 1e8, mod: 3 }), 0).modulation).toBe('AUTO');
    const dmr = parseObject(record({ name: 'DVU12', hz: 439_150_000, mod: 3, tone: 0x44, b40: 0x15, b122: 0x80, led: [0xff, 0, 0xff] }), 0);
    expect(dmr).toMatchObject({ modulation: 'DMR', dmode: 'Digital', digital: true, colourCode: 'any', tone: { type: 'Search', value: '' } });
    expect(parseObject(record({ name: 'cc', hz: 1e8, mod: 2, b122: 0x90 }), 0).colourCode).toBe('set');
    expect(parseObject(record({ name: 'nx', hz: 1e8, mod: 2, b123: 2 }), 0)).toMatchObject({ modulation: 'NXDN', nxdn: true });
    expect(parseObject(record({ name: 'an', hz: 1e8, mod: 2, b40: 0x24 }), 0).dmode).toBe('Analog');
    expect(parseObject(record({ name: 's', hz: 1e8, skip: true, backlight: 2, delay: 50 }), 0)).toMatchObject({ skip: true, backlight: 'Flash', delayS: 5 });
  });
});

describe('parseCdat', () => {
  it('decodes a whole folder: objects, scanlists with members and flags, scan sets, globals and a trunked system', () => {
    const files = new Map<string, Uint8Array>();
    const enc = (name: string, plain: Uint8Array): void => {
      files.set(name, decode(plain));
    };
    enc('CG000000._CG', cg([record({ name: 'TC NW Deps', hz: 119_775_000, lists: [12] }), new Uint8Array(OBJECT_RECORD), record({ name: 'Uni of Bucks', hz: 453_062_500, mod: 3, lists: [7] })]));
    const pldef = new Uint8Array(201 * 18);
    for (let n = 0; n < 201; n++) pldef.set(ascii('', 16), n * 18);
    pldef.set(ascii('HAM UK A+D Rpts', 16), 0);
    pldef[17] = 1;
    pldef.set(ascii('Civil Airband', 16), 11 * 18);
    pldef[11 * 18 + 16] = 1;
    pldef[11 * 18 + 17] = 1;
    enc('PLDEF.DAT', pldef);
    const plsets = new Uint8Array(20 * 44);
    for (let n = 0; n < 20; n++) plsets.set(ascii('', 16), n * 44);
    plsets.set(ascii('AIR', 16), 44);
    plsets[44 + 17] = 1;
    plsets[44 + 18 + 1] |= 1 << 3; // scanlist 12
    enc('PLSETS.DAT', plsets);
    const glb = new Uint8Array(1706);
    const centred = (l: string): string => ' '.repeat(Math.floor((16 - l.length) / 2)) + l;
    ['WHISTLER', 'TRX-1e', 'Handheld', 'Trunking Scanner', 'MOONRAKER UK'].forEach((l, i) => glb.set(ascii(centred(l), 16), 15 + i * 16));
    [190, 230, 260, 290, 320].forEach((v, i) => {
      glb[100 + i * 2] = v & 0xff;
      glb[101 + i * 2] = v >> 8;
    });
    const tune = 145_637_500;
    glb.set([tune & 0xff, (tune >> 8) & 0xff, (tune >> 16) & 0xff, (tune >>> 24) & 0xff], 153);
    enc('ISCAN___.GLB', glb);
    const ts = new Uint8Array(35 + 654 * 2);
    ts.set(ascii('USAF Bases UK', 16), 19);
    const site = (o: number, name: string, hz: number[]): void => {
      hz.forEach((h, i) => ts.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff, (h >>> 24) & 0xff], o + i * 6));
      ts.set(ascii(name, 16), o + 192);
    };
    site(35, 'RAF Croughton', [417_725_000, 418_100_000]);
    site(35 + 654, 'RAF Lakenheath', [409_025_000]);
    enc('TS000001._TS', ts);
    const gd = new Uint8Array(3000);
    const tg = record({ name: 'FireEMS', hz: 43503, lists: [4] });
    tg[0] = 0x74;
    gd.set(tg, 777);
    enc('TS000001._GD', gd);
    files.set('DESCRIPT.TXT', ascii('UK Starter', 16));

    const p = parseCdat('/media/card/CDAT', files, 1234);
    expect(p.description).toBe('UK Starter');
    expect(p.objects.map((o) => [o.index, o.name, o.frequencyHz])).toEqual([
      [0, 'TC NW Deps', 119_775_000],
      [2, 'Uni of Bucks', 453_062_500],
    ]);
    // Membership comes from each object's bitmap: object 0 is in list 12, object 2 in list 7.
    const l12 = p.scanlists.find((l) => l.number === 12)!;
    expect(l12).toMatchObject({ name: 'Civil Airband', enabled: true, isDefault: true, objects: [0] });
    expect(p.scanlists.find((l) => l.number === 7)!.objects).toEqual([2]);
    expect(p.scanlists[0]).toMatchObject({ number: 1, name: 'HAM UK A+D Rpts', enabled: true, isDefault: false, objects: [] });
    expect(p.scanSets[1]).toMatchObject({ number: 2, name: 'AIR', enabled: true, scanlists: [12] });
    expect(p.globals).toEqual({ welcome: ['WHISTLER', 'TRX-1e', 'Handheld', 'Trunking Scanner', 'MOONRAKER UK'], signalBars: [190, 230, 260, 290, 320], lastTuneHz: 145_637_500 });
    expect(p.trunked).toHaveLength(1);
    expect(p.trunked[0]).toMatchObject({ number: 1, name: 'USAF Bases UK' });
    expect(p.trunked[0]!.sites.map((s) => [s.name, s.frequenciesHz])).toEqual([
      ['RAF Croughton', [417_725_000, 418_100_000]],
      ['RAF Lakenheath', [409_025_000]],
    ]);
    expect(p.trunked[0]!.talkgroups).toEqual([{ name: 'FireEMS', id: 43503, scanlists: [4] }]);
    expect(p.readAt).toBe(1234);
  });

  it('reads a two-line description as one line', () => {
    const two = new Uint8Array(32).fill(0x20);
    two.set(ascii('TRXC Import', 16), 0);
    two.set(ascii('Tests', 16), 16);
    expect(parseCdat('x', new Map([['DESCRIPT.TXT', two]])).description).toBe('TRXC Import Tests');
  });

  it('copes with a folder missing files', () => {
    const p = parseCdat('x', new Map());
    expect(p.objects).toEqual([]);
    expect(p.scanlists).toEqual([]);
    expect(p.trunked).toEqual([]);
    expect(p.globals.welcome).toEqual([]);
  });
});
