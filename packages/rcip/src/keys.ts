/**
 * `K` (Send Key) key codes from the spec, v1.7 page 5.
 *
 * The four arrow keys are shown in the PDF as Webdings glyphs 0x33..0x36
 * (◄ ► ▲ ▼). Reading the table rows gives UP=8, DOWN=10, LEFT=16, RIGHT=2.
 * Confirmed on a TRX-1e (CPU 7.4) on 14 Sep 2026: at the main menu, 8 moved
 * the cursor from the first item to the last (wrap-around, i.e. UP), 10 moved
 * it back (DOWN), 2 entered the highlighted item (RIGHT acts as select), and
 * 16 did nothing at the top level, which is what LEFT/back does there.
 */
export const Key = {
  MENU: 17,
  SEL: 9, // PLAY / SEL / PAUSE
  SKIP: 1,
  WX: 3,
  ATT: 15,
  UP: 8,
  DOWN: 10,
  LEFT: 16, // confirmed only by elimination (no visible effect at the main menu)
  RIGHT: 2, // also selects the highlighted menu item
  PRI: 5,
  FN: 12,
  DECIMAL: 19,
  DIGIT_1: 29,
  DIGIT_2: 22,
  DIGIT_3: 30,
  DIGIT_4: 23,
  DIGIT_5: 31,
  DIGIT_6: 24,
  DIGIT_7: 32,
  DIGIT_8: 25,
  DIGIT_9: 33,
  DIGIT_0: 26,
  KNOB_CW: 40,
  KNOB_CCW: 41,
  KNOB_PUSH: 43,
  POWER: 44,
} as const;

export type KeyName = keyof typeof Key;
export type KeyCode = (typeof Key)[KeyName];

/**
 * Keys whose code has not been directly observed on real hardware. LEFT is
 * known by elimination; check it in a sub-menu when convenient.
 */
export const PROVISIONAL_KEYS: readonly KeyName[] = ['LEFT'];

/** Display labels matching the scanner's key legends. */
export const KEY_LABELS: Readonly<Record<KeyName, string>> = {
  MENU: 'MENU',
  SEL: 'PLAY/SEL/PAUSE',
  SKIP: 'SKIP',
  WX: 'WX',
  ATT: 'ATT',
  UP: '▲',
  DOWN: '▼',
  LEFT: '◄',
  RIGHT: '►',
  PRI: 'PRI',
  FN: 'Fn',
  DECIMAL: '.',
  DIGIT_1: '1',
  DIGIT_2: '2',
  DIGIT_3: '3',
  DIGIT_4: '4',
  DIGIT_5: '5',
  DIGIT_6: '6',
  DIGIT_7: '7',
  DIGIT_8: '8',
  DIGIT_9: '9',
  DIGIT_0: '0',
  KNOB_CW: 'Knob CW',
  KNOB_CCW: 'Knob CCW',
  KNOB_PUSH: 'Knob push',
  POWER: 'POWER',
};

const CODE_TO_NAME: ReadonlyMap<number, KeyName> = new Map(
  (Object.keys(Key) as KeyName[]).map((name) => [Key[name], name]),
);

export function keyName(code: number): KeyName | undefined {
  return CODE_TO_NAME.get(code);
}

export function keyLabel(code: number): string {
  const name = keyName(code);
  return name ? KEY_LABELS[name] : `key ${code}`;
}

export function isKeyCode(code: number): code is KeyCode {
  return CODE_TO_NAME.has(code);
}

/** Key code for a digit character '0'..'9', or undefined. */
export function digitKey(ch: string): KeyCode | undefined {
  const map: Record<string, KeyCode> = {
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
  return map[ch];
}
