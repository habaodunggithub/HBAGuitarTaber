/** settings.json next to the data folder. Everything optional: a missing or broken file means defaults. */
import fs from 'node:fs';
import path from 'node:path';
import type { Lang } from './i18n';
import type { Variant } from './runtime';

export interface Settings {
  /** runtime variant the user picked; undefined = not installed yet */
  variant?: Variant;
  /** kept across launches: the SPA's localStorage (theme, ...) belongs to the origin, port included */
  port?: number;
  /** the language the user picked in the app (shell and web app alike); undefined = the computer's */
  language?: Lang;
  /** start the local analysis worker with the app (off when all jobs go to a Kaggle worker) */
  startWorker: boolean;
  /** look for a newer release on GitHub once a day */
  checkUpdates: boolean;
  lastUpdateCheck?: number;
  /** the latest release tag seen on GitHub, so the notice shows on every start until the next check */
  latestRelease?: string;
  /** the newer version whose notice the user closed: no notice again until a newer one */
  dismissedUpdate?: string;
  window?: { width: number; height: number; x?: number; y?: number; maximized?: boolean };
}

const DEFAULTS: Settings = { startWorker: true, checkUpdates: true };

export function loadSettings(file: string): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(file: string, s: Settings): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);
}
