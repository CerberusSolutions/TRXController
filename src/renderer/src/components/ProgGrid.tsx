import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CTCSS_TONES, type ProgObject, type ProgScanlist } from '../../../shared/programming';
import { candidatesFor, type ListedCandidate } from '../../../shared/listed';
import { normaliseLookups } from '../../../shared/sources';
import { SOURCE_PILL } from '../lib/sources';

/** A change to one or more objects: the fields to set. */
export type ObjectPatch = Partial<Omit<ProgObject, 'index'>>;

export const ROW_PX = 26;
export const NAME_MAX = 16;
export const MODES = ['AM', 'FM', 'NFM', 'AUTO', 'DMR', 'NXDN'] as const;
export const mhz = (hz: number): string => (hz / 1e6).toFixed(6);
export const squelchText = (o: ProgObject): string => (o.tone.type === 'CTCSS' || o.tone.type === 'DCS' ? `${o.tone.type} ${o.tone.value}` : o.tone.type);

const COLS = '1.6rem minmax(3.2rem,3.6rem) minmax(11rem,1.4fr) 7.2rem 4.6rem 4.6rem 8.6rem 2.6rem 3.4rem 4.6rem 6.4rem minmax(7rem,1fr)';
const cell = 'h-[22px] w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-[12.5px] text-ink outline-none hover:border-edge focus:border-cyan focus:bg-panel-2';
const select = `${cell} cursor-pointer appearance-none`;

/** A mode change as a patch: DMR / NXDN set the digital flags, an analogue mode clears them. */
export function modePatch(mode: string, o: ProgObject): ObjectPatch {
  if (mode === 'DMR') return { modulation: 'DMR', digital: true, nxdn: false, dmode: 'Digital', colourCode: o.colourCode ?? 'any' };
  if (mode === 'NXDN') return { modulation: 'NXDN', digital: false, nxdn: true, dmode: 'Digital', colourCode: null };
  return { modulation: mode, digital: false, nxdn: false, colourCode: null, dmode: o.dmode === 'Digital' ? 'Auto' : o.dmode };
}

/** What a lookup's pick sets: the name cut to the tag length, plus the tone and mode its detail names. */
export function pickPatch(c: ListedCandidate): ObjectPatch {
  const text = `${c.detail} ${c.pills ?? ''}`;
  const patch: ObjectPatch = { name: c.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) };
  // A repeater's detail carries its tone as "94.8 Hz", RadioReference's and RRUK's as "CTCSS 94.8".
  const ctcss = /(?:CTCSS\s+|\b)(\d{2,3}\.\d)(?:\s*Hz)?/i.exec(text);
  if (ctcss && CTCSS_TONES.some((t) => t.toFixed(1) === ctcss[1])) patch.tone = { type: 'CTCSS', value: ctcss[1]! };
  const digitalOnly = /\bDMR\b|\bCC\s*\d+/i.test(text) && !/\bANALOG\b|\bFM\b/i.test(text);
  if (digitalOnly) Object.assign(patch, { modulation: 'DMR', digital: true, nxdn: false, dmode: 'Digital', colourCode: 'any' });
  else if (/\bNXDN\b|\bRAN\s*\d+/i.test(text)) Object.assign(patch, { modulation: 'NXDN', digital: false, nxdn: true, dmode: 'Digital' });
  else if (c.source === 'UKR') Object.assign(patch, { modulation: 'NFM', digital: false, nxdn: false, dmode: 'Auto' });
  return patch;
}

interface GridProps {
  rows: ProgObject[];
  /** The first column: the record number, or the position within a scanlist. */
  first: 'Rec#' | 'Pos';
  /** Objects with an index at or past this are new since the folder was read. */
  newFrom: number;
  scanlists: readonly ProgScanlist[];
  selected: ReadonlySet<number>;
  onSelect: (index: number, mode: 'toggle' | 'range' | 'only') => void;
  onEdit: (index: number, patch: ObjectPatch) => void;
  /** An object whose name cell should take the focus once (a row just added). */
  focus: number | null;
}

/**
 * The editable objects grid: every cell is its own editor and commits on blur or Enter (Esc reverts), so
 * the table is the form. A change to a row inside the selection is applied to the whole selection by
 * the owner (`onEdit` decides), which is the bulk edit: select the rows, change one.
 */
export default function ProgGrid({ rows, first, newFrom, scanlists, selected, onSelect, onEdit, focus }: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_PX, overscan: 14, getItemKey: (i) => rows[i]!.index });
  useEffect(() => {
    if (focus === null) return;
    const at = rows.findIndex((r) => r.index === focus);
    if (at >= 0) v.scrollToIndex(at, { align: 'center' });
  }, [focus, rows, v]);
  const named = scanlists.filter((l) => l.name && !/^Scanlist \d{3}$/.test(l.name));
  return (
    <div ref={scrollRef} className="h-full min-h-0 flex-1 overflow-auto">
      <div className="sticky top-0 z-20 grid gap-x-1.5 whitespace-nowrap border-b border-edge bg-panel px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-ink-2" style={{ gridTemplateColumns: COLS }}>
        <span />
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
          const isSel = selected.has(o.index);
          const bad = !(o.frequencyHz >= 25e6 && o.frequencyHz <= 1300e6);
          return (
            <div
              key={it.key}
              className={`absolute left-0 grid w-full items-center gap-x-1.5 whitespace-nowrap border-b border-edge/60 px-2 text-[12.5px] text-ink-2 ${isSel ? 'bg-cyan/10' : ''}`}
              style={{ top: it.start, height: ROW_PX, gridTemplateColumns: COLS }}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 cursor-pointer accent-cyan"
                checked={isSel}
                onChange={() => undefined}
                onClick={(e) => onSelect(o.index, e.shiftKey ? 'range' : 'toggle')}
                title="Select (Shift-click for a range); a change to a selected row applies to every selected row"
              />
              <button type="button" className={`text-left font-mono text-[11px] ${o.index >= newFrom ? 'text-green' : 'text-ink-3'}`} onClick={(e) => onSelect(o.index, e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'only')} title="Select this row alone (Ctrl-click adds, Shift-click a range)">
                {o.index >= newFrom ? 'new' : first === 'Pos' ? it.index + 1 : String(o.index).padStart(5, '0')}
              </button>
              <span className="flex min-w-0 items-center gap-1">
                <TextCell value={o.name} maxLength={NAME_MAX} autoFocus={focus === o.index} onCommit={(name) => onEdit(o.index, { name })} />
                <Lookup o={o} onPick={(c) => onEdit(o.index, pickPatch(c))} />
              </span>
              <TextCell value={mhz(o.frequencyHz)} mono className={bad ? 'text-red' : 'text-amber'} title={bad ? 'Enter a frequency between 25 and 1300 MHz' : 'MHz'} onCommit={(s) => onEdit(o.index, { frequencyHz: Math.round(Number(s.replace(/[^\d.]/g, '')) * 1e6) || 0 })} />
              <select className={`${select} font-mono`} value={MODES.includes(o.modulation as (typeof MODES)[number]) ? o.modulation : 'NFM'} onChange={(e) => onEdit(o.index, modePatch(e.target.value, o))}>
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <select className={select} value={o.dmode} onChange={(e) => onEdit(o.index, { dmode: e.target.value as ProgObject['dmode'] })}>
                <option>Auto</option>
                <option>Analog</option>
                <option>Digital</option>
              </select>
              <Squelch o={o} onEdit={(p) => onEdit(o.index, p)} />
              <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-cyan" checked={o.skip} onChange={(e) => onEdit(o.index, { skip: e.target.checked })} title="Skip" />
              <TextCell value={o.delayS.toFixed(1)} mono onCommit={(s) => onEdit(o.index, { delayS: Math.max(0, Math.min(25.5, Number(s) || 0)) })} title="Delay, seconds" />
              <select className={select} value={o.backlight === 'Leave' || o.backlight === 'On' || o.backlight === 'Flash' ? o.backlight : 'other'} onChange={(e) => onEdit(o.index, { backlight: e.target.value })}>
                <option>Leave</option>
                <option>On</option>
                <option>Flash</option>
                {o.backlight !== 'Leave' && o.backlight !== 'On' && o.backlight !== 'Flash' && <option value="other">{o.backlight}</option>}
              </select>
              <span className="flex items-center gap-1">
                <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-cyan" checked={o.led.on} onChange={(e) => onEdit(o.index, { led: { on: e.target.checked, colour: o.led.colour ?? '#FF00FF' } })} title="LED on" />
                <input type="color" className="h-4 w-6 cursor-pointer rounded border border-edge bg-transparent p-0 disabled:opacity-30" disabled={!o.led.on} value={o.led.colour ?? '#FF00FF'} onChange={(e) => onEdit(o.index, { led: { on: true, colour: e.target.value.toUpperCase() } })} title="LED colour" />
              </span>
              <ScanlistsCell value={o.scanlists} named={named} onCommit={(scanlists) => onEdit(o.index, { scanlists })} />
            </div>
          );
        })}
      </div>
      {rows.length === 0 && <div className="p-4 text-sm text-ink-3">Nothing here.</div>}
    </div>
  );
}

/** A text editor that holds its own text while focused and commits on blur or Enter; Esc puts the value back. */
export function TextCell({ value, onCommit, maxLength, mono, className, title, autoFocus }: { value: string; onCommit: (v: string) => void; maxLength?: number; mono?: boolean; className?: string; title?: string; autoFocus?: boolean }) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  useEffect(() => {
    if (autoFocus) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [autoFocus]);
  return (
    <input
      ref={ref}
      className={`${cell} ${mono ? 'font-mono' : ''} ${className ?? ''}`}
      value={text}
      maxLength={maxLength}
      title={title}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value);
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function Squelch({ o, onEdit }: { o: ProgObject; onEdit: (p: ObjectPatch) => void }) {
  const type = o.tone.type;
  const known = type === 'None' || type === 'CTCSS' || type === 'Search';
  return (
    <span className="flex items-center gap-1">
      <select
        className={`${select} ${type === 'CTCSS' ? 'w-[4.2rem]' : ''}`}
        value={known ? type : 'other'}
        onChange={(e) => {
          const t = e.target.value;
          onEdit({ tone: t === 'CTCSS' ? { type: 'CTCSS', value: '94.8' } : { type: t, value: '' } });
        }}
      >
        <option>None</option>
        <option>CTCSS</option>
        <option disabled title="Not decoded from the card yet">
          DCS
        </option>
        <option disabled title="Not decoded from the card yet">
          NAC
        </option>
        <option>Search</option>
        {!known && <option value="other">{squelchText(o)}</option>}
      </select>
      {type === 'CTCSS' && (
        <select className={`${select} font-mono`} value={o.tone.value} onChange={(e) => onEdit({ tone: { type: 'CTCSS', value: e.target.value } })}>
          {!CTCSS_TONES.some((t) => t.toFixed(1) === o.tone.value) && <option value={o.tone.value}>{o.tone.value}</option>}
          {CTCSS_TONES.map((t) => (
            <option key={t}>{t.toFixed(1)}</option>
          ))}
        </select>
      )}
    </span>
  );
}

/** A popover fixed to the viewport beside its anchor (the rows are clipped by the scroller), closed by Esc or a click outside. */
export function Popover({ anchor, onClose, children, width = 320 }: { anchor: DOMRect; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: anchor.left, top: anchor.bottom + 4 });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const below = anchor.bottom + 4 + h <= window.innerHeight - 8;
    setPos({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)), top: below ? anchor.bottom + 4 : Math.max(8, anchor.top - 4 - h) });
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="fixed z-50 rounded-lg border border-edge bg-panel p-2 text-[12.5px] text-ink-2 shadow-xl" style={{ left: pos.left, top: pos.top, width }}>
      {children}
    </div>
  );
}

/** The scanlist chips: every named list, the member ones lit; All on / All off; Apply commits. */
export function ScanlistPicker({ value, named, onCommit, onClose }: { value: readonly number[]; named: readonly ProgScanlist[]; onCommit: (lists: number[]) => void; onClose: () => void }) {
  const [set, setSet] = useState<Set<number>>(new Set(value));
  const [other, setOther] = useState('');
  const toggle = (n: number): void =>
    setSet((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const extra = [...set].filter((n) => !named.some((l) => l.number === n)).sort((a, b) => a - b);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {named.map((l) => (
          <button
            key={l.number}
            type="button"
            className={`rounded-full border px-2 py-0.5 text-[11px] leading-4 ${set.has(l.number) ? 'border-cyan bg-cyan/15 text-ink' : 'border-edge text-ink-3 hover:text-ink'}`}
            onClick={() => toggle(l.number)}
            title={`Scanlist ${l.number}${l.enabled ? '' : ' (disabled)'}`}
          >
            <span className="mr-1 font-mono text-[10px] opacity-70">{l.number}</span>
            {l.name}
          </button>
        ))}
        {extra.map((n) => (
          <button key={n} type="button" className="rounded-full border border-cyan bg-cyan/15 px-2 py-0.5 font-mono text-[11px] leading-4 text-ink" onClick={() => toggle(n)} title={`Scanlist ${n}`}>
            {n}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          className="w-16 rounded border border-edge bg-panel-2 px-1 py-0.5 font-mono text-[11px] text-ink outline-none focus:border-cyan"
          placeholder="1-200"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            const n = Number(other);
            if (e.key === 'Enter' && n >= 1 && n <= 200) {
              toggle(n);
              setOther('');
            }
          }}
          title="Add a list by number"
        />
        <button type="button" className="text-[11px] text-ink-3 hover:text-ink" onClick={() => setSet(new Set(named.map((l) => l.number)))}>
          All on
        </button>
        <button type="button" className="text-[11px] text-ink-3 hover:text-ink" onClick={() => setSet(new Set())}>
          All off
        </button>
        <span className="ml-auto flex gap-1">
          <button type="button" className="rounded-md border border-edge px-2 py-0.5 text-[11px] text-ink-3 hover:text-ink" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-cyan px-2 py-0.5 text-[11px] font-bold text-bg"
            onClick={() => {
              onCommit([...set].sort((a, b) => a - b));
              onClose();
            }}
          >
            Apply
          </button>
        </span>
      </div>
    </div>
  );
}

function ScanlistsCell({ value, named, onCommit }: { value: readonly number[]; named: readonly ProgScanlist[]; onCommit: (lists: number[]) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const names = value.map((n) => named.find((l) => l.number === n)?.name ?? String(n));
  return (
    <>
      <button type="button" className={`${cell} truncate text-left font-mono text-[11px]`} onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())} title={names.join(', ') || 'No scanlist: the object is never scanned'}>
        {value.length ? value.join(', ') : <span className="text-red">none</span>}
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={360}>
          <ScanlistPicker value={value} named={named} onCommit={onCommit} onClose={() => setAnchor(null)} />
        </Popover>
      )}
    </>
  );
}

/** Ask the lookups (WTR, RRUK, RadioReference, repeaters) what is on the frequency and offer each answer as the name. */
function Lookup({ o, onPick }: { o: ProgObject; onPick: (c: ListedCandidate) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [cands, setCands] = useState<ListedCandidate[] | null>(null);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const api = window.trx;
  const canLookup = !!api && (!!api.wtrLookup || !!api.repeatersLookup || !!api.rrukLookup || !!api.rrLookup);
  /**
   * The registers answer at once; RadioReference and RRUK answer from their cache, with `pending` set while
   * the service is being asked, so the popover asks again every couple of seconds until they have answered.
   */
  const run = async (attempt = 0): Promise<void> => {
    if (!api) return;
    if (attempt === 0) setCands(null);
    const hz = o.frequencyHz;
    const [settings, licences, repeaters, rruk, rr] = await Promise.all([
      api.settingsGet().catch(() => null),
      api.wtrLookup?.(hz).catch(() => []) ?? [],
      api.repeatersLookup?.(hz).catch(() => []) ?? [],
      api.rrukLookup?.(hz).catch(() => null) ?? null,
      api.rrLookup?.(hz, 'ask').catch(() => null) ?? null,
    ]);
    const tone = o.tone.type === 'CTCSS' ? `CTCSS ${o.tone.value}` : null;
    setCands(candidatesFor({ rr, rruk, licences, repeaters, detectedTone: tone }, normaliseLookups(settings?.lookups)));
    const waiting = !!rruk?.pending || !!rr?.pending;
    setPending(waiting);
    if (timer.current) clearTimeout(timer.current);
    timer.current = waiting && attempt < 8 ? setTimeout(() => void run(attempt + 1), 2000) : null;
  };
  const close = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAnchor(null);
  };
  if (!canLookup) return null;
  return (
    <>
      <button
        type="button"
        className="shrink-0 rounded px-1 text-[11px] text-ink-3 hover:bg-panel-2 hover:text-cyan"
        title="What the lookups know about this frequency: pick one to name the channel"
        onClick={(e) => {
          setAnchor(e.currentTarget.getBoundingClientRect());
          void run();
        }}
      >
        ?
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} width={420}>
          <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-ink-2">
            <span>Listed on {mhz(o.frequencyHz)}</span>
            {pending && <span className="ml-auto normal-case tracking-normal text-ink-3">asking RadioReference…</span>}
          </div>
          {cands === null ? (
            <div className="py-2 text-ink-3">Looking up…</div>
          ) : cands.length === 0 ? (
            <div className="py-2 text-ink-3">{pending ? 'Nothing in the registers; waiting for RadioReference.' : 'Nothing listed.'}</div>
          ) : (
            <div className="max-h-72 overflow-auto">
              {cands.map((c) => (
                <button key={c.key} type="button" className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-panel-2" onClick={() => onPick(c)} title={`${c.title}\nUse as the alpha tag (cut to 16 characters), with the tone and mode it names`}>
                  <span className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-bold ${SOURCE_PILL[c.source]}`}>{c.source}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-ink">
                      {c.name}
                      {c.pills && <span className="ml-2 text-[10px] text-ink-3">{c.pills}</span>}
                    </span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {c.detail}
                      {c.distanceKm !== null ? ` · ${c.distanceKm.toFixed(1)} km` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Popover>
      )}
    </>
  );
}
