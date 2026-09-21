import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CdatCandidate, ProgObject, ProgSaveResult, ProgSaveTarget, ProgScanlist, Programming } from '../../../shared/programming';
import { defaultModulation } from '../../../shared/bandDefaults';
import { attachLogEvents } from '../store/log';
import { initTheme } from '../store/theme';
import ProgLogImport from './ProgLogImport';
import ProgNameFromLookups from './ProgNameFromLookups';
import ProgSearch from './ProgSearch';
import ProgGrid, { NAME_MAX, Popover, ScanlistPicker, TextCell, mhz, squelchText, type ObjectPatch } from './ProgGrid';

type Tab = 'general' | 'scanlists' | 'objects' | 'trunked' | 'search';
const UNDO_DEPTH = 100;
const btn = 'no-drag whitespace-nowrap rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40 disabled:hover:text-ink-3';
const primary = 'no-drag whitespace-nowrap rounded-md bg-cyan px-2.5 py-1 text-[11px] font-bold text-bg disabled:opacity-40';

/** Fields a change to one selected row is applied to the whole selection for; the name and frequency stay per row. */
const BULK_FIELDS: ReadonlySet<keyof ObjectPatch> = new Set(['modulation', 'dmode', 'tone', 'skip', 'backlight', 'delayS', 'led', 'digital', 'nxdn', 'colourCode', 'scanlists']);

/** Recompute each scanlist's members from the objects' own lists, as the reader does. */
function withMembers(p: Programming): Programming {
  const members = new Map<number, number[]>();
  for (const o of p.objects) for (const n of o.scanlists) (members.get(n) ?? members.set(n, []).get(n)!).push(o.index);
  return { ...p, scanlists: p.scanlists.map((l) => ({ ...l, objects: members.get(l.number) ?? [] })) };
}

/** The problems that stop a save: the writer would put them on the card as they are. */
function problems(p: Programming): string[] {
  const out: string[] = [];
  for (const o of p.objects) {
    if (!(o.frequencyHz >= 25e6 && o.frequencyHz <= 1300e6)) out.push(`${o.name || `#${o.index}`}: frequency ${mhz(o.frequencyHz)} is outside 25-1300 MHz`);
    if (!o.name.trim()) out.push(`${mhz(o.frequencyHz)}: no alpha tag`);
  }
  return out;
}

/** The mode a new channel starts with, replaced from its band the first time a frequency is typed in. */
const NEW_MODE = 'NFM';

const newObject = (index: number, scanlist: number): ProgObject => ({
  index,
  name: 'New channel',
  frequencyHz: 0,
  modulation: NEW_MODE,
  dmode: 'Auto',
  tone: { type: 'None', value: '' },
  skip: false,
  backlight: 'Leave',
  delayS: 2,
  led: { on: false, colour: null },
  digital: false,
  colourCode: null,
  nxdn: false,
  scanlists: [scanlist],
});

/**
 * The Programming window (`#programming`, development builds only): the scanner's programming as EZ Scan
 * writes it to the SD card's CDAT folder, read off the card (which mounts as a drive while the scanner
 * is off) or a V-Scanner folder beside it, edited in place in the grid, and written back over the
 * folder (after a backup beside it) or into a new V-Scanner folder. Every edit is one undo step.
 * Tabs follow EZ Scan's: General, Scanlists, Conventional objects, Trunked systems (read-only), Search.
 */
export default function ProgrammingApp() {
  const [base, setBase] = useState<Programming | null>(null);
  const [hist, setHist] = useState<{ past: Programming[]; present: Programming | null; future: Programming[] }>({ past: [], present: null, future: [] });
  const [cands, setCands] = useState<CdatCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('objects');
  const [filter, setFilter] = useState('');
  const [list, setList] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState<number | null>(null);
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const [fromLog, setFromLog] = useState(false);
  const [naming, setNaming] = useState(false);
  const anchorRef = useRef<number | null>(null);
  const prog = hist.present;
  const dirty = hist.past.length > 0;

  const load = useCallback(async (dir?: string) => {
    if (!window.trx?.programmingLoad) return;
    setBusy(true);
    setError(null);
    try {
      const p = await window.trx.programmingLoad(dir);
      if (p) {
        setBase(p);
        setHist({ past: [], present: p, future: [] });
        setSelected(new Set());
        setCands((await window.trx.programmingLocate?.(p.dir)) ?? []);
      }
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Loading over unsaved edits asks first. */
  const loadChecked = useCallback(
    (dir?: string) => {
      if (dirty && !window.confirm('Drop the unsaved changes?')) return;
      void load(dir);
    },
    [dirty, load],
  );

  useEffect(() => {
    const offTheme = initTheme();
    const offLog = attachLogEvents();
    void (async () => {
      const found = (await window.trx?.programmingLocate?.()) ?? [];
      setCands(found);
      if (found[0]) void load(found[0].dir);
    })();
    return () => {
      offTheme();
      offLog();
    };
  }, [load]);

  const commit = useCallback((next: Programming) => {
    setHist((h) => ({ past: [...h.past.slice(-(UNDO_DEPTH - 1)), h.present!], present: withMembers(next), future: [] }));
  }, []);
  const undo = useCallback(() => {
    setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present!, ...h.future] } : h));
  }, []);
  const redo = useCallback(() => {
    setHist((h) => (h.future.length ? { past: [...h.past, h.present!], present: h.future[0]!, future: h.future.slice(1) } : h));
  }, []);

  /** One row's change, or the selection's when the row is selected and the field is a bulk one. */
  const edit = useCallback(
    (index: number, patch: ObjectPatch) => {
      if (!prog) return;
      const bulk = selected.has(index) && selected.size > 1 && Object.keys(patch).every((k) => BULK_FIELDS.has(k as keyof ObjectPatch));
      const targets = bulk ? selected : new Set([index]);
      setFocus(null);
      // A new channel's first frequency also sets its mode from the band, unless a mode was picked already.
      const withMode = (o: ProgObject): ObjectPatch => (o.frequencyHz === 0 && o.modulation === NEW_MODE && patch.frequencyHz && !('modulation' in patch) ? { ...patch, modulation: defaultModulation(patch.frequencyHz) } : patch);
      commit({ ...prog, objects: prog.objects.map((o) => (targets.has(o.index) ? { ...o, ...withMode(o) } : o)) });
    },
    [prog, selected, commit],
  );

  const nextIndex = useMemo(() => (prog ? prog.objects.reduce((m, o) => Math.max(m, o.index + 1), base?.objects.length ?? 0) : 0), [prog, base]);

  const addObject = useCallback(() => {
    if (!prog) return;
    const o = newObject(nextIndex, tab === 'scanlists' && list ? list : 1);
    commit({ ...prog, objects: [...prog.objects, o] });
    setSelected(new Set());
    setFocus(o.index);
    if (tab !== 'scanlists') setTab('objects');
  }, [prog, nextIndex, tab, list, commit]);

  const duplicate = useCallback(() => {
    if (!prog || selected.size === 0) return;
    let n = nextIndex;
    const copies = prog.objects.filter((o) => selected.has(o.index)).map((o) => ({ ...o, index: n++ }));
    commit({ ...prog, objects: [...prog.objects, ...copies] });
    setSelected(new Set(copies.map((c) => c.index)));
    setFocus(copies[0]!.index);
  }, [prog, selected, nextIndex, commit]);

  const remove = useCallback(() => {
    if (!prog || selected.size === 0) return;
    commit({ ...prog, objects: prog.objects.filter((o) => !selected.has(o.index)) });
    setSelected(new Set());
  }, [prog, selected, commit]);

  const shown = useMemo(() => {
    if (!prog) return [];
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = prog.objects;
    if (words.length === 0) return rows;
    return rows.filter((o) => {
      const hay = `${o.name} ${mhz(o.frequencyHz)} ${o.modulation} ${o.dmode} ${squelchText(o)} ${o.scanlists.join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [prog, filter]);

  const byIndex = useMemo(() => new Map((prog?.objects ?? []).map((o) => [o.index, o])), [prog]);
  const selectedList = prog?.scanlists.find((l) => l.number === list) ?? null;
  const listRows = useMemo(() => (selectedList ? selectedList.objects.map((i) => byIndex.get(i)).filter((o): o is ProgObject => !!o) : []), [selectedList, byIndex]);
  const visible = tab === 'scanlists' ? listRows : shown;

  const select = useCallback(
    (index: number, mode: 'toggle' | 'range' | 'only') => {
      setFocus(null);
      setSelected((s) => {
        const next = mode === 'only' ? new Set<number>() : new Set(s);
        if (mode === 'range' && anchorRef.current !== null) {
          const a = visible.findIndex((o) => o.index === anchorRef.current);
          const b = visible.findIndex((o) => o.index === index);
          if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(visible[i]!.index);
          return next;
        }
        if (mode === 'toggle' && next.has(index)) next.delete(index);
        else next.add(index);
        anchorRef.current = index;
        return next;
      });
    },
    [visible],
  );

  const save = useCallback(
    async (target: ProgSaveTarget) => {
      if (!prog || !window.trx?.programmingSave) return;
      const bad = problems(prog);
      if (bad.length) {
        setError(`Not saved. ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''}`);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const r: ProgSaveResult = await window.trx.programmingSave(prog, target);
        setNotice(`Saved ${r.files} files to ${r.dir}${r.backupDir ? ` · the folder as it was is in ${r.backupDir}` : ''}`);
        setSaveAs(null);
        await load(r.dir);
      } catch (e) {
        setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
      } finally {
        setBusy(false);
      }
    },
    [prog, load],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inField = /^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y' && !inField) {
        e.preventDefault();
        redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) void save({ kind: 'inplace' });
      } else if (e.key === 'Delete' && !inField && selected.size) {
        e.preventDefault();
        remove();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save, remove, dirty, selected]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 12000);
    return () => clearTimeout(t);
  }, [notice]);

  const tabBtn = (t: Tab, label: string): React.ReactElement => (
    <button type="button" className={`no-drag rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${tab === t ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:text-ink'}`} onClick={() => setTab(t)}>
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
        <span className="rounded border border-amber/60 px-1.5 text-[9px] font-bold uppercase tracking-widest text-amber" title="Development build only">
          dev
        </span>
        {prog && (
          <>
            {cands.length > 1 || cands[0]?.kind === 'recent' ? (
              <select className="no-drag max-w-[16rem] rounded-md border border-edge bg-panel-2 px-2 py-1 text-[12px] text-ink" value={prog.dir} onChange={(e) => loadChecked(e.target.value)} title="The card's CDAT folder and the V-Scanner folders beside it">
                {cands.map((c) => (
                  <option key={c.dir} value={c.dir} title={c.dir}>
                    {c.kind === 'vscanner' ? `V-Scanner · ${c.description || c.dir}` : c.kind === 'recent' ? `Recent · ${c.description || c.dir.replace(/^.*[\\/]/, '')}` : c.description || 'Card'}
                  </option>
                ))}
              </select>
            ) : (
              <span className="min-w-0 truncate text-ink">{prog.description || 'Scanner card'}</span>
            )}
            <span className="min-w-0 truncate font-mono text-[11px] text-ink-3" title={prog.dir}>
              {prog.dir}
            </span>
            <span className="whitespace-nowrap text-[11px] text-ink-3">
              {prog.objects.length} objects · {prog.scanlists.filter((l) => l.objects.length).length} scanlists in use · {prog.trunked.length} trunked
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {prog && (
            <>
              <button type="button" className={btn} disabled={!hist.past.length} onClick={undo} title="Undo (Ctrl+Z)">
                Undo
              </button>
              <button type="button" className={btn} disabled={!hist.future.length} onClick={redo} title="Redo (Ctrl+Y)">
                Redo
              </button>
              <button type="button" className={btn} disabled={busy || !dirty} onClick={() => setSaveAs((s) => (s === null ? '' : null))} title="Write the edits into a new CDAT_VS.nnn folder beside this one, which the scanner loads from its V-Scanner menu; this folder is left as it is">
                Save as V-Scanner…
              </button>
              <button type="button" className={primary} disabled={busy || !dirty} onClick={() => void save({ kind: 'inplace' })} title="Write the edits over this folder (Ctrl+S); the folder as it was is copied beside it first">
                Save
              </button>
            </>
          )}
          <button type="button" className={btn} disabled={busy || !prog} onClick={() => prog && loadChecked(prog.dir)} title="Read the folder again">
            Reload
          </button>
          <button type="button" className={btn} disabled={busy} onClick={() => loadChecked()} title="Choose a CDAT folder (the card's, or a copy of it)">
            Open folder…
          </button>
        </span>
      </header>

      {saveAs !== null && prog && (
        <div className="flex items-center gap-2 border-b border-edge bg-panel-2 px-4 py-2 text-xs text-ink-2">
          <span>New V-Scanner folder beside {prog.dir.replace(/[\\/][^\\/]+$/, '')}, described as</span>
          <input
            className="w-48 rounded border border-edge bg-panel px-2 py-0.5 text-[12px] text-ink outline-none focus:border-cyan"
            maxLength={64}
            value={saveAs}
            placeholder={prog.description}
            autoFocus
            onChange={(e) => setSaveAs(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save({ kind: 'vscanner', description: saveAs || prog.description });
              if (e.key === 'Escape') setSaveAs(null);
            }}
          />
          <button type="button" className={primary} disabled={busy} onClick={() => void save({ kind: 'vscanner', description: saveAs || prog.description })}>
            Write
          </button>
          <button type="button" className={btn} onClick={() => setSaveAs(null)}>
            Cancel
          </button>
          <span className="text-ink-3">Up to four lines of 16 characters, wrapped at a word. The scanner loads it from Main Menu › V-Scanner; EZ Scan lists it under Scanner/SD Card.</span>
        </div>
      )}
      {error && <div className="border-b border-red/40 bg-panel px-4 py-2 text-xs text-red">{error}</div>}
      {notice && <div className="border-b border-green/40 bg-panel px-4 py-2 text-xs text-green">{notice}</div>}

      {!prog ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-ink-2">
          <div className="max-w-md space-y-2">
            <p className="text-ink">{busy ? 'Reading the card…' : 'No scanner card found.'}</p>
            {!busy && (
              <>
                <p>Switch the scanner off with the USB lead in: its SD card mounts as a drive, and the programming EZ Scan wrote to it is in the card's CDAT folder. Plug the card into a reader if you prefer.</p>
                <p>
                  Nothing found on the mounted drives just now. Press <b className="text-ink">Open folder…</b> to point at a CDAT folder (or a copy of one), or <b className="text-ink">Reload</b> once the card is in. Folders opened before are offered first.
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
            {tabBtn('search', 'Search')}
            {tab === 'objects' && (
              <>
                <input
                  className="ml-4 w-72 rounded-md border border-edge bg-panel-2 px-2 py-1 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
                  placeholder="Filter (alpha tag, frequency, mode, scanlist…)"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
                  }}
                />
                <span className="text-[11px] text-ink-3">{shown.length === prog.objects.length ? `${prog.objects.length} objects` : `${shown.length} of ${prog.objects.length}`}</span>
              </>
            )}
            {(tab === 'objects' || tab === 'scanlists') && (
              <span className="ml-auto flex items-center gap-2">
                {selected.size === 0 && visible.length > 0 && (
                  <button type="button" className={btn} onClick={() => setSelected(new Set(visible.map((o) => o.index)))} title="Select every row shown">
                    Select all
                  </button>
                )}
                <button type="button" className={btn} onClick={() => setFromLog((v) => !v)} title="Add channels from the log: what the scanner has heard, named as the log names it">
                  From log…
                </button>
                <button type="button" className={primary} onClick={addObject} title={tab === 'scanlists' && list ? `Add a channel to scanlist ${list}` : 'Add a channel (in scanlist 1)'}>
                  Add channel
                </button>
              </span>
            )}
          </div>
          {(tab === 'objects' || tab === 'scanlists') && selected.size > 0 && (
            <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-cyan/5 px-3 py-1.5 text-[11px] text-ink-2">
              <span className="font-bold text-cyan">{selected.size} selected</span>
              <span className="text-ink-3">Change any field in a selected row to change them all.</span>
              <span className="ml-auto flex items-center gap-2">
                <BulkLists prog={prog} selected={selected} onEdit={(lists) => commit({ ...prog, objects: prog.objects.map((o) => (selected.has(o.index) ? { ...o, scanlists: lists(o.scanlists) } : o)) })} />
                <button type="button" className={btn} onClick={() => setNaming(true)} title="Ask the lookups about every selected frequency and take their names as the alpha tags">
                  Name from lookups…
                </button>
                <button type="button" className={btn} onClick={duplicate} title="Copy the selected objects as new ones">
                  Duplicate
                </button>
                <button type="button" className={`${btn} hover:text-red`} onClick={remove} title="Delete the selected objects (Delete)">
                  Delete
                </button>
                <button type="button" className={btn} onClick={() => setSelected(new Set())} title="Clear the selection">
                  Clear
                </button>
              </span>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {naming && (tab === 'objects' || tab === 'scanlists') ? (
              <ProgNameFromLookups
                objects={visible.filter((o) => selected.has(o.index))}
                onApply={(patches) => {
                  commit({ ...prog, objects: prog.objects.map((o) => (patches.has(o.index) ? { ...o, ...patches.get(o.index)! } : o)) });
                  setNaming(false);
                }}
                onClose={() => setNaming(false)}
              />
            ) : fromLog && (tab === 'objects' || tab === 'scanlists') ? (
              <ProgLogImport
                scanlists={prog.scanlists}
                existing={prog.objects}
                defaultList={tab === 'scanlists' && list ? list : 1}
                nextIndex={nextIndex}
                onAdd={(objects) => {
                  commit({ ...prog, objects: [...prog.objects, ...objects] });
                  setSelected(new Set(objects.map((o) => o.index)));
                  setFocus(objects[0]?.index ?? null);
                  setFromLog(false);
                  if (tab !== 'scanlists') setTab('objects');
                }}
                onClose={() => setFromLog(false)}
              />
            ) : null}
            {!fromLog && !naming && tab === 'objects' && <ProgGrid rows={shown} first="Rec#" newFrom={base?.objects.length ?? 0} scanlists={prog.scanlists} selected={selected} onSelect={select} onEdit={edit} focus={focus} />}
            {!fromLog && !naming && tab === 'scanlists' && (
              <div className="grid h-full grid-cols-[21rem_minmax(0,1fr)]">
                <div className="overflow-y-auto border-r border-edge">
                  {prog.scanlists
                    .filter((l) => l.objects.length || !/^Scanlist \d{3}$/.test(l.name))
                    .map((l) => (
                      <ScanlistRow key={l.number} l={l} active={list === l.number} onPick={() => setList(l.number)} onEdit={(patch) => commit({ ...prog, scanlists: prog.scanlists.map((x) => (x.number === l.number ? { ...x, ...patch } : x)) })} />
                    ))}
                  <button type="button" className="w-full px-3 py-2 text-left text-[11px] text-ink-3 hover:text-ink" onClick={() => setList(prog.scanlists.find((l) => !l.objects.length && /^Scanlist \d{3}$/.test(l.name))?.number ?? null)} title="Bring the next unused scanlist into view to name it">
                    + Use the next empty scanlist
                  </button>
                </div>
                <div className="flex min-h-0 flex-col">
                  {selectedList ? (
                    <>
                      <div className="flex items-center gap-3 border-b border-edge px-3 py-1.5 text-xs text-ink-2">
                        <span className="w-6 font-mono text-[11px] text-ink-3">{String(selectedList.number).padStart(2, '0')}</span>
                        <TextCell value={selectedList.name} maxLength={NAME_MAX} className="max-w-[14rem] text-ink" onCommit={(name) => commit({ ...prog, scanlists: prog.scanlists.map((x) => (x.number === selectedList.number ? { ...x, name } : x)) })} title="Rename the scanlist" />
                        <span>{selectedList.objects.length} objects</span>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" className="accent-cyan" checked={selectedList.enabled} onChange={(e) => commit({ ...prog, scanlists: prog.scanlists.map((x) => (x.number === selectedList.number ? { ...x, enabled: e.target.checked } : x)) })} />
                          Enabled
                        </label>
                      </div>
                      <ProgGrid rows={listRows} first="Pos" newFrom={base?.objects.length ?? 0} scanlists={prog.scanlists} selected={selected} onSelect={select} onEdit={edit} focus={focus} />
                    </>
                  ) : (
                    <div className="p-4 text-sm text-ink-3">Pick a scanlist.</div>
                  )}
                </div>
              </div>
            )}
            {tab === 'general' && <General prog={prog} onChange={commit} />}
            {tab === 'trunked' && <Trunked prog={prog} />}
            {tab === 'search' && <ProgSearch prog={prog} onChange={commit} />}
          </div>
          <div className="flex shrink-0 items-center gap-3 border-t border-edge bg-panel px-3 py-1 text-[11px] text-ink-3">
            {dirty ? (
              <span className="text-amber">
                {hist.past.length} unsaved {hist.past.length === 1 ? 'edit' : 'edits'}
              </span>
            ) : (
              <span>No unsaved edits</span>
            )}
            <span>Click a cell to edit; Enter or Tab commits, Esc reverts. Ctrl+Z undo · Ctrl+Y redo · Ctrl+S save · Delete removes the selection.</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Add the selection to, or take it out of, scanlists: the same chip picker applied to every selected object. */
function BulkLists({ prog, selected, onEdit }: { prog: Programming; selected: ReadonlySet<number>; onEdit: (change: (lists: number[]) => number[]) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const named = prog.scanlists.filter((l) => l.name && !/^Scanlist \d{3}$/.test(l.name));
  const common = useMemo(() => {
    const sel = prog.objects.filter((o) => selected.has(o.index));
    return sel.length ? sel[0]!.scanlists.filter((n) => sel.every((o) => o.scanlists.includes(n))) : [];
  }, [prog, selected]);
  return (
    <>
      <button
        type="button"
        className={btn}
        onClick={(e) => {
          setMode('add');
          setAnchor(e.currentTarget.getBoundingClientRect());
        }}
        title="Add the selected objects to scanlists"
      >
        Add to lists…
      </button>
      <button
        type="button"
        className={btn}
        onClick={(e) => {
          setMode('remove');
          setAnchor(e.currentTarget.getBoundingClientRect());
        }}
        title="Take the selected objects out of scanlists"
      >
        Remove from lists…
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={360}>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">{mode === 'add' ? 'Add the selection to' : 'Take the selection out of'}</div>
          <ScanlistPicker
            value={mode === 'remove' ? common : []}
            named={named}
            onCommit={(lists) => onEdit((have) => (mode === 'add' ? [...new Set([...have, ...lists])].sort((a, b) => a - b) : have.filter((n) => !lists.includes(n))))}
            onClose={() => setAnchor(null)}
          />
        </Popover>
      )}
    </>
  );
}

function ScanlistRow({ l, active, onPick, onEdit }: { l: ProgScanlist; active: boolean; onPick: () => void; onEdit: (patch: Partial<ProgScanlist>) => void }) {
  return (
    <div className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm ${active ? 'bg-panel-2 text-ink' : 'text-ink-2 hover:bg-panel-2/60 hover:text-ink'}`}>
      <button type="button" className="w-7 font-mono text-[11px] text-ink-3" onClick={onPick}>
        {String(l.number).padStart(2, '0')}
      </button>
      <span className="min-w-0 flex-1" onClick={onPick}>
        <TextCell value={l.name} maxLength={NAME_MAX} onCommit={(name) => onEdit({ name })} title="Rename" />
      </span>
      <button type="button" className="w-9 text-right text-[11px] text-ink-3" onClick={onPick}>
        {l.objects.length}
      </button>
      <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-green" checked={l.enabled} onChange={(e) => onEdit({ enabled: e.target.checked })} title={l.enabled ? 'Enabled: untick to leave it out of scanning' : 'Disabled: tick to scan it'} />
    </div>
  );
}

function General({ prog, onChange }: { prog: Programming; onChange: (p: Programming) => void }) {
  const g = prog.globals;
  const named = prog.scanlists.filter((l) => l.name && !/^Scanlist \d{3}$/.test(l.name));
  const [setAnchor, setSetAnchor] = useState<{ rect: DOMRect; number: number } | null>(null);
  const welcome = [0, 1, 2, 3, 4].map((i) => g.welcome[i] ?? '');
  return (
    <div className="grid h-full grid-cols-[22rem_minmax(0,1fr)] gap-4 overflow-auto p-4 text-sm text-ink-2">
      <div className="space-y-4">
        <section>
          <h3 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-ink-2">Welcome text</h3>
          <div className="lcd-screen lcd-radio rounded-lg bg-lcd font-mono leading-[1.35] text-lcd-ink">
            {welcome.map((l, i) => (
              <input
                key={i}
                className="lcd-line block w-full bg-transparent text-center text-lcd-ink outline-none placeholder:text-lcd-ink/40 focus:bg-lcd-ink/10"
                maxLength={NAME_MAX}
                value={l}
                placeholder={i === 0 ? 'line 1' : ''}
                onChange={(e) => onChange({ ...prog, globals: { ...g, welcome: welcome.map((w, j) => (j === i ? e.target.value : w)) } })}
                title="Shown at power-on, centred, up to 16 characters"
              />
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
                    <td className="py-0.5 pr-2 text-ink">
                      <TextCell value={s.name} maxLength={NAME_MAX} onCommit={(name) => onChange({ ...prog, scanSets: prog.scanSets.map((x) => (x.number === s.number ? { ...x, name } : x)) })} />
                    </td>
                    <td className="py-0.5 pr-2">
                      <input type="checkbox" className="accent-green" checked={s.enabled} onChange={(e) => onChange({ ...prog, scanSets: prog.scanSets.map((x) => (x.number === s.number ? { ...x, enabled: e.target.checked } : x)) })} title="Enabled" />
                    </td>
                    <td className="py-0.5">
                      <button type="button" className="rounded border border-transparent px-1 text-left font-mono text-[11px] hover:border-edge" onClick={(e) => setSetAnchor({ rect: e.currentTarget.getBoundingClientRect(), number: s.number })} title="The scanlists in this set">
                        {s.scanlists.length > 24 ? `${s.scanlists.length} lists` : s.scanlists.join(', ') || <span className="text-ink-3">none</span>}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {setAnchor && (
            <Popover anchor={setAnchor.rect} onClose={() => setSetAnchor(null)} width={360}>
              <ScanlistPicker value={prog.scanSets.find((s) => s.number === setAnchor.number)?.scanlists ?? []} named={named} onCommit={(scanlists) => onChange({ ...prog, scanSets: prog.scanSets.map((x) => (x.number === setAnchor.number ? { ...x, scanlists } : x)) })} onClose={() => setSetAnchor(null)} />
            </Popover>
          )}
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
              <th className="py-1">Objects</th>
            </tr>
          </thead>
          <tbody>
            {prog.scanlists
              .filter((l) => l.objects.length || !/^Scanlist \d{3}$/.test(l.name))
              .map((l) => (
                <tr key={l.number} className="border-b border-edge/60">
                  <td className="py-0.5 pr-2 font-mono text-[11px] text-ink-3">{String(l.number).padStart(2, '0')}</td>
                  <td className="py-0.5 pr-2 text-ink">
                    <TextCell value={l.name} maxLength={NAME_MAX} onCommit={(name) => onChange({ ...prog, scanlists: prog.scanlists.map((x) => (x.number === l.number ? { ...x, name } : x)) })} />
                  </td>
                  <td className="py-0.5 pr-2">
                    <input type="checkbox" className="accent-green" checked={l.enabled} onChange={(e) => onChange({ ...prog, scanlists: prog.scanlists.map((x) => (x.number === l.number ? { ...x, enabled: e.target.checked } : x)) })} />
                  </td>
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
      <p className="text-[11px] text-ink-3">Trunked systems are shown as read; they are not edited here.</p>
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
