import { useMemo } from 'react';

/** A few bars of hand-written tab, generated from the title: it draws itself on hover. */
export default function TabDoodle({ seed, width = 180 }: { seed: string; width?: number }) {
  const notes = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    const out: { x: number; s: number; f: number }[] = [];
    for (let i = 0; i < 5; i++) { h = Math.imul(h ^ (h >>> 13), 1274126177); out.push({ x: 18 + i * ((width - 30) / 5), s: (h >>> 3) % 3, f: [3, 5, 7, 8, 10, 12][(h >>> 7) % 6]! }); }
    return out;
  }, [seed, width]);
  return (
    <svg className="doodle" width={width} height="40" viewBox={`0 0 ${width} 40`} aria-hidden="true" focusable="false">
      <path pathLength={1} d={`M0 8h${width}M0 18h${width}M0 28h${width}`} />
      {notes.map((n, i) => <text key={i} x={n.x} y={11 + n.s * 10} style={{ transitionDelay: `${300 + i * 70}ms` }}>{n.f}</text>)}
    </svg>
  );
}
