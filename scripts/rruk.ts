/**
 * Ask RadioReference UK about a frequency from the command line, with the key from RRUK_KEY:
 *   RRUK_KEY=… npm run rruk -- 453.4375 [lat lon | postcode] [rangeMiles]
 * Prints the parsed entries and the raw JSON; never the key.
 */
import { searchRruk, rrukUrl } from '../src/main/identities/rruk';

const key = (process.env['RRUK_KEY'] ?? '').trim();
if (!key) {
  console.error('Set RRUK_KEY in the environment first (your own key from the RRUK dashboard).');
  process.exit(2);
}
const [freqArg, a, b, c] = process.argv.slice(2);
const freqMHz = Number(freqArg ?? '446.00625');
if (!Number.isFinite(freqMHz)) {
  console.error('Usage: npm run rruk -- <MHz> [lat lon | postcode] [rangeMiles]');
  process.exit(2);
}
const q = a !== undefined && b !== undefined && Number.isFinite(Number(a)) && Number.isFinite(Number(b))
  ? { apiKey: key, freqMHz, lat: Number(a), lon: Number(b), rangeMiles: c !== undefined ? Number(c) : null }
  : { apiKey: key, freqMHz, postcode: a, rangeMiles: b !== undefined ? Number(b) : null };
console.log(`GET ${rrukUrl(q).replace(/api_key=[^&]*/, 'api_key=***')}`);
const res = await fetch(rrukUrl(q));
const text = await res.text();
console.log(`HTTP ${res.status}\n${text}\n`);
const r = await searchRruk(q, async () => ({ ok: res.ok, status: res.status, text: async () => text }) as unknown as Response);
console.log(`user: ${r.user}; ${r.entries.length} entries`);
for (const e of r.entries) {
  console.log(`  ${e.alpha || e.callsign}${e.alpha && e.callsign ? ` (${e.callsign})` : ''} · ${e.mode} · ${e.code || 'no code'} · ${e.direction || '-'} · ${e.nationwide ? 'nationwide' : `${e.place || e.location}${e.distanceKm !== null ? ` · ${e.distanceKm.toFixed(1)} km` : ''}${e.bearingDeg !== null ? ` ${e.bearingDeg}°` : ''}`}${e.isTrunk ? ' · trunked' : ''}`);
}
