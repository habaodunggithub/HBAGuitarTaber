/**
 * "Remove the engine" and "Remove all data" (macOS and Linux have no uninstaller; Windows has one too). What each
 * deletes, how much space that frees, and the deleting itself, refusing any folder that is not the app's own.
 * No Electron import: tests run it from plain Node.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_NAME, type Layout, topFolders } from './layout';

export type Removal = 'engine' | 'everything';

const NAMES = new Set([APP_NAME.toLowerCase(), 'hba-guitar-taber']);

/**
 * The app's own folders are named after it (or sit right inside one that is: runtime, cache, logs). A home
 * folder, a drive root, or a folder that only mentions the name ("HBA Guitar Taber projects") never is.
 */
export function isOurs(p: string): boolean {
  const abs = path.resolve(p);
  if (abs === path.resolve(os.homedir()) || abs === path.parse(abs).root) return false;
  return [abs, path.dirname(abs)].some((q) => NAMES.has(path.basename(q).toLowerCase()));
}

/**
 * What a removal deletes. The engine: the Python runtime and the caches (model files, stems, downloads); the next
 * start installs it again. Everything: the app's top folders (tabs, recordings, settings, logs, the engine) and
 * `extra` (the window's own browser profile).
 */
export function targets(layout: Layout, what: Removal, extra: string[] = []): string[] {
  return what === 'engine' ? [layout.runtime, layout.cache] : topFolders([...layout.roots, ...extra]);
}

/** Bytes under a folder or file, without following links; what cannot be read counts 0. */
export async function sizeOf(p: string): Promise<number> {
  let st: fs.Stats;
  try {
    st = await fs.promises.lstat(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.isFile() ? st.size : 0;
  let names: string[] = [];
  try {
    names = await fs.promises.readdir(p);
  } catch {
    return 0;
  }
  let total = 0;
  for (const n of names) total += await sizeOf(path.join(p, n));
  return total;
}

/** The space a list of folders takes. */
export async function freed(paths: string[]): Promise<number> {
  let total = 0;
  for (const p of paths) total += await sizeOf(p);
  return total;
}

/** Throws if a folder may not be deleted (see remove): to know before quitting, when the deleting comes after. */
export function check(paths: string[], keep: string[] = []): void {
  const inside = (p: string, k: string) => path.resolve(k) === path.resolve(p) || path.resolve(k).startsWith(path.resolve(p) + path.sep);
  const bad = paths.filter((p) => !isOurs(p) || keep.some((k) => inside(p, k)));
  if (bad.length) throw new Error(`refusing to delete: ${bad.join(', ')}`);
}

/**
 * Deletes the folders of a removal. Throws, deleting nothing, if one of them is not the app's own or holds a folder
 * in `keep` (the installed app itself, which a user may have put next to its data).
 */
export function remove(paths: string[], keep: string[] = []): void {
  check(paths, keep);
  for (const p of paths) fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
