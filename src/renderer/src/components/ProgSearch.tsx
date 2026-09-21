import { useState } from 'react';
import { SEARCH_GROUPS, WX_BUTTON, type ProgSearch as SearchSettings, type Programming, type SearchOptions } from '../../../shared/programming';
import { TextCell, mhz } from './ProgGrid';

/**
 * The Search tab: what EZ Scan's Search Options keep in the globals file and TRXController has decoded so
 * far, the lockouts, the search delay and the WX button's search. The search band tables are not here yet.
 */
export default function ProgSearch({ prog, onChange }: { prog: Programming; onChange: (p: Programming) => void }) {
  const g = prog.globals;
  const [add, setAdd] = useState('');
  const set = (patch: Partial<Programming['globals']>): void => onChange({ ...prog, globals: { ...g, ...patch } });
  const addHz = (): void => {
    const hz = Math.round(Number(add.replace(/[^\d.]/g, '')) * 1e6);
    if (!(hz >= 25e6 && hz <= 1300e6) || g.lockoutsHz.includes(hz)) return;
    set({ lockoutsHz: [...g.lockoutsHz, hz].sort((a, b) => a - b) });
    setAdd('');
  };
  const known = g.wxButton !== null && WX_BUTTON[g.wxButton] !== undefined;
  return (
    <div className="grid h-full grid-cols-[20rem_minmax(0,1fr)] gap-6 overflow-auto p-4 text-sm text-ink-2">
      <section>
        <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Frequency lockouts</h3>
        <p className="mb-2 text-[11px] text-ink-3">Frequencies every search skips. {g.lockoutsHz.length ? `${g.lockoutsHz.length} locked out.` : 'None locked out.'}</p>
        <div className="mb-2 flex items-center gap-2">
          <input
            className="w-32 rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[12.5px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
            placeholder="MHz"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addHz();
            }}
          />
          <button type="button" className="rounded-md bg-cyan px-2.5 py-1 text-[11px] font-bold text-bg disabled:opacity-40" disabled={!add.trim()} onClick={addHz}>
            Add lockout
          </button>
        </div>
        <table className="w-full text-[12.5px]">
          <tbody>
            {g.lockoutsHz.map((hz, i) => (
              <tr key={hz} className="border-b border-edge/60">
                <td className="py-0.5 pr-2 font-mono text-[11px] text-ink-3">{i + 1}</td>
                <td className="py-0.5 pr-2 font-mono text-amber">{mhz(hz)}</td>
                <td className="py-0.5 text-right">
                  <button type="button" className="text-[11px] text-ink-3 hover:text-red" onClick={() => set({ lockoutsHz: g.lockoutsHz.filter((x) => x !== hz) })} title="Remove the lockout">
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="space-y-5">
        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Search delay</h3>
          <div className="flex items-center gap-2">
            {g.searchDelayS === null ? (
              <span className="text-ink-3">—</span>
            ) : (
              <>
                <span className="w-16">
                  <TextCell value={g.searchDelayS.toFixed(1)} mono onCommit={(s) => set({ searchDelayS: Math.max(0, Math.min(25.5, Number(s) || 0)) })} title="Seconds the search waits on a signal before moving on" />
                </span>
                <span className="text-[11px] text-ink-3">seconds</span>
              </>
            )}
          </div>
        </section>
        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">WX button</h3>
          {g.wxButton === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            <select className="rounded-md border border-edge bg-panel-2 px-2 py-1 text-[12.5px] text-ink" value={g.wxButton} onChange={(e) => set({ wxButton: Number(e.target.value) })} title="The search the WX button starts">
              {Object.entries(WX_BUTTON).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
              {!known && <option value={g.wxButton}>Mode {g.wxButton}</option>}
            </select>
          )}
          <p className="mt-1 text-[11px] text-ink-3">Only Pub Safety and Amateur have been seen on a card; the other searches keep their code.</p>
        </section>
        {g.search && <Bands search={g.search} onChange={(search) => set({ search })} />}
        <section>
          <p className="text-[11px] text-ink-3">The Sweeper's own Attenuator, Zeromatic and Delay, and the Mosque, CB, Marine and PMR446 channel tables, are read from the card as they are and written back unchanged.</p>
        </section>
      </div>
    </div>
  );
}

/** The search groups as tick lists, with the options decoded so far beside them. */
function Bands({ search, onChange }: { search: SearchSettings; onChange: (s: SearchSettings) => void }) {
  const groups = (title: string, labels: readonly string[], on: boolean[], set: (groups: boolean[]) => void, extra?: React.ReactNode): React.ReactElement => (
    <section>
      <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">{title}</h3>
      {extra}
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[12.5px]">
        {labels.map((label, i) => (
          <label key={label} className="flex items-center gap-2">
            <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={on[i] ?? false} onChange={(e) => set(on.map((v, j) => (j === i ? e.target.checked : v)))} />
            <span className="w-4 font-mono text-[11px] text-ink-3">{i + 1}</span>
            <span className="text-ink">{label}</span>
          </label>
        ))}
      </div>
    </section>
  );
  const flag = (label: string, on: boolean, set: (v: boolean) => void): React.ReactElement => (
    <label className="mr-4 inline-flex items-center gap-1 text-[12.5px]">
      <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={on} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );
  const opts = (o: SearchOptions, set: (o: SearchOptions) => void): React.ReactElement => (
    <div className="mb-1">
      {flag('Attenuator', o.attenuator, (v) => set({ ...o, attenuator: v }))}
      {flag('Zeromatic', o.zeromatic, (v) => set({ ...o, zeromatic: v }))}
      {flag('Delay', o.delay, (v) => set({ ...o, delay: v }))}
    </div>
  );
  const mhzOf = (hz: number): string => (hz / 1e6).toFixed(6);
  const hzOf = (s: string): number => Math.round(Number(s.replace(/[^\d.]/g, '')) * 1e6) || 0;
  return (
    <>
      {groups('Public Safety', SEARCH_GROUPS.publicSafety, search.publicSafety.groups, (g) => onChange({ ...search, publicSafety: { ...search.publicSafety, groups: g } }), opts(search.publicSafety, (o) => onChange({ ...search, publicSafety: { ...search.publicSafety, ...o } })))}
      <section>
        <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Limit search</h3>
        {opts(search.limit, (o) => onChange({ ...search, limit: { ...search.limit, ...o } }))}
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="text-ink-3">from</span>
          <span className="w-28">
            <TextCell value={mhzOf(search.limit.lowHz)} mono onCommit={(s) => onChange({ ...search, limit: { ...search.limit, lowHz: hzOf(s) } })} title="MHz" />
          </span>
          <span className="text-ink-3">to</span>
          <span className="w-28">
            <TextCell value={mhzOf(search.limit.highHz)} mono onCommit={(s) => onChange({ ...search, limit: { ...search.limit, highHz: hzOf(s) } })} title="MHz" />
          </span>
          <span className="text-ink-3">MHz</span>
        </div>
      </section>
      {groups('U/VHF AM', SEARCH_GROUPS.uvhfAm, search.uvhfAm.groups, (g) => onChange({ ...search, uvhfAm: { ...search.uvhfAm, groups: g } }), opts(search.uvhfAm, (o) => onChange({ ...search, uvhfAm: { ...search.uvhfAm, ...o } })))}
      {groups('Spectrum Sweeper', SEARCH_GROUPS.sweeper, search.sweeper.groups, (g) => onChange({ ...search, sweeper: { ...search.sweeper, groups: g } }), <div className="mb-1">{flag('Special Mode', search.sweeper.specialMode, (v) => onChange({ ...search, sweeper: { ...search.sweeper, specialMode: v } }))}</div>)}
      {groups('Amateur', SEARCH_GROUPS.amateur, search.amateur.groups, (g) => onChange({ ...search, amateur: { groups: g } }))}
    </>
  );
}
