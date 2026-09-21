/**
 * Reader for EZ Scan's CDAT folder, the scanner's programming as written to its SD card (the card
 * mounts as a drive while the scanner is off). Pure functions over bytes; `readCdat` in main does the
 * file reading. Layout worked out on 21 Sep 2026 from two cards and their EZ Scan CSV exports (every
 * varying column solved by correlation; see CLAUDE.md "Programming (CDAT)"):
 *
 * - Every file is XORed with `keystream()` from byte 0 (DESCRIPT.TXT is plain text).
 * - CG000000._CG: 19-byte header (0x13 0x00 + a 17-char signature), then 126-byte object records.
 *   CG000000._CI: one int32 per record (-2 = unused index slot).
 * - Scanlist membership is the 25-byte bitmap at byte 12 of each object (bit n = scanlist n+1); the PLnnn.DAT
 *   files are the same membership as ten-byte entries (see write.ts) and are not read. PLDEF.DAT: 201 x 18 bytes, name (16),
 *   a byte always 0, and a flag byte whose bit 0 is enabled (EZ Scan's Default marker is not on the card: byte 16 stayed 0
 *   on the list EZ Scan showed as Default, 21 Sep 2026).
 *   PLSETS.DAT: 20 x 44 bytes, name (16), ?, enabled, 25-byte scanlist bitmap, ?.
 * - TSnnnnnn._TS: a trunked system, name at 19, then 654-byte site records (32 x 6-byte frequency
 *   entries, then the name); ._GD: its talkgroups as 126-byte object-shaped records, scattered.
 * - ISCAN___.GLB: a 15-byte header (bytes 2-3 the check, see write.ts; 8-12 backlight timeout, contrast, speaker,
 *   headphone and key volume), the five welcome lines (16 each, centred) at 15, the five signal-bar thresholds at 100,
 *   the last Tune Mode frequency at 153, the search delay in tenths at 512, the WX button's search at 566, the search
 *   blocks (Sweeper groups as bits at 571-572 and its flags at 573, bit 5 Special Mode; Limit flags at 575 with its
 *   range as uint32 Hz at 576 and 580; U/VHF AM flags at 589 and groups at 590; Amateur flags at 598 and groups at 599 (group 1 moved bit 0); Public Safety
 *   flags at 607 and groups at 608; the four channel-table searches at 615, 633, 651 and 669, a flags byte then 128
 *   channel bits, not decoded; in a flags byte bit 0 is Zeromatic, bit 2 Attenuator, bit 3 Delay, bit 1 always set), and the lockouts from 694 to the end
 *   as uint32 Hz (found by EZ Scan's own saves, one change each, 21 Sep 2026).
 */
import { CHANNEL_SEARCHES } from '../../shared/searchChannels';
import { CTCSS_TONES, FLAG_ATTENUATOR, GLB_CHANNEL_BLOCKS, GLB_CHANNELS_END, FLAG_DELAY, FLAG_ZEROMATIC, GLB_AMATEUR_FLAGS, GLB_AMATEUR_GROUPS, GLB_UVHF_FLAGS, GLB_UVHF_GROUPS, GLB_LIMIT_FLAGS, GLB_LIMIT_HIGH, GLB_LIMIT_LOW, GLB_LOCKOUTS, GLB_PS_FLAGS, GLB_PS_GROUPS, GLB_SEARCH_DELAY, GLB_SEARCH_END, GLB_SWEEPER_FLAGS, GLB_SWEEPER_GROUPS, GLB_WX_BUTTON, type DMode, type ProgSearch, type SearchOptions, type Modulation, type ProgGlobals, type ProgObject, type ProgScanSet, type ProgScanlist, type ProgSite, type ProgTalkgroup, type ProgTrunkedSystem, type Programming, type ToneSetting } from '../../shared/programming';
import { keystream } from './keystream';

export const OBJECT_RECORD = 126;
export const CG_HEADER = 19;
const SITE_RECORD = 654;
const SITE_FREQS = 32;

/** XOR with the keystream: the same operation encodes and decodes. */
export function decode(data: Uint8Array): Uint8Array {
  const k = keystream();
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i]! ^ k[i % k.length]!;
  return out;
}

const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const text = (b: Uint8Array, o: number, n: number): string => {
  let s = '';
  for (let i = 0; i < n; i++) {
    const c = b[o + i]!;
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : c === 0 ? '' : '?';
  }
  return s.replace(/\s+$/, '');
};

/** Scanlist numbers (1-200) from the 25-byte bitmap at `o`. */
function bitmapLists(b: Uint8Array, o: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 200; i++) if ((b[o + (i >> 3)]! >> (i & 7)) & 1) out.push(i + 1);
  return out;
}

function modulationOf(r: Uint8Array): Modulation {
  const m = r[102]!;
  if (r[123] === 2) return 'NXDN';
  if (r[122]! & 0x80) return 'DMR';
  return m === 0 ? 'AM' : m === 1 ? 'FM' : m === 2 ? 'NFM' : m === 3 ? 'AUTO' : `Mode ${m}`;
}

function dmodeOf(r: Uint8Array): DMode {
  const d = r[40]! & 0x30;
  return d === 0x10 ? 'Digital' : d === 0x20 ? 'Analog' : 'Auto';
}

function toneOf(r: Uint8Array): ToneSetting {
  const t = r[103]!;
  const kind = t & 0x0f;
  if (t === 0) return { type: 'None', value: '' };
  if (kind === 1) return { type: 'CTCSS', value: CTCSS_TONES[r[104]!] !== undefined ? CTCSS_TONES[r[104]!]!.toFixed(1) : `#${r[104]}` };
  if (kind === 2) return { type: 'DCS', value: `#${r[104]}` };
  if (t & 0x40) return { type: 'Search', value: '' };
  return { type: `Type ${t}`, value: `#${r[104]}` };
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();

/** One 126-byte object record. */
export function parseObject(r: Uint8Array, index: number): ProgObject {
  const digital = (r[122]! & 0x80) !== 0;
  return {
    index,
    name: text(r, 49, 16),
    frequencyHz: u32(r, 98),
    modulation: modulationOf(r),
    dmode: dmodeOf(r),
    tone: toneOf(r),
    skip: (r[39]! & 0x08) !== 0,
    backlight: r[81] === 0 ? 'Leave' : r[81] === 1 ? 'On' : r[81] === 2 ? 'Flash' : `Code ${r[81]}`,
    delayS: r[66]! / 10,
    led: { on: r[68] === 1, colour: r[68] === 1 ? `#${hex2(r[69]!)}${hex2(r[70]!)}${hex2(r[71]!)}` : null },
    digital,
    colourCode: digital ? ((r[122]! & 0x10) !== 0 ? 'set' : 'any') : null,
    nxdn: r[123] === 2,
    scanlists: bitmapLists(r, 12),
  };
}

/** Every object in a decoded CG000000._CG. */
export function parseObjects(cg: Uint8Array): ProgObject[] {
  const out: ProgObject[] = [];
  for (let o = CG_HEADER; o + OBJECT_RECORD <= cg.length; o += OBJECT_RECORD) {
    const r = cg.subarray(o, o + OBJECT_RECORD);
    if (r[0] === 0 && r[98] === 0 && r[99] === 0 && r[100] === 0 && r[101] === 0) continue; // an unused slot
    out.push(parseObject(r, (o - CG_HEADER) / OBJECT_RECORD));
  }
  return out;
}

/**
 * PLDEF.DAT → the 200 scanlists, with their members taken from the objects' own bitmaps. (The PLnnn.DAT
 * files are not the membership: on one card list 1 had 344 members by bitmap and an empty PL000.DAT,
 * list 12 had 878 and 39; the bitmap agreed with EZ Scan's CSV on all 7,412 objects of two cards.)
 */
export function parseScanlists(pldef: Uint8Array, objects: readonly ProgObject[]): ProgScanlist[] {
  const members = new Map<number, number[]>();
  for (const o of objects) for (const n of o.scanlists) (members.get(n) ?? members.set(n, []).get(n)!).push(o.index);
  const out: ProgScanlist[] = [];
  for (let n = 1; n <= 200; n++) {
    const o = (n - 1) * 18;
    if (o + 18 > pldef.length) break;
    out.push({ number: n, name: text(pldef, o, 16), enabled: (pldef[o + 17]! & 1) !== 0, objects: members.get(n) ?? [] });
  }
  return out;
}

export function parseScanSets(plsets: Uint8Array): ProgScanSet[] {
  const out: ProgScanSet[] = [];
  for (let n = 1; n <= 20; n++) {
    const o = (n - 1) * 44;
    if (o + 44 > plsets.length) break;
    out.push({ number: n, name: text(plsets, o, 16), enabled: (plsets[o + 17]! & 1) !== 0, scanlists: bitmapLists(plsets, o + 18) });
  }
  return out;
}

const plausibleHz = (hz: number): boolean => hz >= 25_000_000 && hz <= 1_300_000_000;

/** TSnnnnnn._TS: the system's name and its sites; ._GD: its talkgroups. */
export function parseTrunked(number: number, ts: Uint8Array, gd: Uint8Array | undefined): ProgTrunkedSystem {
  const name = text(ts, 19, 16);
  const sites: ProgSite[] = [];
  // Site records: 32 six-byte frequency entries then the 16-char name. The first starts where the
  // system header ends; walk by record size while a name is there.
  const first = findSiteStart(ts);
  if (first !== null) {
    for (let o = first; o + SITE_FREQS * 6 + 16 <= ts.length; o += SITE_RECORD) {
      const siteName = text(ts, o + SITE_FREQS * 6, 16);
      const freqs: number[] = [];
      for (let i = 0; i < SITE_FREQS; i++) {
        const hz = u32(ts, o + i * 6);
        if (plausibleHz(hz)) freqs.push(hz);
      }
      if (!siteName && freqs.length === 0) break;
      sites.push({ name: siteName, frequenciesHz: freqs });
    }
  }
  const talkgroups: ProgTalkgroup[] = [];
  if (gd) {
    // Talkgroup records share the object layout (name at 49, the ID where an object keeps its
    // frequency) but sit at arbitrary offsets; the constant 'UUUU22' at 82 marks them.
    for (let o = 0; o + OBJECT_RECORD <= gd.length; o++) {
      if (gd[o + 82] !== 0x55 || gd[o + 83] !== 0x55 || gd[o + 84] !== 0x55 || gd[o + 85] !== 0x55 || gd[o + 86] !== 0x32 || gd[o + 87] !== 0x32) continue;
      const r = gd.subarray(o, o + OBJECT_RECORD);
      const tgName = text(r, 49, 16);
      if (!tgName) continue;
      talkgroups.push({ name: tgName, id: u32(r, 98), scanlists: bitmapLists(r, 12) });
      o += OBJECT_RECORD - 1;
    }
  }
  return { number, name, sites, talkgroups };
}

/** The first site record: 32 frequency slots followed by a name, the earliest such name after the header. */
function findSiteStart(ts: Uint8Array): number | null {
  for (let o = 35; o + SITE_FREQS * 6 + 16 <= ts.length; o++) {
    const nameAt = o + SITE_FREQS * 6;
    if (!text(ts, nameAt, 16)) continue;
    // A real site name is printable across its 16 bytes (space padded), and at least one slot before it is a frequency.
    let printable = true;
    for (let i = 0; i < 16; i++) {
      const c = ts[nameAt + i]!;
      if (c < 0x20 || c >= 0x7f) printable = false;
    }
    if (printable && plausibleHz(u32(ts, o))) return o;
  }
  return null;
}

const options = (flags: number): SearchOptions => ({ attenuator: (flags & FLAG_ATTENUATOR) !== 0, zeromatic: (flags & FLAG_ZEROMATIC) !== 0, delay: (flags & FLAG_DELAY) !== 0 });

export function parseGlobals(glb: Uint8Array): ProgGlobals {
  const welcome: string[] = [];
  // Five 16-character slots from byte 15, the text centred with spaces as the scanner draws it.
  for (let i = 0; i < 5; i++) welcome.push(text(glb, 15 + i * 16, 16).trim());
  const signalBars: number[] = [];
  for (let i = 0; i < 5; i++) signalBars.push(u16(glb, 100 + i * 2));
  const tune = glb.length >= 157 ? u32(glb, 153) : 0;
  const lockoutsHz: number[] = [];
  for (let o = GLB_LOCKOUTS; o + 4 <= glb.length; o += 4) {
    const hz = u32(glb, o);
    if (plausibleHz(hz)) lockoutsHz.push(hz);
  }
  lockoutsHz.sort((a, b) => a - b);
  const bits = (o: number, n: number): boolean[] => Array.from({ length: n }, (_, i) => ((glb[o + (i >> 3)]! >> (i & 7)) & 1) === 1);
  const search: ProgSearch | null =
    glb.length >= GLB_SEARCH_END
      ? {
          publicSafety: { ...options(glb[GLB_PS_FLAGS]!), groups: bits(GLB_PS_GROUPS, 5) },
          limit: { ...options(glb[GLB_LIMIT_FLAGS]!), lowHz: u32(glb, GLB_LIMIT_LOW), highHz: u32(glb, GLB_LIMIT_HIGH) },
          uvhfAm: { ...options(glb[GLB_UVHF_FLAGS]!), groups: bits(GLB_UVHF_GROUPS, 4) },
          sweeper: { specialMode: (glb[GLB_SWEEPER_FLAGS]! & 0x20) !== 0, groups: bits(GLB_SWEEPER_GROUPS, 10) },
          amateur: { ...options(glb[GLB_AMATEUR_FLAGS]!), groups: bits(GLB_AMATEUR_GROUPS, 8) },
          channels: Object.fromEntries(CHANNEL_SEARCHES.map((t) => [t.id, glb.length >= GLB_CHANNELS_END ? { ...options(glb[GLB_CHANNEL_BLOCKS[t.id]]!), enabled: bits(GLB_CHANNEL_BLOCKS[t.id] + 1, t.channels.length) } : { attenuator: false, zeromatic: false, delay: false, enabled: t.channels.map(() => true) }])) as ProgSearch['channels'],
        }
      : null;
  return {
    welcome,
    signalBars,
    lastTuneHz: plausibleHz(tune) ? tune : null,
    searchDelayS: glb.length > GLB_SEARCH_DELAY ? glb[GLB_SEARCH_DELAY]! / 10 : null,
    wxButton: glb.length > GLB_WX_BUTTON ? glb[GLB_WX_BUTTON]! : null,
    lockoutsHz,
    search,
  };
}

/**
 * Assemble a `Programming` from the folder's files (raw, still obfuscated), keyed by upper-case file
 * name. Missing files leave their part empty rather than failing: a card straight from the scanner
 * has them all, an EZ Scan export folder may not.
 */
export function parseCdat(dir: string, files: ReadonlyMap<string, Uint8Array>, readAt = Date.now()): Programming {
  const get = (name: string): Uint8Array | undefined => {
    const raw = files.get(name.toUpperCase());
    return raw ? decode(raw) : undefined;
  };
  const cg = get('CG000000._CG');
  const pldef = get('PLDEF.DAT');
  const plsets = get('PLSETS.DAT');
  const glb = get('ISCAN___.GLB');
  const descRaw = files.get('DESCRIPT.TXT');
  // Up to four 16-character lines (EZ Scan's folder description): one line here.
  const description = descRaw ? text(descRaw, 0, Math.min(descRaw.length, 64)).replace(/\s{2,}/g, ' ') : '';
  const trunked: ProgTrunkedSystem[] = [];
  for (const name of [...files.keys()].sort()) {
    const m = /^TS(\d{6})\._TS$/.exec(name);
    if (!m) continue;
    const ts = get(name);
    if (ts) trunked.push(parseTrunked(Number(m[1]), ts, get(`TS${m[1]}._GD`)));
  }
  const objects = cg ? parseObjects(cg) : [];
  return {
    dir,
    description,
    globals: glb ? parseGlobals(glb) : { welcome: [], signalBars: [], lastTuneHz: null, searchDelayS: null, wxButton: null, lockoutsHz: [], search: null },
    objects,
    scanlists: pldef ? parseScanlists(pldef, objects) : [],
    scanSets: plsets ? parseScanSets(plsets) : [],
    trunked,
    readAt,
  };
}
