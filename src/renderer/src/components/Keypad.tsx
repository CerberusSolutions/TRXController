import { useState } from 'react';
import { Key } from '@trxcontroller/rcip';
import { KEYPAD_ROWS, type KeyDef } from '../lib/keypad';
import { rxView, useScanner } from '../store/scanner';
import { useUi } from '../store/ui';
import { useRx } from '../lib/rx';
import { useScannerKeys } from '../lib/useScannerKeys';
import { LcdScreen } from './LcdPanel';
import RxPill from './RxPill';

/**
 * The keys six wide for the drawer, derived from the table rather than by row number: each function row beside a
 * digit row (the rows with a digit key, the knob push among them), the knob-only row along the bottom at span 3.
 */
const SIX_WIDE: KeyDef[] = (() => {
  const knobRows = KEYPAD_ROWS.filter((row) => row.every((d) => d.variant === 'knob'));
  const digitRows = KEYPAD_ROWS.filter((row) => row.some((d) => d.variant === 'digit'));
  const fnRows = KEYPAD_ROWS.filter((row) => !knobRows.includes(row) && !digitRows.includes(row));
  const pairs = Math.max(fnRows.length, digitRows.length);
  return Array.from({ length: pairs }, (_, i) => [...(fnRows[i] ?? []), ...(digitRows[i] ?? [])])
    .flat()
    .concat(knobRows.flat().map((d) => ({ ...d, span: 3 })));
})();

/** How the keypad is shown in a twin-scanner column: in the receiver block's drawer, pinned (in the flow) or not (over the hero). */
export interface DrawerProps {
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
}

export default function Keypad({ drawer }: { drawer?: DrawerProps }) {
  const rx = useRx();
  const lastKey = useScanner((s) => rxView(s, rx).lastKey);
  const stalled = useScanner((s) => rxView(s, rx).snapshot.link.stall !== null);
  const off = useScanner((s) => rxView(s, rx).snapshot.power?.on === false);
  const tune = useScanner((s) => s.tune);
  const resumeScan = useScanner((s) => s.resumeScan);
  const tuneState = useScanner((s) => rxView(s, rx).tuneState);
  // With two scanners the keyboard drives the block last clicked; a single-scanner window has only RX1.
  const keyboard = useUi((s) => s.activeRx) === rx;
  const { enabled, armPower, press } = useScannerKeys(rx, keyboard);
  const [freqText, setFreqText] = useState('');
  const freqHz = Math.round(parseFloat(freqText) * 1e6);
  const freqOk = Number.isFinite(freqHz) && freqHz >= 25e6 && freqHz <= 1300e6;
  const tuning = tuneState?.phase === 'tuning';
  const submitTune = (): void => {
    if (enabled && freqOk && !tuning) void tune(freqHz, rx);
  };
  const keys = drawer ? SIX_WIDE : KEYPAD_ROWS.flat();
  // The radio: the scanner's own display over its keys, as on the front panel, then the Tune box.
  return (
    <section className={`flex min-h-0 flex-col overflow-y-auto bg-panel ${drawer ? 'h-full border-l border-edge p-3' : 'rounded-xl border border-edge p-3'}`}>
      {drawer && (
        <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-ink-3">
          <RxPill rx={rx} />
          <span>Display &amp; Keys</span>
          <button
            type="button"
            className={`ml-auto rounded px-1 text-[12px] leading-none ${drawer.pinned ? 'text-amber' : 'text-ink-3 hover:text-ink'}`}
            title={drawer.pinned ? 'Pinned: stays open and the hero makes room. Click to let it slide away again.' : 'Pin: keep it open beside the hero'}
            aria-pressed={drawer.pinned}
            onClick={drawer.onPin}
          >
            {drawer.pinned ? '📌' : '📍'}
          </button>
          <button type="button" className="rounded px-1 text-[14px] leading-none text-ink-3 hover:text-ink" title="Close the drawer (the keyboard still reaches this scanner while its block is the one last clicked)" aria-label="Close" onClick={drawer.onClose}>
            ×
          </button>
        </div>
      )}
      <div className={`relative ${drawer ? 'mb-1.5' : 'mb-2.5'}`}>
        <LcdScreen className={drawer ? 'lcd-drawer' : ''} />
        {(stalled || off) && (
          <span
            className="absolute right-2 bottom-2 rounded-md border border-amber/60 bg-panel/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber"
            title="The scanner is not answering; key presses would queue up and fire later, so the keypad is held."
          >
            {off ? 'Scanner off' : 'Scanner busy'}
          </span>
        )}
      </div>
      <div className={`grid ${drawer ? 'key-drawer grid-cols-6 gap-1' : 'grid-cols-3 gap-1.5'}`}>
        {keys.map((def) => {
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
      <div className={`border-t border-edge ${drawer ? 'mt-1.5 pt-1.5' : 'mt-2.5 pt-2.5'}`}>
        {!drawer && (
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2">Tune</span>
            <span className="text-[11px] text-ink-3">via Searches › Tune Mode</span>
          </div>
        )}
        <div className={`flex gap-1.5 ${drawer ? '[&>button]:px-2 [&>button]:py-0.5 [&>button]:text-xs [&>input]:py-0.5 [&>input]:text-xs' : ''}`}>
          <input
            className="min-w-0 flex-1 rounded-md border border-edge bg-panel-2 px-2 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan disabled:opacity-50"
            placeholder="144.800"
            title="Frequency in MHz, e.g. 144.800 (Searches › Tune Mode)"
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
            onClick={() => void resumeScan(rx)}
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
