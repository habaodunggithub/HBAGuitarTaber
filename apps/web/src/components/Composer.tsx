import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api } from '../api/client';
import type { CreateTranscription } from '../api/types';
import { errorText, lookup, useT } from '../i18n';
import { fmtBytes } from '../lib/format';
import { TUNING_PRESETS } from '../lib/tuning';
import Icon from './Icon';

const ACCEPT = 'audio/*,video/*,.wav,.mp3,.flac,.m4a,.ogg,.mp4,.mov,.webm';

/** Peaks of the chosen file, decoded in the browser (audio, or the audio track of a video). */
function usePeaks(file: File | null, bars = 64): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!file || file.size > 80 * 1024 * 1024) return;
    let off = false;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    file.arrayBuffer()
      .then((buf) => ctx.decodeAudioData(buf))
      .then((audio) => {
        if (off) return;
        const ch = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / bars));
        const out: number[] = [];
        for (let b = 0; b < bars; b++) {
          let m = 0;
          for (let i = b * step; i < Math.min((b + 1) * step, ch.length); i += 16) m = Math.max(m, Math.abs(ch[i]!));
          out.push(m);
        }
        const top = Math.max(...out, 1e-6);
        setPeaks(out.map((v) => Math.max(v / top, 0.04)));
      })
      .catch(() => undefined) // not decodable here (some video codecs): the server will still read it
      .finally(() => void ctx.close());
    return () => { off = true; };
  }, [file, bars]);
  return peaks;
}

function Bars({ peaks, progress = 0 }: { peaks: number[]; progress?: number }) {
  return (
    <div className="bars" aria-hidden="true">
{peaks.map((p, i) => (
  <span key={i} className={i / peaks.length < progress ? 'on' : ''} style={{ transform: `scaleY(${p.toFixed(3)})`, animationDelay: `${i * 6}ms` }} />
))}
    </div>
  );
}

/**
 * The "new tab" form: a recording (plus an optional DI track) and the analysis options.
 * Uploads both files, creates the transcription, then hands its id to `onCreated`.
 */
export default function Composer({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [wet, setWet] = useState<File | null>(null);
  const [di, setDi] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [tuning, setTuning] = useState('Standard (E A D G B E)');
  const [capo, setCapo] = useState(0);
  const [timing, setTiming] = useState<'auto' | 'grid_from_hint' | 'free'>('auto');
  const [tempo, setTempo] = useState('');
  const [tone, setTone] = useState<'clean' | 'distortion_light' | 'high_gain'>('distortion_light');
  const [target, setTarget] = useState<'any' | 'local' | 'kaggle'>('any');
  const [separate, setSeparate] = useState<'auto' | 'on' | 'off'>('auto');
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const peaks = usePeaks(wet);
  const t = useT();

  const choose = (f: File | null) => {
    setWet(f);
    setError(null);
    if (!f && input.current) input.current.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) choose(f);
  };

  const submit = async () => {
    if (!wet) return;
    setError(null);
    try {
setBusy(t.composer.uploading);
setProgress(0);
const prog = [0, 0];
const upd = () => {
  const frac = ((prog[0] ?? 0) + (prog[1] ?? 0)) / (di ? 2 : 1);
  setProgress(frac);
  setBusy(t.composer.uploadingPct(Math.round(frac * 100)));
};
const [wetA, diA] = await Promise.all([
  api.upload(wet, (f) => { prog[0] = f; upd(); }),
  di ? api.upload(di, (f) => { prog[1] = f; upd(); }) : Promise.resolve(null),
]);
setBusy(t.composer.creating);
const body: CreateTranscription = {
  inputs: [{ asset_id: wetA.asset_id, role: 'wet' }, ...(diA ? [{ asset_id: diA.asset_id, role: 'di' as const }] : [])],
  analysis_options: { tone, mode: 'monophonic', segmenter: 'auto', string_model: 'auto', separate_source: separate, detect_techniques: true, use_video: false },
  assembly_params: {
    tuning: { name: tuning, open_pitches: TUNING_PRESETS[tuning] ?? [64, 59, 55, 50, 45, 40], capo },
    max_fret: 22,
    timing: tempo && timing === 'auto' ? 'grid_from_hint' : timing,
    tempo_hint_bpm: tempo ? Number(tempo) : null,
    fingering_weights: {},
  },
  worker_target: target,
};
const res = await api.create(wetA.project_id, body);
await onCreated(res.transcription_id);
    } catch (e) {
setError(errorText(e));
setBusy(null);
setProgress(null);
    }
  };

  const summary = [
    lookup(t.tunings, tuning).split(' (')[0],
    capo ? t.composer.capoN(capo) : null,
    tempo ? t.composer.bpm(tempo) : null,
    separate === 'off' ? t.composer.noSeparation : separate === 'on' ? t.composer.alwaysSeparate : null,
  ].filter(Boolean).join(', ');

  return (
    <form className={`composer${wet ? ' has' : ''}`} onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={t.composer.form}>
      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <input id="wet" ref={input} type="file" accept={ACCEPT} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        <label htmlFor="wet" className="drop-label">
          <span className="sr-only">{t.composer.recording}</span>
          <span className="plus" aria-hidden="true">+</span>
          <b>{over ? t.composer.letGo : t.composer.drop}</b>
          {wet ? null : <span className="drop-sub">{t.composer.formats[0]}<br />{t.composer.formats[1]}<br /><u>{t.composer.choose}</u></span>}
        </label>
        {wet ? (
          <div className="now-line">
            <div className="now-title">
              <h2 className="track" data-i18n="user">{wet.name}</h2>
              <button type="button" className="icon-btn small" aria-label={t.composer.remove} onClick={() => choose(null)}><Icon name="close" size={16} /></button>
            </div>
            <p className="facts-line">{wet.type.startsWith('video') ? t.composer.video : t.composer.audio}, {fmtBytes(wet.size)}</p>
            {peaks ? <Bars peaks={peaks} progress={progress ?? 0} /> : <div className="bars placeholder" aria-hidden="true" />}
          </div>
        ) : null}
      </div>

      {wet ? (
        <div className="composer-extra">
          <input id="di" type="file" accept={ACCEPT} className="sr-only" onChange={(e) => setDi(e.target.files?.[0] ?? null)} />
          {di ? (
            <p className="di-chosen"><span className="muted">{t.composer.diTrack}</span> <strong>{di.name}</strong> <button type="button" className="text-btn" onClick={() => setDi(null)}>{t.composer.removeDi}</button></p>
          ) : (
            <label htmlFor="di" className="text-btn">{t.composer.addDi} <span className="muted">{t.composer.addDiHint}</span></label>
          )}
          <details className="options">
            <summary><span>{t.composer.options} <span className="muted">{summary}</span></span></summary>
            <div className="grid">
              <label className="field"><span>{t.composer.tuning}</span>
                <select value={tuning} onChange={(e) => setTuning(e.target.value)}>{Object.keys(TUNING_PRESETS).map((k) => <option key={k} value={k}>{lookup(t.tunings, k)}</option>)}</select>
              </label>
              <label className="field"><span>{t.composer.capo}</span>
                <input type="number" name="capo" autoComplete="off" inputMode="numeric" min={0} max={12} value={capo} onChange={(e) => setCapo(Math.max(0, Math.min(12, Number(e.target.value) || 0)))} />
              </label>
              <label className="field"><span>{t.composer.tone}</span>
                <select value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
                  {(['clean', 'distortion_light', 'high_gain'] as const).map((k) => <option key={k} value={k}>{t.composer.tones[k]}</option>)}
                </select>
              </label>
              <label className="field"><span>{t.composer.backing}</span>
                <select value={separate} onChange={(e) => setSeparate(e.target.value as typeof separate)}>
                  {(['auto', 'on', 'off'] as const).map((k) => <option key={k} value={k}>{t.composer.separation[k]}</option>)}
                </select>
              </label>
              <label className="field"><span>{t.composer.timing}</span>
                <select value={timing} onChange={(e) => setTiming(e.target.value as typeof timing)}>
                  {(['auto', 'grid_from_hint', 'free'] as const).map((k) => <option key={k} value={k}>{t.composer.timings[k]}</option>)}
                </select>
              </label>
              <label className="field"><span>{t.composer.tempo}</span>
                <input type="number" name="tempo" autoComplete="off" inputMode="decimal" min={30} max={300} step={0.5} placeholder={t.composer.tempoPlaceholder} value={tempo} onChange={(e) => setTempo(e.target.value)} />
              </label>
              <label className="field"><span>{t.composer.runOn}</span>
                <select value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
                  {(['any', 'local', 'kaggle'] as const).map((k) => <option key={k} value={k}>{t.composer.targets[k]}</option>)}
                </select>
              </label>
            </div>
          </details>
        </div>
      ) : null}
      {error ? <p className="banner bad" role="alert"><Icon name="alert" /> <span data-i18n="server">{error}</span></p> : null}
      <button type="submit" className="btn primary block" disabled={!wet || !!busy} data-testid="submit">{busy ?? t.composer.transcribe}</button>
      {progress !== null ? <span className="pencil" aria-hidden="true" style={{ transform: `scaleX(${Math.max(progress, 0.02)})` }} /> : null}
    </form>
  );
}
