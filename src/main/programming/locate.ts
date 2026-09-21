/**
 * Where a scanner's SD card shows up: the CDAT folder on a mounted volume, and the `CDAT_VS.nnn`
 * V-Scanner folders beside it (EZ Scan's "V-Scanner folders": alternative programmings the scanner
 * loads from its own menu; `CURVS.DAT` at the card root names the one loaded at power-up). Windows drive
 * letters, Linux's /media and /run/media, macOS's /Volumes. Read errors mean "not there". Writing goes
 * through `writeCdat`, which backs the folder up first.
 */
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { CdatCandidate, ProgSaveResult, ProgSaveTarget, Programming } from '../../shared/programming';
import { parseCdat } from './cdat';
import { buildCdat } from './write';

const VS_FOLDER = /^CDAT_VS\.(\d{3})$/i;

async function isCdat(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'CG000000._CG'))).isFile();
  } catch {
    return false;
  }
}

async function description(dir: string): Promise<string> {
  try {
    return (await readFile(join(dir, 'DESCRIPT.TXT'), 'latin1')).replace(/[^\x20-\x7e]/g, '').replace(/\s{2,}/g, ' ').trim();
  } catch {
    return '';
  }
}

async function subdirs(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name));
  } catch {
    return [];
  }
}

/** Volume roots that might be the card, by platform. */
async function volumeRoots(platform: NodeJS.Platform): Promise<string[]> {
  if (platform === 'win32') return 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`);
  if (platform === 'darwin') return subdirs('/Volumes');
  const roots: string[] = [];
  for (const base of ['/media', '/run/media']) {
    for (const user of await subdirs(base)) roots.push(user, ...(await subdirs(user)));
  }
  roots.push(...(await subdirs('/mnt')));
  return roots;
}

/** The CDAT folder and the V-Scanner folders under one root (a card, or wherever a copy of one sits). */
async function foldersUnder(root: string): Promise<CdatCandidate[]> {
  const out: CdatCandidate[] = [];
  const live = join(root, 'CDAT');
  if (await isCdat(live)) out.push({ dir: live, description: await description(live), kind: 'card' });
  const vs = (await subdirs(root)).filter((d) => VS_FOLDER.test(basename(d))).sort();
  for (const dir of vs) if (await isCdat(dir)) out.push({ dir, description: await description(dir), kind: 'vscanner' });
  return out;
}

/**
 * Every mounted CDAT folder found, cards first as the OS lists them, each with its V-Scanner folders;
 * with `near`, a folder opened by hand, that folder and its siblings are listed first.
 */
export async function locateCdat(platform: NodeJS.Platform = process.platform, near?: string): Promise<CdatCandidate[]> {
  const out: CdatCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: CdatCandidate): void => {
    if (!seen.has(c.dir)) {
      seen.add(c.dir);
      out.push(c);
    }
  };
  if (near) {
    if (await isCdat(near)) add({ dir: near, description: await description(near), kind: VS_FOLDER.test(basename(near)) ? 'vscanner' : 'card' });
    for (const c of await foldersUnder(dirname(near))) add(c);
  }
  for (const root of await volumeRoots(platform)) for (const c of await foldersUnder(root)) add(c);
  return out;
}

/** Every file in the folder, keyed by upper-case name, still obfuscated. */
async function readFiles(dir: string): Promise<{ files: Map<string, Uint8Array>; names: Map<string, string> }> {
  const files = new Map<string, Uint8Array>();
  const names = new Map<string, string>();
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const u = e.name.toUpperCase();
    names.set(u, e.name);
    try {
      files.set(u, new Uint8Array(await readFile(join(dir, e.name))));
    } catch {
      /* a file the card refuses to read is left out */
    }
  }
  return { files, names };
}

/** Read a CDAT folder into a `Programming`. Throws when it is not one. */
export async function readCdat(dir: string): Promise<Programming> {
  if (!(await isCdat(dir))) throw new Error('Not a CDAT folder: no CG000000._CG in it');
  return parseCdat(dir, (await readFiles(dir)).files);
}

const stamp = (d = new Date()): string => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

/** The next unused `CDAT_VS.nnn` beside `dir`. */
async function nextVsFolder(dir: string): Promise<string> {
  const root = dirname(dir);
  const used = new Set((await subdirs(root)).map((d) => VS_FOLDER.exec(basename(d))?.[1]).filter((n): n is string => !!n).map(Number));
  let n = 1;
  while (used.has(n)) n++;
  return join(root, `CDAT_VS.${String(n).padStart(3, '0')}`);
}

/**
 * Write an edited programming: over the folder it was read from (`prog.dir`) after copying that folder
 * to `<name>.bak-<stamp>` beside it, or into a new V-Scanner folder beside it (a copy of the folder
 * with the regenerated files over it). The folder is re-read first so the unknown bytes come from what
 * is on the card now.
 */
export async function writeCdat(prog: Programming, target: ProgSaveTarget): Promise<ProgSaveResult> {
  const src = prog.dir;
  if (!(await isCdat(src))) throw new Error('Not a CDAT folder: no CG000000._CG in it');
  const { files, names } = await readFiles(src);
  const out = buildCdat(files, target.kind === 'vscanner' ? { ...prog, description: target.description } : prog);
  let dest = src;
  let backupDir: string | null = null;
  if (target.kind === 'vscanner') {
    dest = await nextVsFolder(src);
    await cp(src, dest, { recursive: true, errorOnExist: true, force: false });
  } else {
    backupDir = `${src}.bak-${stamp()}`;
    await cp(src, backupDir, { recursive: true, errorOnExist: true, force: false });
  }
  await mkdir(dest, { recursive: true });
  let count = 0;
  for (const [name, data] of out) {
    await writeFile(join(dest, names.get(name) ?? name), data);
    count++;
  }
  return { dir: dest, backupDir, files: count };
}
