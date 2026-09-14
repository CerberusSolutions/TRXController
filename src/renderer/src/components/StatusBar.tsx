import { batteryText } from '../lib/format';
import { useScanner } from '../store/scanner';
import { useUi } from '../store/ui';

export default function StatusBar() {
  const { status, stats, link, updatedAt } = useScanner((s) => s.snapshot);
  const ccdumpCount = useScanner((s) => s.ccdump.length);
  const led = status?.led;
  const ledCss = led ? `rgb(${led.r}, ${led.g}, ${led.b})` : 'transparent';
  const online = link.status === 'connected' || link.status === 'unresponsive';
  const diagnostics = useUi((s) => s.diagnostics);

  return (
    <footer className="flex items-center gap-5 border-t border-edge bg-panel px-4 py-1.5 font-mono text-[11px] text-ink-3">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border border-edge" style={{ background: ledCss }} />
        LED
      </span>
      <span>{online ? batteryText(status) : '—'}</span>
      <span>{link.port ?? ''}</span>
      <span className="ml-auto">
        rtt {stats.lastRttMs ?? '—'} ms · {stats.responses}/{stats.requests} ok · {stats.timeouts} t/o · {stats.late} late · {stats.frameErrors} bad
      </span>
      {diagnostics && (
        <span className="rounded border border-amber/60 px-1 text-[9px] font-bold tracking-widest text-amber" title="Diagnostics on (Ctrl+Shift+D to hide)">
          DIAG
        </span>
      )}
      {ccdumpCount > 0 && <span>ccdump {ccdumpCount}</span>}
      <span>{updatedAt ? new Date(updatedAt).toLocaleTimeString() : ''}</span>
    </footer>
  );
}
