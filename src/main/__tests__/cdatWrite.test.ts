import { describe, expect, it } from 'vitest';
import { CG_HEADER, OBJECT_RECORD, decode, parseCdat, parseObject, parseObjects } from '../programming/cdat';
import { TEMPLATE, buildCdat, buildCg, buildDescript, buildPl, centre, encodeObject, glbChecksum, patchGlb, patchPldef, plEntryRecord, plName } from '../programming/write';
import type { ProgObject, Programming } from '../../shared/programming';

const ascii = (s: string, n: number): Uint8Array => {
  const b = new Uint8Array(n).fill(0x20);
  for (let i = 0; i < Math.min(n, s.length); i++) b[i] = s.charCodeAt(i);
  return b;
};

/** A record as EZ Scan writes one, with a few of the bytes the parser leaves alone set to odd values. */
function record(name: string, hz: number, extra: Partial<Record<number, number>> = {}): Uint8Array {
  const r = new Uint8Array(TEMPLATE);
  r.set(ascii(name, 16), 49);
  r[98] = hz & 0xff;
  r[99] = (hz >>> 8) & 0xff;
  r[100] = (hz >>> 16) & 0xff;
  r[101] = (hz >>> 24) & 0xff;
  for (const [k, v] of Object.entries(extra)) r[Number(k)] = v!;
  return r;
}

const obj = (over: Partial<ProgObject> = {}): ProgObject => ({
  index: 0,
  name: 'GB3AA',
  frequencyHz: 145_662_500,
  modulation: 'NFM',
  dmode: 'Auto',
  tone: { type: 'CTCSS', value: '94.8' },
  skip: false,
  backlight: 'Leave',
  delayS: 2,
  led: { on: false, colour: null },
  digital: false,
  colourCode: null,
  nxdn: false,
  scanlists: [1, 16, 200],
  ...over,
});

describe('encodeObject', () => {
  it('round-trips through parseObject for every kind of object', () => {
    const cases: ProgObject[] = [
      obj(),
      obj({ modulation: 'AM', tone: { type: 'None', value: '' }, scanlists: [12] }),
      obj({ modulation: 'FM', tone: { type: 'Search', value: '' }, skip: true, backlight: 'Flash', delayS: 5, led: { on: true, colour: '#FF00FF' } }),
      obj({ backlight: 'On' }),
      obj({ modulation: 'AUTO', dmode: 'Analog' }),
      obj({ modulation: 'DMR', dmode: 'Digital', digital: true, colourCode: 'any', tone: { type: 'Search', value: '' } }),
      obj({ modulation: 'NXDN', dmode: 'Digital', nxdn: true, tone: { type: 'Search', value: '' } }),
      obj({ tone: { type: 'CTCSS', value: '67.0' } }),
    ];
    for (const c of cases) expect(parseObject(encodeObject(c), 0)).toEqual({ ...c, index: 0 });
  });

  it('keeps the bytes it does not understand from the record it started from', () => {
    const base = record('OLD NAME', 118_700_000, { 8: 0x33, 9: 0x48, 10: 0x05, 37: 0x17, 122: 0x90, 40: 0x14 });
    const edited = encodeObject(obj({ name: 'NEW NAME', frequencyHz: 121_850_000, modulation: 'DMR', dmode: 'Digital', digital: true, colourCode: 'set', tone: { type: 'None', value: '' } }), base);
    expect(edited[37]).toBe(0x17); // an untouched byte
    expect(edited.subarray(8, 11)).toEqual(new Uint8Array([0x33, 0x48, 0x05])); // the object ID
    expect(edited[122]).toBe(0x90); // DMR with the colour-code bit kept
    expect(parseObject(edited, 3)).toMatchObject({ index: 3, name: 'NEW NAME', frequencyHz: 121_850_000, modulation: 'DMR', colourCode: 'set' });
    // Back to analogue clears the DMR flag but not the colour-code bit's neighbours.
    const analogue = encodeObject(obj({ modulation: 'NFM', dmode: 'Auto' }), edited);
    expect(analogue[122]! & 0x80).toBe(0);
    expect(parseObject(analogue, 0)).toMatchObject({ modulation: 'NFM', digital: false, dmode: 'Auto' });
  });

  it('starts a new object from the template, which parses as a plain channel', () => {
    const r = encodeObject(obj({ name: 'x'.repeat(20), frequencyHz: 453_062_500.4 }));
    expect(r[0]).toBe(0x7e);
    expect(r.subarray(82, 88)).toEqual(new Uint8Array([0x55, 0x55, 0x55, 0x55, 0x32, 0x32]));
    expect(r[90]).toBe(0xff);
    expect(parseObject(r, 0)).toMatchObject({ name: 'x'.repeat(16), frequencyHz: 453_062_500, backlight: 'Leave', delayS: 2 });
  });

  it('writes an unknown CTCSS value as "find the tone" (0x41) rather than a wrong tone', () => {
    const r = encodeObject(obj({ tone: { type: 'CTCSS', value: '95.0' } }));
    expect(r[103]).toBe(0x41);
    expect(parseObject(r, 0).tone).toEqual({ type: 'CTCSS', value: '67.0' });
  });
});

describe('buildCg / buildPl', () => {
  it('copies the header, lays the records out and derives the index file from the object IDs', () => {
    const header = new Uint8Array(CG_HEADER + 5);
    header[0] = 0x13;
    header.set(ascii('9+PG-Y#3[cZ$t\\m]T', 17), 2);
    const a = record('A', 1e8);
    const b = record('B', 1e8, { 8: 0x33, 9: 0x48, 10: 0x05 });
    const { cg, ci } = buildCg(header, [a, b]);
    expect(cg.length).toBe(CG_HEADER + 2 * OBJECT_RECORD);
    expect(cg.subarray(0, CG_HEADER)).toEqual(header.subarray(0, CG_HEADER));
    expect(cg.subarray(CG_HEADER + OBJECT_RECORD, CG_HEADER + 2 * OBJECT_RECORD)).toEqual(b);
    expect(new DataView(ci.buffer).getInt32(0, true)).toBe(-2);
    expect(new DataView(ci.buffer).getInt32(4, true)).toBe(0x054833);
  });

  it('writes members as ten-byte entries and keeps a list\'s talkgroup entries after them, tenth byte zeroed', () => {
    const existing = new Uint8Array([0, 5, 0, 0, 0, 0, 0, 0, 0, 0x30, 1, 0xef, 0xa9, 0xff, 0x80, 1, 0, 0, 0, 0x70, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0x78]);
    const pl = buildPl([2, 300], existing);
    expect(pl.length).toBe(30);
    expect(plEntryRecord(pl, 0)).toBe(2);
    expect(plEntryRecord(pl, 1)).toBe(300);
    expect(pl.subarray(20, 30)).toEqual(new Uint8Array([1, 0xef, 0xa9, 0xff, 0x80, 1, 0, 0, 0, 0]));
    expect(pl[9]).toBe(0);
    expect(buildPl([]).length).toBe(0);
  });
});

describe('patchPldef / patchGlb', () => {
  it('rewrites names and flag bits, leaving the other bits of the flag bytes alone', () => {
    const base = new Uint8Array(201 * 18);
    base.set(ascii('OLD', 16), 0);
    base[17] = 0xc9; // enabled plus garbage bits
    base[16] = 0x05; // not understood: kept
    const out = patchPldef(base, [
      { number: 1, name: 'AIR', enabled: false, objects: [] },
      { number: 2, name: 'WTR 1', enabled: true, objects: [] },
    ]);
    expect(new TextDecoder().decode(out.subarray(0, 16))).toBe('AIR             ');
    expect(out[16]).toBe(0x05);
    expect(out[17]).toBe(0xc8);
    expect(out[18 + 17]).toBe(1);
    expect(base[17]).toBe(0xc9); // the input is not mutated
  });

  it('centres each welcome line in its 16 characters', () => {
    expect(centre('WHISTLER')).toBe('    WHISTLER');
    expect(centre('Trunking Scanner')).toBe('Trunking Scanner');
    expect(centre('a much longer line than fits')).toBe('a much longer li');
    const glb = new Uint8Array(1706);
    glb[573] = 0x16;
    glb[575] = 0x0b;
    glb[589] = 0x06;
    glb[598] = 0x0b;
    glb[607] = 0x0b;
    for (const o of [615, 633, 651, 669]) {
      glb[o] = 0x0a;
      glb.fill(0xff, o + 1, o + 17);
    }
    const out = patchGlb(glb, {
      welcome: ['WHISTLER', 'TRX-1e', '', '', 'MOONRAKER UK'],
      searchDelayS: 2.5,
      wxButton: 3,
      lockoutsHz: [450_500_000, 145_500_000, 145_500_000],
      search: {
        publicSafety: { attenuator: false, zeromatic: false, delay: true, groups: [false, true, true, true, true] },
        limit: { attenuator: true, zeromatic: false, delay: false, lowHz: 25_000_000, highHz: 1_300_000_000 },
        uvhfAm: { attenuator: false, zeromatic: true, delay: true, groups: [true, true, false, false] },
        sweeper: { specialMode: true, groups: [false, false, true, false, false, true, false, true, true, false] },
        amateur: { attenuator: true, zeromatic: false, delay: false, groups: [true, true, true, true, true, true, true, true] },
        channels: {
          cbUk: { attenuator: false, zeromatic: false, delay: true, enabled: [false, false, ...Array(38).fill(true)] },
          mosque: { attenuator: true, zeromatic: false, delay: false, enabled: Array(23).fill(true) },
          vhfMarine: { attenuator: false, zeromatic: false, delay: true, enabled: [true, false, ...Array(95).fill(true)] },
          pmr446: { attenuator: false, zeromatic: false, delay: true, enabled: Array(32).fill(true) },
        },
      },
    });
    expect(new TextDecoder().decode(out.subarray(15, 31))).toBe('    WHISTLER    ');
    expect(new TextDecoder().decode(out.subarray(31, 47))).toBe('     TRX-1e     ');
    expect(new TextDecoder().decode(out.subarray(47, 63))).toBe(' '.repeat(16));
    expect(out[512]).toBe(25);
    expect(out[566]).toBe(3);
    // Search blocks: only the decoded bits move, the others in each flags byte stay.
    expect([out[571], out[572], out[573], out[575], out[589], out[590], out[598], out[599], out[607], out[608]]).toEqual([0xa4, 0x01, 0x36, 0x06, 0x0b, 0x03, 0x06, 0xff, 0x0a, 0x1e]);
    expect([out[615], out[616], out[617], out[633], out[651], out[652], out[669]]).toEqual([0x0a, 0xfc, 0xff, 0x06, 0x0a, 0xfd, 0x0a]);
    expect(out[616 + 5]).toBe(0xff); // CB has 40 rows: bits past them stay as read
    expect(new DataView(out.buffer).getUint32(576, true)).toBe(25_000_000);
    expect(new DataView(out.buffer).getUint32(580, true)).toBe(1_300_000_000);
    // Lockouts lowest first, once each, the rest of the table clear.
    expect(new DataView(out.buffer).getUint32(694, true)).toBe(145_500_000);
    expect(new DataView(out.buffer).getUint32(698, true)).toBe(450_500_000);
    expect(new DataView(out.buffer).getUint32(702, true)).toBe(0);
    // The check in bytes 2-3 makes the sum of the file from byte 4 plus itself 0xFFFF.
    let sum = 0;
    for (let i = 4; i < out.length; i++) sum += out[i]!;
    expect(((out[2]! | (out[3]! << 8)) + sum) & 0xffff).toBe(0xffff);
    expect(glbChecksum(out)).toBe(out[2]! | (out[3]! << 8));
  });

  it('writes the description on one line, or two when a word does not fit', () => {
    expect(new TextDecoder().decode(buildDescript('UK Starter'))).toBe('UK Starter      ' + ' '.repeat(48));
    expect(new TextDecoder().decode(buildDescript('TRXC Import Tests'))).toBe('TRXC Import     Tests           ' + ' '.repeat(32));
    expect(new TextDecoder().decode(buildDescript('a'.repeat(40)).subarray(0, 16))).toBe('a'.repeat(16));
    expect(new TextDecoder().decode(buildDescript('one two three four five six seven eight nine ten eleven twelve thirteen'))).toBe('one two three   four five six   seven eight nineten eleven      ');
  });
});

describe('buildCdat', () => {
  /** A small card: three objects, two lists, one list file with a talkgroup entry. */
  function card(): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const enc = (name: string, plain: Uint8Array): void => {
      files.set(name, decode(plain));
    };
    const header = new Uint8Array(CG_HEADER);
    header[0] = 0x13;
    header.set(ascii('q@)iep=L`%n"1}cS`', 17), 2);
    const recs = [record('TC NW Deps', 119_775_000, { 12: 0x01, 36: 0x11 }), record('Uni of Bucks', 453_062_500, { 12: 0x02, 8: 0x07 }), record('GB3AA', 145_662_500, { 12: 0x03 })];
    const cg = new Uint8Array(CG_HEADER + recs.length * OBJECT_RECORD);
    cg.set(header);
    recs.forEach((r, i) => cg.set(r, CG_HEADER + i * OBJECT_RECORD));
    enc('CG000000._CG', cg);
    enc('CG000000._CI', new Uint8Array(12));
    const pldef = new Uint8Array(201 * 18);
    for (let n = 0; n < 201; n++) pldef.set(ascii('', 16), n * 18);
    pldef.set(ascii('AIR', 16), 0);
    pldef[17] = 0x81;
    pldef.set(ascii('WTR 1', 16), 18);
    pldef[18 + 17] = 1;
    enc('PLDEF.DAT', pldef);
    const plsets = new Uint8Array(20 * 44);
    for (let n = 0; n < 20; n++) plsets.set(ascii('', 16), n * 44);
    enc('PLSETS.DAT', plsets);
    enc('ISCAN___.GLB', new Uint8Array(1706));
    enc(plName(1), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0x30, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0x30]));
    enc(plName(2), new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0x70, 1, 0xef, 0xa9, 0xff, 0x80, 1, 0, 0, 0, 0x70]));
    files.set('DESCRIPT.TXT', ascii('UK Starter', 16));
    return files;
  }

  it('writes the edited objects, renumbering after a deletion, and regenerates the list files, index, definitions and description', () => {
    const files = card();
    const before = parseCdat('/card/CDAT', files);
    expect(before.objects.map((o) => o.name)).toEqual(['TC NW Deps', 'Uni of Bucks', 'GB3AA']);
    // Delete the first, rename the second, move the third to list 1 only, add a fourth in list 2.
    const edited: Programming = {
      ...before,
      description: 'UK Starter v2',
      objects: [
        { ...before.objects[1]!, name: 'Bucks Uni' },
        { ...before.objects[2]!, scanlists: [1] },
        obj({ index: 3, name: 'New one', frequencyHz: 156_800_000, modulation: 'FM', tone: { type: 'None', value: '' }, scanlists: [2] }),
      ],
      scanlists: before.scanlists.map((l) => (l.number === 1 ? { ...l, name: 'AIRBAND', enabled: false } : l)),
      globals: { ...before.globals, welcome: ['HELLO', '', '', '', ''], lockoutsHz: [156_800_000] },
    };
    const out = buildCdat(files, edited);
    const after = parseCdat('/card/CDAT', new Map([...files, ...out]));
    expect(after.description).toBe('UK Starter v2');
    expect(after.objects.map((o) => [o.index, o.name, o.frequencyHz, o.scanlists])).toEqual([
      [0, 'Bucks Uni', 453_062_500, [2]],
      [1, 'GB3AA', 145_662_500, [1]],
      [2, 'New one', 156_800_000, [2]],
    ]);
    // The renamed object kept its unknown bytes and its ID; the index file follows.
    const cg = decode(out.get('CG000000._CG')!);
    expect(cg[CG_HEADER + 8]).toBe(0x07);
    const ci = decode(out.get('CG000000._CI')!);
    expect(new DataView(ci.buffer, ci.byteOffset).getInt32(0, true)).toBe(7);
    expect(new DataView(ci.buffer, ci.byteOffset).getInt32(4, true)).toBe(-2);
    expect(ci.length).toBe(12);
    // List files: list 1 = record 1; list 2 = records 0 and 2, then the talkgroup entry kept.
    const pl1 = decode(out.get(plName(1))!);
    expect(pl1.length).toBe(10);
    expect(plEntryRecord(pl1, 0)).toBe(1);
    const pl2 = decode(out.get(plName(2))!);
    expect(pl2.length).toBe(30);
    expect([plEntryRecord(pl2, 0), plEntryRecord(pl2, 1)]).toEqual([0, 2]);
    expect(pl2[20]).toBe(1);
    expect(pl2[29]).toBe(0);
    // Lists nobody uses and that had no file get none; the definitions and globals carry the edits.
    expect(out.has(plName(3))).toBe(false);
    expect(after.scanlists[0]).toMatchObject({ name: 'AIRBAND', enabled: false, objects: [1] });
    expect(decode(out.get('PLDEF.DAT')!)[17]).toBe(0x80);
    expect(after.globals.welcome).toEqual(['HELLO', '', '', '', '']);
    expect(after.globals.lockoutsHz).toEqual([156_800_000]);
    expect(new TextDecoder().decode(out.get('DESCRIPT.TXT')!.subarray(0, 16))).toBe('UK Starter v2   ');
    expect(out.get('DESCRIPT.TXT')!.length).toBe(64);
    // The globals file's check is right after the welcome text changed.
    const glbOut = decode(out.get('ISCAN___.GLB')!);
    expect(glbOut[2]! | (glbOut[3]! << 8)).toBe(glbChecksum(glbOut));
    // Every written file is obfuscated: a raw read decodes it.
    expect(parseObjects(decode(out.get('CG000000._CG')!))).toHaveLength(3);
  });

  it('writes the same bytes back when nothing changed', () => {
    const files = card();
    const prog = parseCdat('/card/CDAT', files);
    const out = buildCdat(files, prog);
    expect(out.get('CG000000._CG')).toEqual(files.get('CG000000._CG'));
    expect(out.get('PLDEF.DAT')).toEqual(files.get('PLDEF.DAT'));
    expect(out.get('DESCRIPT.TXT')!.subarray(0, 16)).toEqual(files.get('DESCRIPT.TXT'));
    // The list files are canonical: the garbage tenth byte goes, nothing else moves.
    expect(decode(out.get(plName(2))!).subarray(0, 9)).toEqual(decode(files.get(plName(2))!).subarray(0, 9));
  });

  it('refuses a folder without an object file', () => {
    expect(() => buildCdat(new Map(), { dir: 'x', description: '', globals: { welcome: [], signalBars: [], lastTuneHz: null, searchDelayS: null, wxButton: null, lockoutsHz: [], search: null }, objects: [], scanlists: [], scanSets: [], trunked: [], readAt: 0 })).toThrow(/object file/);
  });
});
