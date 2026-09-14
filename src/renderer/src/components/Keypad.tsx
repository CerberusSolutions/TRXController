import { useEffect, useRef, useState } from 'react';
import { Key } from '@trxcontroller/rcip';
import { KEYPAD_ROWS, keyDefForKeyboard, type KeyDef } from '../lib/keypad';
import { useScanner } from '../store/scanner';
import { useUi } from '../store/ui';

const POWER_CONFIRM_MS = 2500;

export default function Keypad() {
  const pressKey = useScanner((s) => s.pressKey);
  const lastKey = useScanner((s) => s.lastKey);
  const enabled = useScanner((s) => s.snapshot.link.status === 'connected' || s.snapshot.link.status === 'unresponsive');
  const [armPower, setArmPower] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const press = (def: KeyDef): void => {
    if (!enabled) return;
    if (def.code === Key.POWER) {
      if (!armPower) {
        setArmPower(true);
        armTimer.current = setTimeout(() => setArmPower(false), POWER_CONFIRM_MS);
        return;
      }
      if (armTimer.current) clearTimeout(armTimer.current);
      setArmPower(false);
    }
    void pressKey(def.code);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useUi.getState().helpOpen) return;
      const def = keyDefForKeyboard(e);
      if (!def || e.repeat) return;
      e.preventDefault();
      press(def);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, armPower]);

  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">Keypad</span>
        <span className="text-[11px] text-ink-3">arrows · Enter · Esc · 0-9</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYPAD_ROWS.flat().map((def) => {
          const pressed = lastKey === def.code;
          const isPower = def.code === Key.POWER;
          return (
            <button
              key={def.code}
              className={`key key-${def.variant ?? 'fn'} ${pressed ? 'pressed' : ''} ${isPower && armPower ? 'bg-red/20 shadow-[inset_0_0_0_1px_var(--color-red)]' : ''}`}
              style={def.span ? { gridColumn: `span ${def.span}` } : undefined}
              disabled={!enabled}
              title={def.keys?.length ? `Keyboard: ${def.keys.join(', ')}` : undefined}
              onClick={() => press(def)}
            >
              <span>{def.label}</span>
              {(def.sub || (isPower && armPower)) && <span className="sub">{isPower && armPower ? 'click again' : def.sub}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
