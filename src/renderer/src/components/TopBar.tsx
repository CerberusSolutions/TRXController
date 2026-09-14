import { useScanner } from '../store/scanner';
import type { LinkStatus } from '../../../shared/ipc';
import DataMenu from './DataMenu';

const STATUS_STYLE: Record<LinkStatus, { dot: string; text: string }> = {
  disconnected: { dot: 'bg-ink-3', text: 'Disconnected' },
  connecting: { dot: 'bg-amber animate-pulse', text: 'Connecting' },
  connected: { dot: 'bg-green', text: 'Connected' },
  unresponsive: { dot: 'bg-amber animate-pulse', text: 'No reply' },
  error: { dot: 'bg-red', text: 'Error' },
};

export default function TopBar() {
  const { snapshot, ports, selectedPort, busy, selectPort, connect, disconnect, refreshPorts } = useScanner();
  const link = snapshot.link;
  const style = STATUS_STYLE[link.status];
  const connected = link.status === 'connected' || link.status === 'unresponsive' || link.status === 'connecting';
  const v = snapshot.version;

  return (
    <header
      className="app-drag flex h-[46px] items-center gap-4 border-b border-edge bg-panel px-4"
      // Leave room for the native minimise / maximise / close overlay on Windows.
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw) + 12px)' }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tracking-tight">TRX</span>
        <span className="text-lg font-light tracking-tight text-ink-2">Controller</span>
      </div>

      <div className="no-drag ml-auto flex items-center gap-2">
        <DataMenu />
        <select
          className="rounded-md border border-edge bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none focus:border-cyan disabled:opacity-50"
          value={selectedPort ?? ''}
          disabled={connected || busy}
          onChange={(e) => selectPort(e.target.value)}
        >
          {ports.length === 0 && <option value="">No serial ports</option>}
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
            className="rounded-md border border-edge bg-panel-2 px-3 py-1.5 text-sm font-medium hover:bg-[#1f2a3c] disabled:opacity-50"
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

      <div className="no-drag flex items-center gap-2 border-l border-edge pl-4 text-sm">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} />
        <span className="text-ink-2">{style.text}</span>
        {v && (
          <span className="ml-2 font-mono text-xs text-ink-3" title={`boot ${v.boot.text} · cpu ${v.cpu.text} · dsp ${v.dsp1.text}/${v.dsp2.text}`}>
            {v.model} · fw {v.cpu.text}
          </span>
        )}
        {link.error && <span className="ml-2 text-xs text-red">{link.error}</span>}
      </div>
    </header>
  );
}
