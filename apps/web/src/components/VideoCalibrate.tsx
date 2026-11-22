import { useEffect, useMemo, useRef, useState } from 'react';
import { api, urls } from '../api/client';
import { fmtTime } from '../lib/format';
import { calibrationBoardPoints, calibrationToImage, fretU, TAPER, type GuitarBody, type Pt } from '../lib/homography';
import { type Messages, useT } from '../i18n';
import { errorText } from '../lib/errors';
import Icon from './Icon';

/**
 * Fretboard calibration: the user clicks both outer strings on 2 to 5 fret wires on one frame.
 * As soon as all points are in, the predicted frets and strings are drawn over the frame, so a wrong
 * click is visible before any analysis runs. With 3+ wires the neck is a least-squares fit, and a click
 * far from the fitted neck is flagged.
 */
interface Props {
  transcriptionId: string;
  videoAssetId: string;
  startTime: number;
  onClose: () => void;
  onStarted: () => void;
}

type Body = Exclude<GuitarBody, 'parallel'>;
const BODIES: { id: Body; maxFret: number }[] = [
  { id: 'electric', maxFret: 24 },
  { id: 'acoustic', maxFret: 20 },
  { id: 'classical', maxFret: 19 },
];
/** Easy-to-spot wires (next to the inlays) for each number of wires. */
const DEFAULT_FRETS: Record<number, number[]> = { 2: [5, 12], 3: [3, 7, 12], 4: [3, 5, 9, 12], 5: [3, 5, 7, 9, 12] };
const WIRE_COUNTS = [2, 3, 4, 5];
const OFF_PX = 6; // a click this far (frame pixels) from the fitted neck is probably misplaced
const BODY_KEY = 'taber.guitarBody';

/** Instruction for click i: the snake order A6 A1 B1 B6 C6 C1 ... */
function stepText(c: Messages['calibrate'], frets: number[], i: number): string {
  const wire = Math.floor(i / 2);
  const firstIs6 = wire % 2 === 0;
  const s = (i % 2 === 0) === firstIs6 ? 6 : 1;
  return c.click(s === 6 ? c.lowE : c.highE, frets[wire]!);
}

function loadBody(): Body {
  try {
    const v = localStorage.getItem(BODY_KEY);
    if (v && BODIES.some((b) => b.id === v)) return v as Body;
  } catch { /* private mode: use the default */ }
  return 'electric';
}

export default function VideoCalibrate({ transcriptionId, videoAssetId, startTime, onClose, onStarted }: Props) {
  const tt = useT();
  const c = tt.calibrate;
  const ref = useRef<HTMLDialogElement>(null);
  const [t, setT] = useState(Math.max(0, Math.round(startTime * 10) / 10));
  const [body, setBody] = useState<Body>(loadBody);
  const [frets, setFrets] = useState<number[]>(DEFAULT_FRETS[2]!);
  const [points, setPoints] = useState<Pt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<[number, number] | null>(null); // the frame's pixel size, once loaded
  const loaded = size !== null;
  const maxFret = BODIES.find((b) => b.id === body)!.maxFret;
  const needed = 2 * frets.length;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    d?.addEventListener('cancel', onCancel);
    return () => d?.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const chooseBody = (b: Body) => {
    setBody(b);
    try { localStorage.setItem(BODY_KEY, b); } catch { /* not remembered, fine */ }
    const top = BODIES.find((x) => x.id === b)!.maxFret;
    if (frets.at(-1)! > top) { setFrets(DEFAULT_FRETS[frets.length]!); setPoints([]); }
  };
  const chooseCount = (n: number) => { setFrets(DEFAULT_FRETS[n]!); setPoints([]); };
  const chooseFret = (k: number, f: number) => {
    setFrets((fs) => fs.map((x, i) => (i === k ? f : x)));
    setPoints([]);
  };

  const preview = useMemo(() => {
    if (points.length !== needed || !size) return null;
    try {
      const toImg = calibrationToImage(points, frets, TAPER[body]);
      const lo = Math.max(0, frets[0]! - 4);
      const hi = Math.min(maxFret, frets.at(-1)! + 4);
      const lines = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((n) => ({
        n, a: toImg([fretU(n), -0.08]), b: toImg([fretU(n), 1.08]),
      }));
      const strings = Array.from({ length: 6 }, (_, k) => ({ a: toImg([fretU(lo), k / 5]), b: toImg([fretU(hi), k / 5]) }));
      // how far each click is from the fitted neck, in frame pixels (always 0 with two wires)
      const off = calibrationBoardPoints(frets).map((uv, i) => {
        const [x, y] = toImg(uv);
        return Math.hypot((x - points[i]![0]) * size[0], (y - points[i]![1]) * size[1]);
      });
      if (![...lines.flatMap((l) => [l.a, l.b]), ...strings.flatMap((s) => [s.a, s.b])].every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return null;
      return { lines, strings, off };
    } catch {
      return null;
    }
  }, [points, frets, body, maxFret, needed, size]);

  const onPick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (points.length >= needed || !loaded) return; // coordinates are only meaningful on a loaded frame
    const r = e.currentTarget.getBoundingClientRect();
    setPoints((p) => [...p, [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]]);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.analyseWithVideo(transcriptionId, { t_s: t, points, fret_a: frets[0]!, fret_b: frets.at(-1)!, frets, guitar: body });
      onStarted();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const worst = preview && frets.length > 2 ? Math.max(...preview.off) : 0;
  const status = points.length < needed
    ? c.step(points.length + 1, needed, stepText(c, frets, points.length))
    : !preview
      ? c.invalid
      : worst > OFF_PX
        ? c.offPoint(preview.off.indexOf(worst) + 1, worst.toFixed(0))
        : frets.length > 2
          ? c.checkWithin(worst.toFixed(1))
          : c.check;
  const keySet = new Set(frets);

  return (
    <dialog ref={ref} className="calibrate" aria-labelledby="cal-title">
      <div className="cal-head">
        <h2 id="cal-title" className="display-sm">{c.title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={tt.app.close}><Icon name="close" /></button>
      </div>
      <p className="muted">{c.intro}</p>
      <div className="cal-controls">
        <label className="field inline-field"><span>{c.guitar}</span>
          <select value={body} onChange={(e) => chooseBody(e.target.value as Body)} data-testid="cal-body">
            {BODIES.map((b) => <option key={b.id} value={b.id}>{c.bodies[b.id]}</option>)}
          </select>
        </label>
        <label className="field inline-field"><span>{c.count}</span>
          <select value={frets.length} onChange={(e) => chooseCount(Number(e.target.value))} data-testid="cal-count">
            {WIRE_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="cal-frets">
          {frets.map((f, k) => (
            <label key={k} className="field inline-field"><span>{k === 0 ? c.frets : <span className="sr-only">{c.fretN(k + 1)}</span>}</span>
              <select value={f} onChange={(e) => chooseFret(k, Number(e.target.value))} aria-label={c.fretN(k + 1)} data-testid={`cal-fret-${k}`}>
                {Array.from({ length: maxFret }, (_, i) => i + 1)
                  .filter((n) => n > (frets[k - 1] ?? 0) && n < (frets[k + 1] ?? maxFret + 1))
                  .map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          ))}
        </span>
        <span className="cal-time">
          <button type="button" className="icon-btn small" onClick={() => { setT((x) => Math.max(0, +(x - 1).toFixed(1))); setSize(null); }} aria-label={c.back}><Icon name="left" size={16} /></button>
          {c.frameAt(fmtTime(t))}
          <button type="button" className="icon-btn small" onClick={() => { setT((x) => +(x + 1).toFixed(1)); setSize(null); }} aria-label={c.forward}><Icon name="right" size={16} /></button>
        </span>
      </div>

      <p className="cal-step" role="status" data-testid="cal-step">{status}</p>

      <div className={`cal-stage${loaded ? '' : ' loading'}`} onClick={onPick} data-testid="cal-stage" data-loaded={loaded}>
        <img
          src={urls.frame(videoAssetId, t)}
          alt={c.frameAlt(fmtTime(t))}
          onLoad={(e) => setSize([e.currentTarget.naturalWidth || 1, e.currentTarget.naturalHeight || 1])}
          onError={() => setError(c.frameFailed)}
          draggable={false}
        />
        {loaded ? (
          <svg className="cal-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {preview?.strings.map((s, i) => (
              <line key={`s${i}`} x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} className="cal-string" vectorEffect="non-scaling-stroke" />
            ))}
            {preview?.lines.map((f) => (
              <line key={`f${f.n}`} x1={f.a[0]} y1={f.a[1]} x2={f.b[0]} y2={f.b[1]}
                className={keySet.has(f.n) ? 'cal-fret key' : 'cal-fret'} vectorEffect="non-scaling-stroke" />
            ))}
            {points.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={0.008} vectorEffect="non-scaling-stroke"
                className={preview && frets.length > 2 && preview.off[i]! > OFF_PX ? 'cal-point off' : 'cal-point'} />
            ))}
          </svg>
        ) : null}
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="row">
        <button type="button" className="btn primary" disabled={!preview || busy} onClick={() => void start()}>
          {busy ? c.sending : c.start}
        </button>
        <button type="button" className="btn" disabled={!points.length} onClick={() => setPoints((p) => p.slice(0, -1))}>{c.undo}</button>
        <button type="button" className="btn" disabled={!points.length} onClick={() => setPoints([])}>{c.startOver}</button>
        <button type="button" className="btn quiet" onClick={onClose}>{c.cancel}</button>
      </div>
    </dialog>
  );
}
