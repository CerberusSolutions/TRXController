import { describe, expect, it } from 'vitest';
import { LCD_CURSOR_BYTE, describeIcons, isFrequencyLabel, isModeFrequencyText, lcdChar, parseLcd, parseLcdIcons, parseScanObjectLine, parseScanScreen, parseSearchScreen, renderLcd } from '../lcd';
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

  it('renders the Scanlists check boxes (bytes captured on a TRX-1e)', () => {
    // Middle list ticked only, cursor on line 1.
    const rows = [
      '20202D5363616E6C697374732D202020', //   -Scanlists-
      '8948414D20554B20412B442052707493', // ☐HAM UK A+D Rpt◄
      '89326D2053696D706C65782020202020', // ☐2m Simplex
      '8B3730436D2053696D706C6578202020', // ☑70Cm Simplex
      '89504D522034343620412B4420202020', // ☐PMR 446 A+D
      '89536174656C6C697465732020202020', // ☐Satellites
    ];
    const lcd = parseLcd(fromHex(rows.join('') + '400000'));
    expect(lcd.lines).toEqual(['  -Scanlists-   ', '☐HAM UK A+D Rpt◄', '☐2m Simplex     ', '☑70Cm Simplex   ', '☐PMR 446 A+D    ', '☐Satellites     ']);
    expect(lcd.cursorLine).toBe(1);
  });

  it('never renders scanner glyphs as invisible control characters', () => {
    expect(lcdChar(0x93)).toBe('◄');
    expect(lcdChar(0x8b)).toBe('☑');
    expect(lcdChar(0x89)).toBe('☐');
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

describe('parseScanObjectLine', () => {
  it('splits the object type from the attribute flags', () => {
    const r = parseScanObjectLine('CONV        psDr');
    expect(r?.type).toBe('CONV');
    expect(r?.flags).toEqual({ priority: false, skip: false, delay: true, record: false, raw: 'psDr' });
  });

  it('reads uppercase as enabled', () => {
    expect(parseScanObjectLine('TGRP        PSDR')?.flags).toMatchObject({ priority: true, skip: true, delay: true, record: true });
    expect(parseScanObjectLine('TGRP        psdr')?.flags).toMatchObject({ priority: false, skip: false, delay: false, record: false });
  });

  it('copes with a type but no flags, and with junk', () => {
    expect(parseScanObjectLine('CONV            ')).toEqual({ type: 'CONV', flags: null });
    expect(parseScanObjectLine('                ')).toBeNull();
  });
});

describe('parseScanScreen', () => {
  it('reads the analogue channel screen', () => {
    const s = parseScanScreen({ lines: ['', 'Civil Airband', 'CONV        psDr', 'TC NW Deps', 'AM    119.775000', ''] });
    expect(s).toMatchObject({ scanlist: 'Civil Airband', type: 'CONV', name: 'TC NW Deps', mode: 'AM', frequencyText: '119.775000', tgid: null, radioId: null, slot: null });
    expect(s?.flags.delay).toBe(true);
  });

  it('reads the DMR screen that shows TGID and RadioID', () => {
    const s = parseScanScreen({ lines: ['', 'Shopwatch', 'CONV        psDr', 'TGID:        251', 'DMR   456.025000', 'RadioID:     104'] });
    expect(s).toMatchObject({ name: null, tgid: 251, radioId: 104, mode: 'DMR', frequencyText: '456.025000', slot: null, colorCode: null });
  });

  it('reads the DMR screen that shows the name and slot/colour code', () => {
    const s = parseScanScreen({ lines: ['', 'Shopwatch', 'CONV        psDr', 'Resound Ayles', 'DMR   456.025000', 'Slot:2  Color: 7'] });
    expect(s).toMatchObject({ name: 'Resound Ayles', tgid: null, radioId: null, slot: 2, colorCode: 7 });
  });

  it('reads a detected CTCSS tone from line 5', () => {
    const s = parseScanScreen({ lines: ['', 'Bucks A+D Rep', 'CONV        psDr', 'RBW18', 'Auto  433.225000', 'CTCSS 77.0  S'] });
    expect(s).toMatchObject({ name: 'RBW18', mode: 'Auto', frequencyText: '433.225000', detectedTone: 'CTCSS 77.0', toneFlag: 'S', tgid: null, slot: null });
    expect(parseScanScreen({ lines: ['', 'L', 'CONV        psDr', 'X', 'NFM   453.700000', 'DCS 023'] })).toMatchObject({ detectedTone: 'DCS 023', toneFlag: null });
    expect(parseScanScreen({ lines: ['', 'L', 'CONV        psDr', 'X', 'NFM   453.700000', ''] })?.detectedTone).toBeNull();
  });

  it('returns null for the sweeping screen and menus', () => {
    expect(parseScanScreen({ lines: ['', 'Civil Airband', 'Military Airband', 'Shopwatch', '', ''] })).toBeNull();
    expect(parseScanScreen({ lines: ['  -Main Menu-   ', 'Scan           ◄', 'Scanlists', '', '', ''] })).toBeNull();
  });
});

describe('parseSearchScreen', () => {
  // Captured on a TRX-1e in Tune Mode on 145.6375 MHz, 15 Sep 2026.
  const TUNE = ['', '-Service Search-', 'Tune Mode       ', 'DMRs  145.637500', '', ''];
  const RID = ['', '-Service Search-', 'Tune Mode       ', 'DMR   145.637500', 'Slot:1  Color:15', 'RadioID: 2352157'];
  const TG = ['', '-Service Search-', 'Tune Mode       ', 'DMR   145.637500', 'Slot:1  Color:15', '   TGID:       9'];

  it('reads the idle Tune Mode screen', () => {
    expect(parseSearchScreen({ lines: ['', '-Service Search-', 'Tune Mode', 'au     25.000000', '', ''] })).toMatchObject({
      family: 'Service Search', name: 'Tune Mode', mode: 'au', frequencyText: '25.000000', tgid: null, radioId: null, slot: null, colorCode: null, detectedTone: null,
    });
    expect(parseSearchScreen({ lines: TUNE })).toMatchObject({ mode: 'DMRs', frequencyText: '145.637500', tgid: null, radioId: null, slot: null });
  });

  it('reads slot, colour code and the alternating RadioID / TGID lines of a DMR signal', () => {
    expect(parseSearchScreen({ lines: RID })).toMatchObject({ mode: 'DMR', slot: 1, colorCode: 15, radioId: 2352157, tgid: null });
    expect(parseSearchScreen({ lines: TG })).toMatchObject({ mode: 'DMR', slot: 1, colorCode: 15, radioId: null, tgid: 9 });
  });

  it('returns null for the scan channel screen, the sweeping screen and menus', () => {
    expect(parseSearchScreen({ lines: ['', 'Civil Airband', 'CONV        psDr', 'TC NW Deps', 'AM    119.775000', ''] })).toBeNull();
    expect(parseSearchScreen({ lines: ['', 'Civil Airband', 'Military Airband', 'Shopwatch', '', ''] })).toBeNull();
    expect(parseSearchScreen({ lines: ['  -Searches-    ', ' Main Menu', ' Spectrum Sweep', ' Service Search', ' Limit Search', ' Tune Mode'] })).toBeNull();
  });

  it('knows when a tag is only the mode and frequency', () => {
    expect(isModeFrequencyText('DMRs 145.637500')).toBe(true);
    expect(isModeFrequencyText('145.637500')).toBe(true);
    expect(isModeFrequencyText('Fire Dispatch')).toBe(false);
    expect(isModeFrequencyText('')).toBe(false);
  });

  it('knows when a name is only the frequency, with or without the fingerprint noted after it', () => {
    for (const t of ['453.0625', '145.637500', 'DMRs 145.637500', '453.0625 CC15', '453.0625 CC 15', '167.300 94.8', '453.0625 CC 15 S1', '453.0625MHz', 'NFM 167.3 CTCSS 94.8', '453.0625 D023 TG9', '453.0625 CC:12'])
      expect(isFrequencyLabel(t), t).toBe(true);
    for (const t of ['', 'Fire Dispatch', 'Taxis 453', '453.0625 Taxis', 'Bucks Fire 1', 'RBW18', '453', 'TC NW Deps', 'Tune Mode', 'Site 453.0625 Ops'])
      expect(isFrequencyLabel(t), t).toBe(false);
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
