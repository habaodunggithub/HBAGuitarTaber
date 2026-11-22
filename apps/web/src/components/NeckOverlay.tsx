import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getT } from '../i18n';
import { neckAt, neckLines, segPath, type VideoTrack } from '../lib/neckTrack';

interface Props {
  /** The element the <video> lives in; the overlay is laid over it. */
  host: HTMLElement;
  /** The playing video (the editor's clock). */
  media: React.RefObject<HTMLMediaElement | null>;
  track: VideoTrack;
}

/**
 * What the video stage saw, drawn on the playing video: the fret wires and strings where the neck was
 * tracked (green), or where the analysis fell back on the calibration frame because tracking was lost
 * (red, dashed), and the fingertips that counted at each note onset.
 * Updated imperatively once per animation frame: no React render while the video plays.
 */
export default function NeckOverlay({ host, media, track }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const frets = useRef<SVGPathElement>(null);
  const keys = useRef<SVGPathElement>(null);
  const strings = useRef<SVGPathElement>(null);
  const tips = useRef<SVGGElement>(null);
  const badge = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let shownT = Number.NaN;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const m = media.current;
      const root = svg.current;
      if (!m || !root) return;
      const t = m.currentTime;
      if (t === shownT) return;
      shownT = t;
      const f = neckAt(track, t);
      const state = !f ? 'none' : f.tracked ? 'tracked' : 'lost';
      if (root.dataset.state !== state && badge.current) {
        badge.current.dataset.state = state;
        badge.current.textContent = state === 'tracked' ? getT().neck.tracked : state === 'lost' ? getT().neck.lost : '';
      }
      root.dataset.state = state;
      if (!f) return;
      const l = neckLines(f.quad, track.fret_a, track.fret_b, track.taper ?? 0);
      frets.current?.setAttribute('d', segPath(l.frets));
      keys.current?.setAttribute('d', segPath(l.keyFrets));
      strings.current?.setAttribute('d', segPath(l.strings));
      const g = tips.current;
      if (g) {
        g.querySelectorAll('g').forEach((el, k) => {
          const tip = f.tips[k];
          el.setAttribute('visibility', tip ? 'visible' : 'hidden');
          if (tip) el.setAttribute('transform', `translate(${tip.x.toFixed(1)} ${tip.y.toFixed(1)})`);
          const label = el.querySelector('text');
          if (tip && label) label.textContent = String(tip.finger);
        });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [media, track]);

  const [w, h] = track.size;
  return createPortal(
    <>
      <svg ref={svg} className="neck-overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-testid="neck-overlay">
        <path ref={strings} className="neck-string" />
        <path ref={frets} className="neck-fret" />
        <path ref={keys} className="neck-key" />
        <g ref={tips}>
          {[0, 1, 2, 3].map((k) => (
            <g key={k} visibility="hidden" className="neck-tip">
              <circle r={Math.max(w, h) / 90} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(w, h) / 80} />
            </g>
          ))}
        </g>
      </svg>
      <span ref={badge} className="neck-badge" aria-hidden="true" data-testid="neck-badge" />
    </>,
    host,
  );
}
