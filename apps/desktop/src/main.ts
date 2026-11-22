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
import { newer, notice } from './updates';
import { bundleEntries, systemFacts, zip } from './diagnostics';
import { lang, LANGS, type Lang, pickLang, setLang, t } from './i18n';

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
      title: t().variants.gpu,
      detail: hw.nvidia ? t().variants.gpuFound(hw.nvidia.name) : t().variants.gpuMissing,
      size: m.downloadEstimate.gpu,
      warning: hw.gpuTooOld
        ? t().variants.gpuTooOld(String(hw.nvidia?.name), String(hw.nvidia?.computeCap), String(MIN_COMPUTE_CAP))
        : hw.driverTooOld
          ? t().variants.driverOld(String(hw.nvidia?.driver), MIN_DRIVER_MAJOR)
          : undefined,
    },
    cpu: {
      id: 'cpu',
      title: t().variants.cpu,
      detail: t().variants.cpuDetail,
      size: m.downloadEstimate.cpu,
    },
    lite: {
      id: 'lite',
      title: t().variants.lite,
      detail: t().variants.liteDetail,
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
  let phase = t().install.gettingReady;
  let message = '';
  let written: string | undefined;
  let last: Phase | null = null;
  const labels: Record<Phase, string> = t().install.phases;
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
        written = t().install.of(formatBytes(p.bytes), formatBytes(p.total));
        if (p.rate && p.rate > 0) {
          const left = Math.max(0, (p.total - p.bytes) / p.rate);
          rate = t().install.rate(formatBytes(p.rate), left < 90 ? t().install.seconds(Math.max(1, Math.round(left))) : t().install.minutes(Math.round(left / 60)));
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
  sendSetup({ screen: 'starting', message: t().setup.opening });
  backend = new Backend({ layout, port: settings.port, startWorker: settings.startWorker });
  backend.on('port', (p: number) => {
    if (settings.port !== p) {
      settings.port = p;
      save();
    }
  });
  backend.on('api-crashed', (e: BackendError) => void showError(t().errors.stopped, e));
  backend.on('worker-gave-up', (e: BackendError) => {
    void dialog.showMessageBox({
      type: 'warning',
      message: t().errors.workerGaveUp,
      detail: t().errors.workerGaveUpDetail(e.logPath, e.logTail.slice(-1200)),
      buttons: [t().errors.ok, t().errors.openLog],
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
    await showError(backend ? t().errors.didNotStart : t().errors.notInstalled, e);
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

/** The latest release tag seen, kept from the last check: a start later the same day skips the fetch. */
let latestRelease: string | null = settings.latestRelease ?? null;

/**
 * Asks GitHub for the latest release, once a day unless asked from the menu. The request carries the computer's IP
 * address like any web request, a fixed User-Agent and nothing else. Releases/latest leaves out drafts and
 * pre-releases; the beta (0.9.x) goes out as ordinary releases to its testers.
 */
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
    latestRelease = settings.latestRelease = rel.tag_name;
    save();
    sendDesktopState(); // the app page shows a small notice in its top bar, unless this version was dismissed
    if (manual && newer(rel.tag_name, app.getVersion())) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        message: t().updates.available(APP_NAME, rel.tag_name.replace(/^v/, '')),
        detail: t().updates.availableDetail(app.getVersion()),
        buttons: [t().updates.download, t().updates.later],
        defaultId: 0,
      });
      if (response === 0) void shell.openExternal(SITE);
    } else if (manual) {
      void dialog.showMessageBox({ type: 'info', message: t().updates.latest, detail: app.getVersion() });
    }
  } catch (e) {
    desktopLog.line(`update check failed: ${(e as Error).message}`);
    if (manual) void dialog.showMessageBox({ type: 'warning', message: t().updates.failed, detail: (e as Error).message });
  }
}

// ───────────────────────────── diagnostics bundle ─────────────────────────────

/** Asks where to save the diagnostics bundle (src/diagnostics.ts), writes it, shows it in its folder. */
async function exportDiagnostics() {
  const day = new Date().toISOString().slice(0, 10);
  const opts = {
    title: t().diagnostics.save,
    defaultPath: path.join(app.getPath('downloads'), `taber-diagnostics-${day}.zip`),
    filters: [{ name: t().diagnostics.zip, extensions: ['zip'] }],
  };
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (canceled || !filePath) return;
  let health: Record<string, unknown> | null = null;
  if (backend?.port) {
    try {
      health = (await (await fetch(`${backend.url}/api/v1/health`, { signal: AbortSignal.timeout(3000) })).json()) as Record<string, unknown>;
    } catch {
      /* the engine is not answering: the logs say why */
    }
  }
  const about = {
    createdAt: new Date().toISOString(),
    ...desktopInfo(), // what the Engine panel shows: versions, engine, worker, folders
    electron: process.versions.electron,
    engine: runtime ?? null,
    pipeline: health?.pipeline ?? null,
    health,
    hardware,
    system: systemFacts(layout.data),
    settings,
  };
  try {
    fs.writeFileSync(filePath, zip(bundleEntries(layout.logs, about)));
    shell.showItemInFolder(filePath);
  } catch (e) {
    void dialog.showMessageBox({ type: 'warning', message: t().diagnostics.failed, detail: (e as Error).message });
  }
}

// ───────────────────────────── menu ─────────────────────────────

function engineInfo() {
  const r = runtime;
  const i = t().engineInfo;
  const lines = [
    i.engine(r?.variant ?? i.notInstalled),
    `Python ${r?.python ?? '?'}, torch ${r?.torch ?? i.notInstalled}`,
    i.gpu(r?.cuda ? String(r.gpu) : r?.gpuNote ? i.gpuNotUsedWhy(r.gpuNote) : i.gpuNotUsed),
    i.api(backend?.apiState ?? 'stopped', backend?.url ?? '-'),
    i.worker(backend?.workerState ?? 'stopped'),
    '',
    i.data(layout.data),
    i.files(layout.runtime),
    i.cache(layout.cache),
    i.logs(layout.logs),
  ];
  void dialog.showMessageBox({ type: 'info', message: i.title, detail: lines.join('\n') });
}

function buildMenu() {
  if (!MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: t().menu.file,
      submenu: [
        { label: t().menu.openData, click: () => void shell.openPath(layout.data) },
        { label: t().menu.openLogs, click: () => void shell.openPath(layout.logs) },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' }, // copy / paste in text fields on macOS needs it
    {
      label: t().menu.view,
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
      label: t().menu.engine,
      submenu: [
        {
          label: t().menu.localWorker,
          type: 'checkbox',
          checked: settings.startWorker,
          click: (item) => {
            settings.startWorker = item.checked;
            save();
            void backend?.setWorkerEnabled(item.checked);
          },
        },
        { label: t().menu.restart, click: () => void boot(false) },
        { label: t().menu.change, click: () => void boot(true) },
        { type: 'separator' },
        { label: t().menu.info, click: engineInfo },
      ],
    },
    {
      role: 'help',
      label: t().menu.help,
      submenu: [
        { label: t().menu.downloadPage, click: () => void shell.openExternal(SITE) },
        { label: t().menu.checkUpdates, click: () => void checkForUpdates(true) },
        { label: t().menu.exportDiagnostics, click: () => void exportDiagnostics() },
        { label: t().menu.report, click: () => void shell.openExternal(`https://github.com/${REPO}/issues`) },
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
  /** a newer release to tell the user about (not dismissed), else null */
  update: string | null;
  checkUpdates: boolean;
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
    update: settings.checkUpdates ? notice(latestRelease, app.getVersion(), settings.dismissedUpdate) : null,
    checkUpdates: settings.checkUpdates,
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
    case 'export-diagnostics': void exportDiagnostics(); break;
    case 'report-problem': void shell.openExternal(`https://github.com/${REPO}/issues`); break;
    case 'download-page': void shell.openExternal(SITE); break;
    case 'devtools': win?.webContents.toggleDevTools(); break;
    case 'language': {
      // the language picked in the app: kept in settings.json (the page's own storage follows the port), used here too
      // any language the app knows of, even before the shell has its words (t() falls back to English)
      if (!LANGS.includes(arg as Lang)) return;
      settings.language = arg as Lang;
      save();
      setLang(pickLang(settings.language, app.getPreferredSystemLanguages()));
      buildMenu();
      break;
    }
    case 'update-dismiss': {
      const v = notice(latestRelease, app.getVersion(), settings.dismissedUpdate);
      if (!v) return;
      settings.dismissedUpdate = v; // until a newer one comes out
      save();
      sendDesktopState();
      break;
    }
    case 'auto-updates':
      if (typeof arg !== 'boolean') return;
      settings.checkUpdates = arg;
      save();
      sendDesktopState();
      break;
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

// both pages ask once, while they load, so their first paint is already in the right language. Like every call,
// checked against the sender: the setup page (file://) or the app page.
const fromSetup = (e: IpcMainEvent) => (e.senderFrame?.url ?? '').startsWith('file:');
ipcMain.on('setup:lang', (e) => {
  e.returnValue = fromSetup(e) ? lang() : null;
});
ipcMain.on('setup:strings', (e) => {
  e.returnValue = fromSetup(e) ? t().setup : {};
});
// the app page gets the saved choice, not the shell's: the web app may have a language before the shell does
ipcMain.on('desktop:lang', (e) => {
  e.returnValue = fromApp(e) ? settings.language ?? null : null;
});

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
ipcMain.on('setup:export-diagnostics', (e) => fromSetup(e) && void exportDiagnostics());
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
  setLang(pickLang(settings.language, app.getPreferredSystemLanguages()));
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
