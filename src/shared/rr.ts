import type { RrConventional, RrInfo } from './ipc';

/**
 * The code a reception carries, for matching against what the lookups list: the detected tone
 * ("CTCSS 94.8", "DCS 023", "NAC 293"), else the DMR colour code as "CC 12". Null when neither shows.
 */
export function detectedCode(d: { detectedTone: string | null; colorCode: number | null } | null | undefined): string | null {
  if (!d) return null;
  return d.detectedTone ?? (d.colorCode !== null ? `CC ${d.colorCode}` : null);
}

/** First number in a tone string: "94.8 PL" -> 94.8, "023 DPL" -> 23, "167 NAC" -> 167, "CC 1" -> 1. */
export function toneNumber(text: string | null | undefined): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(text ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Does a RadioReference tone ("94.8 PL", "023 DPL", "167 NAC") agree with what
 * the scanner detected ("CTCSS 94.8", "DCS 023", "NAC 167")? Both must name a
 * tone of the same family for a yes; anything else is "unknown" (null).
 */
export function rrToneMatches(rrTone: string, detected: string | null | undefined): boolean | null {
  const a = toneNumber(rrTone);
  const b = toneNumber(detected);
  if (a === null || b === null) return null;
  // DPL before PL, since a DPL string contains the letters PL.
  const family = (t: string): string => (/DPL|DCS/i.test(t) ? 'dcs' : /PL|CTCSS/i.test(t) ? 'ctcss' : /NAC/i.test(t) ? 'nac' : /CC|RAN/i.test(t) ? 'cc' : '');
  const fa = family(rrTone);
  const fb = family(detected ?? '');
  if (fa && fb && fa !== fb) return false;
  return Math.abs(a - b) < 0.05;
}

/** One line per RadioReference entry for the hero and tooltips. */
export function rrSummary(info: RrInfo | null): string[] {
  if (!info) return [];
  const out: string[] = [];
  for (const s of info.systems) {
    const tg = s.talkgroup ? `${s.talkgroup.descr || s.talkgroup.alpha}${s.talkgroup.enc ? ' (enc)' : ''}` : '';
    out.push([s.name, s.site?.descr, tg].filter(Boolean).join(' · '));
  }
  for (const c of info.conventional) out.push(conventionalLabel(c));
  return out;
}

export function conventionalLabel(c: RrConventional): string {
  return [c.descr || c.alpha, c.alpha && c.descr && c.alpha !== c.descr ? `(${c.alpha})` : '', c.county, c.tone, c.mode].filter(Boolean).join(' · ');
}
