import { SIGNAL_TYPES, type SignalType } from './tables';

export const LCD_COLUMNS = 16;
export const LCD_ROWS = 6;

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
  /** Any trailing text bytes beyond 96 (expected: one NUL). */
  trailer: Uint8Array;
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

/** Map a display byte to a printable character. Control bytes become spaces. */
export function lcdChar(b: number): string {
  if (b === 0) return ' ';
  if (b < 0x20 || b === 0x7f) return ' ';
  // 0x80+ are scanner-specific glyphs; keep them as Latin-1 so nothing is lost.
  return String.fromCharCode(b);
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
  return {
    lines,
    text,
    textLength,
    trailer: textBytes.slice(LCD_COLUMNS * LCD_ROWS),
    icons: parseLcdIcons(data[textLength]!, data[textLength + 1]!, data[textLength + 2]!),
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
