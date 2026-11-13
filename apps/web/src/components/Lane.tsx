import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Score } from '../api/types';
import { laneModel, soundingAt, type LaneModel } from '../lib/lane';
import type { NoteLoc } from '../lib/scoreOps';
import { openPitch } from '../lib/tuning';
import Icon from './Icon';

/**
 * The play-along lane: six strings, a fixed playhead, the tab gliding under it in time with the audio.
 * Drawn once per score; every frame only moves the strip, lights the sounding note and fills its
 * sustain bar. No React state changes while playing.
 */
interface Props {
  score: Score;
  selection: NoteLoc | null;
  onSelect: (loc: NoteLoc) => void;
  /** Current audio time in seconds (read every frame). */
  getTime: () => number;
  onSeek: (t: number) => void;
}

const GAP = 26; // px between strings
const TOP = 40; // room for bar numbers and technique marks
const LEFT = 34; // fixed string-name column
const PLAYHEAD = 0.3; // playhead position as a fraction of the lane width
const labelWidth = (fret: number) => String(fret).length * 8.2 + 6;

/** Opening zoom: enough pixels per second that consecutive numbers on a string do not overlap
 *  (capped, so a burst of very fast notes does not zoom the whole lane in too far). */
function fitPps(model: LaneModel): number {
  const need: number[] = [];
  const last = new Map<number, LaneModel['notes'][number]>();
  for (const n of model.notes) {
    const prev = last.get(n.string);
    if (prev && n.start > prev.start) need.push((labelWidth(prev.fret) + 3) / (n.start - prev.start));
    last.set(n.string, n);
  }
  if (!need.length) return 150;
  return Math.round(Math.min(Math.max(...need, 150), 420));
}
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** A plucked string: fast, decaying side-to-side movement (px). */
const PLUCK: Keyframe[] = [0, -2.2, 1.9, -1.6, 1.3, -1, 0.75, -0.5, 0.3, -0.15, 0].map((d) => ({ transform: `translateY(${d}px)` }));

const MARK: Record<string, string> = {
  bend: '↗', prebend: '↑', release: '↘', vibrato: '∿', whammy: 'w', slide_legato: '⟋', slide_shift: '⟋',
  hammer_on: 'h', pull_off: 'p', palm_mute: 'pm', harmonic_natural: '◇', dead_note: '×',
};

function stringLabel(midi: number, i: number): string {
  const n = NAMES[((midi % 12) + 12) % 12]!;
  return i === 0 ? n.toLowerCase() : n; // e B G D A E
}

const Strip = memo(function Strip({ model, pps, height }: { model: LaneModel; pps: number; height: number }) {
  const y = (s: number) => TOP + (s - 1) * GAP;
  return (
    <g className="lane-strip">
      {model.bars.map((b) => (
        <g key={b.index} className="lane-bar">
          <line x1={b.t * pps} x2={b.t * pps} y1={TOP - 6} y2={height - 10} />
          <text x={b.t * pps + 5} y={13}>{b.index + 1}</text>
        </g>
      ))}
      {model.notes.map((n, i) => {
        const x = n.start * pps;
        const w = Math.max((n.end - n.start) * pps, 6);
        const label = String(n.fret);
        const tw = labelWidth(n.fret); // just wide enough to break the string behind the number
        const marks = n.techniques.map((t) => MARK[t]).filter(Boolean).join('');
        return (
          <g key={i} data-i={i} className={`lane-note${n.locked ? ' is-locked' : ''}`} transform={`translate(${x} ${y(n.string)})`}>
            <rect className="lane-sustain" x={tw - 2} y={-1} width={Math.max(w - tw + 2, 2)} height={2} />
            <rect className="lane-fill" x={tw - 2} y={-1} width={Math.max(w - tw + 2, 2)} height={2} />
            <g className="lane-pill">
              <rect className="lane-knock" x={-2} y={-9} width={tw} height={18} rx={3} />
              <text className="lane-fret" x={tw / 2 - 2} y={5}>{label}</text>
            </g>
            {marks ? <text className="lane-mark" x={0} y={-12}>{marks}</text> : null}
          </g>
        );
      })}
    </g>
  );
});

export default function Lane({ score, selection, onSelect, getTime, onSeek }: Props) {
  const model = useMemo(() => laneModel(score), [score]);
  const [pps, setPps] = useState(() => fitPps(model)); // pixels per second
  const [width, setWidth] = useState(900);
  const boxRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<SVGGElement>(null);
  const strings = useRef<SVGGElement>(null);
  const height = TOP + (model.strings - 1) * GAP + 26;

  // keep everything the frame loop needs in one ref: no re-subscribing while playing
  const live = useRef({ model, pps, width, getTime });
  live.current = { model, pps, width, getTime };

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let lit: number[] = [];
    let past = 0; // notes [0, past) have finished sounding and are dimmed
    let nodes: Element[] = [];
    let nodesFor: LaneModel | null = null;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = () => {
      const { model: m, pps: p, width: w, getTime: now } = live.current;
      const g = stripRef.current;
      if (g) {
        if (nodesFor !== m) {
          nodes = Array.from(g.querySelectorAll('[data-i]'));
          nodesFor = m;
          lit = [];
          past = 0;
        }
        const t = now();
        const head = (w - LEFT) * PLAYHEAD;
        g.setAttribute('transform', `translate(${(head - t * p).toFixed(2)} 0)`);
        // dim what has already sounded; walk the boundary both ways (seeking backwards undims)
        while (past < m.notes.length && m.notes[past]!.end <= t) nodes[past++]?.classList.add('is-past');
        while (past > 0 && m.notes[past - 1]!.end > t) nodes[--past]?.classList.remove('is-past');
        const sounding = soundingAt(m, t);
        if (sounding.join() !== lit.join()) {
          if (!still && strings.current) {
            for (const i of sounding) {
              if (lit.includes(i)) continue;
              const line = strings.current.children[m.notes[i]!.string - 1] as SVGElement | undefined;
              line?.animate(PLUCK, { duration: 420, easing: 'linear' });
            }
          }
          lit.forEach((i) => nodes[i]?.classList.remove('is-now'));
          sounding.forEach((i) => nodes[i]?.classList.add('is-now'));
          lit = sounding;
        }
        for (const i of sounding) {
          const n = m.notes[i]!;
          const fill = nodes[i]?.querySelector('.lane-fill') as SVGRectElement | null;
          if (fill) {
            const k = Math.min(Math.max((t - n.start) / Math.max(n.end - n.start, 1e-3), 0), 1);
            fill.style.transform = `scaleX(${k.toFixed(3)})`;
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // selection ring
  const selIndex = useMemo(
    () => (selection ? model.notes.findIndex((n) => n.loc.m === selection.m && n.loc.s === selection.s && n.loc.n === selection.n) : -1),
    [model, selection],
  );
  useEffect(() => {
    const g = stripRef.current;
    if (!g) return;
    g.querySelectorAll('.is-selected').forEach((e) => e.classList.remove('is-selected'));
    if (selIndex >= 0) g.querySelector(`[data-i="${selIndex}"]`)?.classList.add('is-selected');
  }, [selIndex, model, pps]);

  const tuning = score.assembly_params.tuning;
  const head = (width - LEFT) * PLAYHEAD;

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const target = (e.target as Element).closest('[data-i]');
    if (target) {
      const n = model.notes[Number(target.getAttribute('data-i'))];
      if (n) onSelect(n.loc);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - LEFT;
    onSeek(Math.max(0, getTime() + (x - head) / pps));
  };

  return (
    <div className="lane" ref={boxRef}>
      <svg
        className="lane-svg"
        width="100%"
        height={height}
        role="img"
        aria-label="Tab that scrolls with the audio. Click a note to select it, click empty space to seek there."
        onClick={onClick}
        data-testid="lane"
      >
        <defs>
          <linearGradient id="lane-beam" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" className="lane-beam-a" />
            <stop offset="1" className="lane-beam-b" />
          </linearGradient>
          <clipPath id="lane-clip">
            <rect x={0} y={0} width={Math.max(width - LEFT, 0)} height={height} />
          </clipPath>
        </defs>
        <g transform={`translate(${LEFT} 0)`} clipPath="url(#lane-clip)">
          <g ref={strings} className="lane-strings">
            {Array.from({ length: model.strings }, (_, i) => (
              <line key={i} className="lane-string" x1={0} x2={Math.max(width - LEFT, 0)} y1={TOP + i * GAP} y2={TOP + i * GAP} />
            ))}
          </g>
          <g ref={stripRef}>
            <Strip model={model} pps={pps} height={height} />
          </g>
          <rect x={head - 48} y={TOP - 18} width={48} height={height - TOP + 12} fill="url(#lane-beam)" className="lane-beam" />
          <line className="lane-head" x1={head} x2={head} y1={TOP - 18} y2={height - 6} />
          <path className="lane-needle" d={`M${head - 6} ${TOP - 26} h12 l-6 8 z`} />
        </g>
        <g className="lane-names" aria-hidden="true">
          {Array.from({ length: model.strings }, (_, i) => (
            <text key={i} x={14} y={TOP + i * GAP + 4}>{stringLabel(openPitch(tuning, i + 1), i)}</text>
          ))}
        </g>
      </svg>
      <div className="lane-zoom" role="group" aria-label="Lane zoom">
        <button type="button" className="icon-btn small" onClick={() => setPps((p) => Math.max(60, Math.round(p / 1.4)))} aria-label="Zoom out" title="Zoom out"><Icon name="minus" size={16} /></button>
        <button type="button" className="icon-btn small" onClick={() => setPps((p) => Math.min(480, Math.round(p * 1.4)))} aria-label="Zoom in" title="Zoom in"><Icon name="plus" size={16} /></button>
      </div>
    </div>
  );
}
