import { useState } from 'react';
import { WX_BUTTON, type Programming } from '../../../shared/programming';
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
    <div className="grid h-full grid-cols-[22rem_minmax(0,1fr)] gap-6 overflow-auto p-4 text-sm text-ink-2">
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
        <section>
          <p className="text-[11px] text-ink-3">The search band tables (Public Safety, Sweeper, Amateur, Marine, PMR446 and the rest) are read from the card as they are and written back unchanged.</p>
        </section>
      </div>
    </div>
  );
}
