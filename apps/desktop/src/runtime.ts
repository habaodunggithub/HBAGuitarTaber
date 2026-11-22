/**
 * The Python runtime: Python 3.12 + a venv with the locked packages, built by the bundled `uv` on first run and
 * re-synced when the app ships a different lock (docs/adr/ADR-011-desktop-app.md, "Biến thể runtime").
 * No Electron import: the smoke test drives this from plain Node.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cacheEnv, cleanEnv, type Layout } from './layout';
import type { LogFile } from './log';
import { t } from './i18n';

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
  /** why a GPU that is there is not used (too old for this build, test kernel failed) */
  gpuNote?: string | null;
  installedAt: string;
}

export type Phase = 'python' | 'download' | 'packages' | 'check' | 'models';

export interface Progress {
  phase: Phase;
  message: string;
  /** 'download' / 'models': bytes of the current file so far; 'packages': bytes uv has written into its cache */
  bytes?: number;
  /** size of the current file, when known: the setup page shows a percentage and the time left */
  total?: number;
  /** bytes per second over the last few seconds */
  rate?: number;
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
    // slow or flaky links (the default 30 s read timeout and 3 retries give up on them)
    UV_HTTP_TIMEOUT: '120',
    UV_HTTP_RETRIES: '8',
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

/**
 * Size of a directory tree, best effort (files can vanish while uv works). Asynchronous: the unpacked torch alone
 * is tens of thousands of files, and walking them synchronously every few seconds froze the window on Windows.
 */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    const files: string[] = [];
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) files.push(p);
    }
    for (let i = 0; i < files.length; i += 64) {
      const sizes = await Promise.all(files.slice(i, i + 64).map((f) => fs.promises.stat(f).then((s) => s.size, () => 0)));
      for (const n of sizes) total += n;
    }
  }
  return total;
}

/** A requirement pinned to a file URL (the CUDA torch wheel: 2 GB on Windows): fetched by us, resumably. */
interface BigWheel {
  name: string;
  version: string;
  url: string;
  sha256: string;
  file: string;
}

/** `torch @ https://…/torch-2.15.0%2Bcu132-…whl \` + `--hash=sha256:…` -> what to fetch, and the pin to write instead. */
export function directWheels(text: string): { wheels: Omit<BigWheel, 'file'>[]; text: string } {
  const lines = text.split(/\r?\n/);
  const wheels: Omit<BigWheel, 'file'>[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z0-9._-]+) @ (https?:\/\/\S+\.whl)\s*\\$/);
    const h = lines[i + 1]?.match(/^\s+--hash=sha256:([0-9a-f]{64})/);
    if (!m || !h) continue;
    const fname = decodeURIComponent(m[2].split('/').pop()!);
    const version = fname.split('-')[1];
    wheels.push({ name: m[1], version, url: m[2], sha256: h[1] });
    // a version pin + --find-links: installed from the downloaded file, and still satisfied once it is deleted
    lines[i] = `${m[1]}==${version} \\`;
  }
  return { wheels, text: lines.join('\n') };
}

function sitePackages(layout: Layout, python: string): string {
  return process.platform === 'win32'
    ? path.join(layout.venv, 'Lib', 'site-packages')
    : path.join(layout.venv, 'lib', `python${python}`, 'site-packages');
}

/** Is `name==version` in the venv already (its .dist-info folder)? Then its wheel is not needed. */
function installedVersion(layout: Layout, python: string, name: string, version: string): boolean {
  const want = `${name.replace(/[-.]+/g, '_')}-${version}.dist-info`.toLowerCase();
  try {
    return fs.readdirSync(sitePackages(layout, python)).some((d) => d.toLowerCase() === want);
  } catch {
    return false;
  }
}

const IDLE_TIMEOUT_MS = 60_000; // no byte for this long: drop the connection and resume
const MAX_STALLED_ATTEMPTS = 8; // attempts in a row that brought nothing new

async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 20 })) h.update(chunk as Buffer);
  return h.digest('hex');
}

/**
 * Download `url` to `dest` through `dest.part`: Range requests resume after a dropped link, a stall, or the app
 * being closed halfway (the next launch continues from the part file). Checked against `sha256` at the end.
 */
export async function downloadResumable(
  url: string,
  dest: string,
  sha256: string,
  log: LogFile,
  onBytes: (done: number, total: number | undefined, rate: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  let stalled = 0;
  let total: number | undefined;
  const window: [number, number][] = []; // (time, bytes) over the last 5 s, for the rate
  for (;;) {
    signal?.throwIfAborted();
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (total !== undefined && have >= total) break;
    const before = have;
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort);
    let idle = setTimeout(() => ctl.abort(), IDLE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctl.signal });
      if (res.status === 416) {
        // nothing left to send: the part file is the whole thing (checked below), or garbage
        const whole = Number(res.headers.get('content-range')?.split('/').pop());
        if (whole === have) {
          total = have;
          break;
        }
        fs.rmSync(part, { force: true });
        continue;
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      if (have && res.status !== 206) have = 0; // the server ignored the range: start over
      const len = Number(res.headers.get('content-length'));
      if (Number.isFinite(len) && len > 0) total = have + len;
      log.line(`download ${path.basename(dest)}: from ${have} of ${total ?? '?'} bytes`);
      const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      const closed = new Promise<void>((resolve, reject) => {
        out.on('close', resolve);
        out.on('error', reject);
      });
      let done = have;
      let lastReport = 0;
      try {
        const reader = res.body.getReader();
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          clearTimeout(idle);
          idle = setTimeout(() => ctl.abort(), IDLE_TIMEOUT_MS);
          if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
          done += value.length;
          const now = Date.now();
          if (now - lastReport >= 500) {
            lastReport = now;
            window.push([now, done]);
            while (window.length > 1 && now - window[0][0] > 5000) window.shift();
            const [t0, b0] = window[0];
            onBytes(done, total, now > t0 ? ((done - b0) * 1000) / (now - t0) : 0);
          }
        }
      } finally {
        out.end();
        await closed;
      }
      if (total === undefined || done >= total) {
        total = done;
        break;
      }
      throw new Error(`the connection closed at ${done} of ${total} bytes`);
    } catch (e) {
      if (signal?.aborted) throw e;
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new RuntimeError(t().install.noSpace(path.basename(dest), path.dirname(dest)), log.tail());
      }
      const now = fs.existsSync(part) ? fs.statSync(part).size : 0;
      stalled = now > before ? 0 : stalled + 1;
      log.line(`download ${path.basename(dest)} interrupted (${(e as Error).message}); ${stalled ? `attempt ${stalled} without progress` : 'resuming'}`);
      if (stalled >= MAX_STALLED_ATTEMPTS) {
        throw new RuntimeError(t().install.downloadFailed(path.basename(dest), (e as Error).message), log.tail());
      }
      await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** stalled, 30_000)));
    } finally {
      clearTimeout(idle);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  onBytes(total ?? 0, total, 0);
  log.line(`download ${path.basename(dest)}: checking`);
  if ((await sha256File(part)) !== sha256) {
    fs.rmSync(part, { force: true });
    throw new RuntimeError(t().install.damaged(path.basename(dest)), log.tail());
  }
  fs.renameSync(part, dest);
}

/** The requirements for this install: the shipped variant file + the project wheels, copied to a stable path. */
function writeRequirements(layout: Layout, manifest: Manifest, variant: Variant): { file: string; big: BigWheel[] } {
  const wheelDir = path.join(layout.runtime, 'wheels');
  fs.rmSync(wheelDir, { recursive: true, force: true });
  fs.mkdirSync(wheelDir, { recursive: true });
  const lines: string[] = [];
  for (const w of manifest.wheels) {
    const dst = path.join(wheelDir, w);
    fs.copyFileSync(path.join(layout.res.python, 'wheels', w), dst);
    lines.push(dst);
  }
  const shipped = fs.readFileSync(path.join(layout.res.python, `requirements-${variant}.txt`), 'utf8');
  const { wheels, text: base } = directWheels(shipped);
  const dl = downloadsDir(layout);
  const big = wheels.map((w) => ({ ...w, file: path.join(dl, decodeURIComponent(w.url.split('/').pop()!)) }));
  const out = path.join(layout.runtime, 'requirements.txt');
  fs.writeFileSync(out, `${base.trimEnd()}\n\n# this app's own packages\n${lines.join('\n')}\n`);
  return { file: out, big };
}

function downloadsDir(layout: Layout): string {
  return path.join(layout.cache, 'downloads');
}

const LABELS: Record<string, string> = { torch: 'PyTorch' };

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
    onProgress({ phase: 'python', message: t().install.python(manifest.python) });
    await exec(uv, ['venv', layout.venv, '--python', manifest.python, '--managed-python', '--clear'], {
      env, log, signal, onLine: (l) => onProgress({ phase: 'python', message: l }),
    });
  }

  // 2a. The one huge wheel (CUDA torch, 2 GB on Windows) is ours to fetch: uv starts a dropped download from zero,
  //     and on a slow link that can mean hours. Ours resumes, also across launches. Skipped once it is installed.
  const req = writeRequirements(layout, manifest, variant);
  const dl = downloadsDir(layout);
  fs.mkdirSync(dl, { recursive: true });
  const fetched: string[] = [];
  for (const w of req.big) {
    if (installedVersion(layout, manifest.python, w.name, w.version)) continue;
    const label = LABELS[w.name] ?? w.name;
    onProgress({ phase: 'download', message: t().install.wheel(label, w.version), bytes: 0 });
    await downloadResumable(w.url, w.file, w.sha256, log, (bytes, total, rate) => {
      onProgress({ phase: 'download', message: t().install.wheel(label, w.version), bytes, total, rate });
    }, signal);
    fetched.push(w.file);
  }

  // 2b. Exactly the locked packages for this variant (sync also removes what an older version installed)
  const cacheDir = env.UV_CACHE_DIR!;
  const before = await dirSize(cacheDir);
  onProgress({ phase: 'packages', message: t().install.engine, bytes: 0 });
  let measuring = false;
  let syncing = true;
  const timer = setInterval(() => {
    if (measuring) return; // one walk at a time
    measuring = true;
    void dirSize(cacheDir)
      .then((n) => syncing && onProgress({ phase: 'packages', message: '', bytes: Math.max(0, n - before) }))
      .finally(() => (measuring = false));
  }, 3000);
  try {
    const reinstall = manifest.workspacePackages.flatMap((p) => ['--reinstall-package', p]);
    await exec(uv, ['pip', 'sync', req.file, '--python', layout.python, '--find-links', dl, ...reinstall], {
      env, log, signal, onLine: (l) => onProgress({ phase: 'packages', message: l }),
    });
    await exec(uv, ['pip', 'check', '--python', layout.python], { env, log, signal });
  } finally {
    syncing = false;
    clearInterval(timer);
  }
  // installed: the wheel is in uv's cache now, and the version pin stays satisfied without the file
  for (const f of fetched) fs.rmSync(f, { force: true });

  // 3. Can the API and the pipeline import, and what does torch see?
  onProgress({ phase: 'check', message: t().install.phases.check });
  const out = await exec(layout.python, [layout.res.launch, 'check'], {
    env: cleanEnv(cacheEnv(layout)), log, signal, cwd: layout.runtime,
  });
  const info = JSON.parse(out.trim().split(/\r?\n/).pop() || '{}') as Partial<RuntimeState>;
  const state: RuntimeState = {
    variant,
    stamp: manifest.stamp,
    python: info.python ?? manifest.python,
    torch: info.torch ?? null,
    cuda: Boolean(info.cuda),
    gpu: info.gpu ?? null,
    gpuNote: info.gpuNote ?? null,
    installedAt: new Date().toISOString(),
  };

  // 4. The model files (separation, beats, hands): fetched now, where the wait is on screen, not during the first
  //    analysis. Best effort: offline, the worker fetches them on first use (and falls back without them).
  try {
    await exec(layout.python, [layout.res.launch, 'fetch-models'], {
      env: cleanEnv(cacheEnv(layout)), log, signal, cwd: layout.runtime,
      onLine: (l) => {
        let m: { model?: string; done?: number; total?: number; error?: string };
        try {
          m = JSON.parse(l);
        } catch {
          return;
        }
        if (m.model && m.done !== undefined) {
          onProgress({ phase: 'models', message: t().install.model(m.model), bytes: m.done, total: m.total });
        }
      },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    log.line(`model files not fetched now (the first analysis fetches them): ${(e as Error).message}`);
  }

  fs.writeFileSync(stateFile(layout), JSON.stringify(state, null, 2));
  log.line(`runtime ready: ${JSON.stringify(state)}`);
  return state;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} kB`;
}
