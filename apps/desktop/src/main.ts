/**
 * Electron main process: one window, the setup screen until the engine is ready, then the web app served by the
 * local API. The flow behind it is unchanged: API + pull worker (docs/adr/ADR-011-desktop-app.md).
 */
import {
  app, BrowserWindow, dialog, type IpcMainEvent, type IpcMainInvokeEvent, ipcMain, Menu, type MenuItemConstructorOptions, nativeTheme,
  session, shell,
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Backend, BackendError } from './backend';
import { detectHardware, type Hardware, MIN_COMPUTE_CAP, MIN_DRIVER_MAJOR, recommend } from './hardware';
import { APP_NAME, resolveLayout } from './layout';
import { LogFile } from './log';
import {
  formatBytes, type Manifest, type Phase, provision, readManifest, RuntimeError, type RuntimeState, runtimeStatus, type Variant,
} from './runtime';
import { loadSettings, saveSettings, type Settings } from './settings';

const REPO = 'habaodunggithub/HBAGuitarTaber';
const SITE = 'https://habaodunggithub.github.io/HBAGuitarTaber/';
const SELFTEST = process.env.TABER_DESKTOP_SELFTEST === '1';
const MAC = process.platform === 'darwin';

app.setName(APP_NAME);
if (!app.requestSingleInstanceLock()) {
  // a second API on the same SQLite file and data folder would fight the first one
  app.quit();
}

const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'stage');
const layout = resolveLayout(resources);
const setupPage = path.join(__dirname, 'static', 'setup.html');
let settings: Settings = loadSettings(layout.settingsFile);
let win: BrowserWindow | null = null;
let backend: Backend | null = null;
let manifest: Manifest | null = null;
let hardware: Hardware | null = null;
let runtime: RuntimeState | null = null;
let desktopLog: LogFile;
let quitting = false;
let stopped = false;

/** what the setup page shows; the page only renders it and sends actions back */
type SetupState =
  | { screen: 'boot' }
  | { screen: 'choose'; variants: VariantCard[]; recommended: Variant; current?: Variant; installDir: string; reason: string }
  | {
    screen: 'installing'; variant: Variant; phase: string; message: string; written?: string; startedAt: number;
    /** 0..1 for a download of known size (the bar on the setup page), else undefined */
    fraction?: number;
    /** "4.2 MB/s, about 6 min left" */
    rate?: string;
  }
  | { screen: 'starting'; message: string }
  | { screen: 'error'; title: string; message: string; logTail: string; logPath: string };

interface VariantCard {
  id: Variant;
  title: string;
  detail: string;
  size: string;
  warning?: string;
}

let setupState: SetupState = { screen: 'boot' };

function sendSetup(s: SetupState) {
  setupState = s;
  win?.webContents.send('setup:state', s);
}

function save() {
  saveSettings(layout.settingsFile, settings);
}

// ───────────────────────────── window ─────────────────────────────

function isAppUrl(url: string): boolean {
  if (backend?.port && url.startsWith(`${backend.url}/`)) return true;
  return url.startsWith('file:') && decodeURIComponent(new URL(url).pathname).endsWith('/static/setup.html');
}

function createWindow(): BrowserWindow {
  const w = settings.window;
  const night = nativeTheme.shouldUseDarkColors;
  const bw = new BrowserWindow({
    width: w?.width ?? 1440,
    height: w?.height ?? 900,
    x: w?.x,
    y: w?.y,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    backgroundColor: night ? '#161c2c' : '#efe7d6', // the app's paper, so there is no white flash
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (w?.maximized) bw.maximize();
  bw.once('ready-to-show', () => !SELFTEST && bw.show());
  if (!MAC) {
    // no File / Edit / View bar on Windows and Linux: the engine commands live in the app's own menu (Shell.tsx),
    // and the shortcuts that menu carried still work
    bw.removeMenu();
    bw.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const mod = input.control || input.meta;
      const key = input.key.toLowerCase();
      const wc = bw.webContents;
      const act =
        key === 'f5' || (mod && !input.shift && key === 'r') ? () => wc.reload()
        : key === 'f12' || (mod && input.shift && key === 'i') ? () => wc.toggleDevTools()
        : key === 'f11' ? () => bw.setFullScreen(!bw.isFullScreen())
        : mod && (key === '=' || key === '+') ? () => wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4))
        : mod && key === '-' ? () => wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3))
        : mod && key === '0' ? () => wc.setZoomLevel(0)
        : null;
      if (act) {
        e.preventDefault();
        act();
      }
    });
  }

  // only the local app and the setup page load in this window; links go to the system browser
  bw.webContents.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return;
    e.preventDefault(); // also stops a file dropped outside the drop zone from replacing the app
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  bw.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: 'allow' };
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  bw.on('close', () => {
    const b = bw.getNormalBounds();
    settings.window = { width: b.width, height: b.height, x: b.x, y: b.y, maximized: bw.isMaximized() };
    save();
  });
  bw.on('closed', () => {
    if (win === bw) win = null;
  });
  return bw;
}

async function showSetup() {
  if (!win) win = createWindow();
  await win.loadFile(setupPage);
}

async function showApp() {
  if (!backend) return;
  if (!win) win = createWindow();
  await win.loadURL(`${backend.url}/`);
}

// ───────────────────────────── engine ─────────────────────────────

function variantCards(m: Manifest, hw: Hardware): VariantCard[] {
  const cards: Record<Variant, VariantCard> = {
    gpu: {
      id: 'gpu',
      title: 'NVIDIA GPU',
      detail: hw.nvidia
        ? `Fastest. Runs the models on your ${hw.nvidia.name}.`
        : 'Fastest, but needs an NVIDIA graphics card, and none was found.',
      size: m.downloadEstimate.gpu,
      warning: hw.gpuTooOld
        ? `Your ${hw.nvidia?.name} (compute ${hw.nvidia?.computeCap}) is too old for this GPU build, which needs ${MIN_COMPUTE_CAP} or newer (GTX 16 / RTX 20 series and up). The models would run on the processor after a large download: choose Processor.`
        : hw.driverTooOld
          ? `Driver ${hw.nvidia?.driver} is older than ${MIN_DRIVER_MAJOR}: update it first, or the models run on the CPU.`
          : undefined,
    },
    cpu: {
      id: 'cpu',
      title: 'Processor',
      detail: 'Every model, on the processor. Same tabs, slower analysis.',
      size: m.downloadEstimate.cpu,
    },
    lite: {
      id: 'lite',
      title: 'Lite',
      detail: 'Smallest. Lighter pitch tracker, no backing-track removal, no string classifier. Video still works.',
      size: m.downloadEstimate.lite,
    },
  };
  return m.variants.filter((v) => v !== 'gpu' || hw.nvidia).map((v) => cards[v]);
}

async function ensureEngine(forceChoose = false): Promise<void> {
  manifest = readManifest(layout);
  hardware ??= await detectHardware();
  const status = runtimeStatus(layout, manifest);
  desktopLog.line(`runtime status: ${JSON.stringify(status)} hardware: ${JSON.stringify(hardware)}`);
  if (status.ready && !forceChoose) {
    runtime = status.state;
    return;
  }
  if (SELFTEST && !status.ready) {
    // CI on a clean machine (.github/workflows/desktop.yml): install the named engine without asking, as the setup page would
    const v = process.env.TABER_DESKTOP_SELFTEST_VARIANT as Variant | undefined;
    if (!v || !manifest.variants.includes(v)) throw new RuntimeError('selftest needs an installed runtime, or TABER_DESKTOP_SELFTEST_VARIANT', '');
    await install(v);
    return;
  }
  // an update of the app keeps the variant the user chose: no question, just sync
  const keep = !forceChoose && status.state?.variant && manifest.variants.includes(status.state.variant) ? status.state.variant : null;
  const variant = keep ?? (await askVariant(manifest, hardware, forceChoose || status.ready ? 'change' : status.reason));
  await install(variant);
}

let pickVariant: ((v: Variant) => void) | null = null;

function askVariant(m: Manifest, hw: Hardware, reason: string): Promise<Variant> {
  return new Promise((resolve) => {
    pickVariant = resolve;
    sendSetup({
      screen: 'choose',
      variants: variantCards(m, hw),
      recommended: recommend(hw, m.variants),
      current: runtime?.variant,
      installDir: layout.runtime,
      reason,
    });
  });
}

async function install(variant: Variant): Promise<void> {
  const log = new LogFile(layout.logs, 'runtime');
  const startedAt = Date.now();
  let phase = 'Getting ready';
  let message = '';
  let written: string | undefined;
  let last: Phase | null = null;
  const labels: Record<Phase, string> = {
    python: 'Getting Python',
    download: 'Downloading PyTorch',
    packages: 'Installing the engine',
    check: 'Checking the engine',
    models: 'Downloading the models',
  };
  try {
    runtime = await provision(layout, manifest!, variant, log, (p) => {
      if (p.phase !== last) {
        last = p.phase;
        written = undefined;
      }
      phase = labels[p.phase];
      if (p.message) message = p.message;
      let fraction: number | undefined;
      let rate: string | undefined;
      if (p.bytes !== undefined && p.total) {
        fraction = Math.min(1, p.bytes / p.total);
        written = `${formatBytes(p.bytes)} of ${formatBytes(p.total)}`;
        if (p.rate && p.rate > 0) {
          const left = Math.max(0, (p.total - p.bytes) / p.rate);
          rate = `${formatBytes(p.rate)}/s, about ${left < 90 ? `${Math.max(1, Math.round(left))} s` : `${Math.round(left / 60)} min`} left`;
        }
      } else if (p.bytes !== undefined) {
        written = formatBytes(p.bytes);
      }
      sendSetup({ screen: 'installing', variant, phase, message, written, startedAt, fraction, rate });
    });
    settings.variant = variant;
    save();
  } finally {
    await log.close();
  }
}

async function startBackend(): Promise<void> {
  sendSetup({ screen: 'starting', message: 'Opening the notebook' });
  backend = new Backend({ layout, port: settings.port, startWorker: settings.startWorker });
  backend.on('port', (p: number) => {
    if (settings.port !== p) {
      settings.port = p;
      save();
    }
  });
  backend.on('api-crashed', (e: BackendError) => void showError('The engine stopped', e));
  backend.on('worker-gave-up', (e: BackendError) => {
    void dialog.showMessageBox({
      type: 'warning',
      message: 'The analysis worker keeps stopping',
      detail: `New recordings will wait in the queue. The log is at:\n${e.logPath}\n\n${e.logTail.slice(-1200)}`,
      buttons: ['OK', 'Open log'],
    }).then((r) => r.response === 1 && shell.showItemInFolder(e.logPath));
  });
  backend.on('state', () => {
    buildMenu();
    sendDesktopState();
  });
  await backend.start();
}

async function showError(title: string, e: unknown) {
  const err = e as Partial<BackendError & RuntimeError> & Error;
  desktopLog.line(`${title}: ${err.message}\n${err.logTail ?? ''}`);
  if (SELFTEST) {
    console.error(`${title}: ${err.message}\n${err.logTail ?? ''}`);
    app.exit(1);
    return;
  }
  await showSetup();
  sendSetup({
    screen: 'error',
    title,
    message: err.message,
    logTail: err.logTail ?? '',
    logPath: err.logPath ?? layout.logs,
  });
}

async function boot(forceChoose = false) {
  try {
    if (backend) {
      await backend.stop();
      backend = null;
    }
    await showSetup();
    await ensureEngine(forceChoose);
    await startBackend();
    await showApp();
    buildMenu();
    if (SELFTEST) await selftest();
    else setTimeout(() => void checkForUpdates(false), 8000);
  } catch (e) {
    await showError(backend ? 'The engine did not start' : 'The engine could not be installed', e);
  }
}

/** TABER_DESKTOP_SELFTEST=1: start everything in a hidden window, check that the SPA rendered, quit. */
async function selftest() {
  const wc = win!.webContents;
  const deadline = Date.now() + 30_000;
  let rendered = 0;
  while (Date.now() < deadline && !rendered) {
    rendered = await wc.executeJavaScript('document.getElementById("root")?.childElementCount ?? 0');
    if (!rendered) await new Promise((r) => setTimeout(r, 250));
  }
  const title = await wc.executeJavaScript('document.title');
  let workers = 0;
  while (settings.startWorker && Date.now() < deadline + 60_000 && !workers) {
    workers = ((await (await fetch(`${backend!.url}/api/v1/workers`)).json()) as unknown[]).length;
    if (!workers) await new Promise((r) => setTimeout(r, 500));
  }
  // the app page reaches the engine commands through the bridge, and Windows / Linux show no menu bar
  const bridge = await wc.executeJavaScript(
    'window.taberDesktop ? window.taberDesktop.info().then((i) => (i ? i.api : "no info")) : "no bridge"',
  );
  const noMenuBar = MAC || Menu.getApplicationMenu() === null;
  const ok = rendered > 0 && (workers > 0 || !settings.startWorker) && bridge === 'running' && noMenuBar;
  console.log(JSON.stringify({ selftest: ok ? 'ok' : 'failed', url: backend!.url, title, rendered, workers, bridge, noMenuBar, runtime }));
  await backend!.stop();
  stopped = true;
  app.exit(ok ? 0 : 1);
}

// ───────────────────────────── updates ─────────────────────────────

function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** Asks GitHub for the latest release (no data about the user is sent), once a day unless asked from the menu. */
async function checkForUpdates(manual: boolean) {
  if (!manual && (!settings.checkUpdates || Date.now() - (settings.lastUpdateCheck ?? 0) < 86_400_000)) return;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'HBA-Guitar-Taber-Desktop' },
      signal: AbortSignal.timeout(10_000),
    });
    settings.lastUpdateCheck = Date.now();
    save();
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    const rel = (await r.json()) as { tag_name: string; html_url: string };
    if (newer(rel.tag_name, app.getVersion())) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        message: `${APP_NAME} ${rel.tag_name.replace(/^v/, '')} is available`,
        detail: `You have ${app.getVersion()}. Your tabs and the engine are kept when you install the new version.`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
      });
      if (response === 0) void shell.openExternal(SITE);
    } else if (manual) {
      void dialog.showMessageBox({ type: 'info', message: 'You have the latest version', detail: app.getVersion() });
    }
  } catch (e) {
    desktopLog.line(`update check failed: ${(e as Error).message}`);
    if (manual) void dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates', detail: (e as Error).message });
  }
}

// ───────────────────────────── menu ─────────────────────────────

function engineInfo() {
  const r = runtime;
  const lines = [
    `Engine: ${r?.variant ?? 'not installed'}`,
    `Python ${r?.python ?? '?'}, torch ${r?.torch ?? 'not installed'}`,
    `GPU: ${r?.cuda ? r.gpu : r?.gpuNote ? `not used (${r.gpuNote})` : 'not used'}`,
    `API: ${backend?.apiState ?? 'stopped'} on ${backend?.url ?? '-'}`,
    `Local worker: ${backend?.workerState ?? 'stopped'}`,
    '',
    `Data: ${layout.data}`,
    `Engine files: ${layout.runtime}`,
    `Cache: ${layout.cache}`,
    `Logs: ${layout.logs}`,
  ];
  void dialog.showMessageBox({ type: 'info', message: 'Engine', detail: lines.join('\n') });
}

function buildMenu() {
  if (!MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'Open data folder', click: () => void shell.openPath(layout.data) },
        { label: 'Open logs folder', click: () => void shell.openPath(layout.logs) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' }, // copy / paste in text fields on macOS needs it
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Engine',
      submenu: [
        {
          label: 'Local analysis worker',
          type: 'checkbox',
          checked: settings.startWorker,
          click: (item) => {
            settings.startWorker = item.checked;
            save();
            void backend?.setWorkerEnabled(item.checked);
          },
        },
        { label: 'Restart engine', click: () => void boot(false) },
        { label: 'Change engine…', click: () => void boot(true) },
        { type: 'separator' },
        { label: 'Engine info', click: engineInfo },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Download page', click: () => void shell.openExternal(SITE) },
        { label: 'Check for updates…', click: () => void checkForUpdates(true) },
        { label: 'Report a problem', click: () => void shell.openExternal(`https://github.com/${REPO}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ───────────────────────────── app page IPC ─────────────────────────────
// The app page (served by the local API) gets a few commands, the ones the Engine menu had. Only that page may
// call them: the window loads nothing else (will-navigate above), and every call checks the sender again.

interface DesktopInfo {
  version: string;
  platform: NodeJS.Platform;
  variant: Variant | null;
  python: string | null;
  torch: string | null;
  gpu: string | null;
  gpuNote: string | null;
  api: string;
  worker: string;
  workerEnabled: boolean;
  paths: { data: string; runtime: string; cache: string; logs: string };
}

function desktopInfo(): DesktopInfo {
  return {
    version: app.getVersion(),
    platform: process.platform,
    variant: runtime?.variant ?? null,
    python: runtime?.python ?? null,
    torch: runtime?.torch ?? null,
    gpu: runtime?.cuda ? runtime.gpu : null,
    gpuNote: runtime?.gpuNote ?? null,
    api: backend?.apiState ?? 'stopped',
    worker: backend?.workerState ?? 'stopped',
    workerEnabled: settings.startWorker,
    paths: { data: layout.data, runtime: layout.runtime, cache: layout.cache, logs: layout.logs },
  };
}

function fromApp(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return !!backend?.port && url.startsWith(`${backend.url}/`);
}

function sendDesktopState() {
  const wc = win?.webContents;
  if (wc && backend?.port && wc.getURL().startsWith(`${backend.url}/`)) wc.send('desktop:state', desktopInfo());
}

ipcMain.handle('desktop:info', (e) => (fromApp(e) ? desktopInfo() : null));
ipcMain.on('desktop:action', (e, action: unknown, arg: unknown) => {
  if (!fromApp(e)) return;
  switch (action) {
    case 'restart-engine': void boot(false); break;
    case 'change-engine': void boot(true); break;
    case 'open-logs': void shell.openPath(layout.logs); break;
    case 'open-data': void shell.openPath(layout.data); break;
    case 'check-updates': void checkForUpdates(true); break;
    case 'report-problem': void shell.openExternal(`https://github.com/${REPO}/issues`); break;
    case 'download-page': void shell.openExternal(SITE); break;
    case 'devtools': win?.webContents.toggleDevTools(); break;
    case 'worker':
      if (typeof arg !== 'boolean') return;
      settings.startWorker = arg;
      save();
      void backend?.setWorkerEnabled(arg);
      sendDesktopState();
      break;
  }
});

// ───────────────────────────── setup page IPC ─────────────────────────────

ipcMain.on('setup:ready', (e) => e.sender.send('setup:state', setupState));
ipcMain.on('setup:install', (_e, v: Variant) => {
  if (pickVariant && manifest?.variants.includes(v)) {
    const p = pickVariant;
    pickVariant = null;
    p(v);
  }
});
ipcMain.on('setup:retry', () => void boot(false));
ipcMain.on('setup:change', () => void boot(true));
ipcMain.on('setup:open-logs', () => void shell.openPath(layout.logs));
ipcMain.on('setup:quit', () => app.quit());

// ───────────────────────────── lifecycle ─────────────────────────────

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  fs.mkdirSync(layout.logs, { recursive: true });
  desktopLog = new LogFile(layout.logs, 'desktop');
  desktopLog.line(`${APP_NAME} ${app.getVersion()} on ${process.platform}-${process.arch}, resources ${resources}`);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Ha Van Thien Bao',
    website: SITE,
  });
  // the app asks for nothing (no camera, microphone, location, notifications)
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen' || perm === 'clipboard-sanitized-write'));
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  buildMenu();
  void boot(false);
});

app.on('activate', () => {
  if (!win && backend?.apiState === 'running') void showApp();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (e) => {
  if (stopped || !backend) return;
  e.preventDefault();
  if (quitting) return;
  quitting = true;
  const b = backend;
  void b.stop().finally(() => {
    stopped = true;
    app.quit();
  });
});
