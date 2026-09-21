import { useState, type ReactNode } from 'react';
import { SEARCH_GROUPS, WX_BUTTON, type ProgSearch as SearchSettings, type Programming, type SearchOptions } from '../../../shared/programming';
import { CHANNEL_SEARCHES } from '../../../shared/searchChannels';
import { TextCell, mhz } from './ProgGrid';

const card = 'rounded-lg border border-edge bg-panel p-3';
const h3 = 'mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-2';

/**
 * The Search tab: what EZ Scan spreads over its Search Options tabs, as one screen of cards, one per search,
 * so every option is in view. Only what has been decoded is shown; the rest of the file is written back as read.
 */
export default function ProgSearch({ prog, onChange }: { prog: Programming; onChange: (p: Programming) => void }) {
  const g = prog.globals;
  const set = (patch: Partial<Programming['globals']>): void => onChange({ ...prog, globals: { ...g, ...patch } });
  const s = g.search;
  const setSearch = (patch: Partial<SearchSettings>): void => {
    if (s) set({ search: { ...s, ...patch } });
  };
  return (
    <div className="h-full overflow-auto p-4 text-sm text-ink-2">
      <div className="mb-4 flex flex-wrap items-center gap-6 text-[12.5px]">
        <label className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">Search delay</span>
          {g.searchDelayS === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            <>
              <span className="w-14">
                <TextCell value={g.searchDelayS.toFixed(1)} mono onCommit={(v) => set({ searchDelayS: Math.max(0, Math.min(25.5, Number(v) || 0)) })} title="Seconds a search waits on a signal before moving on" />
              </span>
              <span className="text-ink-3">s</span>
            </>
          )}
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">WX button</span>
          {g.wxButton === null ? (
            <span className="text-ink-3">—</span>
          ) : (
            <select className="rounded-md border border-edge bg-panel-2 px-2 py-1 text-[12.5px] text-ink" value={g.wxButton} onChange={(e) => set({ wxButton: Number(e.target.value) })} title="The search the WX button starts">
              {Object.entries(WX_BUTTON).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
              {WX_BUTTON[g.wxButton] === undefined && <option value={g.wxButton}>Mode {g.wxButton}</option>}
            </select>
          )}
        </label>
        <span className="text-[11px] text-ink-3">The Sweeper's own options and its mode are kept as read.</span>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))' }}>
        <Lockouts hz={g.lockoutsHz} onChange={(lockoutsHz) => set({ lockoutsHz })} />
        {s && (
          <>
            <section className={card}>
              <h3 className={h3}>Limit search</h3>
              <Options o={s.limit} onChange={(o) => setSearch({ limit: { ...s.limit, ...o } })} />
              <Range low={s.limit.lowHz} high={s.limit.highHz} onChange={(lowHz, highHz) => setSearch({ limit: { ...s.limit, lowHz, highHz } })} />
            </section>
            <Groups title="Public Safety" labels={SEARCH_GROUPS.publicSafety} on={s.publicSafety.groups} onChange={(groups) => setSearch({ publicSafety: { ...s.publicSafety, groups } })}>
              <Options o={s.publicSafety} onChange={(o) => setSearch({ publicSafety: { ...s.publicSafety, ...o } })} />
            </Groups>
            <Groups title="U/VHF AM" labels={SEARCH_GROUPS.uvhfAm} on={s.uvhfAm.groups} onChange={(groups) => setSearch({ uvhfAm: { ...s.uvhfAm, groups } })}>
              <Options o={s.uvhfAm} onChange={(o) => setSearch({ uvhfAm: { ...s.uvhfAm, ...o } })} />
            </Groups>
            <Groups title="Spectrum Sweeper" labels={SEARCH_GROUPS.sweeper} on={s.sweeper.groups} onChange={(groups) => setSearch({ sweeper: { ...s.sweeper, groups } })}>
              <div className="mb-2">
                <Flag label="Special Mode" on={s.sweeper.specialMode} onChange={(v) => setSearch({ sweeper: { ...s.sweeper, specialMode: v } })} />
              </div>
            </Groups>
            <Groups title="Amateur" labels={SEARCH_GROUPS.amateur} on={s.amateur.groups} onChange={(groups) => setSearch({ amateur: { groups } })} />
            {CHANNEL_SEARCHES.map((t) => (
              <Channels key={t.id} title={t.name} table={t.channels} state={s.channels[t.id]} onChange={(c) => setSearch({ channels: { ...s.channels, [t.id]: c } })} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function Flag({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mr-4 inline-flex items-center gap-1 text-[12.5px]">
      <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={on} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Options({ o, onChange }: { o: SearchOptions; onChange: (o: SearchOptions) => void }) {
  return (
    <div className="mb-2">
      <Flag label="Attenuator" on={o.attenuator} onChange={(v) => onChange({ ...o, attenuator: v })} />
      <Flag label="Zeromatic" on={o.zeromatic} onChange={(v) => onChange({ ...o, zeromatic: v })} />
      <Flag label="Delay" on={o.delay} onChange={(v) => onChange({ ...o, delay: v })} />
    </div>
  );
}

function Range({ low, high, onChange }: { low: number; high: number; onChange: (low: number, high: number) => void }) {
  const hzOf = (v: string): number => Math.round(Number(v.replace(/[^\d.]/g, '')) * 1e6) || 0;
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <span className="w-24">
        <TextCell value={mhz(low)} mono onCommit={(v) => onChange(hzOf(v), high)} title="Low frequency, MHz" />
      </span>
      <span className="text-ink-3">to</span>
      <span className="w-24">
        <TextCell value={mhz(high)} mono onCommit={(v) => onChange(low, hzOf(v))} title="High frequency, MHz" />
      </span>
      <span className="text-ink-3">MHz</span>
    </div>
  );
}

function Groups({ title, labels, on, onChange, children }: { title: string; labels: readonly string[]; on: boolean[]; onChange: (groups: boolean[]) => void; children?: ReactNode }) {
  const all = on.every(Boolean);
  return (
    <section className={card}>
      <div className="flex items-baseline">
        <h3 className={h3}>{title}</h3>
        <button type="button" className="ml-auto text-[11px] text-ink-3 hover:text-ink" onClick={() => onChange(on.map(() => !all))}>
          {all ? 'None' : 'All'}
        </button>
      </div>
      {children}
      <div className="space-y-0.5 text-[12.5px]">
        {labels.map((label, i) => (
          <label key={label} className="flex items-center gap-2">
            <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={on[i] ?? false} onChange={(e) => onChange(on.map((v, j) => (j === i ? e.target.checked : v)))} />
            <span className="w-4 font-mono text-[11px] text-ink-3">{i + 1}</span>
            <span className={on[i] ? 'text-ink' : 'text-ink-3'}>{label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function Lockouts({ hz, onChange }: { hz: number[]; onChange: (hz: number[]) => void }) {
  const [add, setAdd] = useState('');
  const addHz = (): void => {
    const v = Math.round(Number(add.replace(/[^\d.]/g, '')) * 1e6);
    if (!(v >= 25e6 && v <= 1300e6) || hz.includes(v)) return;
    onChange([...hz, v].sort((a, b) => a - b));
    setAdd('');
  };
  return (
    <section className={card}>
      <h3 className={h3}>Frequency lockouts</h3>
      <div className="mb-2 flex items-center gap-2">
        <input
          className="w-28 rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[12.5px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
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
      {hz.length === 0 ? (
        <p className="text-[11px] text-ink-3">None. Every search covers every frequency in its range.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <tbody>
            {hz.map((v, i) => (
              <tr key={v} className="border-b border-edge/60">
                <td className="py-0.5 pr-2 font-mono text-[11px] text-ink-3">{i + 1}</td>
                <td className="py-0.5 pr-2 font-mono text-amber">{mhz(v)}</td>
                <td className="py-0.5 text-right">
                  <button type="button" className="text-[11px] text-ink-3 hover:text-red" onClick={() => onChange(hz.filter((x) => x !== v))} title="Remove the lockout">
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** A service search's channel table: the scanner's fixed frequencies with the card's tick per row. */
function Channels({ title, table, state, onChange }: { title: string; table: readonly { label: string; hz: number }[]; state: SearchOptions & { enabled: boolean[] }; onChange: (c: SearchOptions & { enabled: boolean[] }) => void }) {
  const all = state.enabled.every(Boolean);
  const on = state.enabled.filter(Boolean).length;
  return (
    <section className={card}>
      <div className="flex items-baseline">
        <h3 className={h3}>
          {title} <span className="ml-1 normal-case tracking-normal text-ink-3">{on} of {table.length}</span>
        </h3>
        <button type="button" className="ml-auto text-[11px] text-ink-3 hover:text-ink" onClick={() => onChange({ ...state, enabled: table.map(() => !all) })}>
          {all ? 'None' : 'All'}
        </button>
      </div>
      <div className="mb-2">
        <Flag label="Attenuator" on={state.attenuator} onChange={(v) => onChange({ ...state, attenuator: v })} />
        <Flag label="Delay" on={state.delay} onChange={(v) => onChange({ ...state, delay: v })} />
      </div>
      <div className="grid max-h-64 grid-cols-2 gap-x-4 gap-y-0.5 overflow-y-auto text-[12px]">
        {table.map((c, i) => (
          <label key={`${c.label}-${c.hz}`} className="flex items-center gap-2">
            <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={state.enabled[i] ?? false} onChange={(e) => onChange({ ...state, enabled: state.enabled.map((v, j) => (j === i ? e.target.checked : v)) })} />
            <span className="w-6 font-mono text-[11px] text-ink-3">{c.label}</span>
            <span className={`font-mono ${state.enabled[i] ? 'text-amber' : 'text-ink-3'}`}>{(c.hz / 1e6).toFixed(c.hz % 1000 ? 6 : 4)}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
