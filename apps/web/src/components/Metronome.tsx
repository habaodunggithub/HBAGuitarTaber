import { useEffect, useRef } from 'react';

/**
 * A hand-drawn metronome: the practice symbol in place of a playback machine. Visual only
 * (aria-hidden); every movement reports real state:
 *  - while the take plays, the pendulum swings on the take's own beats (reaching an end on every
 *    beat, where the tick mark flashes), so slowing playback to 50% slows the swing with it
 *  - when playback stops, the swing dies away to rest instead of freezing
 *  - the sliding weight sits at the tab's tempo on the scale, as on a real metronome
 */
interface Props {
  /** Swinging (playing, or working). */
  running: boolean;
  /** Current beat as a float (integer = on the beat), read every frame; null = no beat yet. */
  beat: () => number | null;
  bpm: number;
  /** Hand-written on the tape label. */
  label: string;
  className?: string;
}

const PIVOT = { x: 160, y: 318 };
const AMP = 17; // degrees at the ends of the swing
const SCALE = [40, 60, 80, 100, 120, 144, 168, 208];
const weightY = (bpm: number) => {
  const b = Math.min(Math.max(bpm || 100, 40), 208);
  return 92 + ((b - 40) / 168) * 170; // slow tempo = weight high up the rod
};

export default function Metronome({ running, beat, bpm, label, className }: Props) {
  const pend = useRef<SVGGElement>(null);
  const ticks = useRef<SVGGElement>(null);
  const live = useRef({ running, beat });
  live.current = { running, beat };

  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let amp = 0;
    let lastPhase = 0;
    let shown = Number.POSITIVE_INFINITY;
    let raf = 0;
    const frame = () => {
      const { running: on, beat: getBeat } = live.current;
      const b = on ? getBeat() : null;
      if (b != null) lastPhase = b;
      const target = on && b != null && !still ? AMP : 0;
      amp += (target - amp) * (target > amp ? 0.12 : 0.035);
      if (amp < 0.05 && target === 0) amp = 0;
      const angle = -amp * Math.cos(Math.PI * lastPhase);
      if (pend.current && Math.abs(angle - shown) > 0.03) {
        pend.current.style.transform = `rotate(${angle.toFixed(2)}deg)`;
        shown = angle;
      }
      // tick: flash the mark at the end the pendulum just reached
      if (ticks.current && b != null && amp > 4) {
        const near = Math.abs(Math.cos(Math.PI * b)) > 0.985;
        const side = Math.cos(Math.PI * b) > 0 ? 0 : 1;
        ticks.current.children[side]?.classList.toggle('on', near);
        ticks.current.children[1 - side]?.classList.remove('on');
      } else if (ticks.current) {
        for (const t of Array.from(ticks.current.children)) t.classList.remove('on');
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const wy = weightY(bpm);
  return (
    <div className={`metro${running ? ' is-live' : ''}${className ? ` ${className}` : ''}`} aria-hidden="true">
      <svg viewBox="0 0 320 420" className="metro-svg" focusable="false">
        {/* hatched shadow */}
        <path className="mt-shadow" d="M108 392 L146 50 L196 50 L250 392 Z" transform="translate(14 6)" />
        {/* body */}
        <path className="mt-body" d="M92 380 Q110 214 134 50 Q136 38 148 38 L172 38 Q184 38 186 50 Q209 216 228 380 Z" />
        <path className="mt-face" d="M110 344 Q122 206 136 70 L184 70 Q197 208 210 344 Z" />
        {/* tempo scale, printed on the face behind the rod (read it at the top edge of the weight) */}
        <g className="mt-scale">
          {SCALE.map((s) => (
            <g key={s}>
              <path d={`M164 ${weightY(s)} h5`} />
              <text x="171" y={weightY(s) + 3}>{s}</text>
            </g>
          ))}
        </g>
        {/* tick marks at the ends of the swing */}
        <g ref={ticks} className="mt-ticks">
          <path d="M104 96 l-14 -10 M100 110 l-16 -2" />
          <path d="M216 96 l14 -10 M220 110 l16 -2" />
        </g>
        {/* pendulum */}
        <g ref={pend} className="mt-pend" style={{ transformOrigin: `${PIVOT.x}px ${PIVOT.y}px` }}>
          <path className="mt-rod" d={`M${PIVOT.x} ${PIVOT.y} L${PIVOT.x} 62`} />
          <path className="mt-weight" d={`M147 ${wy - 9} L173 ${wy - 9} L169 ${wy + 9} L151 ${wy + 9} Z`} />
          <path className="mt-weight-line" d={`M151 ${wy} h18`} />
        </g>
        <circle className="mt-pivot" cx={PIVOT.x} cy={PIVOT.y} r="6" />
        {/* winding key */}
        <path className="mt-key" d="M224 250 h18 M242 240 v20 a6 6 0 0 0 0 -20" />
        {/* base + tape label */}
        <rect className="mt-base" x="72" y="378" width="176" height="22" rx="4" />
        <g transform="rotate(-2 160 362)">
          <rect className="mt-tape" x="112" y="350" width="96" height="26" />
          <text className="mt-label" x="160" y="369">{label}</text>
        </g>
      </svg>
    </div>
  );
}
