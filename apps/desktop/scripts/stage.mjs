#!/usr/bin/env node
/**
 * Stage what the desktop app ships, for the platform this runs on (CI builds each OS on its own runner):
 *
 *   stage/web       the built SPA (apps/web/dist)
 *   stage/python    project wheels, requirements-<variant>.txt exported from uv.lock, launch.py, manifest.json
 *   stage/bin       uv
 *   stage/ffmpeg    ffmpeg + ffprobe, LGPL build (bin/, lib/, licence)
 *
 *   node scripts/stage.mjs [--ffmpeg fetch|none|DIR]
 *
 * --ffmpeg fetch (default on Windows/Linux) downloads the BtbN LGPL build; on macOS pass the folder made by
 * scripts/build-ffmpeg-macos.sh. "none" relies on ffmpeg being on PATH (local development only).
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desk = path.resolve(here, '..');
const root = path.resolve(desk, '..', '..');
const out = path.join(desk, 'stage');
const cfg = JSON.parse(fs.readFileSync(path.join(desk, 'runtime.config.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(desk, 'package.json'), 'utf8'));
const key = `${process.platform}-${process.arch}`;
const variants = cfg.variants[key];
const WORKSPACE = ['taber-ir', 'taber-ml', 'taber-api'];

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const log = (m) => console.log(`[stage] ${m}`);
const fail = (m) => {
  console.error(`[stage] ERROR: ${m}`);
  process.exit(1);
};

if (!variants) fail(`no runtime variants configured for ${key} (runtime.config.json)`);

function which(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
}

const uv = process.env.UV_BIN || which('uv');
if (!uv) fail('uv not found on PATH (https://docs.astral.sh/uv/)');
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// ── web ──────────────────────────────────────────────────────────────
const dist = path.join(root, 'apps', 'web', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) fail('apps/web/dist is missing: run `pnpm --dir apps/web build` first');
fs.cpSync(dist, path.join(out, 'web'), { recursive: true });
log(`web: ${path.relative(root, dist)}`);

// ── python: wheels ───────────────────────────────────────────────────
const pyOut = path.join(out, 'python');
const wheelDir = path.join(pyOut, 'wheels');
run(uv, ['build', '--all-packages', '--wheel', '-q', '-o', wheelDir]);
const wheels = fs.readdirSync(wheelDir).filter((f) => f.endsWith('.whl')).sort();
for (const f of fs.readdirSync(wheelDir)) if (!f.endsWith('.whl')) fs.rmSync(path.join(wheelDir, f));
if (wheels.length !== WORKSPACE.length) fail(`expected ${WORKSPACE.length} wheels, got ${wheels.join(', ')}`);
log(`wheels: ${wheels.join(', ')}`);
fs.copyFileSync(path.join(desk, 'python', 'launch.py'), path.join(pyOut, 'launch.py'));

// ── python: requirements per variant, from uv.lock ───────────────────
function exportLock(extras) {
  const tmp = path.join(os.tmpdir(), `taber-export-${process.pid}-${extras.join('-')}.txt`);
  run(uv, ['export', '--frozen', '--no-dev', '--all-packages', '--no-emit-workspace', '-q',
    ...extras.flatMap((e) => ['--extra', e]), '-o', tmp]);
  const text = fs.readFileSync(tmp, 'utf8');
  fs.rmSync(tmp);
  return text;
}

/** requirement blocks: a "name==ver ; marker \" line and its indented --hash / # via lines */
function blocks(text) {
  const res = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^[A-Za-z0-9]/.test(line)) res.push({ name: line.split(/[\s=@;<>!~[]/)[0].toLowerCase(), lines: [line] });
    else if (res.length && /^\s+\S/.test(line)) res.at(-1).lines.push(line);
  }
  return res;
}

/** enough of PEP 508 for the python_full_version clauses torch carries in the lock */
function markerHolds(line, py) {
  const m = line.split(';')[1];
  if (!m) return true;
  const ver = (s) => s.split('.').map(Number);
  const cmp = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  const me = ver(py);
  for (const [, op, v] of m.matchAll(/python_full_version\s*(>=|<=|==|<|>)\s*'([\d.]+)'/g)) {
    const c = cmp(me, ver(v));
    const ok = { '>=': c >= 0, '<=': c <= 0, '==': c === 0, '<': c < 0, '>': c > 0 }[op];
    if (!ok) return false;
  }
  return true;
}

async function torchWheel(index, version, wheelPlatform) {
  const tag = index.replace(/\/+$/, '').split('/').pop();
  const local = `${version}+${tag}`;
  const page = await (await fetch(`${index.replace(/\/+$/, '')}/torch/`)).text();
  const want = `torch-${encodeURIComponent(local)}-cp${cfg.python.replace('.', '')}-cp${cfg.python.replace('.', '')}-${wheelPlatform}.whl`;
  const m = page.match(new RegExp(`href="([^"]*${want.replace(/[.+]/g, '\\$&')})#sha256=([0-9a-f]{64})"`));
  if (!m) fail(`${index} has no ${decodeURIComponent(want)}: bump the tag in runtime.config.json "torchOverride"`);
  return { url: new URL(m[1], index.endsWith('/') ? index : `${index}/`).href, sha256: m[2], local };
}

const exports = {};
const files = [];
for (const v of variants) {
  const extras = cfg.extras[v];
  const k = extras.join('+');
  exports[k] ??= exportLock(extras);
  let list = blocks(exports[k]);
  const header = [`# HBA Guitar Taber runtime "${v}" for ${key}, exported from uv.lock (extras: ${extras.join(', ')})`];
  const ov = cfg.torchOverride[`${key}-${v}`];
  if (ov) {
    const torch = list.find((b) => b.name === 'torch' && markerHolds(b.lines[0], cfg.python));
    if (!torch) fail(`no torch pin for Python ${cfg.python} in the lock`);
    const version = torch.lines[0].match(/torch==([^\s;\\]+)/)[1];
    const w = await torchWheel(ov.index, version, ov.wheelPlatform);
    const drop = ov.drop ?? [];
    list = list.filter((b) => b.name !== 'torch' && !drop.some((d) => b.name.startsWith(d)));
    list.unshift({ name: 'torch', lines: [`torch @ ${w.url} \\`, `    --hash=sha256:${w.sha256}`] });
    header.push(`# torch ${w.local} from ${ov.index}${drop.length ? `; dropped: ${drop.join(' ')}*` : ''}`);
    log(`${v}: torch ${w.local}${drop.length ? `, without ${drop.join(' ')}` : ''}`);
  }
  const text = `${header.join('\n')}\n${list.map((b) => b.lines.join('\n')).join('\n')}\n`;
  const file = `requirements-${v}.txt`;
  fs.writeFileSync(path.join(pyOut, file), text);
  files.push(file);
  log(`${file}: ${list.length} packages`);
}

const h = crypto.createHash('sha256');
h.update(fs.readFileSync(path.join(root, 'uv.lock')));
h.update(fs.readFileSync(path.join(desk, 'runtime.config.json')));
h.update(fs.readFileSync(path.join(pyOut, 'launch.py')));
for (const f of files) h.update(fs.readFileSync(path.join(pyOut, f)));
for (const w of wheels) h.update(fs.readFileSync(path.join(wheelDir, w)));
const manifest = {
  appVersion: pkg.version,
  stamp: h.digest('hex').slice(0, 24),
  python: cfg.python,
  platform: process.platform,
  arch: process.arch,
  variants,
  downloadEstimate: cfg.downloadEstimate,
  wheels,
  workspacePackages: WORKSPACE,
};
fs.writeFileSync(path.join(pyOut, 'manifest.json'), JSON.stringify(manifest, null, 2));
log(`manifest: stamp ${manifest.stamp}, variants ${variants.join(' ')}`);

// ── uv ───────────────────────────────────────────────────────────────
fs.mkdirSync(path.join(out, 'bin'));
const uvDst = path.join(out, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv');
fs.copyFileSync(uv, uvDst);
fs.chmodSync(uvDst, 0o755);
log(`uv: ${run(uvDst, ['--version']).trim()}`);

// ── ffmpeg ───────────────────────────────────────────────────────────
const ff = opt('ffmpeg', process.platform === 'darwin' ? null : 'fetch');
const ffOut = path.join(out, 'ffmpeg');
if (ff === 'none') {
  log('ffmpeg: not bundled (uses the one on PATH; development only)');
} else if (ff === 'fetch') {
  execFileSync(process.execPath, [path.join(here, 'fetch-ffmpeg.mjs'), ffOut], { stdio: 'inherit' });
} else if (ff && fs.existsSync(path.join(ff, 'bin'))) {
  fs.cpSync(ff, ffOut, { recursive: true, verbatimSymlinks: true });
} else {
  fail('pass --ffmpeg DIR (from scripts/build-ffmpeg-macos.sh), --ffmpeg fetch, or --ffmpeg none');
}
if (ff !== 'none') {
  const bin = path.join(ffOut, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const first = run(bin, ['-hide_banner', '-version']).split('\n')[0];
  const conf = run(bin, ['-hide_banner', '-buildconf']);
  if (/--enable-gpl|--enable-nonfree/.test(conf)) fail('this ffmpeg is a GPL/nonfree build: only LGPL builds may ship');
  log(`ffmpeg: ${first}`);
}
// the license the Windows installer shows before installing (nsis.license in electron-builder.yml)
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE.txt'));
log(`done -> ${path.relative(root, out)}`);
