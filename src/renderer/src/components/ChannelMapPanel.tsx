import { useEffect, useMemo, useState } from 'react';
import type { DsdStatus } from '../../../shared/dsd';
import { MIN_VOTES, dsdFrequencyLines } from '../../../shared/dsdChannels';
import { MAP_STEPS, channelMapLines, lcnOf, lsnPair, lsnSlot, mapHz, mapLsn, mhzText, type AnchorSource, type ChannelMapSettings, type HeardChannel, type MapAnchor } from '../../../shared/dsdChannelMap';

const PILL = 'shrink-0 rounded px-1 py-px font-sans text-[9px] font-bold uppercase tracking-wider';
const SOURCE: Record<AnchorSource, { label: string; cls: string; title: string }> = {
  user: { label: 'You', cls: 'bg-green/15 text-green', title: 'Typed in here' },
  neighbour: { label: 'Site', cls: 'bg-cyan/15 text-cyan', title: "A neighbour list's control channel LSN joined to that site's control frequency from the scanner" },
  learned: { label: 'TRX', cls: 'bg-amber/15 text-amber', title: "Learned from the scanner's squelch openings matching DSD+'s grants" },
};
const LABEL = 'text-[10px] font-bold uppercase tracking-widest text-ink-2';
const INPUT = 'no-drag w-24 rounded border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[12px] text-ink outline-none focus:border-cyan/60';
const LINK = 'font-sans text-[10px] text-ink-3 underline decoration-ink-3/40 underline-offset-2 hover:text-ink';

const hms = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const kHz = (hz: number): string => `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 2)} kHz`;

/**
 * The Channel map panel of the System window: the Tier III line (LSN → frequency) a network's anchors give, the
 * anchors themselves with where each came from and whether it fits, a calculator, every logical slot number heard
 * with its frequency on the map, and the `DSDPlus.frequencies` lines that follow. Everything the user types is kept
 * per network in main (`dsd:map-set`); the map itself is built there so every window agrees.
 */
export default function ChannelMapPanel({ status, scannerHz }: { status: DsdStatus; scannerHz: number | null }): React.JSX.Element {
  const info = status.map;
  const map = info?.map ?? null;
  const settings: ChannelMapSettings = info?.settings ?? { stepHz: null, anchors: [] };
  const network = status.feed.network;
  const learned = status.channels;
  const [heard, setHeard] = useState<HeardChannel[]>([]);
  const [lsnIn, setLsnIn] = useState('');
  const [mhzIn, setMhzIn] = useState('');
  const [noteIn, setNoteIn] = useState('');
  const [calcLsn, setCalcLsn] = useState('');
  const [calcMhz, setCalcMhz] = useState('');
  const [copied, setCopied] = useState(false);

  // The LSNs heard come from the recorded events; refetch as more are recorded, at most every few seconds.
  const recorded = status.recorded;
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void window.trx?.dsdChannels?.().then((list) => {
        if (live) setHeard(list);
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [network?.key, Math.floor(recorded / 20)]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (next: ChannelMapSettings): void => void window.trx?.dsdMapSet?.(next);
  const addAnchor = (): void => {
    const lsn = Number(lsnIn);
    const hz = Math.round(Number(mhzIn) * 1e6);
    if (!Number.isInteger(lsn) || lsn < 1 || !Number.isFinite(hz) || hz <= 0) return;
    const anchor: MapAnchor = { lsn, hz, source: 'user', note: noteIn.trim() };
    save({ ...settings, anchors: [...settings.anchors.filter((a) => a.lsn !== lsn), anchor] });
    setLsnIn('');
    setMhzIn('');
    setNoteIn('');
  };
  const removeAnchor = (lsn: number): void => save({ ...settings, anchors: settings.anchors.filter((a) => a.lsn !== lsn) });
  const setStep = (v: string): void => save({ ...settings, stepHz: v === '' ? null : Number(v) });

  // Every LSN with a place on the panel: the ones heard, the anchors' and the learned channels'.
  const rows = useMemo(() => {
    const byLsn = new Map<number, HeardChannel>();
    for (const h of heard) byLsn.set(h.lsn, h);
    for (const a of map?.anchors ?? []) if (!byLsn.has(a.lsn)) byLsn.set(a.lsn, { lsn: a.lsn, calls: 0, hz: null, lastAt: 0 });
    for (const l of Object.values(learned)) {
      const n = Number(l.channel);
      if (Number.isInteger(n) && n >= 1 && !byLsn.has(n)) byLsn.set(n, { lsn: n, calls: 0, hz: null, lastAt: 0 });
    }
    return [...byLsn.values()].sort((a, b) => a.lsn - b.lsn);
  }, [heard, map, learned]);

  const lines = useMemo(() => {
    if (!network) return [];
    if (map) return channelMapLines(status.protocol ?? 'DMR', network.id, status.feed.site?.id ?? null, rows.map((r) => r.lsn), map);
    return dsdFrequencyLines(status.protocol ?? 'DMR', network.id, status.feed.site?.id ?? null, learned);
  }, [network, map, rows, learned, status.protocol, status.feed.site?.id]);
  const copyLines = (): void => {
    void navigator.clipboard.writeText(lines.join('\r\n') + '\r\n').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const calcOut = (): string => {
    if (!map) return '';
    const lsn = Number(calcLsn);
    if (calcLsn && Number.isInteger(lsn) && lsn >= 1) return `LSN ${lsn} = ${mhzText(mapHz(map, lsn))} MHz, slot ${lsnSlot(lsn)}, LCN ${lcnOf(lsn)}`;
    const hz = Math.round(Number(calcMhz) * 1e6);
    if (calcMhz && Number.isFinite(hz) && hz > 0) {
      const l = mapLsn(map, hz);
      return l === null ? `${calcMhz} MHz is not on this map's grid` : `${mhzText(hz)} MHz = LSN ${l} (slot 1) / ${l + 1} (slot 2), LCN ${lcnOf(l)}`;
    }
    return '';
  };

  const misfits = map ? map.anchors.filter((a) => !a.fits).length : 0;

  return (
    <div className="max-h-[70vh] shrink-0 overflow-auto border-b border-edge bg-panel px-4 py-3 text-[12px] text-ink-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={LABEL}>Channel map</span>
        <span className="text-[11px] text-ink-3">
          Tier III numbers its channels in pairs (odd LSN slot 1, even slot 2 of one carrier) at a fixed step, so one known LSN places every channel. Anchors come from the
          neighbour lists, the scanner's matches and you.
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <label className="flex items-baseline gap-1.5 text-[11px] text-ink-3">
          Step
          <select className="no-drag rounded border border-edge bg-panel-2 px-1 py-0.5 font-mono text-[11px] text-ink" value={settings.stepHz ?? ''} onChange={(e) => setStep(e.target.value)}>
            <option value="">{map ? (map.inferredStep ? `Inferred: ${kHz(map.stepHz)}` : `Assumed: ${kHz(map.stepHz)}`) : 'Infer'}</option>
            {MAP_STEPS.map((s) => (
              <option key={s} value={s}>
                {kHz(s)}
              </option>
            ))}
          </select>
        </label>
        {map ? (
          <span className="font-mono text-[11px]">
            <span className="text-ink-3">LSN 1 / 2 = </span>
            <span className="text-amber">{mhzText(map.baseHz)}</span>
            <span className="text-ink-3"> MHz, {kHz(map.stepHz)} per pair</span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-3">No anchor yet: type one LSN and its frequency below, or wait for a neighbour list and a control channel the scanner has sat on.</span>
        )}
        {misfits > 0 && (
          <span className="text-[11px] text-red" title="An anchor off the line: a wrong anchor, a coincidence the scanner learned, or a plan with more than one frequency range">
            {misfits} off the line
          </span>
        )}
      </div>

      {map && map.anchors.length > 0 && (
        <table className="mt-2 font-mono text-[12px]">
          <thead className="text-left text-[10px] font-normal uppercase tracking-wider text-ink-3">
            <tr>
              <th className="pr-4 font-normal">LSN</th>
              <th className="pr-4 font-normal">MHz</th>
              <th className="pr-4 font-normal">From</th>
              <th className="pr-4 font-normal">Fit</th>
              <th className="font-normal" />
            </tr>
          </thead>
          <tbody>
            {map.anchors.map((a) => {
              const off = mapHz(map, a.lsn) - a.hz;
              return (
                <tr key={a.lsn} title={a.note}>
                  <td className="pr-4 text-ink-2">{a.lsn}</td>
                  <td className={`pr-4 ${a.fits ? 'text-amber' : 'text-red'}`}>{mhzText(a.hz)}</td>
                  <td className="pr-4">
                    <span className={`${PILL} ${SOURCE[a.source].cls}`} title={SOURCE[a.source].title}>
                      {SOURCE[a.source].label}
                    </span>
                    {a.note && <span className="ml-2 font-sans text-[11px] text-ink-3">{a.note}</span>}
                  </td>
                  <td className={`pr-4 ${a.fits ? 'text-green' : 'text-red'}`}>{a.fits ? 'on the line' : `off by ${kHz(Math.abs(off))}`}</td>
                  <td>
                    {a.source === 'user' ? (
                      <button type="button" className={`${LINK} hover:text-red`} title="Remove this anchor" onClick={() => removeAnchor(a.lsn)}>
                        remove
                      </button>
                    ) : a.source === 'learned' ? (
                      <button type="button" className={`${LINK} hover:text-red`} title="Forget this channel's votes (a frequency learned from a coincidence); it is learned afresh from the next matches" onClick={() => void window.trx?.dsdForgetChannel?.(String(a.lsn))}>
                        clear
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[11px] text-ink-3">Add anchor</span>
        <input className={INPUT} placeholder="LSN" value={lsnIn} onChange={(e) => setLsnIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAnchor()} />
        <input className={INPUT} placeholder="MHz" value={mhzIn} onChange={(e) => setMhzIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAnchor()} />
        {scannerHz !== null && scannerHz > 0 && (
          <button
            type="button"
            className="no-drag rounded border border-edge px-1.5 py-px font-mono text-[10px] text-amber hover:border-amber/60"
            title="Use the frequency the scanner is on (parked on a Tier III control channel, that is the control channel's LSN to type)"
            onClick={() => setMhzIn(mhzText(scannerHz))}
          >
            Scanner {mhzText(scannerHz)}
          </button>
        )}
        <input className={`${INPUT} w-40`} placeholder="Note (optional)" value={noteIn} onChange={(e) => setNoteIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAnchor()} />
        <button type="button" className="no-drag rounded border border-edge px-1.5 py-px font-sans text-[10px] text-ink-3 hover:text-ink" onClick={addAnchor} disabled={!network}>
          Add
        </button>
        {map && (
          <span className="flex items-baseline gap-3">
            <span className="ml-1 text-[11px] text-ink-3">Calculator</span>
            <input
              className={INPUT}
              placeholder="LSN"
              value={calcLsn}
              onChange={(e) => {
                setCalcLsn(e.target.value);
                setCalcMhz('');
              }}
            />
            <input
              className={INPUT}
              placeholder="MHz"
              value={calcMhz}
              onChange={(e) => {
                setCalcMhz(e.target.value);
                setCalcLsn('');
              }}
            />
            <span className="font-mono text-[11px] text-ink">{calcOut()}</span>
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mt-3">
          <div className="flex items-baseline gap-3">
            <span className={`${LABEL} whitespace-nowrap`}>Channels heard</span>
            <span className="text-[11px] text-ink-3">
              Every LSN DSD+ has granted on this network, placed by the map; a frequency DSD+ printed itself, or the scanner learned, is checked against it.
            </span>
          </div>
          <table className="mt-1 font-mono text-[12px]">
            <thead className="text-left text-[10px] font-normal uppercase tracking-wider text-ink-3">
              <tr>
                <th className="pr-4 font-normal">LSN</th>
                <th className="pr-4 font-normal">Slot</th>
                <th className="pr-4 font-normal">LCN</th>
                <th className="pr-4 font-normal">MHz</th>
                <th className="pr-4 font-normal">Calls</th>
                <th className="pr-4 font-normal">Last</th>
                <th className="font-normal">Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const onMap = map ? mapHz(map, r.lsn) : null;
                const l = learned[String(r.lsn)];
                const known = r.hz ?? l?.hz ?? null;
                const differs = onMap !== null && known !== null && Math.abs(onMap - known) > 10;
                const [s1, s2] = lsnPair(lcnOf(r.lsn));
                return (
                  <tr key={r.lsn} className="border-t border-edge/40">
                    <td className="pr-4 text-ink-2" title={`Pair ${s1} / ${s2}`}>
                      {r.lsn}
                    </td>
                    <td className="pr-4 text-ink-3">{lsnSlot(r.lsn)}</td>
                    <td className="pr-4 text-ink-3">{lcnOf(r.lsn)}</td>
                    <td className="pr-4">
                      {onMap !== null ? (
                        <span className="text-amber underline decoration-dashed decoration-amber/50 underline-offset-2" title="From the channel map">
                          {mhzText(onMap)}
                        </span>
                      ) : known !== null ? (
                        <span className="text-amber">{mhzText(known)}</span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                    <td className="pr-4 text-ink-3">{r.calls || ''}</td>
                    <td className="pr-4 text-ink-3">{r.lastAt ? hms(r.lastAt) : ''}</td>
                    <td className="font-sans text-[11px]">
                      {r.hz !== null && onMap !== null && (
                        <span className={differs && Math.abs(onMap - r.hz) > 10 ? 'text-red' : 'text-green'} title="The frequency DSD+ printed for this channel (its frequencies file)">
                          DSD+ {mhzText(r.hz)}
                        </span>
                      )}
                      {l && (
                        <span className={`${r.hz !== null && onMap !== null ? 'ml-2 ' : ''}${l.hz === null ? 'text-ink-3' : onMap !== null && Math.abs(onMap - l.hz) > 10 ? 'text-red' : 'text-green'}`} title={l.hz === null ? `${l.votes} of ${MIN_VOTES} matches with the scanner so far` : `Learned from ${l.votes} match${l.votes === 1 ? '' : 'es'} with the scanner`}>
                          TRX {l.hz === null ? `${l.votes}/${MIN_VOTES} votes` : mhzText(l.hz)}
                          {l.hz !== null && onMap !== null && Math.abs(onMap - l.hz) > 10 && (
                            <>
                              {' '}
                              <button type="button" className={`${LINK} hover:text-red`} title="Forget the votes behind this frequency; it was a coincidence" onClick={() => void window.trx?.dsdForgetChannel?.(l.channel)}>
                                clear
                              </button>
                            </>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {lines.length > 0 && (
        <div className="mt-3">
          <div className="flex items-baseline gap-3">
            <span className="text-[11px] text-ink-3">
              For DSDPlus.frequencies in the DSD+ folder (DSD+ reads it while running), one line per carrier under its slot-1 LSN. The protocol
              {status.protocol ? ` (${status.protocol})` : ''} is the newest line DSD+'s groups file has for this network; DSD+ can reclassify a site, so check it and the site number against
              DSD+'s own status bar before pasting:
            </span>
            <button type="button" className="no-drag rounded border border-edge px-1.5 py-px font-sans text-[10px] text-ink-3 hover:text-ink" onClick={copyLines}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="mt-1 max-h-40 select-text overflow-auto rounded-md bg-panel-2 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-2">{lines.join('\n')}</pre>
        </div>
      )}
    </div>
  );
}
