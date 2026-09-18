/**
 * RadioReference UK (radioreferenceuk.co.uk) REST client: one GET per frequency, JSON back.
 * The search is Ofcom-backed and geographic: the server filters by the user's postcode or
 * coordinates and a range in miles (nationwide and aero frequencies bypass the range), with a
 * ±5 kHz tolerance around the frequency. The API key is the user's own, generated in their
 * RRUK dashboard; it is never logged.
 */
import type { RrukEntry } from '../../shared/ipc';
import { KM_PER_MILE } from '../../shared/geo';

export const RRUK_ENDPOINT = 'https://radioreferenceuk.co.uk/api_search.php';
export const RRUK_SITE = 'https://radioreferenceuk.co.uk/';
/** The server's own maximum; sent as the default so the range is explicit. */
export const RRUK_MAX_RANGE_MILES = 50;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class RrukError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'RrukError';
  }
}

export interface RrukQuery {
  apiKey: string;
  freqMHz: number;
  /** Either a postcode (full or outward) or coordinates; the postcode wins when both are given. */
  postcode?: string;
  lat?: number | null;
  lon?: number | null;
  /** Miles; capped at the server's maximum. */
  rangeMiles?: number | null;
}

export interface RrukResult {
  /** The account the key belongs to, as the server reports it. */
  user: string;
  entries: RrukEntry[];
}

/** The request URL for a query, key included (so never log it). */
export function rrukUrl(q: RrukQuery): string {
  const p = new URLSearchParams();
  p.set('api_key', q.apiKey);
  p.set('freq', q.freqMHz.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''));
  if (q.postcode) p.set('postcode', q.postcode);
  else if (q.lat != null && q.lon != null) {
    p.set('lat', q.lat.toFixed(5));
    p.set('lon', q.lon.toFixed(5));
  }
  const range = q.rangeMiles != null && q.rangeMiles > 0 ? Math.min(q.rangeMiles, RRUK_MAX_RANGE_MILES) : RRUK_MAX_RANGE_MILES;
  p.set('range', String(Math.round(range)));
  return `${RRUK_ENDPOINT}?${p.toString()}`;
}

export async function searchRruk(q: RrukQuery, fetchImpl: FetchLike = fetch): Promise<RrukResult> {
  let res: Response;
  try {
    res = await fetchImpl(rrukUrl(q), { method: 'GET', headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new RrukError(`RRUK unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (res.status === 401 || res.status === 403) throw new RrukError('RRUK rejected the API key', res.status);
    throw new RrukError(`RRUK answered HTTP ${res.status} with no JSON`, res.status);
  }
  return parseRrukResponse(json, res.status);
}

/** The response body to entries; throws RrukError on a refusal. */
export function parseRrukResponse(json: unknown, status = 200): RrukResult {
  const o = (typeof json === 'object' && json !== null ? json : {}) as Record<string, unknown>;
  if (o['success'] !== true) {
    const msg = text(o['error']) || text(o['message']) || (status === 401 || status === 403 ? 'RRUK rejected the API key' : `RRUK refused the request (HTTP ${status})`);
    throw new RrukError(msg, status);
  }
  const data = Array.isArray(o['data']) ? o['data'] : [];
  return { user: text(o['user']), entries: data.map(toEntry).filter((e): e is RrukEntry => e !== null) };
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function toEntry(v: unknown): RrukEntry | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  const freq = Number(o['freq']);
  const dist = o['distance'];
  // Nationwide (PMR446, aero, …): the server says so in the distance, the location, or both.
  const nationwide = (typeof dist === 'string' && /nationwide/i.test(dist)) || /^\s*nationwide\s*$/i.test(text(o['location']));
  const miles = typeof dist === 'number' ? dist : typeof dist === 'string' && /^\s*[\d.]+/.test(dist) ? parseFloat(dist) : NaN;
  const alpha = text(o['alpha']);
  // Live answers put the Ofcom licence number in `callsign` ("1383591/1") with the licensee in `alpha`;
  // a nationwide entry has a real callsign there ("PMR446"). A licence-shaped one is kept as the licence.
  const rawCallsign = text(o['callsign']);
  const licenceShaped = /^\d{3,}(\/\d+)?$/.test(rawCallsign);
  const callsign = licenceShaped ? '' : rawCallsign;
  if (!alpha && !callsign) return null;
  const tone = text(o['tone']);
  const colorCode = text(o['colorCode']);
  const ran = text(o['ran']);
  const nac = text(o['nac']);
  const cls = text(o['class']).toUpperCase();
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const lat = num(o['lat']);
  const lon = num(o['lon'] ?? o['long'] ?? o['lng']);
  const bearing = num(o['bearing']);
  return {
    callsign,
    alpha,
    freqMHz: Number.isFinite(freq) ? freq : 0,
    mode: text(o['mode']),
    tone,
    colorCode,
    ran,
    nac,
    code: rrukCode({ tone, colorCode, ran, nac }),
    // The TX/RX flag as the WTR has it: T base transmits here, R base receives (mobiles transmit).
    direction: cls === 'T' || cls === 'R' || cls === 'TR' ? cls : '',
    location: text(o['location']),
    nationwide,
    distanceKm: nationwide || !Number.isFinite(miles) ? null : miles * KM_PER_MILE,
    bearingDeg: bearing === null ? null : ((Math.round(bearing) % 360) + 360) % 360,
    lat: lat !== null && lat !== 0 && Math.abs(lat) <= 90 ? lat : null,
    lon: lon !== null && lat !== null && lat !== 0 && Math.abs(lon) <= 180 ? lon : null,
    place: text(o['place'] ?? o['town'] ?? o['location_name']),
    county: text(o['county']),
    postcode: text(o['postcode']),
    licence: text(o['licence'] ?? o['license']) || (licenceShaped ? rawCallsign : ''),
    group: text(o['group']) || (/^[A-Z0-9 ]{2,12}$/.test(text(o['tags'])) ? text(o['tags']) : ''),
    tags: text(o['tags']),
    isTrunk: o['is_trunk'] === true,
  };
}

/**
 * The entry's code in the form the scanner's detected code takes ("CC 12", "CTCSS 94.8",
 * "DCS 023", "NAC 293", "RAN 1"), so `rrToneMatches` can compare them; '' when it has none.
 */
export function rrukCode(e: { tone: string; colorCode: string; ran: string; nac: string }): string {
  if (e.nac) return `NAC ${e.nac.replace(/^\$/, '')}`;
  if (e.colorCode) return `CC ${e.colorCode.replace(/^CC\s*/i, '')}`;
  if (e.ran) return `RAN ${e.ran.replace(/^RAN\s*/i, '')}`;
  const t = e.tone;
  if (!t) return '';
  if (/^\d+(\.\d+)?$/.test(t)) return `CTCSS ${t}`;
  if (/^D?\d{3}[NI]?$/i.test(t)) return `DCS ${t.replace(/^D/i, '').replace(/[NI]$/i, '')}`;
  return t;
}
