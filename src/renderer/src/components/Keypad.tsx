import { useEffect, useRef, useState } from 'react';
import { Key } from '@trxcontroller/rcip';
import { KEYPAD_ROWS, keyDefForKeyboard, type KeyDef } from '../lib/keypad';
import { useScanner } from '../store/scanner';
import { useUi } from '../store/ui';

const POWER_CONFIRM_MS = 2500;

export default function Keypad() {
  const pressKey = useScanner((s) => s.pressKey);
  const lastKey = useScanner((s) => s.lastKey);
  const stalled = useScanner((s) => s.snapshot.link.stall !== null);
  const off = useScanner((s) => s.snapshot.power?.on === false);
  // Held while the scanner is not answering: it queues every key and fires them all when it wakes.
  const enabled = useScanner((s) => (s.snapshot.link.status === 'connected' || s.snapshot.link.status === 'unresponsive') && s.snapshot.link.stall === null);
  const tune = useScanner((s) => s.tune);
  const resumeScan = useScanner((s) => s.resumeScan);
  const tuneState = useScanner((s) => s.tuneState);
  const [freqText, setFreqText] = useState('');
  const freqHz = Math.round(parseFloat(freqText) * 1e6);
  const freqOk = Number.isFinite(freqHz) && freqHz >= 25e6 && freqHz <= 1300e6;
  const tuning = tuneState?.phase === 'tuning';
  const submitTune = (): void => {
    if (enabled && freqOk && !tuning) void tune(freqHz);
  };
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
  }, [enabled, armPower]);

  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2">Keypad</span>
        {stalled ? (
          <span className="rounded-md border border-amber/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber" title="The scanner is not answering; key presses would queue up and fire later, so the keypad is held.">
            {off ? 'Scanner off' : 'Scanner busy'}
          </span>
        ) : (
          <span className="text-[11px] text-ink-3">arrows · Enter · Esc · 0-9</span>
        )}
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
      <div className="mt-3 border-t border-edge pt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2">Tune</span>
          <span className="text-[11px] text-ink-3">via Searches › Tune Mode</span>
        </div>
        <div className="flex gap-1.5">
          <input
            className="min-w-0 flex-1 rounded-md border border-edge bg-panel-2 px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan disabled:opacity-50"
            placeholder="144.800"
            title="Frequency in MHz, e.g. 144.800"
            inputMode="decimal"
            value={freqText}
            disabled={!enabled}
            onChange={(e) => setFreqText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitTune();
            }}
          />
          <button
            className="rounded-md bg-cyan px-3 py-1.5 text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50"
            disabled={!enabled || !freqOk || tuning}
            onClick={submitTune}
            title="Reach Tune Mode through the menus, enter the frequency, press SEL"
          >
            {tuning ? '…' : 'Tune'}
          </button>
          <button
            className="rounded-md border border-edge px-3 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
            disabled={!enabled || tuning}
            onClick={() => void resumeScan()}
            title="Main Menu › Scan"
          >
            Scan
          </button>
        </div>
        {tuneState?.phase === 'error' && <p className="mt-1.5 text-[11px] text-red">{tuneState.message}</p>}
      </div>
    </section>
  );
}
