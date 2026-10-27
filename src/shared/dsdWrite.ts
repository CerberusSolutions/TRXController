/**
 * Writing back into DSD+'s own files, the one direction DSD+ offers other programs: its documentation says
 * `DSDPlus.radios` and `DSDPlus.groups` may be edited while it runs (it re-reads an edited file and keeps
 * the edit through its own rewrites, every minute or so), and users have done so by hand since 1.092. Two
 * things go in: the names the user gave radios and talkgroups here, as the alias field of the matching
 * lines, and a talkgroup's priority / override, which is DSD+'s "follow this" control when it is voice
 * following with its own SDR (lower priority number = followed first, 50 the default; override `L/O` locks
 * the group out, `Normal` does not). Every other byte of a line is kept exactly as DSD+ wrote it: these are
 * its files. The line formats, from the files' own header comments:
 *
 *   groups: protocol, networkID, group, priority, override, hits, timestamp, "group alias"
 *   radios: protocol, networkID, group, radio, priority, override, hits, timestamp, "radio alias" [, "talker alias", hash]
 *
 * An alias DSD+ generated itself from over-the-air data carries an asterisk before the quotes (`*"G0LGF"`);
 * a user's text has none, and DSD+ overwrites an asterisked alias with the next over-the-air one, so a name
 * written here drops the asterisk. An alias the user typed in DSD+ itself (unquoted-asterisk, non-empty,
 * not ours) is never overwritten: both are the user's words and DSD+'s was typed there on purpose.
 * Pure functions, tested; the watcher reads, applies and writes.
 */

/** A follow setting on a talkgroup, as DSD+'s priority and override fields carry it. */
export type FollowMode = 'follow' | 'normal' | 'lockout';

export const FOLLOW_PRIORITY = 1;
export const NORMAL_PRIORITY = 50;
export const LOCKOUT_OVERRIDE = 'L/O';
export const NORMAL_OVERRIDE = 'Normal';

/** The fields a mode sets, and the mode a line's fields mean. */
export function followFields(mode: FollowMode): { priority: number; override: string } {
  if (mode === 'follow') return { priority: FOLLOW_PRIORITY, override: NORMAL_OVERRIDE };
  if (mode === 'lockout') return { priority: NORMAL_PRIORITY, override: LOCKOUT_OVERRIDE };
  return { priority: NORMAL_PRIORITY, override: NORMAL_OVERRIDE };
}
export function followModeOf(priority: number, override: string): FollowMode {
  if (/^l\/?o$/i.test(override.trim()) || /lock/i.test(override)) return 'lockout';
  return priority < NORMAL_PRIORITY ? 'follow' : 'normal';
}

/** One field of a raw line with where it sits, so it can be replaced and the rest of the line kept byte for byte. */
interface Span {
  /** The field's text, quotes stripped, surrounding spaces trimmed. */
  value: string;
  quoted: boolean;
  /** An asterisk before the opening quote: DSD+'s own marker for an alias it generated. */
  auto: boolean;
  /** The raw span to replace: from the first non-space character of the field (the asterisk included) to the last. */
  start: number;
  end: number;
}

function spans(line: string): Span[] {
  const out: Span[] = [];
  let i = 0;
  const n = line.length;
  while (i <= n) {
    // Skip leading spaces of the field.
    while (i < n && line[i] === ' ') i++;
    const start = i;
    let auto = false;
    if (line[i] === '*' && line[i + 1] === '"') {
      auto = true;
      i++;
    }
    if (line[i] === '"') {
      let v = '';
      i++;
      while (i < n) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        v += line[i]!;
        i++;
      }
      const end = i;
      // Anything up to the comma belongs to the field (DSD+ writes nothing there).
      while (i < n && line[i] !== ',') i++;
      out.push({ value: v, quoted: true, auto, start, end });
    } else {
      let j = i;
      while (j < n && line[j] !== ',') j++;
      let end = j;
      while (end > start && line[end - 1] === ' ') end--;
      out.push({ value: line.slice(start, end), quoted: false, auto: false, start, end });
      i = j;
    }
    if (i >= n) break;
    i++; // the comma
    if (i === n) {
      out.push({ value: '', quoted: false, auto: false, start: n, end: n });
      break;
    }
  }
  return out;
}

const quote = (s: string): string => `"${s.replace(/"/g, '""')}"`;

/** The line with its field `index` replaced (quoted when `quoted`), or the field appended when the line is short. */
function withField(line: string, f: Span[], index: number, text: string, quoted: boolean): string {
  const t = quoted ? quote(text) : text;
  const s = f[index];
  if (s) return line.slice(0, s.start) + t + line.slice(s.end);
  // Pad to the field with empty quoted fields (an alias slot DSD+ left out).
  let out = line.replace(/\s+$/, '');
  for (let k = f.length; k < index; k++) out += ', ""';
  return `${out},  ${t}`;
}

export interface WriteResult {
  text: string;
  /** Lines given the name. */
  written: number;
  /** Lines that already carried the name. */
  unchanged: number;
  /** Lines with a different alias typed in DSD+, left alone. */
  kept: number;
}

const RADIO_ALIAS = 8;
const GROUP_ALIAS = 7;

/**
 * Apply names to a file's lines: `resolve` gives the name for a line's key fields, or null for none. A line is
 * given the name when its alias is empty, DSD+'s own auto alias, or already the name (counted `unchanged`);
 * a different alias typed in DSD+ is `kept`. Comments, blanks and lines that are not entries pass untouched.
 */
export function applyAliases(text: string, kind: 'radios' | 'groups', resolve: (network: string, id: number) => string | null): WriteResult {
  const idField = kind === 'radios' ? 3 : 2;
  const aliasField = kind === 'radios' ? RADIO_ALIAS : GROUP_ALIAS;
  const minFields = kind === 'radios' ? 8 : 7;
  let written = 0;
  let unchanged = 0;
  let kept = 0;
  const lines = text.split('\n').map((raw) => {
    const cr = raw.endsWith('\r') ? '\r' : '';
    const line = cr ? raw.slice(0, -1) : raw;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) return raw;
    const f = spans(line);
    const id = Number(f[idField]?.value);
    if (f.length < minFields || !Number.isInteger(id) || f[idField]!.quoted) return raw;
    const name = resolve(f[1]?.value ?? '', id);
    if (name === null || name === '') return raw;
    const cur = f[aliasField];
    const curText = cur?.quoted ? cur.value : '';
    if (cur?.quoted && !cur.auto && curText === name) {
      unchanged++;
      return raw;
    }
    if (cur?.quoted && !cur.auto && curText !== '') {
      kept++;
      return raw;
    }
    written++;
    return withField(line, f, aliasField, name, true) + cr;
  });
  return { text: lines.join('\n'), written, unchanged, kept };
}

/** The aliases a file's lines carry now, by `network|id`, for checking what DSD+ kept after a write. */
export function aliasesOf(text: string, kind: 'radios' | 'groups'): Map<string, string> {
  const idField = kind === 'radios' ? 3 : 2;
  const aliasField = kind === 'radios' ? RADIO_ALIAS : GROUP_ALIAS;
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const f = spans(line);
    const id = Number(f[idField]?.value);
    if (!Number.isInteger(id) || f[idField]!.quoted) continue;
    const a = f[aliasField];
    out.set(`${f[1]?.value ?? ''}|${id}`, a?.quoted && !a.auto ? a.value : '');
  }
  return out;
}

/** DSD+'s timestamp form for a new line: `2026/10/02 18:26` (the hour not padded in its own files; two digits are read fine). */
export function dsdStamp(at: number): string {
  const d = new Date(at);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Set a talkgroup's follow mode in a groups file: the priority and override fields of its line, or a new line
 * (`protocol, network, tgid, priority, override, 0, stamp, ""`) after the network's last line, else before the
 * trailing record-count comment, else at the end. `changed` is false when the line already said so.
 */
export function setGroupFollow(text: string, protocol: string, network: string, tgid: number, mode: FollowMode, at: number): { text: string; changed: boolean; appended: boolean } {
  const { priority, override } = followFields(mode);
  const lines = text.split('\n');
  let lastOfNetwork = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const cr = raw.endsWith('\r') ? '\r' : '';
    const line = cr ? raw.slice(0, -1) : raw;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;
    const f = spans(line);
    const id = Number(f[2]?.value);
    if (f.length < 7 || !Number.isInteger(id) || f[2]!.quoted) continue;
    if ((f[1]?.value ?? '') !== network) continue;
    lastOfNetwork = i;
    if (id !== tgid) continue;
    if (Number(f[3]!.value) === priority && f[4]!.value === override) return { text, changed: false, appended: false };
    let out = withField(line, f, 4, override, false);
    out = withField(out, spans(out), 3, String(priority), false);
    lines[i] = out + cr;
    return { text: lines.join('\n'), changed: true, appended: false };
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const fresh = `${protocol}, ${network}, ${tgid}, ${priority}, ${override}, 0, ${dsdStamp(at)}, ""`;
  if (lastOfNetwork >= 0) {
    lines.splice(lastOfNetwork + 1, 0, fresh + (lines[lastOfNetwork]!.endsWith('\r') ? '\r' : ''));
    return { text: lines.join('\n'), changed: true, appended: true };
  }
  // Before the trailing "; N records" comment when there is one, so DSD+'s own tail stays last.
  let tail = lines.length;
  while (tail > 0 && lines[tail - 1]!.trim() === '') tail--;
  const last = lines[tail - 1]?.trim() ?? '';
  const insertAt = /^;.*records/i.test(last) ? tail - 1 : tail;
  lines.splice(insertAt, 0, fresh + (eol === '\r\n' ? '\r' : ''));
  return { text: lines.join('\n'), changed: true, appended: true };
}
