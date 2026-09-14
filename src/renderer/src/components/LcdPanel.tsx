import { describeIcons, LCD_COLUMNS, LCD_ROWS } from '@trxcontroller/rcip';
import { useScanner } from '../store/scanner';

export default function LcdPanel() {
  const lcd = useScanner((s) => s.snapshot.lcd);
  const online = useScanner((s) => s.snapshot.link.status === 'connected' || s.snapshot.link.status === 'unresponsive');
  const lines = lcd?.lines ?? Array.from({ length: LCD_ROWS }, () => ' '.repeat(LCD_COLUMNS));
  const iconText = lcd ? describeIcons(lcd.icons) : '';

  return (
    <section className="rounded-xl border border-edge bg-panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-3">Scanner display</span>
        <span className="font-mono text-[11px] text-ink-3">{iconText && iconText !== '(none)' ? iconText : ''}</span>
      </div>
      <div className={`rounded-lg bg-lcd px-4 py-3 font-mono text-[22px] leading-[1.35] ${online ? 'text-lcd-ink' : 'text-lcd-dim'}`}>
        {lines.map((line, i) => (
          <div key={i} className={`lcd-line rounded px-1 ${lcd?.cursorLine === i ? 'lcd-cursor' : ''}`}>
            {line}
          </div>
        ))}
      </div>
    </section>
  );
}
