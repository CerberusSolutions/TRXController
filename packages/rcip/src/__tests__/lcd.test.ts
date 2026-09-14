import { describe, expect, it } from 'vitest';
import { LCD_CURSOR_BYTE, describeIcons, lcdChar, parseLcd, parseLcdIcons, renderLcd } from '../lcd';
import { fromHex } from '../frame';

function lcdData(lines: string[], icons: [number, number, number], nul = true): Uint8Array {
  const text = lines.map((l) => l.padEnd(16, ' ')).join('');
  const bytes = [...text].map((c) => c.charCodeAt(0));
  if (nul) bytes.push(0);
  return new Uint8Array([...bytes, ...icons]);
}

const LINES = ['Scan           ', 'Scanlist 01    ', 'Fire Dispatch  ', '154.32500 MHz  ', '', 'NFM        CT 2'];

describe('parseLcd', () => {
  it('tolerates 97+3 bytes as the spec describes', () => {
    const lcd = parseLcd(lcdData(LINES, [0x05, 0x00, 0x05]));
    expect(lcd.textLength).toBe(97);
    expect(lcd.lines).toHaveLength(6);
    expect(lcd.lines.every((l) => l.length === 16)).toBe(true);
    expect(lcd.lines[3]).toBe('154.32500 MHz   ');
    expect(lcd.trailer).toEqual(new Uint8Array([0]));
    expect(lcd.icons.rssiBars).toBe(5);
    expect(lcd.icons.signalTypeName).toBe('NFM');
  });

  it('parses the 96+3 bytes the TRX-1e actually sends', () => {
    const lcd = parseLcd(lcdData(LINES, [0, 0, 0], false));
    expect(lcd.textLength).toBe(96);
    expect(lcd.trailer.length).toBe(0);
    expect(lcd.lines[0]).toBe('Scan            ');
    expect(lcd.cursorLine).toBe(-1);
    expect(lcd.raw.length).toBe(96);
  });

  it('decodes a real main-menu capture with the cursor byte on the highlighted line', () => {
    const data = fromHex(
      '20 20 2D 4D 61 69 6E 20 4D 65 6E 75 2D 20 20 20 53 63 61 6E 20 20 20 20 20 20 20 20 20 20 20 93 ' +
        '53 63 61 6E 6C 69 73 74 73 20 20 20 20 20 20 20 42 72 6F 77 73 65 20 4C 69 62 72 61 72 79 20 20 ' +
        '42 72 6F 77 73 65 20 4F 62 6A 65 63 74 73 20 20 50 72 6F 67 72 61 6D 20 4D 65 6E 75 20 20 20 20 00 00 00',
    );
    const lcd = parseLcd(data);
    expect(lcd.textLength).toBe(96);
    expect(lcd.lines).toEqual([
      '  -Main Menu-   ',
      'Scan           ◄',
      'Scanlists       ',
      'Browse Library  ',
      'Browse Objects  ',
      'Program Menu    ',
    ]);
    expect(lcd.cursorLine).toBe(1);
    expect(lcd.raw[31]).toBe(LCD_CURSOR_BYTE);
    expect(lcd.icons.raw).toEqual([0, 0, 0]);
  });

  it('never renders scanner glyphs as invisible control characters', () => {
    expect(lcdChar(0x93)).toBe('◄');
    expect(lcdChar(0x85)).toBe('▯');
    expect(lcdChar(0x00)).toBe(' ');
    expect(lcdChar(0x41)).toBe('A');
  });

  it('replaces control bytes with spaces', () => {
    const data = lcdData(LINES, [0, 0, 0]);
    data[0] = 0x01;
    data[1] = 0x7f;
    const lcd = parseLcd(data);
    expect(lcd.lines[0]!.slice(0, 2)).toBe('  ');
  });

  it('rejects short data', () => {
    expect(() => parseLcd(new Uint8Array(98))).toThrow(/at least 99/);
  });

  it('renders a box', () => {
    const out = renderLcd(parseLcd(lcdData(LINES, [0, 0, 0])));
    expect(out.split('\n')).toHaveLength(8);
    expect(out.split('\n')[1]).toBe('|Scan            |');
  });
});

describe('parseLcdIcons', () => {
  it('decodes icons1', () => {
    const i = parseLcdIcons(0b0111_1011, 0, 0);
    expect(i.rssiBars).toBe(3);
    expect(i.s).toBe(true);
    expect(i.batt).toBe(true);
    expect(i.battBlinking).toBe(true);
    expect(i.extPower).toBe(true);
  });

  it('decodes icons2', () => {
    const i = parseLcdIcons(0, 0b1100_1111, 0);
    expect(i.fn).toBe(true);
    expect(i.g).toBe(true);
    expect(i.a).toBe(true);
    expect(i.t).toBe(true);
    expect(i.play).toBe(true);
    expect(i.pause).toBe(true);
  });

  it('decodes icons3', () => {
    const i = parseLcdIcons(0, 0, 0b0111_1110);
    expect(i.signalType).toBe(6);
    expect(i.signalTypeName).toBe('ENC');
    expect(i.if).toBe(true);
    expect(i.trunk2).toBe(true);
    expect(i.pri).toBe(true);
    expect(i.trunkS).toBe(true);
    expect(i.raw).toEqual([0, 0, 0x7e]);
  });

  it('describes active icons', () => {
    expect(describeIcons(parseLcdIcons(0, 0, 0))).toBe('(none)');
    expect(describeIcons(parseLcdIcons(0x42, 0x01, 0x04))).toBe('RSSI 2/5 EXT Fn SIG FM');
  });
});
