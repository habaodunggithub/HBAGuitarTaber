/**
 * The Python runtime: Python 3.12 + a venv with the locked packages, built by the bundled `uv` on first run and
 * re-synced when the app ships a different lock (docs/adr/ADR-011-desktop-app.md, "Biến thể runtime").
 * No Electron import: the smoke test drives this from plain Node.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { cleanEnv, type Layout } from './layout';
import type { LogFile } from './log';

export type Variant = 'gpu' | 'cpu' | 'lite';

/** written by scripts/stage.mjs into resources/python/manifest.json */
export interface Manifest {
  appVersion: string;
  /** hash of uv.lock + project wheels + runtime config: a different stamp means "sync again" */
  stamp: string;
  python: string;
  platform: string;
  arch: string;
  variants: Variant[];
  downloadEstimate: Record<Variant, string>;
  wheels: string[];
  workspacePackages: string[];
}

/** written into <runtime>/state.json after a successful install */
export interface RuntimeState {
  variant: Variant;
  stamp: string;
  python: string;
  torch: string | null;
  cuda: boolean;
  gpu: string | null;
  installedAt: string;
}

export type Phase = 'python' | 'packages' | 'check';

export interface Progress {
  phase: Phase;
  message: string;
  /** bytes uv has written into its cache so far (downloads + unpacked wheels) */
  bytes?: number;
}

export class RuntimeError extends Error {
  constructor(message: string, readonly logTail: string) {
    super(message);
  }
}

export function readManifest(layout: Layout): Manifest {
  return JSON.parse(fs.readFileSync(path.join(layout.res.python, 'manifest.json'), 'utf8')) as Manifest;
}

function stateFile(layout: Layout): string {
  return path.join(layout.runtime, 'state.json');
}

export function readState(layout: Layout): RuntimeState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile(layout), 'utf8')) as RuntimeState;
  } catch {
    return null;
  }
}

export type Status =
  | { ready: true; state: RuntimeState }
  | { ready: false; reason: 'missing' | 'outdated' | 'broken'; state: RuntimeState | null };

/** Cheap check done on every launch: no process is started when the runtime is current. */
export function runtimeStatus(layout: Layout, manifest: Manifest): Status {
  const state = readState(layout);
  if (!state) return { ready: false, reason: 'missing', state };
  if (!fs.existsSync(layout.python)) return { ready: false, reason: 'broken', state };
  if (state.stamp !== manifest.stamp || !manifest.variants.includes(state.variant)) {
    return { ready: false, reason: 'outdated', state };
  }
  return { ready: true, state };
}

function uvEnv(layout: Layout): NodeJS.ProcessEnv {
  return cleanEnv({
    UV_CACHE_DIR: process.env.TABER_DESKTOP_UV_CACHE || path.join(layout.cache, 'uv'),
    UV_PYTHON_INSTALL_DIR: path.join(layout.runtime, 'python'), // `uv venv --managed-python`: never a system or conda Python
    UV_NO_CONFIG: '1', // ignore the user's uv.toml / pip.conf-like settings
    NO_COLOR: '1',
  });
}

/** Run a command, stream its output to the log and to `onLine`; reject with the log tail on failure. */
function exec(
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; log: LogFile; onLine?: (line: string) => void; signal?: AbortSignal; cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    opts.log.line(`$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { env: opts.env, cwd: opts.cwd, windowsHide: true, signal: opts.signal });
    let stdout = '';
    const partial = { out: '', err: '' };
    const onData = (buf: Buffer, stream: 'out' | 'err') => {
      const s = buf.toString();
      if (stream === 'out') stdout += s;
      opts.log.write(s);
      const lines = (partial[stream] + s).split(/\r?\n/); // chunks end mid-line: keep the rest for the next one
      partial[stream] = lines.pop() ?? '';
      if (opts.onLine) for (const l of lines) if (l.trim()) opts.onLine(l.trim());
    };
    child.stdout.on('data', (b: Buffer) => onData(b, 'out'));
    child.stderr.on('data', (b: Buffer) => onData(b, 'err'));
    child.on('error', (e) => reject(new RuntimeError(`${path.basename(cmd)}: ${e.message}`, opts.log.tail())));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new RuntimeError(`${path.basename(cmd)} exited with code ${code}`, opts.log.tail()));
    });
  });
}

/** Size of a directory tree, best effort (files can vanish while uv works). */
function dirSize(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* gone */
        }
      }
    }
  }
  return total;
}

/** The requirements for this install: the shipped variant file + the project wheels, copied to a stable path. */
function writeRequirements(layout: Layout, manifest: Manifest, variant: Variant): string {
  const wheelDir = path.join(layout.runtime, 'wheels');
  fs.rmSync(wheelDir, { recursive: true, force: true });
  fs.mkdirSync(wheelDir, { recursive: true });
  const lines: string[] = [];
  for (const w of manifest.wheels) {
    const dst = path.join(wheelDir, w);
    fs.copyFileSync(path.join(layout.res.python, 'wheels', w), dst);
    lines.push(dst);
  }
  const base = fs.readFileSync(path.join(layout.res.python, `requirements-${variant}.txt`), 'utf8');
  const out = path.join(layout.runtime, 'requirements.txt');
  fs.writeFileSync(out, `${base.trimEnd()}\n\n# this app's own packages\n${lines.join('\n')}\n`);
  return out;
}

export async function provision(
  layout: Layout,
  manifest: Manifest,
  variant: Variant,
  log: LogFile,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<RuntimeState> {
  if (!manifest.variants.includes(variant)) throw new RuntimeError(`variant ${variant} is not built for this computer`, '');
  if (!fs.existsSync(layout.res.uv)) throw new RuntimeError(`uv is missing from the app (${layout.res.uv})`, '');
  fs.mkdirSync(layout.runtime, { recursive: true });
  const previous = readState(layout);
  fs.rmSync(stateFile(layout), { force: true }); // a crash halfway must not look like a finished install
  const env = uvEnv(layout);
  const uv = layout.res.uv;

  // 1. Python (uv downloads a standalone CPython build), and a venv on it
  const pythonChanged = previous ? !previous.python.startsWith(manifest.python) : false;
  if (!fs.existsSync(layout.python) || pythonChanged) {
    onProgress({ phase: 'python', message: `Getting Python ${manifest.python}` });
    await exec(uv, ['venv', layout.venv, '--python', manifest.python, '--managed-python', '--clear'], {
      env, log, signal, onLine: (l) => onProgress({ phase: 'python', message: l }),
    });
  }

  // 2. Exactly the locked packages for this variant (sync also removes what an older version installed)
  const req = writeRequirements(layout, manifest, variant);
  const cacheDir = env.UV_CACHE_DIR!;
  const before = dirSize(cacheDir);
  onProgress({ phase: 'packages', message: 'Downloading the analysis engine', bytes: 0 });
  const timer = setInterval(() => onProgress({ phase: 'packages', message: '', bytes: Math.max(0, dirSize(cacheDir) - before) }), 2000);
  try {
    const reinstall = manifest.workspacePackages.flatMap((p) => ['--reinstall-package', p]);
    await exec(uv, ['pip', 'sync', req, '--python', layout.python, ...reinstall], {
      env, log, signal, onLine: (l) => onProgress({ phase: 'packages', message: l }),
    });
    await exec(uv, ['pip', 'check', '--python', layout.python], { env, log, signal });
  } finally {
    clearInterval(timer);
  }

  // 3. Can the API and the pipeline import, and what does torch see?
  onProgress({ phase: 'check', message: 'Checking the engine' });
  const out = await exec(layout.python, [layout.res.launch, 'check'], {
    env: cleanEnv(), log, signal, cwd: layout.runtime,
  });
  const info = JSON.parse(out.trim().split(/\r?\n/).pop() || '{}') as Partial<RuntimeState>;
  const state: RuntimeState = {
    variant,
    stamp: manifest.stamp,
    python: info.python ?? manifest.python,
    torch: info.torch ?? null,
    cuda: Boolean(info.cuda),
    gpu: info.gpu ?? null,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(stateFile(layout), JSON.stringify(state, null, 2));
  log.line(`runtime ready: ${JSON.stringify(state)}`);
  return state;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} kB`;
}
