import { useEffect, useRef, useState } from 'react';
import { Key } from '@trxcontroller/rcip';
import { keyDefForKeyboard, type KeyDef } from './keypad';
import { rxView, useScanner } from '../store/scanner';
import { useUi } from '../store/ui';

const POWER_CONFIRM_MS = 2500;

/**
 * Pressing a receiver's keys: `press` sends a key (POWER needs a second press within 2.5 s, `armPower` while it waits)
 * and, while `keyboard` is true, the window's keyboard shortcuts go to this receiver too. The keypad uses it for its
 * buttons and a closed drawer for the shortcuts alone, so no keypad has to be rendered just to listen.
 */
export function useScannerKeys(rx: number, keyboard: boolean): { enabled: boolean; armPower: boolean; press: (def: KeyDef) => void } {
  const pressKey = useScanner((s) => s.pressKey);
  // Held while the scanner is not answering: it queues every key and fires them all when it wakes.
  const enabled = useScanner((s) => {
    const { link, power } = rxView(s, rx).snapshot;
    return (link.status === 'connected' || link.status === 'unresponsive') && link.stall === null && power?.on !== false;
  });
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
    void pressKey(def.code, rx);
  };

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent): void => {
      const ui = useUi.getState();
      if (ui.helpOpen || ui.dataOpen) return;
      const def = keyDefForKeyboard(e);
      if (!def || e.repeat) return;
      e.preventDefault();
      press(def);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, armPower, keyboard]);

  return { enabled, armPower, press };
}
