/**
 * Great-circle geometry and the distance units the user chose. Pure functions shared by
 * main (which places lookups relative to the user) and the renderer (which formats them).
 */

const R_KM = 6371;
const toRad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(a));
}

/** Initial bearing from the first point to the second, degrees clockwise from true north, 0-359. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round(deg + 360) % 360;
}

export interface Placement {
  distanceKm: number | null;
  bearingDeg: number | null;
}

/** Where a point lies relative to the user; both null when either side is unknown. */
export function placeFrom(here: { lat: number; lon: number } | null | undefined, lat: number | null | undefined, lon: number | null | undefined): Placement {
  if (!here || lat === null || lat === undefined || lon === null || lon === undefined) return { distanceKm: null, bearingDeg: null };
  return { distanceKm: distanceKm(here.lat, here.lon, lat, lon), bearingDeg: bearingDeg(here.lat, here.lon, lat, lon) };
}

/** How distances are shown; they are always stored in km. */
export type Units = 'km' | 'mi';

export const KM_PER_MILE = 1.609344;

export const normaliseUnits = (v: unknown): Units => (v === 'mi' ? 'mi' : 'km');

/** "6.7 km" / "4.2 mi" (one decimal under ten, whole numbers above); '' when unknown. */
export function formatDistance(km: number | null | undefined, units: Units = 'km'): string {
  if (km === null || km === undefined) return '';
  const d = units === 'mi' ? km / KM_PER_MILE : km;
  return `${d < 10 ? d.toFixed(1) : String(Math.round(d))} ${units}`;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Compass point for a bearing: "NE". */
export function compassPoint(deg: number): string {
  return POINTS[Math.round(deg / 45) % 8]!;
}

/** "047°"; '' when unknown. */
export function formatBearing(deg: number | null | undefined): string {
  return deg === null || deg === undefined ? '' : `${String(Math.round(deg) % 360).padStart(3, '0')}°`;
}

/** "6.7 km 047°", as the Listed block and the log's Dist column show a placement; '' when unplaced. */
export function formatPlace(p: Placement | null | undefined, units: Units = 'km'): string {
  if (!p || p.distanceKm === null) return '';
  return [formatDistance(p.distanceKm, units), formatBearing(p.bearingDeg)].filter(Boolean).join(' ');
}
