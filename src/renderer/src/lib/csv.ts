import type { ReceptionRow } from '../../../shared/ipc';
import { formatBearing } from '../../../shared/geo';

/** RFC 4180 quoting: wrap when the value has a comma, quote, or line break; double the quotes. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Always quoted, the way EZ Scan writes its text columns. */
function quoted(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Local time without the timezone suffix, the way the log shows it: 2026-09-17 08:12:01. */
function localStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * The header of an EZ Scan conventional-object export, column for column (EZ Scan 3, TRX-1/2),
 * taken from a real export. Our own columns follow it: the importer ignores columns it does not know.
 */
export const EZSCAN_HEADER = [
  'AlphaTag', 'Frequency', 'Tone Type', 'Tone', 'Delay', 'Delay Time', 'Priority', 'Attenuate', 'AGC', 'AudioBoost', 'Backlight',
  'Lockout', 'Skip', 'Modulation', 'DMode', 'LEDMode', 'LEDLatch', 'LEDPattern', 'LEDColor1', 'LEDColor2', 'LEDColor3', 'LEDColor4',
  'Alert', 'OnTime', 'OffTime', 'Record', 'Talkgroup ID', 'Color Code', 'Slot', 'NXDN RAN', 'TGSkip', 'Scanlists',
];

/**
 * The log's own columns, after EZ Scan's: what the app knew about the object. Prefixed `trx_` because EZ Scan's
 * importer matches columns by name and would otherwise map `scanlist`, `type` and `tgid` onto its own
 * Scanlists, Tone Type and Talkgroup ID fields.
 */
export const LOG_EXTRA_HEADER = [
  'first_heard', 'last_heard', 'receptions', 'calls', 'rssi_peak', 'signal', 'name', 'system', 'scanlist', 'type', 'tgid', 'tone',
  'squelch', 'site', 'licensee', 'source', 'scanner_name', 'wtr', 'rr_name', 'rr_system', 'repeater', 'rruk', 'distance_km',
  'bearing_deg', 'candidates',
].map((c) => `trx_${c}`);

export const LOG_CSV_HEADER = [...EZSCAN_HEADER, ...LOG_EXTRA_HEADER];

/** EZ Scan's alpha tag is 16 characters. */
export const ALPHA_TAG_MAX = 16;

/** Every candidate on one line: "WTR University of Buckingham (3.2 km 047°) | RRDB …", distances always in km. */
export function candidatesText(r: Pick<ReceptionRow, 'candidates'>): string {
  return (r.candidates ?? [])
    .map((c) => {
      const where = c.distanceKm === null ? '' : ` (${c.distanceKm.toFixed(1)} km ${formatBearing(c.bearingDeg)})`.replace(/ \)$/, ')');
      return `${c.source} ${c.name}${c.detail ? ` · ${c.detail}` : ''}${where}`;
    })
    .join(' | ');
}

/** "453.0625", "145.500": four decimals with trailing zeros dropped, three kept, the way tags are written. */
export function frequencyTag(hz: number): string {
  return (hz / 1e6).toFixed(4).replace(/0$/, '');
}

/**
 * The code that tells this object from others on the frequency: the detected tone / colour code, else
 * the squelch the scanner's own object was programmed with ("CTCSS 94.8", "DCS 023", "NAC 293", "CC 12",
 * "RAN 1"), else ''. Same key the confirmations use.
 */
export function objectCode(r: Pick<ReceptionRow, 'tone' | 'squelch'>): string {
  if (r.tone) return r.tone;
  return /^(CTCSS|DCS|NAC)\s/i.test(r.squelch) ? r.squelch : '';
}

/** EZ Scan's Tone Type / Tone pair for a code: "Search" (find and show any tone) when there is none. */
export function ezToneOf(code: string): [type: string, tone: string] {
  const m = /^(CTCSS|DCS|NAC)\s+(\S+)/i.exec(code);
  return m ? [m[1]!.toUpperCase(), m[2]!] : ['Search', ''];
}

/** EZ Scan's Modulation / DMode pair: digital when the code or the LCD icon says so, else the receive mode. */
export function ezModeOf(r: Pick<ReceptionRow, 'mode' | 'signalType'>, code: string): [modulation: string, dmode: string] {
  const sig = r.signalType.toUpperCase();
  if (/^NAC\s/i.test(code)) return ['P25', 'Digital'];
  if (/^RAN\s/i.test(code)) return ['NXDN', 'Digital'];
  if (/^CC\s/i.test(code) || sig === 'DG' || sig === 'D2' || sig === 'ENC') return ['DMR', 'Digital'];
  const mode = r.mode.toUpperCase();
  return [mode === 'AM' ? 'AM' : mode === 'NFM' ? 'NFM' : mode === 'FM' ? 'FM' : 'AUTO', 'Auto'];
}

/** One EZ Scan object: the rows on one frequency with one code, folded together. */
export interface EzObject {
  frequencyHz: number;
  code: string;
  /** The row that names the object: the newest named one, else the newest. */
  row: ReceptionRow;
  firstHeard: number;
  lastHeard: number | null;
  receptions: number;
  calls: number;
  rssiPeak: number;
}

/**
 * Fold the log into objects: one per frequency and code (tone / colour code), as the confirmations are keyed,
 * so two users sharing a channel become two objects and twenty conversations with one become one. Rows arrive
 * newest first, so the first named row is the newest named one. Sorted by frequency, then code.
 */
export function ezObjects(rows: readonly ReceptionRow[]): EzObject[] {
  const map = new Map<string, EzObject>();
  for (const r of rows) {
    const code = objectCode(r);
    const key = `${r.frequencyHz}|${code}`;
    const o = map.get(key);
    if (!o) {
      map.set(key, { frequencyHz: r.frequencyHz, code, row: r, firstHeard: r.startedAt, lastHeard: r.endedAt, receptions: 1, calls: r.calls, rssiPeak: r.rssiPeak });
      continue;
    }
    if (!o.row.name && r.name) o.row = r;
    o.firstHeard = Math.min(o.firstHeard, r.startedAt);
    o.lastHeard = o.lastHeard === null || r.endedAt === null ? null : Math.max(o.lastHeard, r.endedAt);
    o.receptions += 1;
    o.calls += r.calls;
    o.rssiPeak = Math.max(o.rssiPeak, r.rssiPeak);
  }
  return [...map.values()].sort((a, b) => a.frequencyHz - b.frequencyHz || a.code.localeCompare(b.code));
}

/**
 * The alpha tag: the row's name, else the scanner's own label ("453.0625 CC12"), else the frequency; 16 characters of
 * printable ASCII, which is all the scanner shows (the app's "GB3AA · BRISTOL" becomes "GB3AA BRISTOL").
 */
export function alphaTag(o: Pick<EzObject, 'row' | 'frequencyHz'>): string {
  const text = (o.row.name || o.row.scannerName || frequencyTag(o.frequencyHz)).replace(/\s*·\s*/g, ' ').replace(/[^\x20-\x7e]+/g, '').replace(/\s+/g, ' ').trim();
  return text.slice(0, ALPHA_TAG_MAX).trim();
}

/** One line of the export: EZ Scan's 32 columns written as EZ Scan writes them, then ours. */
export function ezLine(o: EzObject): string {
  const r = o.row;
  const [toneType, tone] = ezToneOf(o.code);
  const [modulation, dmode] = ezModeOf(r, o.code);
  const cc = /^CC\s+(\d+)/i.exec(o.code)?.[1];
  const ran = /^RAN\s+(\d+)/i.exec(o.code)?.[1];
  const ez = [
    quoted(alphaTag(o)), (o.frequencyHz / 1e6).toFixed(6), quoted(toneType), quoted(tone), quoted('Yes'), '2.0', quoted('No'), quoted('No'), quoted('Yes'), quoted('No'), quoted('Leave'),
    quoted('No'), quoted('No'), quoted(modulation), quoted(dmode), quoted('Off'), quoted('No'), quoted('55555555'), '', '', '', '',
    quoted('None'), '500', '500', quoted('No'),
    modulation === 'DMR' || modulation === 'NXDN' ? '*' : '', // Talkgroup ID: any (as EZ Scan writes those modes)
    modulation === 'DMR' ? (cc ?? '*') : '', // Color Code
    modulation === 'DMR' ? '*' : '', // Slot
    modulation === 'NXDN' ? (ran ?? '*') : '', // NXDN RAN
    '0', quoted(''), // TGSkip, Scanlists: empty = EZ Scan's default import scanlist (normally 1)
  ];
  const ours = [
    localStamp(o.firstHeard), o.lastHeard === null ? '' : localStamp(o.lastHeard), o.receptions, o.calls, o.rssiPeak, r.signalType, r.name, r.system, r.scanlist, r.objectType,
    r.tgid, o.code, r.squelch, r.site, r.licensee ?? '', r.source ?? '', r.scannerName ?? '', r.wtr ?? '', r.rrName ?? '', r.rrSystem ?? '', r.rpt ?? '', r.rruk ?? '',
    r.distanceKm === null || r.distanceKm === undefined ? '' : r.distanceKm.toFixed(1), r.bearingDeg ?? '', candidatesText(r),
  ].map(csvCell);
  return [...ez, ...ours].join(',');
}

/**
 * The log as an EZ Scan conventional import file: one object per frequency and code, EZ Scan's own columns first
 * (header and quoting as its export writes them, so File › Import takes it as it is), the log's columns after.
 */
export function logToCsv(rows: readonly ReceptionRow[]): string {
  return [LOG_CSV_HEADER.map(quoted).join(','), ...ezObjects(rows).map(ezLine)].join('\r\n') + '\r\n';
}
