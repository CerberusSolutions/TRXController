/**
 * Where a scanner's SD card shows up: the CDAT folder on a mounted volume. Windows drive letters,
 * Linux's /media and /run/media, macOS's /Volumes. Read errors mean "not there"; nothing is written.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { CdatCandidate } from '../../shared/programming';
import { parseCdat } from './cdat';
import type { Programming } from '../../shared/programming';

const CDAT_FILES = ['CG000000._CG', 'CG000000._CI', 'PLDEF.DAT', 'PLSETS.DAT', 'ISCAN___.GLB', 'ISCAN___.TSM', 'DESCRIPT.TXT'];

async function isCdat(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, 'CG000000._CG'))).isFile();
  } catch {
    return false;
  }
}

async function description(dir: string): Promise<string> {
  try {
    return (await readFile(join(dir, 'DESCRIPT.TXT'), 'latin1')).replace(/[^\x20-\x7e]/g, '').trim();
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

/** Every mounted CDAT folder found, cards first as the OS lists them. */
export async function locateCdat(platform: NodeJS.Platform = process.platform): Promise<CdatCandidate[]> {
  const out: CdatCandidate[] = [];
  for (const root of await volumeRoots(platform)) {
    const dir = join(root, 'CDAT');
    if (await isCdat(dir)) out.push({ dir, description: await description(dir) });
  }
  return out;
}

/** Read a CDAT folder into a `Programming`. Throws when it is not one. */
export async function readCdat(dir: string): Promise<Programming> {
  if (!(await isCdat(dir))) throw new Error('Not a CDAT folder: no CG000000._CG in it');
  const files = new Map<string, Uint8Array>();
  const names = new Set<string>(CDAT_FILES);
  for (const e of await readdir(dir)) {
    const u = e.toUpperCase();
    if (/^TS\d{6}\._(TS|GD)$/.test(u)) names.add(u);
  }
  const listing = await readdir(dir);
  for (const want of names) {
    const actual = listing.find((e) => e.toUpperCase() === want);
    if (!actual) continue;
    try {
      files.set(want, new Uint8Array(await readFile(join(dir, actual))));
    } catch {
      /* a file the card refuses to read is left out */
    }
  }
  return parseCdat(dir, files);
}
