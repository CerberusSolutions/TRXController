import { useState } from 'react';
import { describeIcons, LCD_COLUMNS, LCD_ROWS, toHex } from '@trxcontroller/rcip';
import { useScanner } from '../store/scanner';
import { useUi } from '../store/ui';

export default function LcdPanel({ embedded = false }: { embedded?: boolean }) {
  const lcd = useScanner((s) => s.snapshot.lcd);
  const online = useScanner((s) => s.snapshot.link.status === 'connected' || s.snapshot.link.status === 'unresponsive');
  const diagnostics = useUi((s) => s.diagnostics);
  const [hexWanted, setHexWanted] = useState(false);
  const showHex = diagnostics && hexWanted;
  const [copied, setCopied] = useState(false);
  const lines = lcd?.lines ?? Array.from({ length: LCD_ROWS }, () => ' '.repeat(LCD_COLUMNS));
  const iconText = lcd ? describeIcons(lcd.icons) : '';
  const hexText = lcd
    ? [
        ...Array.from({ length: LCD_ROWS }, (_, r) => `${r}  ${toHex(lcd.raw.subarray(r * LCD_COLUMNS, (r + 1) * LCD_COLUMNS))}  |${lines[r] ?? ''}|`),
        `icons ${toHex(lcd.icons.raw)}`,
      ].join('\n')
    : '';
  const copyHex = (): void => {
    void navigator.clipboard.writeText(hexText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <section className={embedded ? 'lcd-fit flex h-full flex-col' : 'rounded-xl border border-edge bg-panel p-4'}>
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">{embedded ? '6 × 16 as sent by the scanner' : 'Scanner display'}</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-ink-3">{iconText && iconText !== '(none)' ? iconText : ''}</span>
          {diagnostics && (
            <button
              className={`rounded border border-edge px-1.5 py-0.5 font-mono text-[10px] ${showHex ? 'text-cyan' : 'text-ink-3 hover:text-ink-2'}`}
              title="Show the raw display bytes (for identifying scanner glyphs)"
              onClick={() => setHexWanted((v) => !v)}
            >
              hex
            </button>
          )}
        </div>
      </div>
      <div className={`lcd-screen shrink-0 rounded-lg bg-lcd font-mono leading-[1.35] ${online ? 'text-lcd-ink' : 'text-lcd-dim'}`}>
        {lines.map((line, i) => (
          <div key={i} className={`lcd-line rounded px-1 ${lcd?.cursorLine === i ? 'lcd-cursor' : ''}`}>
            {line}
          </div>
        ))}
      </div>
      {showHex && lcd && (
        <div className="relative mt-2">
          <pre className="select-text overflow-x-auto rounded-md bg-panel-2 px-3 py-2 pr-16 font-mono text-[11px] leading-relaxed text-ink-2">{hexText}</pre>
          <button
            className="absolute top-1.5 right-1.5 rounded border border-edge bg-panel px-1.5 py-0.5 font-mono text-[10px] text-ink-3 hover:text-ink"
            onClick={copyHex}
            title="Copy the bytes and text to the clipboard"
          >
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      )}
    </section>
  );
}
