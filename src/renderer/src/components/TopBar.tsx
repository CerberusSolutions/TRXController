import { useEffect, useState } from 'react';
import { useScanner } from '../store/scanner';
import type { LinkStatus, ScannerSnapshot } from '../../../shared/ipc';
import { useUi } from '../store/ui';
import { useDsd } from '../store/dsd';
import { useIdentities } from '../store/identities';
import { DataButton } from './DataMenu';
import RxPill from './RxPill';
import ThemeToggle from './ThemeToggle';

const STATUS_STYLE: Record<LinkStatus, { dot: string; text: string }> = {
  disconnected: { dot: 'bg-ink-3', text: 'Disconnected' },
  connecting: { dot: 'bg-amber animate-pulse', text: 'Connecting' },
  connected: { dot: 'bg-green', text: 'Connected' },
  unresponsive: { dot: 'bg-amber animate-pulse', text: 'No reply' },
  error: { dot: 'bg-red', text: 'Error' },
};

/** The link state a snapshot shows: off, busy, or the plain status. */
function linkStyle(snapshot: ScannerSnapshot): { dot: string; text: string; off: boolean; stall: ScannerSnapshot['link']['stall'] } {
  const link = snapshot.link;
  const stall = link.stall;
  // The scanner announces when it is switched off; that beats the stall it then causes.
  const off = snapshot.power?.on === false && (link.status === 'connected' || link.status === 'unresponsive');
  if (off) return { dot: 'bg-ink-3', text: 'Scanner off', off, stall };
  if (stall) return { dot: 'bg-amber animate-pulse', text: `${stall.loading ? 'Loading scanlists' : 'Scanner busy'} · ${Math.max(0, Math.round((Date.now() - stall.since) / 1000))} s`, off, stall };
  return { ...STATUS_STYLE[link.status], off, stall };
}

/**
 * One scanner's connection controls and link state: the port, Connect / Disconnect, the dot and the firmware. RX1's
 * is the bar as it always was; RX2's is the same block again, each with its pill once there are two.
 */
function PortBlock({ rx, compact, onRemove }: { rx: 0 | 1; compact: boolean; onRemove?: () => void }) {
  const store = useScanner();
  const snapshot = rx === 0 ? store.snapshot : store.rx2.snapshot;
  const selectedPort = rx === 0 ? store.selectedPort : store.rx2.selectedPort;
  const busy = rx === 0 ? store.busy : store.rx2.busy;
  const selectPort = rx === 0 ? store.selectPort : store.selectPort2;
  const connect = rx === 0 ? store.connect : store.connect2;
  const disconnect = rx === 0 ? store.disconnect : store.disconnect2;
  const { ports, portsError, refreshPorts } = store;
  const link = snapshot.link;
  const style = linkStyle(snapshot);
  // Elapsed-time ticker for the busy notice.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!style.stall) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [style.stall]);
  const connected = link.status === 'connected' || link.status === 'unresponsive' || link.status === 'connecting';
  const v = snapshot.version;
  // With two scanners the bar is full: a plain Connected / Disconnected is the dot alone (its word in the tooltip), the rest still spelled out.
  const plain = !style.off && !style.stall && (link.status === 'connected' || link.status === 'disconnected');
  const portName = (p: { path: string; friendlyName?: string; manufacturer?: string }): string =>
    compact ? p.path : `${p.path}${p.friendlyName ? ` · ${p.friendlyName.replace(/\s*\(COM\d+\)$/, '')}` : p.manufacturer ? ` · ${p.manufacturer}` : ''}`;
  return (
    <>
      <div className="no-drag flex items-center gap-2">
        {compact && <RxPill rx={rx} title={rx === 0 ? 'The first scanner' : 'The second scanner'} />}
        <select
          className={`rounded-md border border-edge bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan disabled:opacity-50 ${compact ? 'max-w-[7rem]' : ''}`}
          value={selectedPort ?? ''}
          disabled={connected || busy}
          onChange={(e) => selectPort(e.target.value)}
          aria-label={`Port for RX${rx + 1}`}
        >
          {ports.length === 0 && <option value="">{portsError ? 'Cannot list ports' : 'No serial ports'}</option>}
          {ports.map((p) => (
            <option key={p.path} value={p.path}>
              {portName(p)}
            </option>
          ))}
        </select>
        {rx === 0 && (
          <button
            className="rounded-md border border-edge bg-panel-2 px-2 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
            title="Rescan ports"
            disabled={connected || busy}
            onClick={() => void refreshPorts()}
          >
            ⟳
          </button>
        )}
        {connected ? (
          <button className="rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-sm font-medium hover:bg-edge disabled:opacity-50" disabled={busy} onClick={() => void disconnect()}>
            Disconnect
          </button>
        ) : (
          <button className="rounded-md bg-cyan px-3 py-1.5 text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50" disabled={busy || !selectedPort} onClick={() => void connect()}>
            Connect
          </button>
        )}
        {onRemove && !connected && (
          <button
            className="rounded-md border border-edge px-2 py-1.5 text-sm text-ink-3 hover:text-red"
            title="Remove the second scanner: the window goes back to one"
            aria-label="Remove the second scanner"
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </div>

      <div className={`no-drag flex items-center gap-2 whitespace-nowrap border-l border-edge ${compact ? 'pl-2 text-xs' : 'pl-4 text-sm'}`}>
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} title={compact && plain ? style.text : undefined} />
        {!(compact && plain) && (
          <span
            className="text-ink-2"
            title={
              style.off
                ? 'The scanner said it has switched off. Switch it back on and the app carries on; nothing needs reconnecting.'
                : style.stall
                  ? 'The scanner stops answering while it loads scanlists; key presses would queue up and fire afterwards, so the keypad is held.'
                  : undefined
            }
          >
            {style.text}
          </span>
        )}
        {v && (
          <span className={`${compact && plain ? '' : 'ml-2 '}font-mono text-xs text-ink-3`} title={`${style.text} · boot ${v.boot.text} · cpu ${v.cpu.text} · dsp ${v.dsp1.text}/${v.dsp2.text}`}>
            {v.model}
            {compact ? '' : ` · fw ${v.cpu.text}`}
          </span>
        )}
        {link.error && <span className="ml-2 text-xs text-red">{link.error}</span>}
        {rx === 0 && !link.error && portsError && (
          <span className="ml-2 text-xs text-red" title={portsError}>
            Cannot list ports: {portsError}
          </span>
        )}
      </div>
    </>
  );
}

export default function TopBar() {
  const settings = useIdentities((s) => s.settings);
  const saveSettings = useIdentities((s) => s.saveSettings);
  const twin = settings.rx2 !== null;
  // A second scanner just added has no port yet: list them again so its selector offers the first RX1 is not on.
  const refreshPorts = useScanner((s) => s.refreshPorts);
  useEffect(() => {
    if (twin) void refreshPorts();
  }, [twin, refreshPorts]);
  const app = useUi((s) => s.app);
  const update = useUi((s) => s.update);
  const openHelp = useUi((s) => s.openHelp);
  const dsd = useDsd((s) => s.status);
  const openSystem = useDsd((s) => s.open);
  // The DSD+ pill: only once a folder is set, green while events arrive, amber when DSD+ has gone quiet, red on a read error.
  const dsdDot = dsd?.error ? 'bg-red' : dsd?.alive ? 'bg-green' : 'bg-amber';
  const dsdTitle = dsd?.error
    ? dsd.error
    : dsd?.alive
      ? `DSD+ live${dsd.feed.network ? ` on ${dsd.feed.network.name || dsd.feed.network.id}` : ''}: open the System window`
      : dsd?.event.found
        ? 'DSD+ has gone quiet (no event in the last two minutes): open the System window'
        : 'No DSDPlus.event in the DSD+ folder yet: open the System window';

  return (
    <header
      className="app-drag flex h-[46px] items-center gap-4 border-b border-edge bg-panel px-4"
      // Leave room for the native window controls: the minimise / maximise / close overlay
      // at the top right on Windows, the traffic lights at the top left on macOS. Linux keeps
      // the window manager's own frame, so nothing overlaps the bar.
      style={
        window.trx?.platform === 'darwin'
          ? { paddingLeft: '84px' }
          : window.trx?.platform === 'linux'
            ? undefined
            : { paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw) + 12px)' }
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tracking-tight">TRX</span>
        <span className="text-lg font-light tracking-tight text-ink-2">Controller</span>
        <span className="rounded border border-amber/60 px-1 py-px text-[9px] font-bold tracking-widest text-amber" title={`Beta software. No warranty or guarantee of any kind.`}>
          BETA
        </span>
        {app && <span className="font-mono text-[11px] text-ink-3">v{app.version}</span>}
        {dsd?.folder && (
          <button
            type="button"
            className="no-drag flex items-center gap-1.5 rounded border border-edge px-1.5 py-px text-[10px] font-bold tracking-wider text-ink-2 hover:bg-panel-2 hover:text-ink"
            title={dsdTitle}
            onClick={openSystem}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${dsdDot}`} />
            DSD+
          </button>
        )}
        {update?.newer && (
          <a
            className="no-drag rounded border border-green/60 px-1.5 py-px text-[10px] font-bold tracking-wider text-green hover:bg-green/10"
            href={update.url}
            target="_blank"
            rel="noreferrer"
            title={`v${update.latest} is on GitHub. Opens the release page in your browser.`}
          >
            v{update.latest} available
          </a>
        )}
      </div>

      <div className="no-drag ml-auto flex items-center gap-2">
        <DataButton />
        {!twin && (
          <button
            className="rounded-md border border-dashed border-edge px-2 py-1.5 text-sm text-ink-3 hover:text-ink"
            title="Add a second scanner (RX2) with its own port. The log then says which scanner heard what."
            aria-label="Add a second scanner"
            onClick={() => void saveSettings({ rx2: { port: null, autoConnect: true } })}
          >
            +
          </button>
        )}
        {app?.dev && window.trx?.programmingOpen && (
          <button
            className="rounded-md border border-dashed border-edge px-2.5 py-1.5 text-sm text-ink-2 hover:text-ink"
            onClick={() => void window.trx.programmingOpen()}
            title="Development build only: read the scanner's SD-card programming (CDAT)"
          >
            Program
          </button>
        )}
      </div>
      <PortBlock rx={0} compact={twin} />
      {twin && <PortBlock rx={1} compact onRemove={() => void saveSettings({ rx2: null })} />}
      <ThemeToggle />
      <button
        className="no-drag flex h-7 w-7 items-center justify-center rounded-md border border-edge text-sm font-semibold text-ink-2 hover:bg-panel-2 hover:text-ink"
        onClick={openHelp}
        title="Help: connecting, data files, keyboard"
        aria-label="Help"
      >
        ?
      </button>
    </header>
  );
}
