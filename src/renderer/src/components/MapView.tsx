import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LookupId } from '../../../shared/sources';
import { formatPlace, type Units } from '../../../shared/geo';
import { SOURCE_NAME } from '../lib/sources';

/** One pin: a candidate (or the row's own placed identity) with a position. */
export interface MapPoint {
  key: string;
  source: LookupId | 'CONF' | 'SCAN';
  name: string;
  detail: string;
  lat: number;
  lon: number;
  distanceKm: number | null;
  bearingDeg: number | null;
  /** Its tone / colour code matched the one the scanner detected. */
  match?: boolean;
  /** Log view: how many entries stand at this placement; shown on the pin in place of the source. */
  count?: number;
  /** Log view: the entries themselves, one line each, for the card. */
  lines?: string[];
  /** Overrides the source's standard note on the card. */
  note?: string;
}

export interface MapViewProps {
  /** The user's location from the Data dialog; null when not set. */
  user: { lat: number; lon: number } | null;
  points: MapPoint[];
  /** The pin the line is drawn to: the identity the log chose, or the one the user clicked. */
  chosenKey: string | null;
  units: Units;
  onPick: (key: string) => void;
  /** Fires with true when tiles stop loading (offline, or the tile server refusing), false when they load again. */
  onTiles: (failing: boolean) => void;
  /** Bumped by the keyboard: 'fit' zooms to every pin and the user, 'home' centres on the user. */
  command: { n: number; what: 'fit' | 'home' } | null;
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const HOME_ZOOM = 11;

/** What a pin from each register actually marks, for the card; the WTR one is the important caveat. */
const PIN_MEANING: Record<MapPoint['source'], string> = {
  WTR: 'Ofcom licence holder. The transmitter may be elsewhere: a reseller\'s licence often covers its customers\' sites.',
  RRUK: 'RadioReference UK listing.',
  RRDB: 'RadioReference site, or the system\'s centre when the site has no position.',
  UKR: 'Repeater site from the RSGB list.',
  CONF: 'Confirmed by you.',
  SCAN: 'The scanner\'s own object, placed by the lookup that identified it.',
};

const PIN_TITLE: Partial<Record<MapPoint['source'], string>> = { SCAN: 'Scanner object', CONF: 'Confirmed by you' };

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

function pinIcon(source: MapPoint['source'], chosen: boolean, count?: number): L.DivIcon {
  const label = count === undefined ? esc(source) : count > 999 ? '999+' : String(count);
  return L.divIcon({
    className: '',
    html: `<span class="map-pin map-pin-${source.toLowerCase()}${chosen ? ' map-pin-chosen' : ''}${count === undefined ? '' : ' map-pin-count'}"><span class="map-pin-label">${label}</span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

const homeIcon = L.divIcon({ className: '', html: '<span class="map-home" title="You"></span>', iconSize: [18, 18], iconAnchor: [9, 9] });

function card(p: MapPoint, units: Units): string {
  const where = formatPlace(p, units);
  return `<div class="map-card">
    <div class="map-card-name">${esc(p.name)}</div>
    ${p.detail ? `<div class="map-card-detail">${esc(p.detail)}</div>` : ''}
    <div class="map-card-src"><b>${esc(PIN_TITLE[p.source] ?? SOURCE_NAME[p.source as LookupId] ?? p.source)}</b>${where ? ` · ${esc(where)} from you` : ''}${p.match ? ' · tone matches' : ''}</div>
    ${p.lines ? `<ul class="map-card-lines">${p.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
    <div class="map-card-note">${esc(p.note ?? PIN_MEANING[p.source])}</div>
  </div>`;
}

/**
 * The Leaflet map: OpenStreetMap tiles, a dot for the user, a pin per candidate coloured by source,
 * and a line to the chosen one carrying its distance and bearing. Imperative Leaflet behind a React
 * shell; the effects below only touch what changed, so the map neither flickers nor re-fits on every
 * poll.
 */
export default function MapView({ user, points, chosenKey, units, onPick, onTiles, command }: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const line = useRef<L.Polyline | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const fittedKeys = useRef('');
  const failures = useRef(0);

  // Build the map once.
  useEffect(() => {
    if (!host.current || map.current) return;
    const m = L.map(host.current, { zoomControl: true, keyboard: true, attributionControl: true });
    m.setView(user ? [user.lat, user.lon] : [54.5, -2.5], user ? HOME_ZOOM : 5);
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION, crossOrigin: true });
    tiles.on('tileerror', () => {
      failures.current += 1;
      if (failures.current >= 3) onTiles(true);
    });
    tiles.on('load', () => {
      failures.current = 0;
      onTiles(false);
    });
    tiles.addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // Attribution links must not navigate the window; main hands them to the system browser. Only links
    // written as absolute URLs: Leaflet's own controls are anchors too (the popup's × is href="#close"),
    // and a resolved `a.href` would match them whenever the page itself is served over http (the dev build).
    host.current.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('a');
      const href = a?.getAttribute('href') ?? '';
      if (a && /^https?:\/\//i.test(href)) {
        e.preventDefault();
        window.open(a.href);
      }
    });
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins: rebuilt only when the set of points changes, so clicking one (which changes the chosen pin)
  // never discards the popup that click is opening.
  useEffect(() => {
    const m = map.current;
    const lg = layer.current;
    if (!m || !lg) return;
    lg.clearLayers();
    markers.current.clear();
    line.current = null;
    if (user) L.marker([user.lat, user.lon], { icon: homeIcon, zIndexOffset: 1000, keyboard: false }).bindTooltip('You', { direction: 'top', offset: [0, -8] }).addTo(lg);
    for (const p of points) {
      const mk = L.marker([p.lat, p.lon], { icon: pinIcon(p.source, false, p.count), title: p.count === undefined ? p.name : `${p.name} · ${p.count} ${p.count === 1 ? 'entry' : 'entries'}` });
      mk.bindPopup(card(p, units), { maxWidth: 340 });
      mk.on('click', () => onPick(p.key));
      mk.addTo(lg);
      markers.current.set(p.key, mk);
    }
    // Fit once per distinct set of pins, so a new frequency brings everything into view but a
    // repeated poll does not fight the user's own panning and zooming.
    const keys = points
      .map((p) => p.key)
      .sort()
      .join('|');
    if (keys !== fittedKeys.current) {
      fittedKeys.current = keys;
      fit(m, user, points);
    }
  }, [user, points, units, onPick]);

  // The chosen pin and the line to it: icons swapped in place, the line redrawn.
  useEffect(() => {
    const lg = layer.current;
    if (!lg) return;
    for (const p of points) {
      const mk = markers.current.get(p.key);
      if (!mk) continue;
      const chosen = p.key === chosenKey;
      mk.setIcon(pinIcon(p.source, chosen, p.count));
      mk.setZIndexOffset(chosen ? 500 : 0);
    }
    if (line.current) {
      line.current.remove();
      line.current = null;
    }
    const chosen = points.find((p) => p.key === chosenKey);
    if (user && chosen) {
      const pl = L.polyline(
        [
          [user.lat, user.lon],
          [chosen.lat, chosen.lon],
        ],
        { className: 'map-line', weight: 2, opacity: 0.9, dashArray: '6 6', interactive: false },
      );
      const where = formatPlace(chosen, units);
      if (where) pl.bindTooltip(where, { permanent: true, direction: 'center', className: 'map-line-label' });
      pl.addTo(lg);
      line.current = pl;
    }
  }, [user, points, chosenKey, units]);

  // Keyboard commands from the shell.
  useEffect(() => {
    const m = map.current;
    if (!m || !command) return;
    if (command.what === 'fit') fit(m, user, points);
    else if (user) m.setView([user.lat, user.lon], HOME_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command]);

  return <div ref={host} className="map-host h-full w-full" tabIndex={0} />;
}

function fit(m: L.Map, user: { lat: number; lon: number } | null, points: MapPoint[]): void {
  const all: L.LatLngTuple[] = points.map((p) => [p.lat, p.lon]);
  if (user) all.push([user.lat, user.lon]);
  if (all.length === 0) return;
  if (all.length === 1) {
    m.setView(all[0]!, HOME_ZOOM);
    return;
  }
  m.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 14 });
}
