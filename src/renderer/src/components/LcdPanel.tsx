import { useState } from 'react';
import { describeIcons, LCD_COLUMNS, LCD_ROWS, toHex, type Lcd } from '@trxcontroller/rcip';
import { useScanner } from '../store/scanner';

/** The icon strip along the top of the scanner's display, as short legends in the order the TRX draws them. */
function iconStrip(lcd: Lcd | null): string[] {
  if (!lcd) return [];
  const i = lcd.icons;
  const out: string[] = [];
  if (i.rssiBars) out.push('▮'.repeat(i.rssiBars) + '▯'.repeat(5 - i.rssiBars));
  if (i.s) out.push('S');
  if (i.batt) out.push(i.battBlinking ? 'BATT!' : 'BATT');
  if (i.extPower) out.push('EXT');
  if (i.fn) out.push('Fn');
  if (i.g) out.push('G');
  if (i.a) out.push('A');
  if (i.t) out.push('T');
  if (i.play) out.push('▶');
  if (i.pause) out.push('❚❚');
  if (i.signalType) out.push(i.signalTypeName);
  if (i.if) out.push('IF');
  if (i.trunk2) out.push('TRUNK2');
  if (i.pri) out.push('PRI');
  if (i.trunkS) out.push('TRUNKS');
  return out;
}

/**
 * The scanner's own 6 x 16 display drawn as the TRX draws it: amber backlight, dark segments, the icon
 * strip along the top, the highlighted menu line. Unlit (dark grey, nothing shown) while no scanner is
 * connected or it is switched off.
 */
export function LcdScreen({ className = '' }: { className?: string }) {
  const lcd = useScanner((s) => s.snapshot.lcd);
  const online = useScanner((s) => s.snapshot.link.status === 'connected' || s.snapshot.link.status === 'unresponsive');
  const off = useScanner((s) => s.snapshot.power?.on === false);
  const lit = online && !off && lcd !== null;
  const lines = lcd?.lines ?? Array.from({ length: LCD_ROWS }, () => ' '.repeat(LCD_COLUMNS));
  const icons = lit ? iconStrip(lcd) : [];
  return (
    <div
      className={`lcd-screen lcd-radio shrink-0 rounded-lg font-mono leading-[1.35] ${lit ? 'bg-lcd text-lcd-ink' : 'lcd-off bg-lcd-off text-lcd-off-ink'} ${className}`}
      title={lit ? 'The scanner\'s display, as it draws it' : off ? 'Scanner off' : 'No scanner connected'}
    >
      <div className="lcd-icons" aria-hidden={icons.length === 0}>
        {icons.length ? icons.map((t, i) => <span key={i}>{t}</span>) : <span>&nbsp;</span>}
      </div>
      {lines.map((line, i) => (
        <div key={i} className={`lcd-line rounded px-1 ${lit && lcd?.cursorLine === i ? 'lcd-cursor' : ''}`}>
          {lit ? line : ' '.repeat(LCD_COLUMNS)}
        </div>
      ))}
    </div>
  );
}

/** The Debug tab (diagnostics on): the display's raw bytes, line by line with the text beside them, its icon flags spelled out, and a copy button. */
export default function DebugPanel() {
  const lcd = useScanner((s) => s.snapshot.lcd);
  const [copied, setCopied] = useState(false);
  const iconText = lcd ? describeIcons(lcd.icons) : '';
  const hexText = lcd
    ? [
        ...Array.from({ length: LCD_ROWS }, (_, r) => `${r}  ${toHex(lcd.raw.subarray(r * LCD_COLUMNS, (r + 1) * LCD_COLUMNS))}  |${lcd.lines[r] ?? ''}|`),
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
    <section className="flex h-full flex-col">
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2">Display bytes, 6 × 16 as sent by the scanner</span>
        <span className="font-mono text-[11px] text-ink-3">{iconText && iconText !== '(none)' ? `icons: ${iconText}` : ''}</span>
      </div>
      {lcd ? (
        <div className="relative">
          <pre className="select-text overflow-x-auto rounded-md bg-panel-2 px-3 py-2 pr-16 font-mono text-[11px] leading-relaxed text-ink-2">{hexText}</pre>
          <button
            className="absolute top-1.5 right-1.5 rounded border border-edge bg-panel px-1.5 py-0.5 font-mono text-[10px] text-ink-3 hover:text-ink"
            onClick={copyHex}
            title="Copy the bytes and text to the clipboard, for reporting a glyph the app does not know"
          >
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-ink-3">No display bytes yet: connect the scanner.</p>
      )}
    </section>
  );
}
