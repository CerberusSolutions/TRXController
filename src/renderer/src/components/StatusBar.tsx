import { batteryText } from '../lib/format';
import { rxView, useScanner } from '../store/scanner';
import { useIdentities } from '../store/identities';
import { useUi } from '../store/ui';
import { RX_PILL } from './RxPill';

/** One receiver's figures: LED, power, port, link statistics. With two scanners each gets its pill and the lot in one line. */
function RxStatus({ rx, twin }: { rx: number; twin: boolean }) {
  const { status, stats, link } = useScanner((s) => rxView(s, rx).snapshot);
  const led = status?.led;
  const ledCss = led ? `rgb(${led.r}, ${led.g}, ${led.b})` : 'transparent';
  const online = link.status === 'connected' || link.status === 'unresponsive';
  const pill = RX_PILL[rx] ?? RX_PILL[0]!;
  return (
    <>
      {twin && <span className={`font-sans font-bold tracking-wider ${pill.text}`}>{pill.label}</span>}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border border-edge" style={{ background: ledCss }} />
        LED
      </span>
      <span>{online ? batteryText(status) : '—'}</span>
      <span>{link.port ?? ''}</span>
      {twin && (
        <span className="text-ink-3/80" title={`${stats.responses}/${stats.requests} replies · ${stats.timeouts} timeouts · ${stats.late} late · ${stats.frameErrors} bad frames`}>
          rtt {stats.lastRttMs ?? '—'} ms · {stats.responses}/{stats.requests} ok
        </span>
      )}
      {!twin && (
        <span className="ml-auto">
          rtt {stats.lastRttMs ?? '—'} ms · {stats.responses}/{stats.requests} ok · {stats.timeouts} t/o · {stats.late} late · {stats.frameErrors} bad
        </span>
      )}
    </>
  );
}

export default function StatusBar() {
  const updatedAt = useScanner((s) => s.snapshot.updatedAt);
  const ccdumpCount = useScanner((s) => s.ccdump.length);
  const diagnostics = useUi((s) => s.diagnostics);
  const twin = useIdentities((s) => s.settings.rx2 !== null);

  return (
    <footer className="flex items-center gap-5 border-t border-edge bg-panel px-4 py-1.5 font-mono text-[11px] text-ink-3">
      <RxStatus rx={0} twin={twin} />
      {twin && (
        <>
          <span className="h-3 border-l border-edge" />
          <RxStatus rx={1} twin />
          <span className="ml-auto" />
        </>
      )}
      {diagnostics && (
        <span className="rounded border border-amber/60 px-1 text-[9px] font-bold tracking-widest text-amber" title={`Diagnostics on (${window.trx?.platform === 'darwin' ? 'Cmd' : 'Ctrl'}+Shift+D to hide)`}>
          DIAG
        </span>
      )}
      {ccdumpCount > 0 && <span>ccdump {ccdumpCount}</span>}
      <span>{updatedAt ? new Date(updatedAt).toLocaleTimeString() : ''}</span>
    </footer>
  );
}
