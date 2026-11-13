import { useEffect, useMemo, useRef, useState } from 'react';
import { api, urls } from '../api/client';
import { fmtTime } from '../lib/format';
import { apply, boardToImage, fretU, type Pt } from '../lib/homography';
import Icon from './Icon';

/**
 * Fretboard calibration: the user clicks the two outer strings at two fret wires on one frame.
 * As soon as four points are in, the predicted frets and strings are drawn over the frame, so a wrong
 * click is visible before any analysis runs.
 */
interface Props {
  transcriptionId: string;
  videoAssetId: string;
  startTime: number;
  onClose: () => void;
  onStarted: () => void;
}

const STEPS = (a: number, b: number) => [
  `Click the low E string (6) right on fret ${a}`,
  `Click the high e string (1) right on fret ${a}`,
  `Click the high e string (1) right on fret ${b}`,
  `Click the low E string (6) right on fret ${b}`,
];
const FRETS = Array.from({ length: 24 }, (_, i) => i + 1);

export default function VideoCalibrate({ transcriptionId, videoAssetId, startTime, onClose, onStarted }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [t, setT] = useState(Math.max(0, Math.round(startTime * 10) / 10));
  const [fretA, setFretA] = useState(5);
  const [fretB, setFretB] = useState(12);
  const [points, setPoints] = useState<Pt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    d?.addEventListener('cancel', onCancel);
    return () => d?.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const preview = useMemo(() => {
    if (points.length !== 4 || fretB <= fretA) return null;
    try {
      const H = boardToImage(points, fretA, fretB);
      const lo = Math.max(0, fretA - 4);
      const hi = Math.min(24, fretB + 4);
      const frets = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).map((n) => ({
        n, a: apply(H, [fretU(n), -0.08]), b: apply(H, [fretU(n), 1.08]),
      }));
      const strings = Array.from({ length: 6 }, (_, k) => ({ a: apply(H, [fretU(lo), k / 5]), b: apply(H, [fretU(hi), k / 5]) }));
      return { frets, strings };
    } catch {
      return null;
    }
  }, [points, fretA, fretB]);

  const onPick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (points.length >= 4 || !loaded) return; // coordinates are only meaningful on a loaded frame
    const r = e.currentTarget.getBoundingClientRect();
    setPoints((p) => [...p, [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]]);
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.analyseWithVideo(transcriptionId, { t_s: t, points, fret_a: fretA, fret_b: fretB });
      onStarted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const steps = STEPS(fretA, fretB);
  return (
    <dialog ref={ref} className="calibrate" aria-labelledby="cal-title">
      <div className="cal-head">
        <h2 id="cal-title" className="display-sm">Show the app where the neck is</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <p className="muted">
        Pick a frame where the neck is clear, choose two frets you can spot easily (the 5 and 12 markers are easiest), then click 4 points in order.
        A preview grid appears so you can check it.
      </p>
      <div className="cal-controls">
        <label className="field inline-field"><span>First fret</span>
          <select value={fretA} onChange={(e) => { setFretA(Number(e.target.value)); setPoints([]); }}>
            {FRETS.filter((f) => f < 24).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="field inline-field"><span>Second fret</span>
          <select value={fretB} onChange={(e) => { setFretB(Number(e.target.value)); setPoints([]); }}>
            {FRETS.filter((f) => f > fretA).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <span className="cal-time">
          <button type="button" className="icon-btn small" onClick={() => { setT((x) => Math.max(0, +(x - 1).toFixed(1))); setLoaded(false); }} aria-label="Back 1 second"><Icon name="left" size={16} /></button>
          Frame at {fmtTime(t)}
          <button type="button" className="icon-btn small" onClick={() => { setT((x) => +(x + 1).toFixed(1)); setLoaded(false); }} aria-label="Forward 1 second"><Icon name="right" size={16} /></button>
        </span>
      </div>

      <p className="cal-step" role="status" data-testid="cal-step">
        {points.length < 4 ? `${points.length + 1}/4. ${steps[points.length]}` : preview ? 'Check: do the lines sit on the frets and strings?' : 'These 4 points do not form a valid shape. Start over.'}
      </p>

      <div className={`cal-stage${loaded ? '' : ' loading'}`} onClick={onPick} data-testid="cal-stage" data-loaded={loaded}>
        <img
          src={urls.frame(videoAssetId, t)}
          alt={`Video frame at ${fmtTime(t)}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError('Could not get a frame at this time. Try another moment.')}
          draggable={false}
        />
        {loaded ? (
          <svg className="cal-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {preview?.strings.map((s, i) => (
              <line key={`s${i}`} x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} className="cal-string" vectorEffect="non-scaling-stroke" />
            ))}
            {preview?.frets.map((f) => (
              <line key={`f${f.n}`} x1={f.a[0]} y1={f.a[1]} x2={f.b[0]} y2={f.b[1]}
                className={f.n === fretA || f.n === fretB ? 'cal-fret key' : 'cal-fret'} vectorEffect="non-scaling-stroke" />
            ))}
            {points.map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={0.008} className="cal-point" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        ) : null}
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="row">
        <button type="button" className="btn primary" disabled={!preview || busy} onClick={() => void start()}>
          {busy ? 'Sending…' : 'Re-analyze with video'}
        </button>
        <button type="button" className="btn" disabled={!points.length} onClick={() => setPoints([])}>Start over</button>
        <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
      </div>
    </dialog>
  );
}
