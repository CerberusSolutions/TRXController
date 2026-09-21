import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MapTarget, ReceptionRow } from '../../../shared/ipc';
import { candidatesFor } from '../../../shared/listed';
import { normaliseUnits } from '../../../shared/geo';
import { attachLogEvents, useLog } from '../store/log';
import { attachScannerEvents, useScanner } from '../store/scanner';
import { useIdentities } from '../store/identities';
import { initTheme } from '../store/theme';
import MapView, { type MapPoint } from './MapView';

/**
 * The map window (`#map` route): you and every candidate for a frequency pinned on OpenStreetMap,
 * with a line to the identity the log chose. Follows the scanner by default, taking the log's newest
 * entry on the current frequency (the log is the one place that knows which candidate won); a log
 * row's map button pins it to that entry instead.
 */
export default function MapApp() {
  const [target, setTarget] = useState<MapTarget>({ kind: 'follow' });
  const [picked, setPicked] = useState<string | null>(null);
  const [tilesFailing, setTilesFailing] = useState(false);
  const [command, setCommand] = useState<{ n: number; what: 'fit' | 'home' } | null>(null);
  const snapshot = useScanner((s) => s.snapshot);
  const rows = useLog((s) => s.rows);
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
          setPicked(null);
        })
      : () => undefined;
    return () => {
      offTarget();
      offLog();
      offScanner();
      offTheme();
    };
  }, []);

  // Keyboard: + / - and the arrows are Leaflet's own once the map has focus; these work anywhere in the window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === 'a') setCommand({ n: Date.now(), what: 'fit' });
      else if (k === 'z' || k === 'h') setCommand({ n: Date.now(), what: 'home' });
      else if (k === 'f') {
        setTarget({ kind: 'follow' });
        setPicked(null);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const userLat = settings.lat;
  const userLon = settings.lon;
  const user = useMemo(() => (userLat !== null && userLon !== null ? { lat: userLat, lon: userLon } : null), [userLat, userLon]);
  const hz = snapshot.status?.frequencyHz ?? null;

  // The entry on show: the pinned row, else the log's newest entry on the scanner's frequency.
  const row: ReceptionRow | null = useMemo(() => {
    if (target.kind === 'row') return rows.find((r) => r.id === target.row.id) ?? target.row;
    if (hz === null) return null;
    return rows.find((r) => r.frequencyHz === hz) ?? null;
  }, [target, rows, hz]);

  // Pins: the row's candidates (they carry their own position), else, before anything is logged on the
  // frequency, whatever the lookups offer right now.
  const rawPoints: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = [];
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
      if (c.lat === null || c.lon === null || c.lat === undefined || c.lon === undefined) return;
      add({ key: `c${i}`, source: c.source, name: c.name, detail: c.detail, lat: c.lat, lon: c.lon, distanceKm: c.distanceKm, bearingDeg: c.bearingDeg, ...(c.match === undefined ? {} : { match: c.match }) });
    });
    // A confirmed or otherwise placed identity that no candidate carries gets its own pin.
    if (row && row.lat !== null && row.lon !== null && row.name && !out.some((p) => p.name === row.name)) {
      add({ key: 'row', source: row.source === 'CONF' ? 'CONF' : row.source === 'RRDB' || row.source === 'RRUK' || row.source === 'WTR' || row.source === 'UKR' ? row.source : 'CONF', name: row.name, detail: row.system, lat: row.lat, lon: row.lon, distanceKm: row.distanceKm, bearingDeg: row.bearingDeg });
    }
    return out;
  }, [row, snapshot]);
  // The snapshot changes several times a second; the pins must only change when their content does, or
  // the map would rebuild them on every poll and lose the popup the user is opening.
  const pointsKey = JSON.stringify(rawPoints);
  const stable = useRef<{ key: string; points: MapPoint[] }>({ key: '', points: [] });
  if (stable.current.key !== pointsKey) stable.current = { key: pointsKey, points: rawPoints };
  const points = stable.current.points;

  // The line goes to the pin the user clicked, else the identity the log chose for the entry, else the top candidate.
  const chosenKey = useMemo(() => {
    if (picked && points.some((p) => p.key === picked)) return picked;
    if (row) {
      const byName = points.find((p) => p.name === row.name && (p.source === row.source || row.source === 'CONF' || row.source === ''));
      if (byName) return byName.key;
      const own = points.find((p) => p.key === 'row');
      if (own) return own.key;
    }
    return points[0]?.key ?? null;
  }, [picked, points, row]);

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
        {mhz !== null && <span className="font-mono text-base text-amber">{mhz.toFixed(4)}</span>}
        <span className="min-w-0 truncate text-ink">{title}</span>
        {row?.system && <span className="min-w-0 truncate text-ink-3">{row.system}</span>}
        <span className="ml-auto flex items-center gap-2">
          {target.kind === 'row' ? (
            <>
              <span className="text-[11px] text-ink-3" title="Pinned to one log entry">{when}</span>
              <button
                type="button"
                className="no-drag rounded-md border border-edge px-2 py-1 text-[11px] text-ink-3 hover:text-ink"
                title="Follow the scanner again (F)"
                onClick={() => {
                  setTarget({ kind: 'follow' });
                  setPicked(null);
                }}
              >
                Follow
              </button>
            </>
          ) : (
            <span className="rounded-md border border-green/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-green" title="Following the scanner: the pins change with the frequency">
              Following
            </span>
          )}
          <span className="hidden text-[11px] text-ink-3 lg:inline" title="Keyboard: + and − zoom, arrows pan, A fits everything in, Z centres on you, F follows the scanner">
            + − · arrows · A fit · Z home · F follow
          </span>
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
        {points.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-10 z-[1000] mx-auto w-max max-w-[90%] rounded-md border border-edge bg-panel/95 px-3 py-1.5 text-center text-xs text-ink-2">
            {row ? 'Nothing placed this entry: none of its candidates carries a position.' : 'No candidates to pin for this frequency yet.'}
          </div>
        )}
      </div>
    </div>
  );
}
