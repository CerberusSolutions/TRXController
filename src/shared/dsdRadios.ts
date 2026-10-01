/**
 * DSD+'s radio ID list (`DSDPlus.radios`, one line per radio heard, in the DSD+ folder):
 *
 *   P25, BEE00.169, 63354, 16734046, 50, Normal, 9, 2026/09/19 17:48, "", "CRO SFS 007", 0E362A72
 *
 * protocol, network / site, the talkgroup last heard on (-2 = none), radio ID, priority, mode, hits,
 * last heard, then the quoted strings DSD+ keeps for the radio (the alias the user typed in DSD+ is the
 * first non-empty one), and a hash. A line with an alias names the radio here; the rest are skipped.
 */

export interface DsdRadio {
  protocol: string;
  network: string;
  tgid: number | null;
  radioId: number;
  hits: number;
  lastHeard: string;
  /** The alias DSD+ shows for the radio, '' when none was given. */
  alias: string;
}

/** One line's fields, commas inside quotes kept, quotes stripped, each marked as quoted or bare. */
function fields(line: string): { value: string; quoted: boolean }[] {
  const out: { value: string; quoted: boolean }[] = [];
  let cur = '';
  let quoted = false;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
      quoted = true;
    } else if (ch === ',') {
      out.push({ value: cur.trim(), quoted });
      cur = '';
      quoted = false;
    } else cur += ch;
  }
  out.push({ value: cur.trim(), quoted });
  return out;
}

/** Parse a DSD+ radio list. `skipped` counts lines that are not radio entries (comments and blanks are not counted). */
export function parseDsdRadios(text: string): { radios: DsdRadio[]; skipped: number } {
  const radios: DsdRadio[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const f = fields(line);
    const radioId = Number(f[3]?.value);
    if (f.length < 8 || !Number.isInteger(radioId) || radioId < 0 || f[3]!.quoted) {
      skipped++;
      continue;
    }
    const tg = Number(f[2]?.value);
    const alias = f.slice(8).find((x) => x.quoted && x.value !== '')?.value ?? '';
    radios.push({
      protocol: f[0]!.value,
      network: f[1]?.value ?? '',
      tgid: Number.isInteger(tg) && tg >= 0 ? tg : null,
      radioId,
      hits: Number(f[6]?.value) || 0,
      lastHeard: f[7]?.value ?? '',
      alias,
    });
  }
  return { radios, skipped };
}
