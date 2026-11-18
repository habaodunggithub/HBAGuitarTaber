#!/usr/bin/env node
/**
 * Download an LGPL *shared* FFmpeg build for Windows x64 / Linux x64 (github.com/BtbN/FFmpeg-Builds) into OUT:
 *   OUT/bin/ffmpeg[.exe], OUT/bin/ffprobe[.exe] (+ .dll on Windows), OUT/lib/*.so* (Linux), LICENSE.txt, SOURCE.txt
 *
 *   node scripts/fetch-ffmpeg.mjs OUT
 *
 * BtbN keeps rolling builds: the asset name, URL and SHA-256 of what was taken are written to SOURCE.txt.
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, '..', 'runtime.config.json'), 'utf8')).ffmpeg;
const out = path.resolve(process.argv[2] || 'ffmpeg');
const plat = { 'win32-x64': 'win64', 'linux-x64': 'linux64' }[`${process.platform}-${process.arch}`];
if (!plat) {
  console.error(`[ffmpeg] no BtbN build for ${process.platform}-${process.arch}; on macOS use scripts/build-ffmpeg-macos.sh`);
  process.exit(1);
}

const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'taber-desktop-build' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const rel = cfg.btbnRelease === 'latest' ? 'latest' : `tags/${cfg.btbnRelease}`;
const r = await fetch(`https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/${rel}`, { headers });
if (!r.ok) throw new Error(`GitHub API ${r.status}`);
const release = await r.json();
const esc = cfg.btbnBranch.replace(/\./g, '\\.');
const re = new RegExp(`^ffmpeg-${esc}[.\\d]*-.+-${plat}-lgpl-shared-[\\d.]+\\.(zip|tar\\.xz)$`);
const asset = release.assets.find((a) => re.test(a.name));
if (!asset) throw new Error(`no ${plat} lgpl-shared ${cfg.btbnBranch} asset in BtbN release ${release.tag_name}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taber-ffmpeg-'));
const archive = path.join(tmp, asset.name);
console.log(`[ffmpeg] ${asset.name} (${Math.round(asset.size / 1048576)} MB) from ${release.tag_name}`);
const dl = await fetch(asset.browser_download_url);
if (!dl.ok) throw new Error(`download failed: ${dl.status}`);
const buf = Buffer.from(await dl.arrayBuffer());
fs.writeFileSync(archive, buf);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
// Windows: System32's bsdtar reads zip; the GNU tar of Git Bash (often first on PATH in CI) does not
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-xf', archive, '-C', tmp], { stdio: 'inherit' });
const top = fs.readdirSync(tmp).map((d) => path.join(tmp, d)).find((p) => fs.statSync(p).isDirectory());

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'bin'), { recursive: true });
for (const f of fs.readdirSync(path.join(top, 'bin'))) {
  if (/^(ffmpeg|ffprobe)(\.exe)?$/.test(f) || f.endsWith('.dll')) fs.copyFileSync(path.join(top, 'bin', f), path.join(out, 'bin', f));
}
const lib = path.join(top, 'lib');
if (process.platform === 'linux' && fs.existsSync(lib)) {
  fs.mkdirSync(path.join(out, 'lib'));
  for (const f of fs.readdirSync(lib)) {
    if (!/\.so(\.\d+)*$/.test(f)) continue;
    const src = path.join(lib, f);
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), path.join(out, 'lib', f));
    else fs.copyFileSync(src, path.join(out, 'lib', f));
  }
}
for (const f of ['LICENSE.txt', 'LICENSE']) if (fs.existsSync(path.join(top, f))) fs.copyFileSync(path.join(top, f), path.join(out, 'LICENSE.txt'));
fs.writeFileSync(
  path.join(out, 'SOURCE.txt'),
  [
    'FFmpeg, LGPL-2.1-or-later build (no GPL or nonfree components).',
    `Build: ${asset.name} from https://github.com/BtbN/FFmpeg-Builds release ${release.tag_name}`,
    `URL: ${asset.browser_download_url}`,
    `SHA-256: ${sha256}`,
    'Source code: https://ffmpeg.org/download.html and https://github.com/BtbN/FFmpeg-Builds',
    '',
  ].join('\n'),
);
fs.rmSync(tmp, { recursive: true, force: true });
for (const f of fs.readdirSync(path.join(out, 'bin'))) if (!f.endsWith('.dll')) fs.chmodSync(path.join(out, 'bin', f), 0o755);
console.log(`[ffmpeg] -> ${out} (sha256 ${sha256.slice(0, 16)}…)`);
