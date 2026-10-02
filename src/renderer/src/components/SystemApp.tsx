import { useEffect, useMemo, useState } from 'react';
import { NO_ID } from '@trxcontroller/rcip';
import { ALIVE_MS, type DsdCall } from '../../../shared/dsd';
import { pickRadioName } from '../../../shared/radioNames';
import { attachDsdEvents, useDsd } from '../store/dsd';
import { attachLogEvents, useLog } from '../store/log';
import { attachScannerEvents, useScanner } from '../store/scanner';
import { initTheme } from '../store/theme';

const hms = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const mhz = (hz: number): string => (hz / 1e6).toFixed(4);
const PILL = 'shrink-0 rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider';

/**
 * The System window (`#system` route): what DSD+ sees on the control channel of the trunked system it
 * is parked on, read from its event file by main. The TRX follows one call at a time; DSD+ sees every
 * grant, so this is the whole system beside the one call the radio chose, which is highlighted.
 */
export default function SystemApp() {
  const status = useDsd((s) => s.status);
  const snapshot = useScanner((s) => s.snapshot);
  const radioNames = useLog((s) => s.radioNames);
  const [, setTick] = useState(0);

  useEffect(() => {
    const offTheme = initTheme();
    const offScanner = attachScannerEvents();
    const offLog = attachLogEvents();
    const offDsd = attachDsdEvents();
    // Durations of open calls and the "quiet for" figure move by the second.
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(t);
      offDsd();
      offLog();
      offScanner();
      offTheme();
    };
  }, []);

  const feed = status?.feed;
  const h = snapshot.active?.header ?? null;
  const onTg = h && h.talkgroupId1 !== NO_ID ? h.talkgroupId1 : null;
  const onHz = snapshot.status?.frequencyHz ?? null;
  // The scanner's system tag keys the user's own radio names; DSD+'s imported names apply on any system.
  const system = h?.systemTag ?? '';
  const now = Date.now();
  const quietS = feed?.lastEventAt ? Math.max(0, Math.round((now - feed.lastEventAt) / 1000)) : null;
  const linkState: { dot: string; text: string } = !status?.folder
    ? { dot: 'bg-ink-3', text: 'DSD+ link off' }
    : status.error
      ? { dot: 'bg-red', text: status.error }
      : !status.event.found
        ? { dot: 'bg-amber', text: 'No DSDPlus.event in the folder yet' }
        : status.alive
          ? { dot: 'bg-green', text: 'DSD+ live' }
          : { dot: 'bg-amber animate-pulse', text: quietS !== null ? `DSD+ quiet for ${quietS >= 120 ? `${Math.round(quietS / 60)} min` : `${quietS} s`}` : 'Waiting for DSD+' };
  const tgName = (tg: number | null): string => (tg === null ? '' : (status?.tgNames[tg] ?? ''));
  const radioLabel = (c: DsdCall): { name: string; sub: string } => {
    const own = pickRadioName(radioNames, c.rid, system)?.name ?? null;
    const name = own ?? c.alias ?? c.callsign ?? (c.rid !== null ? String(c.rid) : '');
    const sub = [own && c.alias && own !== c.alias ? c.alias : '', c.rid !== null && name !== String(c.rid) ? String(c.rid) : ''].filter(Boolean).join(' · ');
    return { name, sub };
  };
  const calls = useMemo(() => feed?.calls ?? [], [feed]);
  // The call the scanner is on: the newest one on its talkgroup and voice frequency, and only while that call is open or just ended.
  const onAirId = useMemo(() => {
    if (onTg === null) return null;
    const c = calls.find((x) => x.tg === onTg && (x.hz === null || onHz === null || Math.abs(x.hz - onHz) < 1000));
    return c && (c.open || now - c.lastAt < 15_000) ? c.id : null;
  }, [calls, onTg, onHz, now]);
  const isOnAir = (c: DsdCall): boolean => c.id === onAirId;

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="app-drag flex h-[46px] shrink-0 items-center gap-3 border-b border-edge bg-panel px-4" style={window.trx?.platform === 'darwin' ? { paddingLeft: '84px' } : window.trx?.platform === 'linux' ? undefined : { paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw) + 12px)' }}>
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2">System</span>
        {feed?.network ? (
          <span className="min-w-0 truncate text-sm" title={`${feed.network.id}${feed.site ? ` · ${feed.site.id}` : ''}`}>
            <span className="text-ink">{feed.network.name || feed.network.id}</span>
            {feed.site && <span className="text-ink-3"> · {feed.site.name || feed.site.id}</span>}
          </span>
        ) : (
          <span className="text-sm text-ink-3">{status?.folder ? 'No system seen yet' : 'Set the DSD+ folder under Data'}</span>
        )}
        {feed?.nac && <span className="font-mono text-[11px] text-ink-3">NAC {feed.nac}</span>}
        {feed?.dcc !== null && feed?.dcc !== undefined && <span className="font-mono text-[11px] text-ink-3">CC {feed.dcc}</span>}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-2" title={status?.folder ?? undefined}>
          <span className={`inline-block h-2 w-2 rounded-full ${linkState.dot}`} />
          <span className="max-w-[18rem] truncate">{linkState.text}</span>
          {feed?.lastEventAt && <span className="font-mono text-ink-3">{hms(feed.lastEventAt)}</span>}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {calls.length === 0 ? (
          <p className="p-6 text-sm text-ink-3">{status?.folder ? 'No calls yet. They appear here as DSD+ decodes the control channel.' : 'The DSD+ link reads DSDPlus.event, .radios and .groups from the DSD+ folder. Choose it under Data › DSD+ link.'}</p>
        ) : (
          <table className="w-full border-collapse font-mono text-[12.5px]">
            <thead className="sticky top-0 bg-bg">
              <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-ink-2">
                <th className="px-3 py-1.5 font-bold">Time</th>
                <th className="px-2 py-1.5 font-bold">Talkgroup</th>
                <th className="px-2 py-1.5 font-bold">Radio</th>
                <th className="px-2 py-1.5 font-bold">Channel</th>
                <th className="px-2 py-1.5 text-right font-bold">Length</th>
                <th className="px-3 py-1.5 font-bold" />
              </tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const r = radioLabel(c);
                const onAir = isOnAir(c);
                const length = c.durationS !== null ? `${c.durationS} s` : c.open ? `${Math.max(1, Math.round((now - c.startedAt) / 1000))} s` : '';
                return (
                  <tr key={c.id} className={`border-t border-edge/50 ${onAir ? 'bg-green/10' : c.open ? 'bg-panel' : ''}`} title={onAir ? 'The call the scanner is on' : undefined}>
                    <td className="whitespace-nowrap px-3 py-1 text-ink-3">
                      {c.open && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green align-middle" title="In progress" />}
                      {hms(c.startedAt)}
                    </td>
                    <td className="px-2 py-1">
                      {c.type === 'Private' ? (
                        <span className="text-ink-2">
                          Private{c.target !== null ? ` → ${c.target}` : ''}
                        </span>
                      ) : c.tg !== null ? (
                        <>
                          <span className="font-sans text-[13px] text-ink">{tgName(c.tg) || `TG ${c.tg}`}</span>
                          {tgName(c.tg) && <span className="text-ink-3"> {c.tg}</span>}
                        </>
                      ) : (
                        <span className="text-ink-3">{c.type}</span>
                      )}
                      {c.emergency && <span className={`${PILL} ml-1.5 bg-red text-bg`}>Emergency</span>}
                      {c.flags.map((f) => (
                        <span key={f} className={`${PILL} ml-1.5 bg-panel-2 text-ink-3`}>
                          {f}
                        </span>
                      ))}
                    </td>
                    <td className="px-2 py-1" title={c.rid !== null ? `Radio ID ${c.rid}` : undefined}>
                      <span className="font-sans text-[13px] text-ink">{r.name}</span>
                      {r.sub && <span className="text-ink-3"> {r.sub}</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1">
                      {c.hz !== null ? <span className="text-amber">{mhz(c.hz)}</span> : c.channel ? <span className="text-ink-2">ch {c.channel}</span> : <span className="text-ink-3">—</span>}
                      {c.slot !== null && <span className="text-ink-3"> · slot {c.slot}</span>}
                      {c.enc && (
                        <span className={`${PILL} ml-1.5 bg-red/15 text-red`} title={[c.alg, c.keyId ? `key ${c.keyId}` : ''].filter(Boolean).join(' ') || 'Encrypted'}>
                          ENC
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right text-ink-2">{length}</td>
                    <td className="px-3 py-1">{onAir && <span className={`${PILL} bg-green text-bg`}>TRX</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {feed && feed.notes.length > 0 && (
        <div className="max-h-40 shrink-0 overflow-auto border-t border-edge bg-panel px-3 py-1.5 font-mono text-[11px] text-ink-3">
          {feed.notes.map((n, i) => (
            <div key={i} className="truncate">
              <span className="text-ink-3/70">{hms(n.at)}</span> {n.text}
            </div>
          ))}
        </div>
      )}
      {status && !status.alive && status.folder && status.event.found && (
        <div className="shrink-0 border-t border-edge bg-panel px-3 py-1 text-[11px] text-ink-3">
          Events count as live for {ALIVE_MS / 1000} s. DSD+ writes to the file as the control channel speaks; a quiet system looks the same as a stopped DSD+.
        </div>
      )}
    </div>
  );
}
