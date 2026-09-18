import { SIGNAL_TYPES, type SignalType } from './tables';

export const LCD_COLUMNS = 16;
export const LCD_ROWS = 6;

/**
 * Byte the TRX-1e puts in the last column of the highlighted menu line. The
 * spec says cursors are not included in the LCD data, but this one is
 * (observed on CPU firmware 7.4).
 */
export const LCD_CURSOR_BYTE = 0x93;

/** Scanlists menu check boxes (TRX-1e, captured 14 Sep 2026). */
export const LCD_CHECKED_BYTE = 0x8b;
export const LCD_UNCHECKED_BYTE = 0x89;

/** Printable stand-ins for scanner-specific glyph bytes (0x80 and above). */
export const LCD_GLYPHS: Readonly<Record<number, string>> = {
  [LCD_CURSOR_BYTE]: '◄',
  [LCD_CHECKED_BYTE]: '☑',
  [LCD_UNCHECKED_BYTE]: '☐',
};

export interface LcdIcons {
  /** icons1 bits 0-2, 0..5 */
  rssiBars: number;
  s: boolean;
  batt: boolean;
  battBlinking: boolean;
  extPower: boolean;
  fn: boolean;
  g: boolean;
  a: boolean;
  t: boolean;
  play: boolean;
  pause: boolean;
  /** icons3 bits 0-2 */
  signalType: number;
  signalTypeName: SignalType | 'Unknown';
  if: boolean;
  trunk2: boolean;
  pri: boolean;
  trunkS: boolean;
  raw: [number, number, number];
}

/** Decoded `L` (Get LCD) response. */
export interface Lcd {
  /** Six 16-character lines, padded with spaces. */
  lines: string[];
  /** All 96 display characters as one string (no line breaks). */
  text: string;
  /** Number of text bytes the scanner sent before the icon bytes (96 or 97). */
  textLength: number;
  /** Any trailing text bytes beyond 96 (the TRX-1e sends none). */
  trailer: Uint8Array;
  /** The 96 raw display bytes, for glyphs the text rendering cannot show. */
  raw: Uint8Array;
  /** Row (0-5) carrying the menu cursor byte, or -1 if none. */
  cursorLine: number;
  icons: LcdIcons;
}

export function parseLcdIcons(i1: number, i2: number, i3: number): LcdIcons {
  const signalType = i3 & 0x07;
  return {
    rssiBars: i1 & 0x07,
    s: (i1 & 0x08) !== 0,
    batt: (i1 & 0x10) !== 0,
    battBlinking: (i1 & 0x20) !== 0,
    extPower: (i1 & 0x40) !== 0,
    fn: (i2 & 0x01) !== 0,
    g: (i2 & 0x02) !== 0,
    a: (i2 & 0x04) !== 0,
    t: (i2 & 0x08) !== 0,
    play: (i2 & 0x40) !== 0,
    pause: (i2 & 0x80) !== 0,
    signalType,
    signalTypeName: SIGNAL_TYPES[signalType] ?? 'Unknown',
    if: (i3 & 0x08) !== 0,
    trunk2: (i3 & 0x10) !== 0,
    pri: (i3 & 0x20) !== 0,
    trunkS: (i3 & 0x40) !== 0,
    raw: [i1, i2, i3],
  };
}

/**
 * Map a display byte to a printable character. Control bytes become spaces;
 * scanner-specific glyphs (0x80+) become a known stand-in or a visible
 * placeholder so they are never silently dropped by the terminal.
 */
export function lcdChar(b: number): string {
  if (b < 0x20 || b === 0x7f) return ' ';
  if (b < 0x80) return String.fromCharCode(b);
  return LCD_GLYPHS[b] ?? '▯';
}

export function parseLcd(data: Uint8Array): Lcd {
  const minLen = LCD_COLUMNS * LCD_ROWS + 3;
  if (data.length < minLen) {
    throw new Error(`LCD data must be at least ${minLen} bytes, got ${data.length}`);
  }
  const textLength = data.length - 3;
  const textBytes = data.subarray(0, textLength);
  const chars: string[] = [];
  for (let i = 0; i < LCD_COLUMNS * LCD_ROWS; i++) chars.push(lcdChar(textBytes[i]!));
  const text = chars.join('');
  const lines: string[] = [];
  for (let r = 0; r < LCD_ROWS; r++) lines.push(text.slice(r * LCD_COLUMNS, (r + 1) * LCD_COLUMNS));
  const raw = textBytes.slice(0, LCD_COLUMNS * LCD_ROWS);
  const cursorIndex = raw.indexOf(LCD_CURSOR_BYTE);
  return {
    lines,
    text,
    textLength,
    trailer: textBytes.slice(LCD_COLUMNS * LCD_ROWS),
    raw,
    cursorLine: cursorIndex < 0 ? -1 : Math.floor(cursorIndex / LCD_COLUMNS),
    icons: parseLcdIcons(data[textLength]!, data[textLength + 1]!, data[textLength + 2]!),
  };
}

/**
 * Object attribute flags shown at the right of LCD line 2 in Scan mode,
 * e.g. "CONV        psDr". Uppercase means enabled (confirmed on a TRX-1e:
 * p priority, s skip, D delay, r record).
 */
export interface ObjectFlags {
  priority: boolean;
  skip: boolean;
  delay: boolean;
  record: boolean;
  /** The four raw flag characters. */
  raw: string;
}

export interface ScanObjectLine {
  /** Object type as displayed, e.g. "CONV", "TGRP". */
  type: string;
  flags: ObjectFlags | null;
}

const FLAG_RE = /([pP])([sS])([dD])([rR])\s*$/;

/** Parse the scan-mode object line ("CONV        psDr"). Returns null if it does not look like one. */
export function parseScanObjectLine(line: string): ScanObjectLine | null {
  const m = FLAG_RE.exec(line);
  const type = line.slice(0, m ? m.index : line.length).trim();
  if (!type && !m) return null;
  const flags: ObjectFlags | null = m
    ? {
        priority: m[1] === 'P',
        skip: m[2] === 'S',
        delay: m[3] === 'D',
        record: m[4] === 'R',
        raw: m[0].trim(),
      }
    : null;
  return { type, flags };
}

/**
 * The Scan-mode channel screen, as observed on a TRX-1e:
 *
 *   0: (blank or alert)
 *   1: scanlist name
 *   2: object type + psDr flags        "CONV        psDr"
 *   3: object name, or "TGID:   251"   (DMR alternates the two)
 *   4: mode + frequency                "AM    119.775000", "DMR  456.025000"
 *   5: extra: "RadioID:    104" or "Slot:2  Color: 7" (DMR),
 *            "CTCSS 77.0  S" / "DCS 023" / "NAC 293" when the tone lookup has found
 *            the transmitter's tone (the trailing letter is a status flag), blank otherwise
 */
export interface ScanScreen extends SignalDetails {
  scanlist: string;
  type: string;
  flags: ObjectFlags;
  /** Object name, or null when the scanner is showing the TGID line instead. */
  name: string | null;
  mode: string;
  frequencyText: string;
}

const TGID_RE = /^TGID:\s*(\d+)\s*$/i;
const RADIO_ID_RE = /^RadioID:\s*(\d+)\s*$/i;
const SLOT_RE = /^Slot:\s*(\d+)\s+Color:\s*(\d+)\s*$/i;
const MODE_FREQ_RE = /^(\S+)\s+(\d{1,4}\.\d{3,6})\s*$/;
const TONE_RE = /^(CTCSS|DCS|NAC)\s+(\S+)(?:\s+([A-Za-z]))?\s*$/i;

/** What the DMR / tone detail lines carry, shared by the Scan and Search screens. */
export interface SignalDetails {
  tgid: number | null;
  radioId: number | null;
  slot: number | null;
  colorCode: number | null;
  /** Tone/code detected on the transmission, e.g. "CTCSS 77.0", "DCS 023", "NAC 293". */
  detectedTone: string | null;
  /** Trailing status letter after the detected tone (observed "S"), or null. */
  toneFlag: string | null;
}

/**
 * Pick TGID / RadioID / Slot+Color / detected tone out of any of the given
 * lines. The scanner alternates "TGID:" and "RadioID:" on the same line, so
 * a single screen never shows both; callers merge over time.
 */
export function parseSignalDetails(lines: readonly string[]): SignalDetails {
  const d: SignalDetails = { tgid: null, radioId: null, slot: null, colorCode: null, detectedTone: null, toneFlag: null };
  for (const raw of lines) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if ((m = TGID_RE.exec(line))) d.tgid = Number(m[1]);
    else if ((m = RADIO_ID_RE.exec(line))) d.radioId = Number(m[1]);
    else if ((m = SLOT_RE.exec(line))) {
      d.slot = Number(m[1]);
      d.colorCode = Number(m[2]);
    } else if ((m = TONE_RE.exec(line))) {
      d.detectedTone = `${m[1]!.toUpperCase()} ${m[2]}`;
      d.toneFlag = m[3]?.toUpperCase() ?? null;
    }
  }
  return d;
}

/** Parse the Scan-mode channel screen; null if the LCD is showing something else. */
export function parseScanScreen(lcd: Pick<Lcd, 'lines'>): ScanScreen | null {
  const obj = parseScanObjectLine(lcd.lines[2] ?? '');
  if (!obj?.flags) return null;
  const l3 = (lcd.lines[3] ?? '').trim();
  const l4 = (lcd.lines[4] ?? '').trim();
  const l5 = (lcd.lines[5] ?? '').trim();
  const tg = TGID_RE.exec(l3);
  const mf = MODE_FREQ_RE.exec(l4);
  return {
    scanlist: (lcd.lines[1] ?? '').trim(),
    type: obj.type,
    flags: obj.flags,
    name: tg ? null : l3 || null,
    mode: mf?.[1] ?? '',
    frequencyText: mf?.[2] ?? '',
    ...parseSignalDetails([l3, l5]),
  };
}

/**
 * The Search-mode screens (Tune Mode at least; Service and Limit Search are
 * expected to match), as observed on a TRX-1e in Tune Mode on a DMR signal:
 *
 *   0: (blank)
 *   1: "-Service Search-"              the search family, in dashes
 *   2: "Tune Mode"                     the search name
 *   3: "DMR   145.637500"              mode + frequency ("au" while idle/auto,
 *                                      "DMRs" briefly before the slot line appears)
 *   4: "Slot:1  Color:15"              DMR only
 *   5: "RadioID: 2352157" / "   TGID:       9"   DMR only, alternating
 *
 * There is no object here, so what the `a` header calls the object tag is just
 * line 3; TGID, radio ID, slot and colour code come only from these lines.
 */
export interface SearchScreen extends SignalDetails {
  /** The search family without its dashes, e.g. "Service Search". */
  family: string;
  /** The search name from line 2, e.g. "Tune Mode". */
  name: string;
  /** Mode as displayed on line 3 ("au", "FM", "DMR", "DMRs"). */
  mode: string;
  frequencyText: string;
}

const SEARCH_TITLE_RE = /^-(.*Search.*)-$/i;

/** Parse a Search-mode screen; null if the LCD is showing something else. */
export function parseSearchScreen(lcd: Pick<Lcd, 'lines'>): SearchScreen | null {
  const title = SEARCH_TITLE_RE.exec((lcd.lines[1] ?? '').trim());
  const name = (lcd.lines[2] ?? '').trim();
  const mf = MODE_FREQ_RE.exec((lcd.lines[3] ?? '').trim());
  if (!title || !name || !mf) return null;
  return {
    family: title[1]!.trim(),
    name,
    mode: mf[1]!,
    frequencyText: mf[2]!,
    ...parseSignalDetails([lcd.lines[4] ?? '', lcd.lines[5] ?? '']),
  };
}

/** True when the object tag / name is nothing more than the mode and frequency ("DMRs 145.637500"). */
export function isModeFrequencyText(text: string): boolean {
  return MODE_FREQ_RE.test(text.trim()) || /^\d{1,4}\.\d{3,6}$/.test(text.trim());
}

const FREQ_TOKEN_RE = /^\d{1,4}\.\d{1,6}(?:mhz)?$/i;
const MODE_TOKEN_RE = /^(?:auto|am|fm|nfm|wfm|dmr|dmrs|p25|nxdn|nxdn4|nxdn8|mot|edacs|ltr|dstar|dg|dig)$/i;
/** A fingerprint note: a code prefix and / or a number ("CC15", "CC", "15", "94.8", "D023", "NAC293", "TG9", "S1"). */
const FINGERPRINT_TOKEN_RE = /^(?:cc|c|ctcss|ct|cs|dcs|d|nac|n|ran|r|tg|tgid|ts|s|slot|col|color|colour|tone|mhz|dmr|nfm|fm|am|p25|nxdn|dg|rid|id)?[:=]?\d*(?:\.\d+)?$/i;

/**
 * True when an object's name is nothing more than its frequency: on its own ("453.0625"), after the
 * mode ("DMRs 145.637500") or followed by the fingerprint a user notes while identifying a channel
 * ("453.0625 CC15", "167.300 94.8", "453.0625 CC 15 S1"). Such a name carries no identity, so the
 * lookups may name the object as if it had none.
 */
export function isFrequencyLabel(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const start = tokens[0] && FREQ_TOKEN_RE.test(tokens[0]) ? 1 : tokens[1] && MODE_TOKEN_RE.test(tokens[0]!) && FREQ_TOKEN_RE.test(tokens[1]) ? 2 : 0;
  return start > 0 && tokens.slice(start).every((t) => FINGERPRINT_TOKEN_RE.test(t));
}

/** Render the LCD as a boxed multi-line string for terminals. */
export function renderLcd(lcd: Lcd): string {
  const bar = '+' + '-'.repeat(LCD_COLUMNS) + '+';
  return [bar, ...lcd.lines.map((l) => `|${l}|`), bar].join('\n');
}

export function describeIcons(icons: LcdIcons): string {
  const on: string[] = [];
  if (icons.rssiBars) on.push(`RSSI ${icons.rssiBars}/5`);
  if (icons.s) on.push('S');
  if (icons.batt) on.push(icons.battBlinking ? 'BATT(blink)' : 'BATT');
  if (icons.extPower) on.push('EXT');
  if (icons.fn) on.push('Fn');
  if (icons.g) on.push('G');
  if (icons.a) on.push('A');
  if (icons.t) on.push('T');
  if (icons.play) on.push('PLAY');
  if (icons.pause) on.push('PAUSE');
  if (icons.signalType) on.push(`SIG ${icons.signalTypeName}`);
  if (icons.if) on.push('IF');
  if (icons.trunk2) on.push('TRUNK2');
  if (icons.pri) on.push('PRI');
  if (icons.trunkS) on.push('TRUNKS');
  return on.length ? on.join(' ') : '(none)';
}
