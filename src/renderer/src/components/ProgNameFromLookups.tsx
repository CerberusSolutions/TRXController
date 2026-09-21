import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProgObject } from '../../../shared/programming';
import { candidatesFor, type ListedCandidate } from '../../../shared/listed';
import { normaliseLookups } from '../../../shared/sources';
import { SOURCE_PILL } from '../lib/sources';
import { NAME_MAX, TextCell, mhz, pickPatch, type ObjectPatch } from './ProgGrid';

interface Row {
  cands: ListedCandidate[];
  /** Index into `cands` of the candidate the name comes from. */
  pick: number;
  name: string;
  apply: boolean;
}

const CHUNK = 8;

/**
 * Name a selection from the lookups in one pass: for every selected object the registers (WTR, repeaters)
 * are asked and RadioReference / RRUK answer from their cache only (a card holds thousands of frequencies;
 * this must not fire a call per row), the top candidate proposes the alpha tag, and each row can take
 * another candidate, be edited, or be left out before the names are applied.
 */
export default function ProgNameFromLookups({ objects, onApply, onClose }: { objects: ProgObject[]; onApply: (patches: Map<number, ObjectPatch>) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Map<number, Row>>(new Map());
  const [done, setDone] = useState(0);
  const [withTone, setWithTone] = useState(true);
  const cancelled = useRef(false);
  const list = useMemo(() => objects, [objects]);

  useEffect(() => {
    cancelled.current = false;
    const api = window.trx;
    if (!api) return;
    void (async () => {
      const settings = await api.settingsGet().catch(() => null);
      const prefs = normaliseLookups(settings?.lookups);
      for (let at = 0; at < list.length && !cancelled.current; at += CHUNK) {
        const chunk = list.slice(at, at + CHUNK);
        const found = await Promise.all(
          chunk.map(async (o) => {
            const hz = o.frequencyHz;
            const [licences, repeaters, rruk, rr] = await Promise.all([
              api.wtrLookup?.(hz).catch(() => []) ?? [],
              api.repeatersLookup?.(hz).catch(() => []) ?? [],
              api.rrukLookup?.(hz, 'cache').catch(() => null) ?? null,
              api.rrLookup?.(hz, 'cache').catch(() => null) ?? null,
            ]);
            const tone = o.tone.type === 'CTCSS' ? `CTCSS ${o.tone.value}` : null;
            return [o.index, candidatesFor({ rr, rruk, licences, repeaters, detectedTone: tone }, prefs)] as const;
          }),
        );
        if (cancelled.current) return;
        setRows((m) => {
          const next = new Map(m);
          for (const [index, cands] of found) next.set(index, { cands, pick: cands.length ? 0 : -1, name: cands.length ? (pickPatch(cands[0]!).name ?? '') : '', apply: cands.length > 0 });
          return next;
        });
        setDone(Math.min(list.length, at + CHUNK));
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, [list]);

  const update = (index: number, patch: Partial<Row>): void =>
    setRows((m) => {
      const r = m.get(index);
      if (!r) return m;
      const next = new Map(m);
      next.set(index, { ...r, ...patch });
      return next;
    });

  const ready = [...rows.values()].filter((r) => r.apply && r.name.trim()).length;
  const found = [...rows.values()].filter((r) => r.cands.length).length;
  const apply = (): void => {
    const patches = new Map<number, ObjectPatch>();
    for (const [index, r] of rows) {
      if (!r.apply || !r.name.trim()) continue;
      const c = r.cands[r.pick];
      patches.set(index, withTone && c ? { ...pickPatch(c), name: r.name.trim().slice(0, NAME_MAX) } : { name: r.name.trim().slice(0, NAME_MAX) });
    }
    onApply(patches);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-edge px-3 py-2 text-[11px] text-ink-2">
        <span className="text-[10px] font-bold uppercase tracking-widest">Name from lookups</span>
        <span className="text-ink-3">
          {done < list.length ? `${done} of ${list.length} looked up…` : `${list.length} looked up`} · {found} listed · {ready} to name
        </span>
        <label className="flex items-center gap-1">
          <input type="checkbox" className="accent-cyan" checked={withTone} onChange={(e) => setWithTone(e.target.checked)} />
          also set the tone and mode the listing names
        </label>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="whitespace-nowrap rounded-md bg-cyan px-2.5 py-1 text-[11px] font-bold text-bg disabled:opacity-40" disabled={ready === 0 || done < list.length} onClick={apply} title="Set the ticked names (one undo step)">
            Apply {ready} {ready === 1 ? 'name' : 'names'}
          </button>
          <button type="button" className="whitespace-nowrap rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink" onClick={onClose}>
            Close
          </button>
        </span>
        <span className="basis-full text-ink-3">The WTR and repeater list answer for every frequency; RadioReference and RRUK only from what they have already fetched. A row's ? button asks them for one frequency.</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-panel text-left text-[10px] font-bold uppercase tracking-widest text-ink-2">
            <tr>
              <th className="px-3 py-1" />
              <th className="py-1 pr-2">Frequency</th>
              <th className="py-1 pr-2">Alpha tag now</th>
              <th className="py-1 pr-2">Listing</th>
              <th className="py-1 pr-2">New alpha tag</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => {
              const r = rows.get(o.index);
              const c = r && r.pick >= 0 ? r.cands[r.pick] : undefined;
              return (
                <tr key={o.index} className={`border-b border-edge/60 ${r && !r.cands.length ? 'text-ink-3' : 'text-ink-2'}`}>
                  <td className="px-3 py-0.5">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-cyan" checked={!!r?.apply} disabled={!r || !r.cands.length} onChange={(e) => update(o.index, { apply: e.target.checked })} />
                  </td>
                  <td className="py-0.5 pr-2 font-mono text-amber">{mhz(o.frequencyHz)}</td>
                  <td className="py-0.5 pr-2">{o.name}</td>
                  <td className="py-0.5 pr-2">
                    {!r ? (
                      <span className="text-ink-3">…</span>
                    ) : r.cands.length === 0 ? (
                      <span className="text-ink-3">nothing listed</span>
                    ) : (
                      <span className="flex items-center gap-1">
                        {c && <span className={`shrink-0 rounded px-1 text-[9px] font-bold ${SOURCE_PILL[c.source]}`}>{c.source}</span>}
                        <select
                          className="max-w-[28rem] rounded border border-transparent bg-transparent px-1 text-[12px] text-ink hover:border-edge focus:border-cyan"
                          value={r.pick}
                          onChange={(e) => {
                            const pick = Number(e.target.value);
                            update(o.index, { pick, name: pickPatch(r.cands[pick]!).name ?? '' });
                          }}
                          title={c ? `${c.detail}${c.distanceKm !== null ? ` · ${c.distanceKm.toFixed(1)} km` : ''}` : ''}
                        >
                          {r.cands.map((x, i) => (
                            <option key={x.key} value={i}>
                              {x.name}
                              {x.detail ? ` · ${x.detail}` : ''}
                              {x.distanceKm !== null ? ` · ${x.distanceKm.toFixed(1)} km` : ''}
                            </option>
                          ))}
                        </select>
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 pr-2">{r && r.cands.length > 0 && <TextCell value={r.name} maxLength={NAME_MAX} className="max-w-[14rem]" onCommit={(name) => update(o.index, { name })} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
