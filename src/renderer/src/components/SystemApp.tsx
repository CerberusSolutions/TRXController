import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NO_ID, parseScanScreen, parseSearchScreen } from '@trxcontroller/rcip';
import { ALIVE_MS, type DsdCall } from '../../../shared/dsd';
import { MIN_VOTES, dsdFrequencyLines } from '../../../shared/dsdChannels';
import { pickRadioName } from '../../../shared/radioNames';
import { pickTgName } from '../../../shared/tgNames';
import { attachDsdEvents, useDsd } from '../store/dsd';
import { attachLogEvents, useLog } from '../store/log';
import { attachScannerEvents, useScanner } from '../store/scanner';
import { initTheme } from '../store/theme';
import SystemHistory from './SystemHistory';

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
  const tgNames = useLog((s) => s.tgNames);
  const [, setTick] = useState(0);
  const [docked, setDocked] = useState<'left' | 'right' | null>(null);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const networks = useDsd((s) => s.networks);
  const loadNetworks = useDsd((s) => s.loadNetworks);
  const [copied, setCopied] = useState(false);
  const toggleDock = useCallback(() => {
    const p = window.trx?.dsdDock?.(docked ? 'off' : 'auto');
    if (p) void p.then((s) => setDocked(s.docked));
  }, [docked]);

  useEffect(() => {
    const offTheme = initTheme();
    const offScanner = attachScannerEvents();
    const offLog = attachLogEvents();
    const offDsd = attachDsdEvents();
    const offDock = window.trx?.onDsdDockState ? window.trx.onDsdDockState((s) => setDocked(s.docked)) : () => undefined;
    // Durations of open calls and the "quiet for" figure move by the second.
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      clearInterval(t);
      offDock();
      offDsd();
      offLog();
      offScanner();
      offTheme();
    };
  }, []);

  // D docks the window beside the main one, or sets it free, as in the map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === 'd') toggleDock();
      if (e.key.toLowerCase() === 'c') setChannelsOpen((o) => !o);
      if (e.key.toLowerCase() === 'h') setHistoryOpen((o) => !o);
      if (e.key === 'Escape') {
        setChannelsOpen(false);
        setHistoryOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDock]);

  // The History view needs a network: DSD+'s current one, else the most recently recorded.
  useEffect(() => {
    if (historyOpen) void loadNetworks();
  }, [historyOpen, loadNetworks]);
  const feed = status?.feed;
  const h = snapshot.active?.header ?? null;
  const onHz = snapshot.status?.frequencyHz ?? null;
  const rfOpen = !!snapshot.status?.squelch.rf;
  // The IDs the scanner shows: the header's on a trunked object; in a search or on a conventional object the display's,
  // which alternates its TGID and RadioID lines, so each is kept from the last line that showed it while the squelch is open.
  const screen = snapshot.lcd ? (snapshot.status?.mode === 0x0a ? parseScanScreen(snapshot.lcd) : null) ?? parseSearchScreen(snapshot.lcd) : null;
  const shown = useRef<{ tg: number | null; rid: number | null }>({ tg: null, rid: null });
  if (!rfOpen) shown.current = { tg: null, rid: null };
  else {
    if (screen?.tgid !== null && screen?.tgid !== undefined) shown.current.tg = screen.tgid;
    if (screen?.radioId !== null && screen?.radioId !== undefined) shown.current.rid = screen.radioId;
  }
  const onTg = h && h.talkgroupId1 !== NO_ID ? h.talkgroupId1 : shown.current.tg;
  const onRid = h && h.radioId1 !== NO_ID ? h.radioId1 : shown.current.rid;
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
  // A name of the user's own (keyed to the scanner's tag for this network, else the network), else DSD+'s alias.
  const tgName = (tg: number | null): string => (tg === null ? '' : (pickTgName(tgNames, tg, [status?.system, status?.feed.network?.key, status?.feed.network?.id])?.name ?? status?.tgNames[tg] ?? ''));
  const radioLabel = (c: DsdCall): { name: string; sub: string } => {
    const own = pickRadioName(radioNames, c.rid, system)?.name ?? null;
    const name = own ?? c.alias ?? c.callsign ?? (c.rid !== null ? String(c.rid) : '');
    const sub = [own && c.alias && own !== c.alias ? c.alias : '', c.rid !== null && name !== String(c.rid) ? String(c.rid) : ''].filter(Boolean).join(' · ');
    return { name, sub };
  };
  const radioName = (rid: number, alias: string | null): string => pickRadioName(radioNames, rid, system)?.name ?? alias ?? '';
  const historyNetwork = feed?.network?.key ?? networks[0]?.network ?? null;
  const calls = useMemo(() => feed?.calls ?? [], [feed]);
  // A call's frequency: DSD+'s own when the site is in its frequencies file, else the one learned for the channel number.
  const learned = status?.channels ?? {};
  const hzOf = (c: DsdCall): number | null => c.hz ?? (c.channel !== null ? (learned[c.channel]?.hz ?? null) : null);
  const learnedCount = Object.values(learned).filter((l) => l.hz !== null).length;
  const formingCount = Object.values(learned).length - learnedCount;
  // The call the scanner is on: the newest one on its talkgroup (or, on a private call, its radio) and voice frequency, and
  // only while that call is open or just ended. With no IDs at all (a conventional object that happens to be a site's voice
  // channel) the frequency alone decides, so a known or learned channel still gets the marker.
  const onAirId = useMemo(() => {
    if (onHz === null || !rfOpen) return null;
    const c = calls.find((x) => {
      const hz = hzOf(x);
      const onHzToo = hz === null || Math.abs(hz - onHz) < 1000;
      if (onTg !== null && x.tg === onTg) return onHzToo;
      if (onRid !== null && (x.rid === onRid || x.target === onRid)) return onHzToo;
      return onTg === null && onRid === null && hz !== null && Math.abs(hz - onHz) < 1000;
    });
    return c && (c.open || now - c.lastAt < 15_000) ? c.id : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls, onTg, onRid, onHz, now, learned, rfOpen]);
  const frequencyLines = feed?.network ? dsdFrequencyLines(status?.protocol ?? 'DMR', feed.network.id, feed.site?.id ?? null, learned) : [];
  const copyLines = (): void => {
    void navigator.clipboard.writeText(frequencyLines.join('\r\n') + '\r\n').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const isOnAir = (c: DsdCall): boolean => c.id === onAirId;

  return (
    <div className="flex h-screen flex-col bg-bg text-ink">
      <header className="app-drag flex h-[46px] shrink-0 items-center gap-3 border-b border-edge bg-panel px-4" style={window.trx?.platform === 'darwin' ? { paddingLeft: '84px' } : window.trx?.platform === 'linux' ? undefined : { paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw) + 12px)' }}>
        {/* Mixed sizes and faces sit on one baseline, as the top bar's title does. */}
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2">System</span>
          {feed?.network ? (
            <span className="min-w-0 truncate text-sm" title={`${feed.network.id}${feed.site ? ` · ${feed.site.id}` : ''}`}>
              <span className="text-ink">{feed.network.name || feed.network.id}</span>
              {feed.site && <span className="text-ink-3"> · {feed.site.name || feed.site.id}</span>}
              {status?.system && <span className="text-ink-3" title="The scanner's system tag for this network, matched on a call both saw"> = {status.system}</span>}
            </span>
          ) : (
            <span className="text-sm text-ink-3">{status?.folder ? 'No system seen yet' : 'Set the DSD+ folder under Data'}</span>
          )}
          {feed?.nac && <span className="font-mono text-[11px] text-ink-3">NAC {feed.nac}</span>}
          {feed?.dcc !== null && feed?.dcc !== undefined && <span className="font-mono text-[11px] text-ink-3">CC {feed.dcc}</span>}
        </div>
        <div className="ml-auto flex items-baseline gap-2 text-[11px] text-ink-2" title={status?.folder ?? undefined}>
          <span className={`inline-block h-2 w-2 self-center rounded-full ${linkState.dot}`} />
          <span className="max-w-[18rem] truncate">{linkState.text}</span>
          {feed?.lastEventAt && <span className="font-mono text-ink-3">{hms(feed.lastEventAt)}</span>}
        </div>
        {(learnedCount > 0 || formingCount > 0) && (
          <button
            type="button"
            className={`no-drag self-center rounded-md border px-2 py-1 text-[11px] ${channelsOpen ? 'border-cyan/60 text-cyan' : 'border-edge text-ink-3 hover:text-ink'}`}
            title="Channel numbers learned from the scanner's squelch openings, and the lines for DSDPlus.frequencies (C)"
            onClick={() => setChannelsOpen((o) => !o)}
          >
            Channels {learnedCount}
            {formingCount > 0 ? ` +${formingCount}` : ''}
          </button>
        )}
        <button
          type="button"
          className={`no-drag self-center rounded-md border px-2 py-1 text-[11px] ${historyOpen ? 'border-cyan/60 text-cyan' : 'border-edge text-ink-3 hover:text-ink'}`}
          title="The recorded day: talkgroups, radios and sites with counts, airtime and busy hours (H)"
          onClick={() => setHistoryOpen((o) => !o)}
        >
          {historyOpen ? 'Live' : 'History'}
        </button>
        <button
          type="button"
          className={`no-drag self-center rounded-md border px-2 py-1 text-[11px] ${docked ? 'border-cyan/60 text-cyan' : 'border-edge text-ink-3 hover:text-ink'}`}
          title={docked ? `Docked to the ${docked} of the main window; click (or D) to set it free` : 'Dock beside the main window and follow it (D)'}
          onClick={toggleDock}
        >
          {docked ? 'Undock' : 'Dock'}
        </button>
      </header>

      {channelsOpen && (
        <div className="shrink-0 border-b border-edge bg-panel px-4 py-3 text-[12px] text-ink-2">
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">Learned channels</span>
            <span className="text-[11px] text-ink-3">
              Each time the scanner's squelch opens within a moment of a grant DSD+ could not put a frequency to, that is one vote; {MIN_VOTES} consistent votes learn the channel.
            </span>
          </div>
          <table className="mt-2 font-mono text-[12px]">
            <tbody>
              {Object.values(learned)
                .sort((a, b) => Number(a.channel) - Number(b.channel))
                .map((l) => (
                  <tr key={l.channel}>
                    <td className="pr-4 text-ink-2">ch {l.channel}</td>
                    <td className={`pr-4 ${l.hz !== null ? 'text-amber' : 'text-ink-3'}`}>{l.hz !== null ? mhz(l.hz) : 'not yet'}</td>
                    <td className="text-ink-3">
                      {l.votes} of {l.total} {l.total === 1 ? 'vote' : 'votes'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {frequencyLines.length > 0 && (
            <div className="mt-2">
              <div className="flex items-baseline gap-3">
                <span className="text-[11px] text-ink-3">
                  For DSDPlus.frequencies in the DSD+ folder (DSD+ reads it while running). The protocol{status?.protocol ? ` (${status.protocol})` : ''} is the newest line DSD+'s groups file
                  has for this network; DSD+ can reclassify a site, so check it and the site number against DSD+'s own status bar before pasting:
                </span>
                <button type="button" className="no-drag rounded border border-edge px-1.5 py-px font-sans text-[10px] text-ink-3 hover:text-ink" onClick={copyLines}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="mt-1 select-text rounded-md bg-panel-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">{frequencyLines.join('\n')}</pre>
            </div>
          )}
        </div>
      )}

      {historyOpen ? (
        <SystemHistory network={historyNetwork} networks={networks.map((n) => n.network)} tgName={(tg) => tgName(tg)} radioName={radioName} />
      ) : (
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
                      {c.hz !== null ? (
                        <span className="text-amber">{mhz(c.hz)}</span>
                      ) : c.channel && learned[c.channel]?.hz ? (
                        <span className="text-amber underline decoration-dotted decoration-amber/50 underline-offset-2" title={`ch ${c.channel}, learned from ${learned[c.channel]!.votes} match${learned[c.channel]!.votes === 1 ? '' : 'es'} with the scanner`}>
                          {mhz(learned[c.channel]!.hz!)}
                        </span>
                      ) : c.channel ? (
                        <span className="text-ink-2" title={learned[c.channel] ? `${learned[c.channel]!.votes} of ${MIN_VOTES} matches with the scanner so far` : 'DSD+ has no frequency for this channel; the scanner opening on it teaches the app which it is'}>
                          ch {c.channel}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
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
      )}

      {!historyOpen && feed && feed.notes.length > 0 && (
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
