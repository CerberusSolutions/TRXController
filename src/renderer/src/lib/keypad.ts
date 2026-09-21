import { Key, type KeyCode } from '@trxcontroller/rcip';

export interface KeyDef {
  code: KeyCode;
  label: string;
  /** Secondary legend under the label, e.g. Fn-shifted meaning. */
  sub?: string;
  variant?: 'nav' | 'fn' | 'digit' | 'knob' | 'power' | 'sel';
  /** Keyboard keys (KeyboardEvent.key) that trigger it. */
  keys?: string[];
  span?: number;
}

/** Rows of the on-screen keypad. Order is a design choice, not the scanner's physical layout. */
export const KEYPAD_ROWS: KeyDef[][] = [
  [
    { code: Key.MENU, label: 'MENU', variant: 'fn', keys: ['Escape', 'm'] },
    { code: Key.UP, label: '▲', variant: 'nav', keys: ['ArrowUp'] },
    { code: Key.SKIP, label: 'SKIP', variant: 'fn', keys: ['s', 'Backspace'] },
  ],
  [
    { code: Key.LEFT, label: '◄', variant: 'nav', keys: ['ArrowLeft'] },
    { code: Key.SEL, label: 'SEL', variant: 'sel', keys: ['Enter', ' '] },
    { code: Key.RIGHT, label: '►', variant: 'nav', keys: ['ArrowRight'] },
  ],
  [
    { code: Key.ATT, label: 'ATT', variant: 'fn', keys: ['a'] },
    { code: Key.DOWN, label: '▼', variant: 'nav', keys: ['ArrowDown'] },
    { code: Key.WX, label: 'WX', variant: 'fn', keys: ['w'] },
  ],
  [
    { code: Key.FN, label: 'Fn', variant: 'fn', keys: ['f'] },
    { code: Key.PRI, label: 'PRI', variant: 'fn', keys: ['p'] },
    { code: Key.POWER, label: '⏻', variant: 'power' },
  ],
  [
    { code: Key.DIGIT_1, label: '1', variant: 'digit', keys: ['1'] },
    { code: Key.DIGIT_2, label: '2', variant: 'digit', keys: ['2'] },
    { code: Key.DIGIT_3, label: '3', variant: 'digit', keys: ['3'] },
  ],
  [
    { code: Key.DIGIT_4, label: '4', variant: 'digit', keys: ['4'] },
    { code: Key.DIGIT_5, label: '5', variant: 'digit', keys: ['5'] },
    { code: Key.DIGIT_6, label: '6', variant: 'digit', keys: ['6'] },
  ],
  [
    { code: Key.DIGIT_7, label: '7', variant: 'digit', keys: ['7'] },
    { code: Key.DIGIT_8, label: '8', variant: 'digit', keys: ['8'] },
    { code: Key.DIGIT_9, label: '9', variant: 'digit', keys: ['9'] },
  ],
  [
    { code: Key.DECIMAL, label: '.', variant: 'digit', keys: ['.'] },
    { code: Key.DIGIT_0, label: '0', variant: 'digit', keys: ['0'] },
    { code: Key.KNOB_PUSH, label: '◉', sub: 'knob', variant: 'knob', keys: ['k'] },
  ],
  [
    { code: Key.KNOB_CCW, label: '↺', sub: 'knob ccw', variant: 'knob', keys: ['[', 'PageUp'] },
    { code: Key.KNOB_CW, label: '↻', sub: 'knob cw', variant: 'knob', keys: [']', 'PageDown'], span: 2 },
  ],
];

const KEYBOARD_MAP: ReadonlyMap<string, KeyDef> = new Map(
  KEYPAD_ROWS.flat().flatMap((k) => (k.keys ?? []).map((kb) => [kb, k] as const)),
);

export function keyDefForKeyboard(e: KeyboardEvent): KeyDef | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey) return undefined;
  const target = e.target as HTMLElement | null;
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return undefined;
  return KEYBOARD_MAP.get(e.key) ?? KEYBOARD_MAP.get(e.key.toLowerCase());
}
