import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DayLog, MapTarget, ReceptionRow } from '../../../shared/ipc';
import { candidatesFor } from '../../../shared/listed';
import { normaliseUnits, point } from '../../../shared/geo';
import { activeIn, dayKey, dayPins, dayRange, shiftDay } from '../../../shared/dayMap';
import { attachLogEvents, rowMatches, useLog } from '../store/log';
import { attachScannerEvents, useScanner } from '../store/scanner';
import { useIdentities } from '../store/identities';
import { initTheme } from '../store/theme';
import MapView, { type MapPoint } from './MapView';

const EMPTY_DAY: DayLog = { rows: [], total: 0, truncated: false };
/** Entries listed on a log-view pin's card before "and N more". */
const CARD_LINES = 12;
const PIN_SOURCES = new Set<MapPoint['source']>(['WTR', 'RRUK', 'RRDB', 'UKR', 'CONF']);
const pinSource = (source: string): MapPoint['source'] => (PIN_SOURCES.has(source as MapPoint['source']) ? (source as MapPoint['source']) : 'SCAN');
const dayBtn = 'no-drag rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink disabled:opacity-40 disabled:hover:text-ink-3';
const hhmm = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** Within about a metre: the same place, whatever rounding the two sources applied. */
const samePoint = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;

/**
 * The map window (`#map` route): you and every candidate for a frequency pinned on OpenStreetMap,
 * with a line to the identity the log chose. Follows the scanner by default, taking the log's newest
 * entry on the current frequency (the log is the one place that knows which candidate won); a log
 * row's map button pins it to that entry instead. The Log view (L, or the log's Map button) shows one
 * day of the log instead: every placed entry, one pin per placement carrying its entry count, filtered
 * as the log is.
 */
export default function MapApp() {
  const [target, setTarget] = useState<MapTarget>({ kind: 'follow' });
  const [picked, setPicked] = useState<string | null>(null);
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [dayFilter, setDayFilter] = useState('');
  const [dayLog, setDayLog] = useState<DayLog>(EMPTY_DAY);
  const [dayLoading, setDayLoading] = useState(false);
  const [tilesFailing, setTilesFailing] = useState(false);
  const [command, setCommand] = useState<{ n: number; what: 'fit' | 'home' } | null>(null);
  const [docked, setDocked] = useState<'left' | 'right' | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const snapshot = useScanner((s) => s.snapshot);
  const rows = useLog((s) => s.rows);
  const generation = useLog((s) => s.generation);
  const settings = useIdentities((s) => s.settings);
  const units = normaliseUnits(settings.units);

  useEffect(() => {
    const offTheme = initTheme();
    const offScanner = attachScannerEvents();
    const offLog = attachLogEvents();
    void useIdentities.getState().refresh();
    const offTarget = window.trx?.onMapTarget
      ? window.trx.onMapTarget((t) => {
          setTarget(t);
          setPicked(t.kind === 'row' && t.pick !== undefined ? `c${t.pick}` : null);
          if (t.kind === 'day') {
            setDay(t.day ?? dayKey(new Date()));
            setDayFilter(t.filter ?? '');
          }
        })
      : () => undefined;
    const offDock = window.trx?.onMapDock ? window.trx.onMapDock((s) => setDocked(s.docked)) : () => undefined;
    return () => {
      offDock();
      offTarget();
      offLog();
      offScanner();
      offTheme();
    };
  }, []);

  // F, or the Following button: following → hold the entry on show (nothing to hold before anything is
  // logged on the frequency); held → follow the scanner again.
  const rowRef = useRef<ReceptionRow | null>(null);
  const toggleFollow = useCallback(() => {
    setTarget((t) => {
      if (t.kind !== 'follow') return { kind: 'follow' };
      return rowRef.current ? { kind: 'row', row: rowRef.current } : t;
    });
    setPicked(null);
  }, []);

  // L, or the Log / Live buttons: the day view of the log, or back to following the scanner.
  const toggleDayView = useCallback(() => {
    setTarget((t) => (t.kind === 'day' ? { kind: 'follow' } : { kind: 'day' }));
    setPicked(null);
  }, []);
  const today = dayKey(new Date());
  const stepDay = useCallback((n: number) => {
    setDay((d) => {
      const next = shiftDay(d, n);
      return next > dayKey(new Date()) ? d : next;
    });
    setPicked(null);
  }, []);

  const toggleDock = useCallback(() => {
    const p = window.trx?.mapDock?.(docked ? 'off' : 'auto');
    if (p) void p.then((s) => setDocked(s.docked));
  }, [docked]);
  const dayView = target.kind === 'day';

  // Keyboard: + / - and the arrows are Leaflet's own once the map has focus; these work anywhere in the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') {
        // Esc in the date or filter box hands the keys back to the map.
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Escape') {
        setHelpOpen(false);
        return;
      }
      if (e.key === '?') {
        setHelpOpen((v) => !v);
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'a') setCommand({ n: Date.now(), what: 'fit' });
      else if (k === 'z' || k === 'h') setCommand({ n: Date.now(), what: 'home' });
      else if (k === 'f') toggleFollow();
      else if (k === 'd') toggleDock();
      else if (k === 'l') toggleDayView();
      else if (e.key === '[' || e.key === ']') {
        if (dayView) stepDay(e.key === '[' ? -1 : 1);
        else return;
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDock, toggleFollow, toggleDayView, stepDay, dayView]);

  // The day's entries from the database, fetched once per day chosen (and again when the log changed
  // wholesale: cleared, or renamed by a confirmation); today's then follow the log live (the store's rows,
  // which arrive over log:upsert, are overlaid below).
  useEffect(() => {
    if (!dayView) return;
    let stale = false;
    const { from, to } = dayRange(day);
    setDayLoading(true);
    const p = window.trx?.logDay?.(from, to) ?? Promise.resolve(EMPTY_DAY);
    p.then((d) => {
      if (stale) return;
      setDayLog(d);
      setDayLoading(false);
    }).catch(() => {
      if (stale) return;
      setDayLog(EMPTY_DAY);
      setDayLoading(false);
    });
    return () => {
      stale = true;
    };
  }, [dayView, day, generation]);

  const userLat = settings.lat;
  const userLon = settings.lon;
  const user = useMemo(() => (userLat !== null && userLon !== null ? { lat: userLat, lon: userLon } : null), [userLat, userLon]);
  const hz = snapshot.status?.frequencyHz ?? null;

  // The entry on show: the pinned row, else the log's newest entry on the scanner's frequency.
  const row: ReceptionRow | null = useMemo(() => {
    if (target.kind === 'day') return null;
    if (target.kind === 'row') return rows.find((r) => r.id === target.row.id) ?? target.row;
    if (hz === null) return null;
    return rows.find((r) => r.frequencyHz === hz) ?? null;
  }, [target, rows, hz]);
  if (!dayView) rowRef.current = row;

  // The day's entries: what the database returned, with the log's live rows laid over it (a new entry
  // today, a name arriving a poll later, a confirmation renaming rows), then the filter.
  const dayRows = useMemo(() => {
    if (!dayView) return [];
    const { from, to } = dayRange(day);
    const now = Date.now();
    const byId = new Map(dayLog.rows.map((r) => [r.id, r]));
    for (const r of rows) if (activeIn(r, from, to, now)) byId.set(r.id, r);
    return [...byId.values()];
  }, [dayView, day, dayLog, rows]);
  const dayShown = useMemo(() => dayRows.filter((r) => rowMatches(r, dayFilter)), [dayRows, dayFilter]);
  const dayPlaced = useMemo(() => dayShown.filter((r) => point(r.lat, r.lon) !== null).length, [dayShown]);

  // Pins: the row's candidates (they carry their own position), else, before anything is logged on the
  // frequency, whatever the lookups offer right now. In the Log view, one pin per placement for the day.
  const rawPoints: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = [];
    if (dayView) {
      for (const pin of dayPins(dayShown)) {
        const n = pin.rows.length;
        const lines = pin.rows.slice(0, CARD_LINES).map((r) => `${hhmm(r.startedAt)}  ${(r.frequencyHz / 1e6).toFixed(4)}  ${r.name || r.licensee || ''}`.trimEnd());
        if (n > CARD_LINES) lines.push(`and ${n - CARD_LINES} more`);
        out.push({
          key: pin.key,
          source: pinSource(pin.source),
          name: pin.name,
          detail: `${n} ${n === 1 ? 'entry' : 'entries'}${pin.frequencies > 1 ? ` on ${pin.frequencies} frequencies` : ''}`,
          lat: pin.lat,
          lon: pin.lon,
          distanceKm: pin.distanceKm,
          bearingDeg: pin.bearingDeg,
          count: n,
          lines,
          note: 'Every entry the log placed here that day. The colour is the source behind the newest name; a WTR pin is still the licence holder, not necessarily the transmitter.',
        });
      }
      return out;
    }
    const seen = new Set<string>();
    const add = (p: MapPoint): void => {
      const k = `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.name}`;
      if (seen.has(k)) return;
      seen.add(k);
      out.push(p);
    };
    const list = row
      ? row.candidates
      : candidatesFor({ rr: snapshot.rr, rruk: snapshot.rruk, licences: snapshot.licences, repeaters: snapshot.repeaters, detectedTone: null }, snapshot.lookups);
    list.forEach((c, i) => {
      const at = point(c.lat, c.lon);
      if (!at) return;
      add({ key: `c${i}`, source: c.source, name: c.name, detail: c.detail, ...at, distanceKm: c.distanceKm, bearingDeg: c.bearingDeg, ...(c.match === undefined ? {} : { match: c.match }) });
    });
    // A confirmed or otherwise placed identity that no candidate carries gets its own pin.
    // `!= null` on purpose: rows from before the columns existed (and the preview mock) carry undefined, not null.
    // The row's own point gets a pin only when no candidate already stands there: a scanner-named row is
    // placed by the lookup that identified it, so that candidate's pin is the row's. A pin of its own is a
    // confirmation (CONF), a lookup's placement that no longer appears in the list, or the scanner's object.
    const own = row ? point(row.lat, row.lon) : null;
    if (row && own && row.name && !out.some((p) => samePoint(p, own))) {
      const source: MapPoint['source'] = row.source === 'CONF' ? 'CONF' : row.source === 'RRDB' || row.source === 'RRUK' || row.source === 'WTR' || row.source === 'UKR' ? row.source : 'SCAN';
      add({ key: 'row', source, name: row.name, detail: row.system, ...own, distanceKm: row.distanceKm, bearingDeg: row.bearingDeg });
    }
    return out;
  }, [row, snapshot, dayView, dayShown]);
  // The snapshot changes several times a second; the pins must only change when their content does, or
  // the map would rebuild them on every poll and lose the popup the user is opening.
  const pointsKey = JSON.stringify(rawPoints);
  const stable = useRef<{ key: string; points: MapPoint[] }>({ key: '', points: [] });
  if (stable.current.key !== pointsKey) stable.current = { key: pointsKey, points: rawPoints };
  const points = stable.current.points;

  // The line goes to the pin the user clicked, else the identity the log chose for the entry (by name, else the
  // candidate standing on the row's own point, which is how a scanner-named row was placed), else the top candidate.
  const chosenKey = useMemo(() => {
    if (picked && points.some((p) => p.key === picked)) return picked;
    if (dayView) return null;
    if (row) {
      const byName = points.find((p) => p.name === row.name && (p.source === row.source || row.source === 'CONF' || row.source === ''));
      if (byName) return byName.key;
      const at = point(row.lat, row.lon);
      const byPoint = at ? points.find((p) => samePoint(p, at)) : undefined;
      if (byPoint) return byPoint.key;
      const own = points.find((p) => p.key === 'row');
      if (own) return own.key;
    }
    return points[0]?.key ?? null;
  }, [picked, points, row, dayView]);

  const onPick = useCallback((key: string) => setPicked(key), []);
  const onTiles = useCallback((failing: boolean) => setTilesFailing(failing), []);

  const mhz = row ? row.frequencyHz / 1e6 : hz !== null ? hz / 1e6 : null;
  const title = row ? row.name || row.licensee || 'Unnamed' : hz !== null ? 'Nothing logged here yet' : 'No scanner';
  const when = target.kind === 'row' ? new Date(target.row.startedAt).toLocaleString() : null;

  return (
    <div className="flex h-full flex-col">
      <header
        className="app-drag flex h-[46px] shrink-0 items-center gap-3 border-b border-edge bg-panel px-4 text-sm"
        style={
          window.trx?.platform === 'darwin'
            ? { paddingLeft: '84px' }
            : window.trx?.platform === 'linux'
              ? undefined
              : { paddingRight: 'calc(100vw - env(titlebar-area-width, 100vw) + 12px)' }
        }
      >
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">Map</span>
        {dayView ? (
          <>
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan">Log</span>
            <button type="button" className={`${dayBtn} px-1.5`} title="The day before ([)" onClick={() => stepDay(-1)} aria-label="Previous day">
              ◀
            </button>
            <input
              type="date"
              className="no-drag rounded-md border border-edge bg-panel-2 px-2 py-0.5 font-mono text-[12px] text-ink outline-none focus:border-cyan"
              value={day}
              max={today}
              onChange={(e) => {
                if (e.target.value && e.target.value <= today) {
                  setDay(e.target.value);
                  setPicked(null);
                }
              }}
              aria-label="Day"
            />
            <button type="button" className={`${dayBtn} px-1.5`} title="The day after (])" onClick={() => stepDay(1)} disabled={day >= today} aria-label="Next day">
              ▶
            </button>
            <input
              className="no-drag w-44 min-w-0 rounded-md border border-edge bg-panel-2 px-2 py-0.5 text-[12px] text-ink placeholder:text-ink-3 outline-none focus:border-cyan"
              placeholder="Filter (name, frequency…)"
              value={dayFilter}
              onChange={(e) => {
                setDayFilter(e.target.value);
                setPicked(null);
              }}
              aria-label="Filter"
            />
            <span className="min-w-0 truncate text-[11px] text-ink-3" title={dayLog.truncated ? 'More entries than the map loads for one day: the counts are of the newest 5000.' : undefined}>
              {dayLoading
                ? 'Loading…'
                : `${dayShown.length} ${dayShown.length === 1 ? 'entry' : 'entries'}${dayFilter.trim() ? ` of ${dayLog.total}` : ''} · ${dayPlaced} placed at ${points.length} ${points.length === 1 ? 'point' : 'points'}${dayLog.truncated ? ' · newest 5000' : ''}`}
            </span>
          </>
        ) : (
          <>
            {mhz !== null && <span className="font-mono text-base text-amber">{mhz.toFixed(4)}</span>}
            <span className="min-w-0 truncate text-ink">{title}</span>
            {row?.system && <span className="min-w-0 truncate text-ink-3">{row.system}</span>}
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          {dayView ? (
            <button type="button" className={dayBtn} title="Back to the scanner: the pins follow the frequency again (L)" onClick={toggleDayView}>
              Live
            </button>
          ) : target.kind === 'row' ? (
            <>
              <span className="text-[11px] text-ink-3" title="Held on one log entry">{when}</span>
              <button
                type="button"
                className="no-drag rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink"
                title="Follow the scanner again (F)"
                onClick={toggleFollow}
              >
                Follow
              </button>
            </>
          ) : (
            <button
              type="button"
              className="no-drag rounded-md border border-green/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-green hover:bg-panel-2"
              title={row ? 'Following the scanner: the pins change with the frequency. Click (or F) to hold this entry.' : 'Following the scanner: the pins change with the frequency.'}
              onClick={toggleFollow}
            >
              Following
            </button>
          )}
          {!dayView && (
            <button type="button" className={dayBtn} title="One day of the log on the map: every placed entry, with a count on each pin (L)" onClick={toggleDayView}>
              Log
            </button>
          )}
          <button
            type="button"
            className={`no-drag rounded-md border px-2 py-1 text-[11px] ${docked ? 'border-cyan/60 text-cyan' : 'border-edge text-ink-3 hover:text-ink'}`}
            title={docked ? `Docked to the ${docked} of the main window; click (or D) to set it free` : 'Dock beside the main window and follow it (D)'}
            onClick={toggleDock}
          >
            {docked ? 'Undock' : 'Dock'}
          </button>
          <button
            type="button"
            className="no-drag flex h-7 w-7 items-center justify-center rounded-md border border-edge text-sm font-semibold text-ink-2 hover:bg-panel-2 hover:text-ink"
            onClick={() => setHelpOpen((v) => !v)}
            title="Help: keys and what the pins mean (?)"
            aria-label="Map help"
          >
            ?
          </button>
        </span>
      </header>
      <div className="relative min-h-0 flex-1">
        <MapView user={user} points={points} chosenKey={chosenKey} units={units} onPick={onPick} onTiles={onTiles} command={command} />
        {tilesFailing && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-[1000] mx-auto w-max max-w-[90%] rounded-md border border-amber/60 bg-panel/95 px-3 py-1.5 text-center text-xs text-amber">
            Map tiles are not loading. The map needs an internet connection to OpenStreetMap; the pins still show where things are relative to you.
          </div>
        )}
        {!user && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[1000] mx-auto w-max max-w-[90%] rounded-md border border-edge bg-panel/95 px-3 py-1.5 text-center text-xs text-ink-2">
            Set your location in the Data dialog to see yourself on the map and the line to each site.
          </div>
        )}
        {helpOpen && (
          <div
            className="no-drag absolute inset-0 z-[1100] flex items-start justify-end bg-bg/40 p-3"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setHelpOpen(false);
            }}
            role="presentation"
          >
            <div role="dialog" aria-label="Map help" className="w-80 max-w-full rounded-xl border border-edge bg-panel p-4 text-sm text-ink-2 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-ink-2">Map keys</span>
                <button type="button" className="text-ink-3 hover:text-ink" onClick={() => setHelpOpen(false)} aria-label="Close" title="Close (Esc)">
                  ×
                </button>
              </div>
              <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
                {(
                  [
                    ['+ / −', 'Zoom in and out (scroll wheel too)'],
                    ['Arrows', 'Pan'],
                    ['A', 'Fit everything in: you and every pin'],
                    ['Z', 'Centre on your location'],
                    ['F', 'Hold the entry on show, or follow the scanner again'],
                    ['L', 'The Log view: one day of the log, a count on each pin; L again for the scanner'],
                    ['[ / ]', 'Log view: the day before / after'],
                    ['D', 'Dock beside the main window, or set it free'],
                    ['Click a pin', 'Its card, and the line moves to it'],
                    ['Esc', 'Close this'],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-mono text-[12px] text-ink">{k}</dt>
                    <dd className="text-[12px]">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-3 border-t border-edge pt-2 text-[11.5px] text-ink-3">
                <p>
                  <span className="map-legend map-pin-wtr" /> WTR is the Ofcom licence holder, often a reseller's address rather than the transmitter.{' '}
                  <span className="map-legend map-pin-rruk" /> RRUK and <span className="map-legend map-pin-rrdb" /> RRDB pins are the sites those databases list.{' '}
                  <span className="map-legend map-pin-ukr" /> UKR is the repeater itself. <span className="map-legend map-pin-scan" /> A grey pin is the scanner's own object where it was placed. <span className="map-legend map-pin-conf" /> CONF is one you confirmed. The larger pin is the one the log chose; the dashed line carries its distance and bearing.
                </p>
                <p className="mt-1.5">
                  In the Log view a pin's number is how many entries the log placed there that day, its colour the source behind the newest name, and its card lists them. Only entries with a position appear; the bar counts the rest.
                </p>
              </div>
            </div>
          </div>
        )}
        {points.length === 0 && !dayLoading && (
          <div className="pointer-events-none absolute inset-x-0 bottom-10 z-[1000] mx-auto w-max max-w-[90%] rounded-md border border-edge bg-panel/95 px-3 py-1.5 text-center text-xs text-ink-2">
            {dayView
              ? dayRows.length === 0
                ? dayLog.total > 0
                  ? `${dayLog.total} ${dayLog.total === 1 ? 'entry' : 'entries'} that day, none with a position (entries from before the map stored positions, or nothing placed them).`
                  : 'Nothing in the log for that day.'
                : dayShown.length === 0
                  ? 'Nothing matches the filter.'
                  : 'None of the entries shown has a position.'
              : row
                ? 'Nothing placed this entry: none of its candidates carries a position.'
                : 'No candidates to pin for this frequency yet.'}
          </div>
        )}
      </div>
    </div>
  );
}
