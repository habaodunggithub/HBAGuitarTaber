/**
 * What the desktop shell itself says (the setup page, dialogs, the macOS menu, install progress), in the same
 * shape as the web app's catalog (apps/web/src/i18n): `en` is the source, other languages copy its keys.
 * The language is one choice for the shell and the web app: settings.json `language`, else the computer's.
 *
 * `setup` goes to the setup page over IPC, so its messages are plain strings with {placeholders} that
 * static/setup.js fills; the rest are used here and may be functions.
 */

export type Lang = 'en' | 'vi';
export const LANGS: readonly Lang[] = ['en', 'vi'];

export const en = {
  language: { name: 'English' },

  setup: {
    opening: 'opening the notebook…',
    title: 'Set up the engine',
    lede: 'Taber listens with a few models: pitch, note onsets, beats, and which string you played. They run on this computer. They are downloaded once, from PyPI and PyTorch, into',
    install: 'Install',
    keep: 'Keep {variant}',
    picked: 'picked for this computer',
    changeLaterMenu: 'you can change this later, from the Engine menu',
    changeLaterLight: 'you can change this later, from the engine light in the top bar',
    installing: 'Setting up the engine',
    step: 'Step',
    onDisk: 'On disk',
    downloaded: 'Downloaded',
    speed: 'Speed',
    time: 'Time',
    progress: 'Download progress',
    once: 'This happens once. If the connection drops or you close the app, the download continues where it stopped next time.',
    fullLog: 'Full log:',
    emptyLog: '(nothing in the log)',
    retry: 'Try again',
    change: 'Change engine',
    openLogs: 'Open logs',
    exportDiagnostics: 'Export diagnostics bundle',
    quit: 'Quit',
  },

  diagnostics: {
    save: 'Save the diagnostics bundle',
    zip: 'Zip archive',
    failed: 'Could not write the diagnostics bundle',
  },

  variants: {
    gpu: 'NVIDIA GPU',
    gpuFound: (name: string) => `Fastest. Runs the models on your ${name}.`,
    gpuMissing: 'Fastest, but needs an NVIDIA graphics card, and none was found.',
    gpuTooOld: (name: string, cap: string, min: string) =>
      `Your ${name} (compute ${cap}) is too old for this GPU build, which needs ${min} or newer (GTX 16 / RTX 20 series and up). The models would run on the processor after a large download: choose Processor.`,
    driverOld: (driver: string, min: number) => `Driver ${driver} is older than ${min}: update it first, or the models run on the CPU.`,
    cpu: 'Processor',
    cpuDetail: 'Every model, on the processor. Same tabs, slower analysis.',
    lite: 'Lite',
    liteDetail: 'Smallest. Lighter pitch tracker, no backing-track removal, no string classifier. Video still works.',
  },

  install: {
    gettingReady: 'Getting ready',
    phases: {
      python: 'Getting Python',
      download: 'Downloading PyTorch',
      packages: 'Installing the engine',
      check: 'Checking the engine',
      models: 'Downloading the models',
    },
    python: (version: string) => `Getting Python ${version}`,
    wheel: (name: string, version: string) => `Downloading ${name} ${version}`,
    engine: 'Downloading the analysis engine',
    model: (model: string) => `Downloading the ${model}`,
    of: (done: string, total: string) => `${done} of ${total}`,
    rate: (rate: string, left: string) => `${rate}/s, about ${left} left`,
    seconds: (s: number) => `${s} s`,
    minutes: (m: number) => `${m} min`,
    noSpace: (file: string, dir: string) =>
      `Not enough free disk space for ${file} (in ${dir}). Free some space and try again: the download continues where it stopped.`,
    downloadFailed: (file: string, why: string) =>
      `Could not download ${file}: ${why}. Check the internet connection and try again: the download continues where it stopped.`,
    damaged: (file: string) => `${file} arrived damaged (checksum mismatch). Try again: it is downloaded from the start.`,
  },

  errors: {
    apiStopped: (why: string) => `The API stopped (${why})`,
    apiDidNotStart: (why: string) => `The API did not start (${why})`,
    apiSilent: 'The API did not answer within 2 minutes',
    stopped: 'The engine stopped',
    didNotStart: 'The engine did not start',
    notInstalled: 'The engine could not be installed',
    workerGaveUp: 'The analysis worker keeps stopping',
    workerGaveUpDetail: (logPath: string, tail: string) => `New recordings will wait in the queue. The log is at:\n${logPath}\n\n${tail}`,
    ok: 'OK',
    openLog: 'Open log',
  },

  engineInfo: {
    title: 'Engine',
    engine: (variant: string) => `Engine: ${variant}`,
    notInstalled: 'not installed',
    gpu: (what: string) => `GPU: ${what}`,
    gpuNotUsed: 'not used',
    gpuNotUsedWhy: (why: string) => `not used (${why})`,
    api: (state: string, url: string) => `API: ${state} on ${url}`,
    worker: (state: string) => `Local worker: ${state}`,
    data: (p: string) => `Data: ${p}`,
    files: (p: string) => `Engine files: ${p}`,
    cache: (p: string) => `Cache: ${p}`,
    logs: (p: string) => `Logs: ${p}`,
  },

  removal: {
    engineTitle: 'Remove the engine?',
    engineDetail: (size: string) =>
      `This frees ${size}: the Python runtime, the models and the caches. Your tabs and recordings stay. Taber restarts and installs the engine again.`,
    engineYes: 'Remove the engine',
    everythingTitle: 'Remove all of Taber\'s data?',
    everythingDetail: (size: string) =>
      `This deletes ${size}: every tab and recording, the engine, the settings and the logs. It cannot be undone. Export the tabs you want to keep first. Taber closes and finishes deleting right after; remove the app itself as you would any other.`,
    everythingYes: 'Delete everything',
    cancel: 'Cancel',
    failed: 'Could not remove everything',
  },

  updates: {
    available: (app: string, version: string) => `${app} ${version} is available`,
    availableDetail: (current: string) => `You have ${current}. Your tabs and the engine are kept when you install the new version.`,
    download: 'Download',
    later: 'Later',
    latest: 'You have the latest version',
    failed: 'Could not check for updates',
  },

  menu: {
    file: 'File',
    openData: 'Open data folder',
    openLogs: 'Open logs folder',
    view: 'View',
    engine: 'Engine',
    localWorker: 'Local analysis worker',
    restart: 'Restart engine',
    change: 'Change engine…',
    info: 'Engine info',
    help: 'Help',
    downloadPage: 'Download page',
    checkUpdates: 'Check for updates…',
    report: 'Report a problem',
    exportDiagnostics: 'Export diagnostics bundle…',
  },
};

export type Messages = typeof en;

/** Tiếng Việt (thuật ngữ theo GLOSSARY.md, như catalog của app web). */
export const vi: Messages | null = {
  language: { name: 'Tiếng Việt' },

  setup: {
    opening: 'đang mở sổ tay…',
    title: 'Cài engine',
    lede: 'Taber nghe bằng vài model: cao độ, điểm bắt đầu nốt, nhịp, và dây bạn đã chơi. Chúng chạy trên máy này, được tải một lần từ PyPI và PyTorch, vào',
    install: 'Cài đặt',
    keep: 'Giữ {variant}',
    picked: 'hợp với máy này',
    changeLaterMenu: 'có thể đổi sau, trong menu Engine',
    changeLaterLight: 'có thể đổi sau, bằng đèn engine trên thanh trên cùng',
    installing: 'Đang cài engine',
    step: 'Bước',
    onDisk: 'Trên ổ đĩa',
    downloaded: 'Đã tải',
    speed: 'Tốc độ',
    time: 'Thời gian',
    progress: 'Tiến độ tải',
    once: 'Việc này chỉ làm một lần. Nếu mất mạng hoặc bạn đóng app, lần sau sẽ tải tiếp từ chỗ đã dừng.',
    fullLog: 'Log đầy đủ:',
    emptyLog: '(log trống)',
    retry: 'Thử lại',
    change: 'Đổi engine',
    openLogs: 'Mở log',
    quit: 'Thoát',
  },

  variants: {
    gpu: 'GPU NVIDIA',
    gpuFound: (name: string) => `Nhanh nhất. Chạy các model trên ${name} của bạn.`,
    gpuMissing: 'Nhanh nhất, nhưng cần card đồ hoạ NVIDIA, và máy này không có.',
    gpuTooOld: (name: string, cap: string, min: string) =>
      `${name} của bạn (compute ${cap}) quá cũ cho bản GPU này, bản này cần ${min} trở lên (dòng GTX 16 / RTX 20 trở lên). Các model sẽ chạy trên bộ xử lý sau một lần tải rất lớn: hãy chọn Bộ xử lý.`,
    driverOld: (driver: string, min: number) => `Driver ${driver} cũ hơn ${min}: hãy cập nhật trước, nếu không các model sẽ chạy trên CPU.`,
    cpu: 'Bộ xử lý',
    cpuDetail: 'Mọi model chạy trên bộ xử lý. Tab như nhau, phân tích chậm hơn.',
    lite: 'Gọn nhẹ',
    liteDetail: 'Nhỏ nhất. Dò cao độ nhẹ hơn, không tách nhạc nền, không phân loại dây. Video vẫn dùng được.',
  },

  install: {
    gettingReady: 'Đang chuẩn bị',
    phases: {
      python: 'Lấy Python',
      download: 'Tải PyTorch',
      packages: 'Cài engine',
      check: 'Kiểm tra engine',
      models: 'Tải các model',
    },
    python: (version: string) => `Đang lấy Python ${version}`,
    wheel: (name: string, version: string) => `Đang tải ${name} ${version}`,
    engine: 'Đang tải engine phân tích',
    model: (model: string) => `Đang tải ${model}`,
    of: (done: string, total: string) => `${done} / ${total}`,
    rate: (rate: string, left: string) => `${rate}/s, còn khoảng ${left}`,
    seconds: (s: number) => `${s} giây`,
    minutes: (m: number) => `${m} phút`,
    noSpace: (file: string, dir: string) =>
      `Không đủ chỗ trống trên ổ đĩa cho ${file} (trong ${dir}). Hãy giải phóng bớt rồi thử lại: lần tải sẽ tiếp tục từ chỗ đã dừng.`,
    downloadFailed: (file: string, why: string) =>
      `Không tải được ${file}: ${why}. Kiểm tra kết nối mạng rồi thử lại: lần tải sẽ tiếp tục từ chỗ đã dừng.`,
    damaged: (file: string) => `${file} tải về bị hỏng (sai checksum). Thử lại: file sẽ được tải lại từ đầu.`,
  },

  errors: {
    apiStopped: (why: string) => `API đã dừng (${why})`,
    apiDidNotStart: (why: string) => `API không khởi động được (${why})`,
    apiSilent: 'API không trả lời trong 2 phút',
    stopped: 'Engine đã dừng',
    didNotStart: 'Engine không khởi động được',
    notInstalled: 'Không cài được engine',
    workerGaveUp: 'Worker phân tích cứ dừng liên tục',
    workerGaveUpDetail: (logPath: string, tail: string) => `Các bản ghi mới sẽ chờ trong hàng đợi. Log ở:\n${logPath}\n\n${tail}`,
    ok: 'OK',
    openLog: 'Mở log',
  },

  engineInfo: {
    title: 'Engine',
    engine: (variant: string) => `Engine: ${variant}`,
    notInstalled: 'chưa cài',
    gpu: (what: string) => `GPU: ${what}`,
    gpuNotUsed: 'không dùng',
    gpuNotUsedWhy: (why: string) => `không dùng (${why})`,
    api: (state: string, url: string) => `API: ${state} tại ${url}`,
    worker: (state: string) => `Worker trên máy: ${state}`,
    data: (p: string) => `Dữ liệu: ${p}`,
    files: (p: string) => `File engine: ${p}`,
    cache: (p: string) => `Cache: ${p}`,
    logs: (p: string) => `Log: ${p}`,
  },

  updates: {
    available: (app: string, version: string) => `Đã có ${app} ${version}`,
    availableDetail: (current: string) => `Bạn đang dùng ${current}. Tab và engine của bạn được giữ nguyên khi cài bản mới.`,
    download: 'Tải về',
    later: 'Để sau',
    latest: 'Bạn đang dùng bản mới nhất',
    failed: 'Không kiểm tra được bản mới',
  },

  menu: {
    file: 'Tệp',
    openData: 'Mở thư mục dữ liệu',
    openLogs: 'Mở thư mục log',
    view: 'Xem',
    engine: 'Engine',
    localWorker: 'Worker phân tích trên máy',
    restart: 'Khởi động lại engine',
    change: 'Đổi engine…',
    info: 'Thông tin engine',
    help: 'Trợ giúp',
    downloadPage: 'Trang tải',
    checkUpdates: 'Kiểm tra bản mới…',
    report: 'Báo lỗi',
  },
};

const CATALOGS: Record<Lang, Messages | null> = { en, vi };

function isLang(l: unknown): l is Lang {
  return typeof l === 'string' && l in CATALOGS && CATALOGS[l as Lang] !== null;
}

/**
 * The saved choice if the app has that language, else the first of the computer's languages it has, else English.
 * Keep in step with initialLang() in apps/web/src/i18n/index.ts (the web app, in a browser).
 */
export function pickLang(saved: string | null | undefined, system: readonly string[]): Lang {
  if (isLang(saved)) return saved;
  for (const tag of system) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLang(base)) return base;
  }
  return 'en';
}

let current: Lang = 'en';

/** Set by main.ts at start and when the user picks a language in the app. */
export function setLang(l: Lang): void {
  current = l;
}

export function lang(): Lang {
  return current;
}

/** The current language's messages (English for a language whose catalog does not exist yet). */
export function t(): Messages {
  return CATALOGS[current] ?? en;
}
