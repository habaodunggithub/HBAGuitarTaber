/**
 * "Remove the engine" and "Remove all data" (macOS and Linux have no uninstaller; Windows has one too). What each
 * deletes, how much space that frees, and the deleting itself, refusing any folder that is not the app's own.
 * No Electron import: tests run it from plain Node.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Layout } from './layout';

export type Removal = 'engine' | 'everything';

/** The app's own folders carry its name: anything else (a home folder, a drive root) is never deleted. */
export function isOurs(p: string): boolean {
  const abs = path.resolve(p);
  return /hba[ -]guitar[ -]taber/i.test(abs) && abs !== path.resolve(os.homedir()) && abs !== path.parse(abs).root;
}

/**
 * What a removal deletes. The engine: the Python runtime and the caches (model files, stems, downloads); the next
 * start installs it again. Everything: that, plus the tabs, the recordings, the settings and the logs.
 */
export function targets(layout: Layout, what: Removal): string[] {
  const engine = [layout.runtime, layout.cache];
  if (what === 'engine') return engine;
  const home = path.dirname(layout.settingsFile); // holds data/, runtime/, settings.json (and cache/ and logs/ on Windows)
  // on Linux the logs sit in …/state/hba-guitar-taber/logs: the app's folder there goes too
  const logs = path.basename(layout.logs) === 'logs' && isOurs(path.dirname(layout.logs)) ? path.dirname(layout.logs) : layout.logs;
  const all = [home, layout.cache, logs, ...engine];
  // a folder inside another one on the list goes with it
  return [...new Set(all.map((p) => path.resolve(p)))].filter((p, _, list) => !list.some((q) => q !== p && p.startsWith(q + path.sep)));
}

/** Bytes under a folder (or a file), without following links; 0 when it is not there. */
export function sizeOf(p: string): number {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.isFile() ? st.size : 0;
  let total = 0;
  for (const e of fs.readdirSync(p)) total += sizeOf(path.join(p, e));
  return total;
}

/** Deletes the folders of a removal. Throws, deleting nothing, if any of them is not the app's own. */
export function remove(paths: string[]): void {
  const foreign = paths.filter((p) => !isOurs(p));
  if (foreign.length) throw new Error(`refusing to delete folders that are not the app's: ${foreign.join(', ')}`);
  for (const p of paths) fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
