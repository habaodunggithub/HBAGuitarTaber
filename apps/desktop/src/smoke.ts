/**
 * End-to-end check of a packaged runtime, from plain Node (no window): build the runtime if needed, start the API
 * and the worker exactly as the app does, upload a short take, wait for the tab, export it.
 *
 *   node dist/smoke.js [--resources stage] [--home DIR] [--variant cpu|gpu|lite] [--timeout 900]
 *
 * Runs in CI on Windows, macOS and Linux (.github/workflows/desktop.yml).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backend } from './backend';
import { detectHardware, recommend } from './hardware';
import { resolveLayout } from './layout';
import { LogFile } from './log';
import { formatBytes, provision, readManifest, runtimeStatus, type Variant } from './runtime';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const t0 = Date.now();
const say = (msg: string) => console.log(`[smoke ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${msg}`);

/** A plucked line (A3 C4 D4 E4 G4 A4 at 120 BPM), 16-bit mono WAV. */
function synthTake(): Buffer {
  const sr = 44100;
  const notes = [57, 60, 62, 64, 67, 69];
  const beat = 0.5;
  const n = Math.round(sr * (notes.length * beat + 1));
  const pcm = new Int16Array(n);
  notes.forEach((midi, k) => {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const start = Math.round(k * beat * sr);
    for (let i = 0; i < Math.round(0.48 * sr) && start + i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.003) * Math.exp(-t * 5);
      const v = Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t);
      pcm[start + i] += Math.round(9000 * env * v);
    }
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + n * 2, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sr, 24);
  header.writeUInt32LE(sr * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(n * 2, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}

function countNotes(x: unknown): number {
  if (Array.isArray(x)) return x.reduce((s, v) => s + countNotes(v), 0);
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return ('fret' in o && 'string' in o ? 1 : 0) + Object.values(o).reduce<number>((s, v) => s + countNotes(v), 0);
  }
  return 0;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.url} -> ${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

async function main(): Promise<number> {
  const resources = path.resolve(arg('resources', path.join(__dirname, '..', 'stage'))!);
  const home = arg('home');
  if (home) process.env.TABER_DESKTOP_HOME = path.resolve(home);
  const timeout = Number(arg('timeout', '900')) * 1000;
  const layout = resolveLayout(resources);
  const manifest = readManifest(layout);
  say(`app ${manifest.appVersion} ${manifest.platform}-${manifest.arch}, home ${path.dirname(layout.data)}`);

  const hw = await detectHardware();
  const variant = (arg('variant') as Variant | undefined) ?? recommend(hw, manifest.variants);
  const status = runtimeStatus(layout, manifest);
  if (!status.ready || status.state.variant !== variant) {
    say(`installing runtime "${variant}" (${status.ready ? 'other variant' : status.reason})`);
    const log = new LogFile(layout.logs, 'runtime');
    let last = 0;
    const state = await provision(layout, manifest, variant, log, (p) => {
      if (p.bytes !== undefined && Date.now() - last > 10_000) {
        last = Date.now();
        say(`  ${p.phase}: ${formatBytes(p.bytes)} on disk`);
      } else if (p.message && p.bytes === undefined) say(`  ${p.phase}: ${p.message}`);
    });
    await log.close();
    say(`runtime: ${JSON.stringify(state)}`);
  } else say(`runtime already installed: ${JSON.stringify(status.state)}`);

  const backend = new Backend({ layout, startWorker: true });
  try {
    const url = await backend.start();
    say(`API up at ${url}`);
    const spa = await fetch(`${url}/`);
    if (!spa.ok || !(await spa.text()).includes('id="root"')) throw new Error('the API does not serve the web app');
    say('web app served');

    const deadline = Date.now() + 90_000;
    while ((await json<unknown[]>(await fetch(`${url}/api/v1/workers`))).length === 0) {
      if (Date.now() > deadline) throw new Error(`no worker registered\n${backend.workerLog?.tail()}`);
      await new Promise((r) => setTimeout(r, 500));
    }
    say('worker registered');

    // m4a goes through the bundled ffmpeg (probe, decode, the AAC encoder the stems use)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taber-smoke-'));
    const wav = path.join(tmp, 'smoke.wav');
    fs.writeFileSync(wav, synthTake());
    let upload = wav;
    const ffmpeg = path.join(layout.res.ffmpegBin, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (fs.existsSync(ffmpeg)) {
      upload = path.join(tmp, 'smoke.m4a');
      execFileSync(ffmpeg, ['-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '128k', upload]);
      say(`bundled ffmpeg encoded ${path.basename(upload)}`);
    } else say('no bundled ffmpeg (dev stage): uploading the wav');

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(upload)]), path.basename(upload));
    const asset = await json<{ asset_id: string; project_id: string; duration_s: number }>(
      await fetch(`${url}/api/v1/uploads`, { method: 'POST', body: form }),
    );
    say(`uploaded: ${asset.duration_s.toFixed(2)} s`);
    const created = await json<{ transcription_id: string; job_id: string | null }>(
      await fetch(`${url}/api/v1/projects/${asset.project_id}/transcriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: [{ asset_id: asset.asset_id, role: 'wet' }], analysis_options: { separate_source: 'off' }, title: 'smoke' }),
      }),
    );
    if (created.job_id) {
      let lastStage = '';
      const jobDeadline = Date.now() + timeout;
      for (;;) {
        const job = await json<{ status: string; stage: string; progress: number; error: string | null }>(
          await fetch(`${url}/api/v1/jobs/${created.job_id}`),
        );
        if (job.stage !== lastStage) say(`  job ${job.status}: ${(lastStage = job.stage)} ${Math.round(job.progress * 100)}%`);
        if (job.status === 'succeeded') break;
        if (['failed', 'canceled'].includes(job.status)) throw new Error(`job ${job.status}: ${job.error}\n${backend.workerLog?.tail(30)}`);
        if (Date.now() > jobDeadline) throw new Error(`job still ${job.status} after ${timeout / 1000}s`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    const t = await json<{ status: string; score?: unknown }>(await fetch(`${url}/api/v1/transcriptions/${created.transcription_id}`));
    const notes = countNotes(t.score);
    say(`tab ${t.status}: ${notes} notes`);
    if (t.status !== 'ready' || notes === 0) throw new Error('no tab came out');
    const gp5 = await fetch(`${url}/api/v1/transcriptions/${created.transcription_id}/export?format=gp5`);
    const size = (await gp5.arrayBuffer()).byteLength;
    if (!gp5.ok || size === 0) throw new Error(`export failed: ${gp5.status}`);
    say(`exported .gp5 (${size} bytes)`);
    fs.rmSync(tmp, { recursive: true, force: true });
    say('SMOKE OK');
    return 0;
  } finally {
    await backend.stop();
    say('stopped');
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[smoke] FAILED: ${e instanceof Error ? e.message : e}`);
    if (e && typeof e === 'object' && 'logTail' in e) console.error((e as { logTail: string }).logTail);
    process.exit(1);
  },
);
