import { SIGNAL_TYPES, type SignalType } from './tables';

export const LCD_COLUMNS = 16;
export const LCD_ROWS = 6;

/**
 * Byte the TRX-1e puts in the last column of the highlighted menu line. The
 * spec says cursors are not included in the LCD data, but this one is
 * (observed on CPU firmware 7.4).
 */
export const LCD_CURSOR_BYTE = 0x93;

/** Printable stand-ins for scanner-specific glyph bytes (0x80 and above). */
export const LCD_GLYPHS: Readonly<Record<number, string>> = {
  [LCD_CURSOR_BYTE]: '◄',
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
 *   5: extra: "RadioID:    104" or "Slot:2  Color: 7" (DMR), blank otherwise
 */
export interface ScanScreen {
  scanlist: string;
  type: string;
  flags: ObjectFlags;
  /** Object name, or null when the scanner is showing the TGID line instead. */
  name: string | null;
  mode: string;
  frequencyText: string;
  tgid: number | null;
  radioId: number | null;
  slot: number | null;
  colorCode: number | null;
}

const TGID_RE = /^TGID:\s*(\d+)\s*$/i;
const RADIO_ID_RE = /^RadioID:\s*(\d+)\s*$/i;
const SLOT_RE = /^Slot:\s*(\d+)\s+Color:\s*(\d+)\s*$/i;
const MODE_FREQ_RE = /^(\S+)\s+(\d{1,4}\.\d{3,6})\s*$/;

/** Parse the Scan-mode channel screen; null if the LCD is showing something else. */
export function parseScanScreen(lcd: Pick<Lcd, 'lines'>): ScanScreen | null {
  const obj = parseScanObjectLine(lcd.lines[2] ?? '');
  if (!obj?.flags) return null;
  const l3 = (lcd.lines[3] ?? '').trim();
  const l4 = (lcd.lines[4] ?? '').trim();
  const l5 = (lcd.lines[5] ?? '').trim();
  const tg = TGID_RE.exec(l3);
  const rid = RADIO_ID_RE.exec(l5);
  const slot = SLOT_RE.exec(l5);
  const mf = MODE_FREQ_RE.exec(l4);
  return {
    scanlist: (lcd.lines[1] ?? '').trim(),
    type: obj.type,
    flags: obj.flags,
    name: tg ? null : l3 || null,
    mode: mf?.[1] ?? '',
    frequencyText: mf?.[2] ?? '',
    tgid: tg ? Number(tg[1]) : null,
    radioId: rid ? Number(rid[1]) : null,
    slot: slot ? Number(slot[1]) : null,
    colorCode: slot ? Number(slot[2]) : null,
  };
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
