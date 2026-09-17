/**
 * Keystroke macros: multi-key actions the scanner has no command for, done
 * the way a person would do them and checked against the display after each
 * step rather than run on a timer. Electron-free; the host is the session.
 *
 * Observed on a TRX-1e (CPU 7.4, 15 Sep 2026): MENU opens "-Main Menu-";
 * "Searches" leads to "-Searches-" whose last item is "Tune Mode"; the Tune
 * Mode screen reads "-Service Search-" / "Tune Mode" / "au     25.000000",
 * and a frequency is entered as digits with the decimal point followed by
 * SEL (the scanner's ENTER). Menu cursors sit in column 0 or 16.
 */
import { Key, type Lcd } from '@trxcontroller/rcip';

export interface MacroHost {
  /** Send one key and refresh the display. */
  press(code: number): Promise<void>;
  /** The most recent display. */
  lcd(): Lcd | null;
  /** Poll the display again. */
  refresh(): Promise<void>;
  /** True while the scanner has stopped answering (it is loading scanlists after a mode change). */
  stalled?(): boolean;
}

export class MacroError extends Error {
  constructor(
    message: string,
    /** What the display showed when the macro gave up, for the log. */
    readonly screen: readonly string[],
  ) {
    super(message);
    this.name = 'MacroError';
  }
}

export const MACRO_TIMEOUT_MS = 3000;
/** Longest menu the navigator will walk before deciding an item is absent. */
export const MENU_MAX_MOVES = 40;
const POLL_MS = 120;

/** Frequencies the TRX family can tune. */
export const TUNE_MIN_HZ = 25_000_000;
export const TUNE_MAX_HZ = 1_300_000_000;

const GLYPHS = /[◄☐☑▯]/g;

/** A display line with glyph stand-ins removed and whitespace trimmed. */
export function lineText(lcd: Lcd, row: number): string {
  return (lcd.lines[row] ?? '').replace(GLYPHS, ' ').trim();
}

/** "  -Main Menu-   " -> "Main Menu". */
export function menuTitle(lcd: Lcd): string {
  return lineText(lcd, 0).replace(/^-+|-+$/g, '').trim();
}

export function isMenuScreen(lcd: Lcd): boolean {
  return lcd.cursorLine >= 0;
}

export function isTuneScreen(lcd: Lcd): boolean {
  return lineText(lcd, 2) === 'Tune Mode' && /Service Search/.test(lineText(lcd, 1));
}

/** The frequency shown on the Tune Mode screen ("au     25.000000"), in Hz. */
export function tuneScreenHz(lcd: Lcd): number | null {
  const m = /(\d{1,4}\.\d{3,6})\s*$/.exec(lcd.lines[3] ?? '');
  return m ? Math.round(parseFloat(m[1]!) * 1e6) : null;
}

const DIGIT_KEYS: Readonly<Record<string, number>> = {
  '0': Key.DIGIT_0,
  '1': Key.DIGIT_1,
  '2': Key.DIGIT_2,
  '3': Key.DIGIT_3,
  '4': Key.DIGIT_4,
  '5': Key.DIGIT_5,
  '6': Key.DIGIT_6,
  '7': Key.DIGIT_7,
  '8': Key.DIGIT_8,
  '9': Key.DIGIT_9,
  '.': Key.DECIMAL,
};

/** "409.7625" for 409762500: MHz with at least three decimals, trailing zeros beyond that dropped. */
export function entryText(hz: number): string {
  const full = (hz / 1e6).toFixed(6);
  return full.replace(/(\.\d{3}\d*?)0+$/, '$1');
}

/** The key presses that type a frequency on the Tune Mode screen (before SEL). */
export function entryKeys(hz: number): number[] {
  return [...entryText(hz)].map((ch) => DIGIT_KEYS[ch]!);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(host: MacroHost, what: string, pred: (lcd: Lcd) => boolean, timeoutMs = MACRO_TIMEOUT_MS): Promise<Lcd> {
  const started = Date.now();
  for (;;) {
    const lcd = host.lcd();
    if (lcd && pred(lcd)) return lcd;
    if (Date.now() - started > timeoutMs) throw new MacroError(`Timed out waiting for ${what}`, lcd?.lines ?? []);
    await sleep(POLL_MS);
    await host.refresh();
  }
}

/**
 * Move the cursor to the first menu line starting with `label` (case-insensitive)
 * and select it with RIGHT. Walks the menu with DOWN (or UP when the item is
 * visible above the cursor); menus scroll and wrap, so a screen seen twice after
 * the same key means the item is not there.
 */
export async function selectMenuItem(host: MacroHost, label: string): Promise<void> {
  const want = label.toLowerCase();
  const seen = new Set<string>();
  for (let moves = 0; moves < MENU_MAX_MOVES; moves++) {
    const lcd = await waitFor(host, 'a menu', isMenuScreen);
    const idx = lcd.lines.findIndex((_, i) => i > 0 && lineText(lcd, i).toLowerCase().startsWith(want));
    if (idx >= 0 && idx === lcd.cursorLine) {
      await host.press(Key.RIGHT);
      return;
    }
    const key = idx >= 0 && idx < lcd.cursorLine ? Key.UP : Key.DOWN;
    const fingerprint = `${key}:${lcd.text}`;
    if (seen.has(fingerprint)) throw new MacroError(`"${label}" is not in the ${menuTitle(lcd) || 'current'} menu`, lcd.lines);
    seen.add(fingerprint);
    const before = lcd.text;
    await host.press(key);
    await waitFor(host, 'the cursor to move', (l) => l.text !== before);
  }
  throw new MacroError(`Gave up looking for "${label}"`, host.lcd()?.lines ?? []);
}

/** Press MENU until the main menu is showing (a sub-menu's first item leads back to it). */
export async function gotoMainMenu(host: MacroHost): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await host.press(Key.MENU);
    const lcd = await waitFor(host, 'a menu', isMenuScreen);
    if (menuTitle(lcd) === 'Main Menu') return;
    if (lcd.lines.some((_, i) => i > 0 && lineText(lcd, i) === 'Main Menu')) {
      await selectMenuItem(host, 'Main Menu');
      await waitFor(host, 'the main menu', (l) => isMenuScreen(l) && menuTitle(l) === 'Main Menu');
      return;
    }
  }
  throw new MacroError('Could not reach the main menu', host.lcd()?.lines ?? []);
}

/** Main Menu > Searches > Tune Mode, unless the Tune Mode screen is already up. */
export async function enterTuneMode(host: MacroHost): Promise<void> {
  const current = host.lcd();
  if (current && isTuneScreen(current)) return;
  await gotoMainMenu(host);
  await selectMenuItem(host, 'Search');
  await waitFor(host, 'the Searches menu', (l) => isMenuScreen(l) && /^Search/.test(menuTitle(l)));
  await selectMenuItem(host, 'Tune Mode');
  await waitFor(host, 'the Tune Mode screen', isTuneScreen);
}

/** Tune the scanner to `hz`: reach Tune Mode, type the frequency, press SEL, confirm on screen. */
export async function tuneTo(host: MacroHost, hz: number): Promise<void> {
  if (!Number.isFinite(hz) || hz < TUNE_MIN_HZ || hz > TUNE_MAX_HZ) {
    throw new MacroError(`${(hz / 1e6).toFixed(6)} MHz is outside the scanner's range`, []);
  }
  const target = Math.round(hz);
  await enterTuneMode(host);
  for (const key of entryKeys(target)) await host.press(key);
  await host.press(Key.SEL);
  await waitFor(host, `the display to show ${entryText(target)} MHz`, (l) => isTuneScreen(l) && tuneScreenHz(l) === target);
}

/** Main Menu > Scan. */
export async function resumeScan(host: MacroHost): Promise<void> {
  await gotoMainMenu(host);
  await selectMenuItem(host, 'Scan');
  // Selecting Scan makes the scanner load its scanlists, during which it answers
  // nothing for up to a minute or more: the display we hold is still the menu, but
  // the silence itself says the key was taken. Either counts as started.
  await waitFor(host, 'scanning to start', (l) => !isMenuScreen(l) || host.stalled?.() === true);
}
