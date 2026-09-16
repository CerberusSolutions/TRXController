import type { RepeaterMatch } from './ipc';

/** "CTCSS 94.8" -> 94.8; null for DCS / NAC / nothing. */
export function ctcssHz(detectedTone: string | null | undefined): number | null {
  const m = /^CTCSS\s+(\d+(?:\.\d+)?)/i.exec(detectedTone ?? '');
  return m ? Number(m[1]) : null;
}

/** Same CTCSS tone within a tenth of a hertz. */
export function toneMatches(r: { ctcss: number | null }, hz: number | null): boolean {
  return hz !== null && r.ctcss !== null && Math.abs(r.ctcss - hz) < 0.05;
}

/**
 * Order repeater candidates for display: the one whose CTCSS tone matches
 * what the scanner detected comes first (several repeaters share a channel),
 * then output-side matches before input-side, then nearest.
 */
export function rankRepeaters<T extends RepeaterMatch>(matches: readonly T[], detectedTone: string | null | undefined): T[] {
  const hz = ctcssHz(detectedTone);
  const score = (r: T): number => (toneMatches(r, hz) ? 0 : 2) + (r.side === 'output' ? 0 : 1);
  return [...matches].sort((a, b) => score(a) - score(b) || (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
}

/** Short label for a log row or subtitle, e.g. "GB3AA · Bristol". */
export function repeaterLabel(r: { callsign: string; where: string }): string {
  return r.where ? `${r.callsign} · ${r.where}` : r.callsign;
}
