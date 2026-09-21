import { describe, expect, it } from 'vitest';
import { Key, LCD_COLUMNS, LCD_CURSOR_BYTE, LCD_ROWS, parseLcd, type Lcd } from '@trxcontroller/rcip';
import { MacroError, entryKeys, entryText, resumeScan, selectMenuItem, tuneScreenHz, tuneTo, type MacroHost } from '../scanner/macros';

/** Build an L response from six lines, with the cursor byte in column 0 or 16 of one row. */
function makeLcd(lines: string[], cursorLine = -1, cursorColumn: 0 | 15 = 15): Lcd {
  const data = new Uint8Array(LCD_COLUMNS * LCD_ROWS + 3).fill(0x20);
  lines.forEach((line, r) => {
    for (let c = 0; c < Math.min(LCD_COLUMNS, line.length); c++) data[r * LCD_COLUMNS + c] = line.charCodeAt(c);
  });
  if (cursorLine >= 0) data[cursorLine * LCD_COLUMNS + cursorColumn] = LCD_CURSOR_BYTE;
  return parseLcd(data);
}

/**
 * Enough of a TRX-1e to drive the macros: a scrolling, wrapping main menu with
 * more items than lines, the Searches sub-menu and the Tune Mode screen.
 */
class FakeScanner implements MacroHost {
  static readonly MAIN = ['Scan', 'Scanlists', 'Browse Library', 'Browse Objects', 'Program Menu', 'Searches', 'Settings'];
  static readonly SEARCHES = ['Main Menu', 'Spectrum Sweep', 'Service Search', 'Limit Search', 'Tune Mode'];
  mode: 'scan' | 'main' | 'searches' | 'tune' = 'scan';
  cursor = 0;
  top = 0;
  entry = '';
  hz = 25_000_000;
  presses: number[] = [];

  async press(code: number): Promise<void> {
    this.presses.push(code);
    if (code === Key.MENU) {
      this.mode = 'main';
      this.cursor = 0;
      this.top = 0;
      return;
    }
    if (this.mode === 'main' || this.mode === 'searches') {
      const items = this.mode === 'main' ? FakeScanner.MAIN : FakeScanner.SEARCHES;
      if (code === Key.DOWN) this.cursor = (this.cursor + 1) % items.length;
      else if (code === Key.UP) this.cursor = (this.cursor + items.length - 1) % items.length;
      else if (code === Key.RIGHT) this.select(items[this.cursor]!);
      // Keep the cursor inside the five visible rows.
      if (this.cursor < this.top) this.top = this.cursor;
      if (this.cursor > this.top + 4) this.top = this.cursor - 4;
      return;
    }
    if (this.mode === 'tune') {
      const digit = DIGITS.get(code);
      if (digit !== undefined) this.entry += digit;
      else if (code === Key.SEL && this.entry) {
        this.hz = Math.round(parseFloat(this.entry) * 1e6);
        this.entry = '';
      }
    }
  }

  private select(item: string): void {
    if (item === 'Scan') this.mode = 'scan';
    else if (item === 'Searches') {
      this.mode = 'searches';
      this.cursor = 0;
      this.top = 0;
    } else if (item === 'Main Menu') {
      this.mode = 'main';
      this.cursor = 0;
      this.top = 0;
    } else if (item === 'Tune Mode') this.mode = 'tune';
  }

  lcd(): Lcd {
    switch (this.mode) {
      case 'scan':
        return makeLcd(['', 'HAM UK A+D Rpts', 'CONV        psDr', 'RBW18', 'Auto  433.225000', 'CTCSS 77.0   S']);
      case 'main':
      case 'searches': {
        const items = this.mode === 'main' ? FakeScanner.MAIN : FakeScanner.SEARCHES;
        const title = this.mode === 'main' ? '  -Main Menu-   ' : '  -Searches-    ';
        const rows = items.slice(this.top, this.top + 5);
        // Searches puts the cursor in column 0, the main menu in column 16.
        const col = this.mode === 'searches' ? 0 : 15;
        return makeLcd([title, ...rows.map((r) => (col === 0 ? ' ' + r : r))], 1 + this.cursor - this.top, col);
      }
      case 'tune': {
        const shown = this.entry || (this.hz / 1e6).toFixed(6);
        return makeLcd(['', '-Service Search-', 'Tune Mode', 'au' + shown.padStart(14)]);
      }
    }
  }

  async refresh(): Promise<void> {}

  stalled(): boolean {
    return false;
  }
}

const DIGITS = new Map<number, string>([
  [Key.DIGIT_0, '0'],
  [Key.DIGIT_1, '1'],
  [Key.DIGIT_2, '2'],
  [Key.DIGIT_3, '3'],
  [Key.DIGIT_4, '4'],
  [Key.DIGIT_5, '5'],
  [Key.DIGIT_6, '6'],
  [Key.DIGIT_7, '7'],
  [Key.DIGIT_8, '8'],
  [Key.DIGIT_9, '9'],
  [Key.DECIMAL, '.'],
]);

describe('frequency entry', () => {
  it('types MHz with at least three decimals and no trailing zeros beyond them', () => {
    expect(entryText(409_750_000)).toBe('409.750');
    expect(entryText(409_762_500)).toBe('409.7625');
    expect(entryText(145_500_000)).toBe('145.500');
    expect(entryText(1_240_000_000)).toBe('1240.000');
    expect(entryKeys(145_500_000)).toEqual([Key.DIGIT_1, Key.DIGIT_4, Key.DIGIT_5, Key.DECIMAL, Key.DIGIT_5, Key.DIGIT_0, Key.DIGIT_0]);
  });

  it('reads the frequency off the Tune Mode screen', () => {
    expect(tuneScreenHz(makeLcd(['', '-Service Search-', 'Tune Mode', 'au    409.750000']))).toBe(409_750_000);
    expect(tuneScreenHz(makeLcd(['', '-Service Search-', 'Tune Mode', 'au     25.000000']))).toBe(25_000_000);
  });
});

describe('tuneTo', () => {
  it('walks Main Menu > Searches > Tune Mode from scanning, types the frequency and presses SEL', async () => {
    const s = new FakeScanner();
    await tuneTo(s, 409_750_000);
    expect(s.mode).toBe('tune');
    expect(s.hz).toBe(409_750_000);
    // Searches is the sixth main-menu item, off the bottom of the first screen.
    expect(s.presses.filter((k) => k === Key.DOWN).length).toBe(5 + 4);
    expect(s.presses.slice(-8)).toEqual([Key.DIGIT_4, Key.DIGIT_0, Key.DIGIT_9, Key.DECIMAL, Key.DIGIT_7, Key.DIGIT_5, Key.DIGIT_0, Key.SEL]);
  });

  it('skips the menus when the Tune Mode screen is already showing', async () => {
    const s = new FakeScanner();
    s.mode = 'tune';
    await tuneTo(s, 145_500_000);
    expect(s.presses).not.toContain(Key.MENU);
    expect(s.hz).toBe(145_500_000);
  });

  it('accepts the frequency the scanner snaps to on the 8.33 kHz airband and reports it', async () => {
    // A TRX tunes the channel name 126.595 as its carrier 126.591667: the display never shows 126.595000.
    class Airband extends FakeScanner {
      override async press(code: number): Promise<void> {
        await super.press(code);
        if (code === Key.SEL && this.mode === 'tune' && this.hz >= 108e6 && this.hz < 137e6) this.hz = Math.round(Math.round(this.hz / (25000 / 3)) * (25000 / 3));
      }
    }
    const s = new Airband();
    await expect(tuneTo(s, 126_595_000)).resolves.toBe(126_591_667);
    expect(s.hz).toBe(126_591_667);
  });

  it('does not take a neighbouring channel still on the screen for the new one', async () => {
    // Already on 126.591667; asked for 126.600, one 8.33 kHz step up. The stale screen is within the snap
    // tolerance of the new target only if the tolerance were loose; it must wait for the scanner to move.
    class Stuck extends FakeScanner {
      override async press(code: number): Promise<void> {
        if (code === Key.SEL && this.mode === 'tune') {
          this.entry = '';
          return;
        }
        await super.press(code);
      }
    }
    const s = new Stuck();
    s.mode = 'tune';
    s.hz = 126_591_667;
    await expect(tuneTo(s, 126_600_000)).rejects.toBeInstanceOf(MacroError);
  }, 10_000);

  it('is satisfied at once when the scanner already sits on the snapped channel', async () => {
    class Stuck extends FakeScanner {
      override async press(code: number): Promise<void> {
        if (code === Key.SEL && this.mode === 'tune') {
          this.entry = '';
          return;
        }
        await super.press(code);
      }
    }
    const s = new Stuck();
    s.mode = 'tune';
    s.hz = 126_591_667;
    await expect(tuneTo(s, 126_595_000)).resolves.toBe(126_591_667);
  });

  it('refuses a frequency the scanner cannot tune', async () => {
    const s = new FakeScanner();
    await expect(tuneTo(s, 5_000_000)).rejects.toBeInstanceOf(MacroError);
    expect(s.presses).toEqual([]);
  });
});

describe('menus', () => {
  it('reports an item that is not in the menu after one full lap', async () => {
    const s = new FakeScanner();
    s.mode = 'main';
    await expect(selectMenuItem(s, 'Weather')).rejects.toThrow(/not in the Main Menu menu/);
    expect(s.presses.length).toBeLessThan(FakeScanner.MAIN.length + 2);
  });

  it('treats the scanner going silent after Scan is selected as scanning having started', async () => {
    const s = new FakeScanner();
    s.mode = 'tune';
    // Selecting Scan leaves the last display as the menu and the scanner stops answering (loading scanlists).
    let silent = false;
    const origPress = s.press.bind(s);
    s.press = async (code: number) => {
      await origPress(code);
      if (s.mode === 'scan') {
        s.mode = 'main';
        silent = true;
      }
    };
    s.stalled = () => silent;
    await resumeScan(s);
    expect(silent).toBe(true);
  });

  it('returns to scanning from Tune Mode via Main Menu > Scan', async () => {
    const s = new FakeScanner();
    s.mode = 'tune';
    await resumeScan(s);
    expect(s.mode).toBe('scan');
    expect(s.presses[0]).toBe(Key.MENU);
    expect(s.presses[s.presses.length - 1]).toBe(Key.RIGHT);
  });
});
