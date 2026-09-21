/**
 * Writer for EZ Scan's CDAT folder: the inverse of `cdat.ts`. Pure functions from the folder's raw
 * (obfuscated) files plus an edited `Programming` to the files to write. Nothing here touches the disk.
 *
 * Every byte the parser does not understand is kept as it was: an edited object is its original record
 * with the known fields rewritten, a new one starts from the constants every record on two cards shared
 * (`TEMPLATE`), a scanlist's flag byte keeps its other bits (they are uninitialised in EZ Scan's own
 * writes). The object file's 17-character header is copied verbatim: it is referenced by nothing else on
 * the card. The index file (`_CI`) is derived: an object's ID (uint32 at byte 8, 0 for most) or -2.
 * The per-list PLnnn.DAT files are the members in record order as ten-byte entries (0, uint16 record,
 * zeros); talkgroup entries (first byte 1) already in a list are kept after them, and the tenth byte,
 * which EZ Scan leaves as memory garbage (always a multiple of 8), is written as 0.
 */
import { CTCSS_TONES, type ProgGlobals, type ProgObject, type ProgScanSet, type ProgScanlist, type Programming } from '../../shared/programming';
import { CG_HEADER, OBJECT_RECORD, decode, parseObjects } from './cdat';

/** A blank record: the bytes constant across 7,412 objects on two cards. */
export const TEMPLATE: Readonly<Uint8Array> = (() => {
  const r = new Uint8Array(OBJECT_RECORD);
  r[0] = 0x7e;
  r[2] = 0x60;
  r[39] = 0x02;
  r[40] = 0x04;
  r[66] = 20;
  r.set([0x55, 0x55, 0x55, 0x55, 0x32, 0x32], 82);
  r[90] = 0xff;
  return r;
})();

const PL_ENTRY = 10;
export const NAME_LENGTH = 16;

const putText = (b: Uint8Array, o: number, n: number, s: string): void => {
  for (let i = 0; i < n; i++) {
    const c = i < s.length ? s.charCodeAt(i) : 0x20;
    b[o + i] = c >= 0x20 && c < 0x7f ? c : 0x3f;
  }
};
const putU32 = (b: Uint8Array, o: number, v: number): void => {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
};
const putI32 = (b: Uint8Array, o: number, v: number): void => putU32(b, o, v >>> 0);
const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** The 25-byte scanlist bitmap at `o` from list numbers (1-200). */
function putBitmap(b: Uint8Array, o: number, lists: readonly number[]): void {
  b.fill(0, o, o + 25);
  for (const n of lists) {
    if (n < 1 || n > 200) continue;
    const at = o + ((n - 1) >> 3);
    b[at] = b[at]! | (1 << ((n - 1) & 7));
  }
}

/** Parse "#RRGGBB" to bytes; null when it is not one. */
function rgb(colour: string | null): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour ?? '');
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : null;
}

/** A record from an object: `base` (its record as read) with the editable fields rewritten, else from `TEMPLATE`. */
export function encodeObject(o: ProgObject, base?: Uint8Array): Uint8Array {
  const r = new Uint8Array(base ?? TEMPLATE);
  putText(r, 49, NAME_LENGTH, o.name);
  putU32(r, 98, Math.round(o.frequencyHz));
  // Modulation: AM / FM / NFM / AUTO in byte 102; a digital object keeps NFM or AUTO there and carries its
  // flag in 122 (DMR, colour-code bit kept) or 123 (NXDN).
  const was = r[102]!;
  r[102] = o.modulation === 'AM' ? 0 : o.modulation === 'FM' ? 1 : o.modulation === 'NFM' ? 2 : o.modulation === 'AUTO' ? 3 : o.modulation === 'DMR' || o.modulation === 'NXDN' ? (was === 2 || was === 3 ? was : 2) : was;
  r[122] = o.digital ? (r[122]! & 0x7f) | 0x80 : r[122]! & 0x6f;
  r[123] = o.nxdn ? 2 : 0;
  // DMode in byte 40 bits 4-5, LED-on in bit 0, bit 2 always set.
  r[40] = (r[40]! & 0xce) | 0x04 | (o.dmode === 'Digital' ? 0x10 : o.dmode === 'Analog' ? 0x20 : 0) | (o.led.on ? 1 : 0);
  r[39] = o.skip ? r[39]! | 0x08 : r[39]! & ~0x08;
  r[66] = Math.max(0, Math.min(255, Math.round(o.delayS * 10)));
  r[81] = o.backlight === 'Leave' ? 0 : o.backlight === 'On' ? 1 : o.backlight === 'Flash' ? 2 : Number(/^Code (\d+)$/.exec(o.backlight)?.[1] ?? r[81]);
  const colour = rgb(o.led.colour);
  r[68] = o.led.on ? 1 : 0;
  if (o.led.on && colour) r.set(colour, 69);
  else if (!o.led.on) r.fill(0, 69, 72);
  // Squelch: byte 103 is 0 None, 1 CTCSS (tone index at 104), 0x44 Search, 0x41 CTCSS whose tone is to be found.
  const t = o.tone;
  if (t.type === 'None') {
    r[103] = 0;
    r[104] = 0;
  } else if (t.type === 'Search') {
    r[103] = 0x44;
    r[104] = 0;
  } else if (t.type === 'CTCSS') {
    const idx = CTCSS_TONES.findIndex((v) => v.toFixed(1) === t.value);
    r[103] = idx >= 0 ? 0x01 : 0x41;
    r[104] = idx >= 0 ? idx : 0;
  }
  // DCS and NAC: no card seen yet carries one, so the editor never produces them; a record read with one
  // keeps its bytes (the `Type N` / DCS branch of `toneOf`).
  putBitmap(r, 12, o.scanlists);
  return r;
}

/** CG000000._CG from the header of the one read and the records, and its ._CI. */
export function buildCg(header: Uint8Array, records: readonly Uint8Array[]): { cg: Uint8Array; ci: Uint8Array } {
  const cg = new Uint8Array(CG_HEADER + records.length * OBJECT_RECORD);
  cg.set(header.subarray(0, CG_HEADER), 0);
  const ci = new Uint8Array(records.length * 4);
  records.forEach((r, i) => {
    cg.set(r, CG_HEADER + i * OBJECT_RECORD);
    const id = u32(r, 8);
    putI32(ci, i * 4, id === 0 ? -2 : id);
  });
  return { cg, ci };
}

/** PLnnn.DAT for one list: its member records in order, then any talkgroup entries the file already had. */
export function buildPl(members: readonly number[], existing?: Uint8Array): Uint8Array {
  const kept: Uint8Array[] = [];
  if (existing) {
    for (let o = 0; o + PL_ENTRY <= existing.length; o += PL_ENTRY) if (existing[o] !== 0) kept.push(existing.subarray(o, o + PL_ENTRY));
  }
  const out = new Uint8Array((members.length + kept.length) * PL_ENTRY);
  members.forEach((rec, i) => {
    out[i * PL_ENTRY + 1] = rec & 0xff;
    out[i * PL_ENTRY + 2] = (rec >> 8) & 0xff;
  });
  kept.forEach((e, i) => {
    out.set(e, (members.length + i) * PL_ENTRY);
    out[(members.length + i) * PL_ENTRY + 9] = 0;
  });
  return out;
}

/** PLDEF.DAT with the names and enabled bits rewritten; the other bits of the flag byte and byte 16 kept. */
export function patchPldef(base: Uint8Array, scanlists: readonly ProgScanlist[]): Uint8Array {
  const out = new Uint8Array(base);
  for (const l of scanlists) {
    const o = (l.number - 1) * 18;
    if (l.number < 1 || o + 18 > out.length) continue;
    putText(out, o, NAME_LENGTH, l.name);
    out[o + 17] = (out[o + 17]! & ~1) | (l.enabled ? 1 : 0);
  }
  return out;
}

export function patchPlsets(base: Uint8Array, sets: readonly ProgScanSet[]): Uint8Array {
  const out = new Uint8Array(base);
  for (const s of sets) {
    const o = (s.number - 1) * 44;
    if (s.number < 1 || o + 44 > out.length) continue;
    putText(out, o, NAME_LENGTH, s.name);
    out[o + 17] = (out[o + 17]! & ~1) | (s.enabled ? 1 : 0);
    putBitmap(out, o + 18, s.scanlists);
  }
  return out;
}

/** The welcome line as the scanner stores it: centred in 16 characters. */
export const centre = (line: string): string => {
  const s = line.trim().slice(0, NAME_LENGTH);
  return ' '.repeat(Math.floor((NAME_LENGTH - s.length) / 2)) + s;
};

export function patchGlb(base: Uint8Array, globals: Pick<ProgGlobals, 'welcome'>): Uint8Array {
  const out = new Uint8Array(base);
  for (let i = 0; i < 5; i++) if (15 + (i + 1) * NAME_LENGTH <= out.length) putText(out, 15 + i * NAME_LENGTH, NAME_LENGTH, centre(globals.welcome[i] ?? ''));
  return out;
}

/** DESCRIPT.TXT: 16 characters, space padded, plain text. */
export function buildDescript(description: string): Uint8Array {
  const out = new Uint8Array(NAME_LENGTH);
  putText(out, 0, NAME_LENGTH, description.trim());
  return out;
}

/** The PLnnn.DAT name for list `n`. */
export const plName = (n: number): string => `PL${String(n).padStart(3, '0')}.DAT`;

/**
 * The files to write for an edited `Programming`, from the folder's raw files (keyed by upper-case name,
 * still obfuscated): the object file and its index, every list's PL file, the scanlist and scan-set
 * definitions, the globals and the description, all obfuscated again. Objects whose `index` is a record
 * of the file read keep that record's unknown bytes; others start from the template. Records are written
 * in the order given, so a deleted object closes its gap and the ones after it renumber.
 */
export function buildCdat(files: ReadonlyMap<string, Uint8Array>, prog: Programming): Map<string, Uint8Array> {
  const get = (name: string): Uint8Array | undefined => {
    const raw = files.get(name.toUpperCase());
    return raw ? decode(raw) : undefined;
  };
  const cgIn = get('CG000000._CG');
  if (!cgIn || cgIn.length < CG_HEADER) throw new Error('The folder has no object file to write over');
  const base = new Map<number, Uint8Array>();
  for (const o of parseObjects(cgIn)) base.set(o.index, cgIn.subarray(CG_HEADER + o.index * OBJECT_RECORD, CG_HEADER + (o.index + 1) * OBJECT_RECORD));
  const records = prog.objects.map((o) => encodeObject(o, base.get(o.index)));
  const out = new Map<string, Uint8Array>();
  const { cg, ci } = buildCg(cgIn, records);
  out.set('CG000000._CG', decode(cg));
  out.set('CG000000._CI', decode(ci));
  const members = new Map<number, number[]>();
  records.forEach((r, i) => {
    for (let n = 0; n < 200; n++) if ((r[12 + (n >> 3)]! >> (n & 7)) & 1) (members.get(n + 1) ?? members.set(n + 1, []).get(n + 1)!).push(i);
  });
  for (let n = 1; n <= 200; n++) {
    const existing = get(plName(n));
    const list = members.get(n) ?? [];
    if (!existing && list.length === 0) continue;
    out.set(plName(n), decode(buildPl(list, existing)));
  }
  const pldef = get('PLDEF.DAT');
  if (pldef) out.set('PLDEF.DAT', decode(patchPldef(pldef, prog.scanlists)));
  const plsets = get('PLSETS.DAT');
  if (plsets) out.set('PLSETS.DAT', decode(patchPlsets(plsets, prog.scanSets)));
  const glb = get('ISCAN___.GLB');
  if (glb) out.set('ISCAN___.GLB', decode(patchGlb(glb, prog.globals)));
  out.set('DESCRIPT.TXT', buildDescript(prog.description));
  return out;
}

/** The record number a PL entry names (for tests and the reader's cross-checks). */
export const plEntryRecord = (pl: Uint8Array, i: number): number => u16(pl, i * PL_ENTRY + 1);
