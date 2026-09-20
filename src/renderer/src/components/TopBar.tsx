import { useEffect, useState } from 'react';
import { useScanner } from '../store/scanner';
import type { LinkStatus } from '../../../shared/ipc';
import { useUi } from '../store/ui';
import { DataButton } from './DataMenu';
import ThemeToggle from './ThemeToggle';

const STATUS_STYLE: Record<LinkStatus, { dot: string; text: string }> = {
  disconnected: { dot: 'bg-ink-3', text: 'Disconnected' },
  connecting: { dot: 'bg-amber animate-pulse', text: 'Connecting' },
  connected: { dot: 'bg-green', text: 'Connected' },
  unresponsive: { dot: 'bg-amber animate-pulse', text: 'No reply' },
  error: { dot: 'bg-red', text: 'Error' },
};

export default function TopBar() {
  const { snapshot, ports, portsError, selectedPort, busy, selectPort, connect, disconnect, refreshPorts } = useScanner();
  const link = snapshot.link;
  const stall = link.stall;
  // Elapsed-time ticker for the busy notice.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!stall) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [stall]);
  // The scanner announces when it is switched off; that beats the stall it then causes.
  const off = snapshot.power?.on === false && (link.status === 'connected' || link.status === 'unresponsive');
  const style = off
    ? { dot: 'bg-ink-3', text: 'Scanner off' }
    : stall
      ? {
          dot: 'bg-amber animate-pulse',
          text: `${stall.loading ? 'Loading scanlists' : 'Scanner busy'} · ${Math.max(0, Math.round((Date.now() - stall.since) / 1000))} s`,
        }
      : STATUS_STYLE[link.status];
  const connected = link.status === 'connected' || link.status === 'unresponsive' || link.status === 'connecting';
  const v = snapshot.version;
  const app = useUi((s) => s.app);
  const update = useUi((s) => s.update);
  const openHelp = useUi((s) => s.openHelp);

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
        <select
          className="rounded-md border border-edge bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan disabled:opacity-50"
          value={selectedPort ?? ''}
          disabled={connected || busy}
          onChange={(e) => selectPort(e.target.value)}
        >
          {ports.length === 0 && <option value="">{portsError ? 'Cannot list ports' : 'No serial ports'}</option>}
          {ports.map((p) => (
            <option key={p.path} value={p.path}>
              {p.path}
              {p.friendlyName ? ` · ${p.friendlyName.replace(/\s*\(COM\d+\)$/, '')}` : p.manufacturer ? ` · ${p.manufacturer}` : ''}
            </option>
          ))}
        </select>
        <button
          className="rounded-md border border-edge bg-panel-2 px-2 py-1.5 text-sm text-ink-2 hover:text-ink disabled:opacity-50"
          title="Rescan ports"
          disabled={connected || busy}
          onClick={() => void refreshPorts()}
        >
          ⟳
        </button>
        {connected ? (
          <button
            className="rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-sm font-medium hover:bg-edge disabled:opacity-50"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        ) : (
          <button
            className="rounded-md bg-cyan px-3 py-1.5 text-sm font-semibold text-bg hover:brightness-110 disabled:opacity-50"
            disabled={busy || !selectedPort}
            onClick={() => void connect()}
          >
            Connect
          </button>
        )}
      </div>

      <div className="no-drag flex items-center gap-2 whitespace-nowrap border-l border-edge pl-4 text-sm">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} />
        <span
          className="text-ink-2"
          title={
            off
              ? 'The scanner said it has switched off. Switch it back on and the app carries on; nothing needs reconnecting.'
              : stall
                ? 'The scanner stops answering while it loads scanlists; key presses would queue up and fire afterwards, so the keypad is held.'
                : undefined
          }
        >
          {style.text}
        </span>
        {v && (
          <span className="ml-2 font-mono text-xs text-ink-3" title={`boot ${v.boot.text} · cpu ${v.cpu.text} · dsp ${v.dsp1.text}/${v.dsp2.text}`}>
            {v.model} · fw {v.cpu.text}
          </span>
        )}
        {link.error && <span className="ml-2 text-xs text-red">{link.error}</span>}
        {!link.error && portsError && (
          <span className="ml-2 text-xs text-red" title={portsError}>
            Cannot list ports: {portsError}
          </span>
        )}
      </div>
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
