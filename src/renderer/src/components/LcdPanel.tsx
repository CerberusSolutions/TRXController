import { useState } from 'react';
import { describeIcons, LCD_COLUMNS, LCD_ROWS, toHex } from '@trxcontroller/rcip';
import { useScanner } from '../store/scanner';

export default function LcdPanel() {
  const lcd = useScanner((s) => s.snapshot.lcd);
  const online = useScanner((s) => s.snapshot.link.status === 'connected' || s.snapshot.link.status === 'unresponsive');
  const [showHex, setShowHex] = useState(false);
  const lines = lcd?.lines ?? Array.from({ length: LCD_ROWS }, () => ' '.repeat(LCD_COLUMNS));
  const iconText = lcd ? describeIcons(lcd.icons) : '';

  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">Scanner display</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-ink-3">{iconText && iconText !== '(none)' ? iconText : ''}</span>
          <button
            className={`rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] ${showHex ? 'text-cyan' : 'text-ink-3 hover:text-ink-2'}`}
            title="Show the raw display bytes (for identifying scanner glyphs)"
            onClick={() => setShowHex((v) => !v)}
          >
            hex
          </button>
        </div>
      </div>
      <div className={`rounded-lg bg-lcd px-4 py-3 font-mono text-[22px] leading-[1.35] ${online ? 'text-lcd-ink' : 'text-lcd-dim'}`}>
        {lines.map((line, i) => (
          <div key={i} className={`lcd-line rounded px-1 ${lcd?.cursorLine === i ? 'lcd-cursor' : ''}`}>
            {line}
          </div>
        ))}
      </div>
      {showHex && lcd && (
        <pre className="mt-2 select-text overflow-x-auto rounded-md bg-panel-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">
          {Array.from({ length: LCD_ROWS }, (_, r) => `${r}  ${toHex(lcd.raw.subarray(r * LCD_COLUMNS, (r + 1) * LCD_COLUMNS))}`).join('\n')}
          {`\nicons ${toHex(lcd.icons.raw)}`}
        </pre>
      )}
    </section>
  );
}
