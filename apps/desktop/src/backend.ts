/**
 * The API and the local worker as child processes: the same two commands as `just app` and `just worker`,
 * with the folders of this computer (docs/adr/ADR-011-desktop-app.md, "Vòng đời tiến trình").
 * No Electron import: the smoke test drives this from plain Node.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { cacheEnv, cleanEnv, type Layout, prependPath } from './layout';
import { LogFile } from './log';
import { t } from './i18n';

export type ProcState = 'stopped' | 'starting' | 'running' | 'crashed';

export interface BackendOptions {
  layout: Layout;
  /** preferred port (kept across launches); another free one is used when it is taken */
  port?: number;
  startWorker: boolean;
}

export class BackendError extends Error {
  constructor(message: string, readonly logPath: string, readonly logTail: string) {
    super(message);
  }
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '127.0.0.1', exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen({ port: 0, host: '127.0.0.1' }, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(child: ChildProcess | null): child is ChildProcess {
  return !!child && child.exitCode === null && child.signalCode === null;
}

/** Stop a child and whatever it started (ffmpeg): process group on POSIX, taskkill /T on Windows. */
function killTree(child: ChildProcess | null, graceMs = 5000): Promise<void> {
  if (!alive(child) || child.pid === undefined) return Promise.resolve();
  const pid = child.pid;
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(hard);
      resolve();
    };
    child.once('exit', done);
    const hard = setTimeout(() => {
      try {
        if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      setTimeout(resolve, 500);
    }, graceMs);
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
  });
}

export class Backend extends EventEmitter {
  readonly layout: Layout;
  port = 0;
  api: ChildProcess | null = null;
  worker: ChildProcess | null = null;
  apiState: ProcState = 'stopped';
  workerState: ProcState = 'stopped';
  apiLog: LogFile | null = null;
  workerLog: LogFile | null = null;
  private startWorker: boolean;
  private preferredPort?: number;
  private stopping = false;
  private workerCrashes: number[] = [];

  constructor(opts: BackendOptions) {
    super();
    this.layout = opts.layout;
    this.preferredPort = opts.port;
    this.startWorker = opts.startWorker;
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private env(): NodeJS.ProcessEnv {
    const { layout } = this;
    const env = cleanEnv({
      TABER_DATA_DIR: layout.data,
      TABER_SPA_DIR: layout.res.web,
      TABER_HOST: '127.0.0.1',
      TABER_PORT: String(this.port),
      TABER_TRUSTED_HOSTS: JSON.stringify(['127.0.0.1', 'localhost']),
      ...cacheEnv(layout),
      TABER_DESKTOP_PARENT_PID: String(process.pid),
    });
    return fs.existsSync(layout.res.ffmpegBin) ? prependPath(env, layout.res.ffmpegBin) : env;
  }

  private spawnPython(args: string[], log: LogFile): ChildProcess {
    const child = spawn(this.layout.python, [this.layout.res.launch, ...args], {
      cwd: this.layout.data,
      env: this.env(),
      windowsHide: true,
      detached: process.platform !== 'win32', // own process group, so a stop also reaches ffmpeg
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (b: Buffer) => log.write(b));
    child.stderr?.on('data', (b: Buffer) => log.write(b));
    return child;
  }

  async start(): Promise<string> {
    this.stopping = false;
    fs.mkdirSync(this.layout.data, { recursive: true });
    this.port = this.preferredPort && (await isPortFree(this.preferredPort)) ? this.preferredPort : await freePort();
    this.emit('port', this.port);
    await this.startApi();
    if (this.startWorker) this.spawnWorker();
    return this.url;
  }

  private async startApi(): Promise<void> {
    this.apiLog = new LogFile(this.layout.logs, 'api');
    this.apiLog.line(`starting API on ${this.url}`);
    this.setApi('starting');
    const child = this.spawnPython(['api'], this.apiLog);
    this.api = child;
    let exited: string | null = null;
    child.on('error', (e) => (exited = e.message));
    child.on('exit', (code, sig) => {
      exited = `exit code ${code ?? sig}`;
      if (!this.stopping) {
        this.setApi('crashed');
        this.emit('api-crashed', new BackendError(t().errors.apiStopped(String(exited)), this.apiLog!.path, this.apiLog!.tail()));
      }
    });
    // first start on Windows can take a while: antivirus scans every new .pyd
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (exited) throw new BackendError(t().errors.apiDidNotStart(String(exited)), this.apiLog.path, this.apiLog.tail());
      try {
        const r = await fetch(`${this.url}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok && (await r.json()).ok) {
          this.setApi('running');
          return;
        }
      } catch {
        /* not listening yet */
      }
      await sleep(300);
    }
    await killTree(child);
    throw new BackendError(t().errors.apiSilent, this.apiLog.path, this.apiLog.tail());
  }

  private spawnWorker(): void {
    if (alive(this.worker)) return;
    const { layout } = this;
    if (!this.workerLog) this.workerLog = new LogFile(layout.logs, 'worker');
    this.workerLog.line(`starting worker for ${this.url}`);
    this.setWorker('starting');
    const child = this.spawnPython(
      ['worker', '--api', this.url, '--token-file', path.join(layout.data, 'worker_token'), '--location', 'local',
        '--cache-dir', path.join(layout.cache, 'inputs')],
      this.workerLog,
    );
    this.worker = child;
    child.on('spawn', () => this.setWorker('running'));
    child.on('exit', (code, sig) => {
      if (this.stopping || this.worker !== child) return;
      this.setWorker('crashed');
      const now = Date.now();
      this.workerCrashes = [...this.workerCrashes.filter((t) => now - t < 5 * 60_000), now];
      const n = this.workerCrashes.length;
      this.workerLog?.line(`worker exited (${code ?? sig}), crash ${n} in the last 5 minutes`);
      if (n >= 5) {
        this.emit('worker-gave-up', new BackendError(t().errors.workerGaveUp, this.workerLog!.path, this.workerLog!.tail()));
        return;
      }
      setTimeout(() => !this.stopping && this.spawnWorker(), [2000, 5000, 15000, 30000][n - 1] ?? 30000);
    });
  }

  async setWorkerEnabled(on: boolean): Promise<void> {
    this.startWorker = on;
    if (on) {
      this.workerCrashes = [];
      if (this.apiState === 'running') this.spawnWorker();
    } else {
      const w = this.worker;
      this.worker = null;
      await killTree(w);
      this.setWorker('stopped');
    }
  }

  async restart(): Promise<string> {
    await this.stop();
    return this.start();
  }

  /** worker first (it may be mid-job: the lease expires and the job is queued again), then the API */
  async stop(): Promise<void> {
    this.stopping = true;
    const w = this.worker;
    this.worker = null;
    await killTree(w);
    this.setWorker('stopped');
    await killTree(this.api);
    this.api = null;
    this.setApi('stopped');
    await this.apiLog?.close();
    await this.workerLog?.close();
    this.apiLog = this.workerLog = null;
  }

  private setApi(s: ProcState) {
    this.apiState = s;
    this.emit('state');
  }

  private setWorker(s: ProcState) {
    this.workerState = s;
    this.emit('state');
  }
}
