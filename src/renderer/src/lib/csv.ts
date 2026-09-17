import type { ReceptionRow } from '../../../shared/ipc';

/** RFC 4180 quoting: wrap when the value has a comma, quote, or line break; double the quotes. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

export const LOG_CSV_HEADER = [
  'first_heard', 'last_heard', 'duration_s', 'calls', 'frequency_mhz', 'mode', 'signal', 'name', 'system', 'scanlist', 'type',
  'tgid', 'radio_id', 'callsign', 'radio_name', 'tone', 'squelch', 'site', 'licensee', 'source',
  'scanner_name', 'wtr', 'rr_name', 'rr_system', 'repeater', 'rssi_peak', 'hits',
];

/** The log table as CSV, one line per row as displayed (oldest last, like the table). */
export function logToCsv(rows: readonly ReceptionRow[], now = Date.now()): string {
  return toCsv(
    LOG_CSV_HEADER,
    rows.map((r) => [
      localStamp(r.startedAt),
      r.endedAt === null ? '' : localStamp(r.endedAt),
      Math.max(0, ((r.endedAt ?? now) - r.startedAt) / 1000).toFixed(1),
      r.calls,
      (r.frequencyHz / 1e6).toFixed(6),
      r.mode,
      r.signalType,
      r.name,
      r.system,
      r.scanlist,
      r.objectType,
      r.tgid,
      r.radioId,
      r.radioCallsign ?? '',
      r.radioName ?? '',
      r.tone,
      r.squelch,
      r.site,
      r.licensee ?? '',
      r.source ?? '',
      r.scannerName ?? '',
      r.wtr ?? '',
      r.rrName ?? '',
      r.rrSystem ?? '',
      r.rpt ?? '',
      r.rssiPeak,
      r.hits,
    ]),
  );
}
