/**
 * Where everything lives, per operating system (docs/adr/ADR-011-desktop-app.md, "Thư mục theo hệ điều hành").
 * No Electron import: the smoke test uses this from plain Node.
 */
import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'HBA Guitar Taber';
const SLUG = 'hba-guitar-taber';

export interface Layout {
  /** user data: SQLite, uploads, analyses, worker_token (TABER_DATA_DIR) */
  data: string;
  /** Python + venv built by uv on first run */
  runtime: string;
  venv: string;
  python: string;
  /** model weights, stems, uv's download cache: safe to delete */
  cache: string;
  logs: string;
  settingsFile: string;
  /** read-only files shipped with the app */
  res: {
    root: string;
    web: string;
    python: string;
    launch: string;
    uv: string;
    ffmpegBin: string;
  };
}

function venvPython(venv: string): string {
  return process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
}

function homes(): { data: string; cache: string; logs: string } {
  const override = process.env.TABER_DESKTOP_HOME;
  if (override) {
    const h = path.resolve(override);
    return { data: h, cache: path.join(h, 'cache'), logs: path.join(h, 'logs') };
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    // LOCALAPPDATA, not the roaming APPDATA: the runtime and the videos can take several GB
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const h = path.join(local, APP_NAME);
    return { data: h, cache: path.join(h, 'cache'), logs: path.join(h, 'logs') };
  }
  if (process.platform === 'darwin') {
    return {
      data: path.join(home, 'Library', 'Application Support', APP_NAME),
      cache: path.join(home, 'Library', 'Caches', APP_NAME),
      logs: path.join(home, 'Library', 'Logs', APP_NAME),
    };
  }
  const xdg = (name: string, fallback: string) => process.env[name] || path.join(home, fallback);
  return {
    data: path.join(xdg('XDG_DATA_HOME', '.local/share'), SLUG),
    cache: path.join(xdg('XDG_CACHE_HOME', '.cache'), SLUG),
    logs: path.join(xdg('XDG_STATE_HOME', '.local/state'), SLUG, 'logs'),
  };
}

export function resolveLayout(resourcesRoot: string): Layout {
  const h = homes();
  const runtime = path.join(h.data, 'runtime');
  const venv = path.join(runtime, 'venv');
  const exe = process.platform === 'win32' ? '.exe' : '';
  return {
    data: path.join(h.data, 'data'),
    runtime,
    venv,
    python: venvPython(venv),
    cache: h.cache,
    logs: h.logs,
    settingsFile: path.join(h.data, 'settings.json'),
    res: {
      root: resourcesRoot,
      web: path.join(resourcesRoot, 'web'),
      python: path.join(resourcesRoot, 'python'),
      launch: path.join(resourcesRoot, 'python', 'launch.py'),
      uv: path.join(resourcesRoot, 'bin', `uv${exe}`),
      ffmpegBin: path.join(resourcesRoot, 'ffmpeg', 'bin'),
    },
  };
}

/** Where the Python side keeps model files and caches: the same for the API, the worker and the install's checks. */
export function cacheEnv(layout: Layout): Record<string, string> {
  return {
    TABER_CACHE_DIR: layout.cache,
    TORCH_HOME: path.join(layout.cache, 'torch'),
    HF_HOME: path.join(layout.cache, 'huggingface'),
    MPLCONFIGDIR: path.join(layout.cache, 'matplotlib'),
  };
}

/** Environment for every Python child: no leakage from the user's shell (PYTHONPATH, another venv, user site). */
export function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(PYTHON|VIRTUAL_ENV|CONDA_|UV_|TABER_)/.test(k) && k !== 'TABER_DESKTOP_HOME') continue;
    env[k] = v;
  }
  return { ...env, PYTHONNOUSERSITE: '1', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...extra };
}

/** Put `dir` first on PATH. Windows keeps the key as "Path": reuse whatever spelling is there. */
export function prependPath(env: NodeJS.ProcessEnv, dir: string): NodeJS.ProcessEnv {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = env[key] ? `${dir}${path.delimiter}${env[key]}` : dir;
  return env;
}
