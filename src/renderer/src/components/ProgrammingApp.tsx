import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CdatCandidate, ProgObject, Programming } from '../../../shared/programming';
import { initTheme } from '../store/theme';

type Tab = 'general' | 'scanlists' | 'objects' | 'trunked';
const ROW_PX = 26;

const mhz = (hz: number): string => (hz / 1e6).toFixed(6);
const squelch = (o: ProgObject): string => (o.tone.type === 'CTCSS' || o.tone.type === 'DCS' ? `${o.tone.type} ${o.tone.value}` : o.tone.type);
const yes = (b: boolean): string => (b ? '✓' : '');

/**
 * The Programming window (`#programming`, development builds only): the scanner's own programming as
 * EZ Scan writes it to the SD card's CDAT folder, read straight off the card (which mounts as a drive
 * while the scanner is off). Read-only. Tabs follow EZ Scan's: General, Scanlists, Conventional
 * objects, Trunked systems.
 */
export default function ProgrammingApp() {
  const [prog, setProg] = useState<Programming | null>(null);
  const [cands, setCands] = useState<CdatCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('objects');
  const [filter, setFilter] = useState('');
  const [list, setList] = useState<number | null>(null);

  const load = useCallback(async (dir?: string) => {
    if (!window.trx?.programmingLoad) return;
    setBusy(true);
    setError(null);
    try {
      const p = await window.trx.programmingLoad(dir);
      if (p) setProg(p);
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const offTheme = initTheme();
    void (async () => {
      const found = (await window.trx?.programmingLocate?.()) ?? [];
      setCands(found);
      if (found[0]) void load(found[0].dir);
    })();
    return offTheme;
  }, [load]);

  const shown = useMemo(() => {
    if (!prog) return [];
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = prog.objects;
    if (words.length === 0) return rows;
    return rows.filter((o) => {
      const hay = `${o.name} ${mhz(o.frequencyHz)} ${o.modulation} ${o.dmode} ${squelch(o)} ${o.scanlists.join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [prog, filter]);

  const byIndex = useMemo(() => new Map((prog?.objects ?? []).map((o) => [o.index, o])), [prog]);
  const selectedList = prog?.scanlists.find((l) => l.number === list) ?? null;
  const listRows = useMemo(() => (selectedList ? selectedList.objects.map((i) => byIndex.get(i)).filter((o): o is ProgObject => !!o) : []), [selectedList, byIndex]);

  const tabBtn = (t: Tab, label: string): React.ReactElement => (
    <button
      type="button"
      className={`no-drag rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${tab === t ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:text-ink'}`}
      onClick={() => setTab(t)}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <header
        className="app-drag flex h-[46px] shrink-0 items-center gap-3 border-b border-edge bg-panel px-4 text-sm"
        style={window.trx?.platform === 'darwin' ? { paddingLeft: '84px' } : window.trx?.platform === 'linux' ? undefined : { paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw) + 12px)' }}
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">Programming</span>
        <span className="rounded border border-amber/60 px-1.5 text-[9px] font-bold uppercase tracking-widest text-amber" title="Development build only">dev</span>
        {prog && (
          <>
            <span className="min-w-0 truncate text-ink">{prog.description || 'Scanner card'}</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-ink-3" title={prog.dir}>
              {prog.dir}
            </span>
            <span className="text-[11px] text-ink-3">
              {prog.objects.length} objects · {prog.scanlists.filter((l) => l.objects.length).length} scanlists in use · {prog.trunked.length} trunked
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {cands.length > 1 && (
            <select className="no-drag rounded-md border border-edge bg-panel-2 px-2 py-1 text-[11px] text-ink" value={prog?.dir ?? ''} onChange={(e) => void load(e.target.value)} title="Cards found">
              {cands.map((c) => (
                <option key={c.dir} value={c.dir}>
                  {c.description || c.dir}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="no-drag rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40" disabled={busy || !prog} onClick={() => prog && void load(prog.dir)} title="Read the card again">
            Reload
          </button>
          <button type="button" className="no-drag rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40" disabled={busy} onClick={() => void load()} title="Choose a CDAT folder (the card's, or a copy of it)">
            Open folder…
          </button>
        </span>
      </header>

      {error && <div className="border-b border-red/40 bg-panel px-4 py-2 text-xs text-red">{error}</div>}

      {!prog ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-2">
          <div className="max-w-md space-y-2">
            <p className="text-ink">{busy ? 'Reading the card…' : 'No scanner card found.'}</p>
            {!busy && (
              <>
                <p>Switch the scanner off with the USB lead in: its SD card mounts as a drive, and the programming EZ Scan wrote to it is in the card's CDAT folder. Plug the card into a reader if you prefer.</p>
                <p>
                  Nothing found on the mounted drives just now. Press <b className="text-ink">Open folder…</b> to point at a CDAT folder (or a copy of one), or <b className="text-ink">Reload</b> once the card is in.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center gap-1 border-b border-edge bg-panel px-3 py-2">
            {tabBtn('general', 'General')}
            {tabBtn('scanlists', 'Scanlists')}
            {tabBtn('objects', 'Conventional')}
            {tabBtn('trunked', 'Trunked')}
            {tab === 'objects' && (
              <>
                <input
                  className="ml-4 w-72 rounded-md border border-edge bg-panel-2 px-2 py-1 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
                  placeholder="Filter (alpha tag, frequency, mode, scanlist…)"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <span className="text-[11px] text-ink-3">
                  {shown.length === prog.objects.length ? `${prog.objects.length} objects` : `${shown.length} of ${prog.objects.length}`}
                </span>
              </>
            )}
          </div>
          <div className="min-h-0 flex-1">
            {tab === 'objects' && <ObjectTable rows={shown} first="Rec#" />}
            {tab === 'scanlists' && (
              <div className="grid h-full grid-cols-[19rem_minmax(0,1fr)]">
                <div className="overflow-y-auto border-r border-edge">
                  {prog.scanlists
                    .filter((l) => l.objects.length || !/^Scanlist \d{3}$/.test(l.name))
                    .map((l) => (
                      <button
                        key={l.number}
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${list === l.number ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:bg-panel-2/60 hover:text-ink'}`}
                        onClick={() => setList(l.number)}
                      >
                        <span className="w-7 font-mono text-[11px] text-ink-3">{String(l.number).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1 truncate">{l.name || <span className="text-ink-3">(unnamed)</span>}</span>
                        <span className="text-[11px] text-ink-3">{l.objects.length}</span>
                        <span className="w-8 text-center text-[10px] text-green" title={l.enabled ? 'Enabled' : 'Disabled'}>
                          {l.enabled ? 'on' : ''}
                        </span>
                      </button>
                    ))}
                </div>
                <div className="flex min-h-0 flex-col">
                  {selectedList ? (
                    <>
                      <div className="flex items-center gap-3 border-b border-edge px-3 py-1.5 text-xs text-ink-2">
                        <span className="text-ink">{selectedList.name}</span>
                        <span>{selectedList.objects.length} objects</span>
                        <span>{selectedList.enabled ? 'Enabled' : 'Disabled'}</span>
                        {selectedList.isDefault && <span>Default</span>}
                      </div>
                      <ObjectTable rows={listRows} first="Pos" />
                    </>
                  ) : (
                    <div className="p-4 text-sm text-ink-3">Pick a scanlist.</div>
                  )}
                </div>
              </div>
            )}
            {tab === 'general' && <General prog={prog} />}
            {tab === 'trunked' && <Trunked prog={prog} />}
          </div>
        </>
      )}
    </div>
  );
}

const COLS = 'minmax(3.5rem,4rem) minmax(11rem,1.4fr) 7rem 4rem 4.5rem 7rem 3rem 3rem 5.5rem 6rem minmax(6rem,1fr)';

function ObjectTable({ rows, first }: { rows: ProgObject[]; first: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_PX, overscan: 16, getItemKey: (i) => rows[i]!.index });
  return (
    <div ref={scrollRef} className="h-full min-h-0 flex-1 overflow-auto">
      <div className="sticky top-0 z-10 grid gap-x-2 whitespace-nowrap border-b border-edge bg-panel px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-ink-2" style={{ gridTemplateColumns: COLS }}>
        <span>{first}</span>
        <span>Alpha tag</span>
        <span>Frequency</span>
        <span>Mode</span>
        <span>DMode</span>
        <span>Squelch</span>
        <span>Skip</span>
        <span>Dly</span>
        <span>Backlight</span>
        <span>LED</span>
        <span>Scanlists</span>
      </div>
      <div className="relative" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((it) => {
          const o = rows[it.index]!;
          return (
            <div
              key={it.key}
              className="absolute left-0 grid w-full items-center gap-x-2 whitespace-nowrap border-b border-edge/60 px-3 text-[12.5px] text-ink-2"
              style={{ top: it.start, height: ROW_PX, gridTemplateColumns: COLS }}
            >
              <span className="font-mono text-[11px] text-ink-3">{first === 'Pos' ? it.index + 1 : String(o.index).padStart(5, '0')}</span>
              <span className="truncate text-ink">{o.name}</span>
              <span className="font-mono text-amber">{mhz(o.frequencyHz)}</span>
              <span className="font-mono">{o.modulation}</span>
              <span>{o.dmode}</span>
              <span className="font-mono">{squelch(o)}</span>
              <span>{yes(o.skip)}</span>
              <span className="font-mono">{o.delayS.toFixed(1)}</span>
              <span>{o.backlight}</span>
              <span className="flex items-center gap-1">
                {o.led.on ? (
                  <>
                    <span className="inline-block h-3 w-3 rounded-sm border border-edge" style={{ background: o.led.colour ?? undefined }} />
                    <span className="font-mono text-[11px]">{o.led.colour}</span>
                  </>
                ) : (
                  <span className="text-ink-3">Off</span>
                )}
              </span>
              <span className="truncate font-mono text-[11px]">{o.scanlists.join(', ')}</span>
            </div>
          );
        })}
      </div>
      {rows.length === 0 && <div className="p-4 text-sm text-ink-3">Nothing here.</div>}
    </div>
  );
}

function General({ prog }: { prog: Programming }) {
  const g = prog.globals;
  return (
    <div className="grid h-full grid-cols-[22rem_minmax(0,1fr)] gap-4 overflow-auto p-4 text-sm text-ink-2">
      <div className="space-y-4">
        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Welcome text</h3>
          <div className="lcd-screen lcd-radio rounded-lg bg-lcd font-mono leading-[1.35] text-lcd-ink">
            {g.welcome.map((l, i) => (
              <div key={i} className="lcd-line px-1 text-center">
                {l || ' '}
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Signal bars (RSSI)</h3>
          <div className="font-mono text-ink">{g.signalBars.join(' · ') || '—'}</div>
        </section>
        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Last Tune Mode frequency</h3>
          <div className="font-mono text-amber">{g.lastTuneHz ? `${mhz(g.lastTuneHz)} MHz` : '—'}</div>
        </section>
        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Scan sets</h3>
          <table className="w-full text-[12.5px]">
            <tbody>
              {prog.scanSets
                .filter((s) => s.scanlists.length || !/^Scan Set \d{2}$/.test(s.name))
                .map((s) => (
                  <tr key={s.number} className="border-b border-edge/60">
                    <td className="py-0.5 pr-2 font-mono text-[11px] text-ink-3">{String(s.number).padStart(2, '0')}</td>
                    <td className="py-0.5 pr-2 text-ink">{s.name}</td>
                    <td className="py-0.5 pr-2 text-green">{s.enabled ? 'on' : ''}</td>
                    <td className="py-0.5 font-mono text-[11px]">{s.scanlists.length > 24 ? `${s.scanlists.length} lists` : s.scanlists.join(', ')}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      </div>
      <section>
        <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Scanlist control</h3>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-ink-2">
              <th className="py-1 pr-2">##</th>
              <th className="py-1 pr-2">Alpha tag</th>
              <th className="py-1 pr-2">Enabled</th>
              <th className="py-1 pr-2">Default</th>
              <th className="py-1">Objects</th>
            </tr>
          </thead>
          <tbody>
            {prog.scanlists
              .filter((l) => l.objects.length || !/^Scanlist \d{3}$/.test(l.name))
              .map((l) => (
                <tr key={l.number} className="border-b border-edge/60">
                  <td className="py-0.5 pr-2 font-mono text-[11px] text-ink-3">{String(l.number).padStart(2, '0')}</td>
                  <td className="py-0.5 pr-2 text-ink">{l.name}</td>
                  <td className="py-0.5 pr-2 text-green">{yes(l.enabled)}</td>
                  <td className="py-0.5 pr-2">{yes(l.isDefault)}</td>
                  <td className="py-0.5 font-mono text-[11px]">{l.objects.length}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Trunked({ prog }: { prog: Programming }) {
  if (prog.trunked.length === 0) return <div className="p-4 text-sm text-ink-3">No trunked systems on this card.</div>;
  return (
    <div className="h-full space-y-6 overflow-auto p-4 text-sm text-ink-2">
      {prog.trunked.map((t) => (
        <section key={t.number}>
          <h3 className="mb-2 text-ink">
            <span className="mr-2 font-mono text-[11px] text-ink-3">{String(t.number).padStart(2, '0')}</span>
            {t.name}
            <span className="ml-3 text-[11px] text-ink-3">
              {t.sites.length} {t.sites.length === 1 ? 'site' : 'sites'} · {t.talkgroups.length} talkgroups
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Sites</div>
              {t.sites.map((s, i) => (
                <div key={i} className="mb-2">
                  <div className="text-ink">{s.name || `Site ${i + 1}`}</div>
                  <div className="font-mono text-[11.5px] text-amber">{s.frequenciesHz.map(mhz).join('  ')}</div>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Talkgroups</div>
              <table className="w-full text-[12.5px]">
                <tbody>
                  {t.talkgroups.map((g, i) => (
                    <tr key={i} className="border-b border-edge/60">
                      <td className="py-0.5 pr-2 text-ink">{g.name}</td>
                      <td className="py-0.5 pr-2 font-mono">{g.id === 65535 ? 'wildcard' : g.id}</td>
                      <td className="py-0.5 font-mono text-[11px] text-ink-3">{g.scanlists.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
