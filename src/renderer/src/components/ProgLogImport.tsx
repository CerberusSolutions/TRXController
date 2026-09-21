import { useMemo, useState } from 'react';
import { CTCSS_TONES, type ProgObject, type ProgScanlist } from '../../../shared/programming';
import { defaultModulation } from '../../../shared/bandDefaults';
import { alphaTag, ezModeOf, ezObjects, ezToneOf, type EzObject } from '../lib/csv';
import { rowMatches, useLog } from '../store/log';
import { mhz } from './ProgGrid';

/** A log entry folded into a channel, as the CSV export does, in the editor's own shape. */
export function objectFromLog(o: EzObject, index: number, scanlist: number): ProgObject {
  const [toneType, tone] = ezToneOf(o.code);
  const [mod, dmode] = ezModeOf(o.row, o.code);
  const ctcss = toneType === 'CTCSS' && CTCSS_TONES.some((t) => t.toFixed(1) === Number(tone).toFixed(1)) ? Number(tone).toFixed(1) : null;
  return {
    index,
    name: alphaTag(o),
    frequencyHz: o.frequencyHz,
    // The mode the scanner was using when it heard the entry; from the band when the scanner never said.
    modulation: mod === 'DMR' || mod === 'NXDN' ? mod : mod === 'P25' ? 'NFM' : mod === 'AUTO' ? defaultModulation(o.frequencyHz) : mod,
    dmode: dmode === 'Digital' ? 'Digital' : 'Auto',
    // DCS and NAC squelch are not written yet (never seen on a card), so those become Search: the scanner finds the code.
    tone: ctcss ? { type: 'CTCSS', value: ctcss } : toneType === 'None' ? { type: 'None', value: '' } : { type: 'Search', value: '' },
    skip: false,
    backlight: 'Leave',
    delayS: 2,
    led: { on: false, colour: null },
    digital: mod === 'DMR',
    colourCode: mod === 'DMR' ? 'any' : null,
    nxdn: mod === 'NXDN',
    scanlists: [scanlist],
  };
}

const when = (t: number | null): string => (t === null ? 'now' : new Date(t).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }));

/**
 * Import from the log: the entries folded into channels (one per frequency and tone / colour code, named
 * by the newest named entry), ticked unless the card already has the frequency, into one scanlist.
 */
export default function ProgLogImport({ scanlists, existing, defaultList, nextIndex, onAdd, onClose }: { scanlists: readonly ProgScanlist[]; existing: readonly ProgObject[]; defaultList: number; nextIndex: number; onAdd: (objects: ProgObject[]) => void; onClose: () => void }) {
  const rows = useLog((s) => s.rows);
  const [filter, setFilter] = useState('');
  const [list, setList] = useState(defaultList);
  const onCard = useMemo(() => new Set(existing.map((o) => o.frequencyHz)), [existing]);
  const objects = useMemo(() => ezObjects(rows.filter((r) => rowMatches(r, filter))), [rows, filter]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const key = (o: EzObject): string => `${o.frequencyHz}|${o.code}`;
  const ticked = objects.filter((o) => !onCard.has(o.frequencyHz) && !unticked.has(key(o)));
  const named = scanlists.filter((l) => l.name && !/^Scanlist \d{3}$/.test(l.name));
  const toggle = (o: EzObject): void =>
    setUnticked((s) => {
      const next = new Set(s);
      const k = key(o);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2 text-[11px] text-ink-2">
        <span className="text-[10px] font-bold uppercase tracking-widest">From the log</span>
        <input
          className="w-56 rounded-md border border-edge bg-panel-2 px-2 py-1 text-[12px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
          placeholder="Filter the log (name, frequency, tone…)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoFocus
        />
        <span className="text-ink-3">
          {objects.length} channels from {rows.length} entries · {ticked.length} ticked
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span>into</span>
          <select className="rounded-md border border-edge bg-panel-2 px-2 py-1 text-[12px] text-ink" value={list} onChange={(e) => setList(Number(e.target.value))} title="The scanlist the channels go into">
            {named.map((l) => (
              <option key={l.number} value={l.number}>
                {l.number} {l.name}
              </option>
            ))}
            {!named.some((l) => l.number === list) && <option value={list}>{list}</option>}
          </select>
          <button type="button" className="whitespace-nowrap rounded-md bg-cyan px-2.5 py-1 text-[11px] font-bold text-bg disabled:opacity-40" disabled={ticked.length === 0} onClick={() => onAdd(ticked.map((o, i) => objectFromLog(o, nextIndex + i, list)))} title="Add the ticked channels to the card's programming (nothing is written until you save)">
            Add {ticked.length} {ticked.length === 1 ? 'channel' : 'channels'}
          </button>
          <button type="button" className="whitespace-nowrap rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink" onClick={onClose}>
            Close
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-panel text-left text-[10px] font-bold uppercase tracking-widest text-ink-2">
            <tr>
              <th className="px-3 py-1" />
              <th className="py-1 pr-2">Alpha tag</th>
              <th className="py-1 pr-2">Frequency</th>
              <th className="py-1 pr-2">Mode</th>
              <th className="py-1 pr-2">Squelch</th>
              <th className="py-1 pr-2">Entries</th>
              <th className="py-1 pr-2">Last heard</th>
              <th className="py-1 pr-2">From</th>
            </tr>
          </thead>
          <tbody>
            {objects.map((o) => {
              const have = onCard.has(o.frequencyHz);
              const on = !have && !unticked.has(key(o));
              const p = objectFromLog(o, 0, list);
              return (
                <tr key={key(o)} className={`border-b border-edge/60 ${have ? 'text-ink-3' : 'text-ink-2'}`}>
                  <td className="px-3 py-0.5">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={on} disabled={have} onChange={() => toggle(o)} title={have ? 'The card already has this frequency' : ''} />
                  </td>
                  <td className="py-0.5 pr-2 text-ink">
                    {p.name}
                    {have && <span className="ml-2 text-[10px] text-ink-3">on card</span>}
                  </td>
                  <td className="py-0.5 pr-2 font-mono text-amber">{mhz(o.frequencyHz)}</td>
                  <td className="py-0.5 pr-2 font-mono">{p.modulation}</td>
                  <td className="py-0.5 pr-2 font-mono">
                    {p.tone.type === 'CTCSS' ? `CTCSS ${p.tone.value}` : p.tone.type}
                    {o.code && p.tone.type === 'Search' && <span className="ml-1 text-[10px] text-ink-3">({o.code})</span>}
                  </td>
                  <td className="py-0.5 pr-2 font-mono text-[11px]">{o.receptions}</td>
                  <td className="py-0.5 pr-2 text-[11px]">{when(o.lastHeard)}</td>
                  <td className="py-0.5 pr-2 text-[11px] text-ink-3">{o.row.source || (o.row.name ? 'scanner' : '')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {objects.length === 0 && <div className="p-4 text-sm text-ink-3">{rows.length ? 'Nothing in the log matches.' : 'The log is empty.'}</div>}
      </div>
    </div>
  );
}
