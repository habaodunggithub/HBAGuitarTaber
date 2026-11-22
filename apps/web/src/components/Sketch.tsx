import { useEffect, useRef } from 'react';
import { toggleTheme, useTheme } from '../lib/theme';

/**
 * The hero drawing: an electric guitar leaning on a small amp, in ink with a blue wash.
 * It draws itself on first view, the lines "boil" slightly like hand-drawn animation, and the amp's
 * lamp is a real switch: day desk / night desk.
 */
export default function Sketch({ className }: { className?: string }) {
  const theme = useTheme();
  const lampRef = useRef<SVGGElement>(null);

  // line boil: re-seed the wobble a few times a second, like redrawn animation frames
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const noise = document.getElementById('boil-noise');
    let s = 1;
    const h = window.setInterval(() => { s = (s % 4) + 1; noise?.setAttribute('seed', String(s)); }, 170);
    return () => window.clearInterval(h);
  }, []);

  const flip = () => {
    const r = lampRef.current?.getBoundingClientRect();
    toggleTheme(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined);
  };
  const P = { pathLength: 1 };

  return (
    <div className={`sketch${className ? ` ${className}` : ''}`}>
      <svg viewBox="0 0 900 760" role="img" aria-label="Ink drawing of an electric guitar leaning on a small amp">
        <g className="stars" aria-hidden="true">
          <circle cx="520" cy="60" r="1.6" /><circle cx="610" cy="20" r="1.2" /><circle cx="700" cy="90" r="1.8" /><circle cx="430" cy="130" r="1.1" /><circle cx="790" cy="40" r="1.4" /><circle cx="330" cy="40" r="1.3" />
        </g>
        <ellipse className="wash" cx="600" cy="560" rx="170" ry="120" />
        {/* the guitar group is scaled about its lowest point so it rests on the floor line (y ≈ 699) */}
        <ellipse className="wash soft" cx="330" cy="300" rx="70" ry="210" transform="translate(418 699) scale(0.9) translate(-418 -771) rotate(-18 330 300)" />
        <g className="draw boil">
          <path className="ink thin" d="M40 700 C200 694 420 700 880 690" {...P} />
          <path className="ink hair" d="M90 716 L170 715 M240 718 L420 716 M520 714 L720 712" {...P} />

          {/* amp */}
          <rect className="ink paper" x="450" y="430" width="300" height="250" rx="10" {...P} />
          <rect className="grille" x="470" y="490" width="260" height="170" rx="4" />
          <rect className="ink" x="470" y="490" width="260" height="170" rx="4" {...P} />
          <path className="ink" d="M560 430 C560 400 640 400 640 430" {...P} />
          <g className="ink thin"><circle cx="572" cy="460" r="8" {...P} /><circle cx="604" cy="460" r="8" {...P} /><circle cx="636" cy="460" r="8" {...P} /><circle cx="668" cy="460" r="8" {...P} /><circle cx="700" cy="460" r="8" {...P} /></g>
          <path className="ink hair" d="M572 452v6 M604 452l3 6 M636 452l-2 6 M668 452l4 5 M700 452v6" />
          {/* name badge on the grille corner: the leaning guitar covers the left of the amp */}
          <rect className="ink paper" x="636" y="634" width="84" height="20" rx="2" />
          <text x="645" y="649" className="sk-text">TABER 15</text>
          <path className="ink hair" d="M455 680 L455 692 M745 680 L745 692" />
          <path className="ink thin hatch" d="M748 440 L760 448 L760 690 L748 680" {...P} />

          {/* guitar leaning on the amp */}
          <g transform="translate(418 699) scale(0.9) translate(-418 -771) rotate(-22 330 420) translate(170 20)">
            <path className="ink paper" d="M144 104 L144 40 C144 20 160 6 180 8 C198 10 204 24 196 40 L184 64 L184 104 Z" {...P} />
            <g className="ink thin"><circle cx="194" cy="26" r="4" /><circle cx="190" cy="42" r="4" /><circle cx="186" cy="58" r="4" /><circle cx="184" cy="74" r="4" /><circle cx="184" cy="88" r="4" /><circle cx="184" cy="100" r="3.5" /></g>
            <rect className="ink paper" x="144" y="104" width="40" height="340" {...P} />
            <path className="ink hair" d="M144 108h40 M144 140h40 M144 170h40 M144 198h40 M144 224h40 M144 248h40 M144 270h40 M144 291h40 M144 310h40 M144 328h40 M144 345h40 M144 361h40 M144 376h40 M144 390h40" />
            <g className="inlay"><circle cx="164" cy="184" r="2.6" /><circle cx="164" cy="236" r="2.6" /><circle cx="164" cy="281" r="2.6" /><circle cx="164" cy="319" r="2.6" /><circle cx="157" cy="368" r="2.4" /><circle cx="171" cy="368" r="2.4" /></g>
            <path className="ink paper" d="M96 456 C76 440 66 414 78 401 C92 390 110 402 122 420 C132 432 150 438 164 438 C182 438 198 430 208 414 C218 398 234 386 250 392 C268 400 262 430 242 456 C274 488 298 544 294 606 C290 694 240 764 164 766 C88 764 36 702 34 630 C34 560 64 496 96 456 Z" {...P} />
            <path className="ink thin" d="M118 470 C112 520 104 560 120 600 C140 640 186 650 214 628 C240 606 246 560 232 520 C224 500 210 480 196 470" {...P} />
            <path className="hatch-fill" d="M50 600 C54 680 100 740 160 752 C110 730 74 690 60 620 Z" />
            <g className="ink thin paper"><rect x="142" y="500" width="44" height="12" rx="5" /><rect x="142" y="540" width="44" height="12" rx="5" /><rect x="140" y="584" width="48" height="12" rx="5" transform="rotate(-8 164 590)" /><rect x="138" y="632" width="52" height="14" rx="2" /></g>
            <g className="ink thin"><circle cx="226" cy="600" r="8" /><circle cx="234" cy="630" r="8" /><circle cx="226" cy="660" r="7" /></g>
            <path className="ink hair" d="M150 104 L150 640 M156 104 L156 640 M161 104 L161 640 M167 104 L167 640 M172 104 L172 640 M178 104 L178 640" />
          </g>

          {/* from the lamp up to the "Click the amp lamp" note */}
          <path className="ink hair dash" d="M752 446 C800 400 840 200 890 50" />
          <path className="ink hair" d="M890 50 l-8.7 8.3 M890 50 l2 11.8" />
        </g>
        {/* the lamp: day / night switch */}
        <g
          ref={lampRef}
          className="lamp-switch"
          role="button"
          tabIndex={0}
          aria-label={theme === 'night' ? 'Switch to the day desk' : 'Switch to the night desk'}
          aria-pressed={theme === 'night'}
          onClick={flip}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } }}
        >
          <circle className="lamp-glow" cx="728" cy="460" r="24" />
          <circle className="lamp-core" cx="728" cy="460" r="8" />
          <circle cx="728" cy="460" r="26" fill="transparent" />
        </g>
      </svg>
    </div>
  );
}

/** Shared SVG filters and patterns (mounted once in App). */
export function InkDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="wobble"><feTurbulence id="boil-noise" type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="1" /><feDisplacementMap in="SourceGraphic" scale="3.2" /></filter>
      <filter id="wobble-still"><feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="3" /><feDisplacementMap in="SourceGraphic" scale="2.4" /></filter>
      {/* tall region: the marks over Vietnamese capitals stand above the line box */}
      <filter id="rough-text" x="-5%" y="-35%" width="110%" height="170%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="4" result="n" /><feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 2.05" result="holes" /><feComposite in="SourceGraphic" in2="holes" operator="in" result="ink" /><feTurbulence type="fractalNoise" baseFrequency=".04" numOctaves="2" seed="2" result="w" /><feDisplacementMap in="ink" in2="w" scale="4" /></filter>
      <filter id="watercolor" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".015" numOctaves="3" seed="8" result="t" /><feDisplacementMap in="SourceGraphic" in2="t" scale="40" result="d" /><feGaussianBlur in="d" stdDeviation="3" /></filter>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="6" className="pat-line" /></pattern>
      <pattern id="grille" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 0 L9 9 M9 0 L0 9" className="pat-line thin" /></pattern>
    </svg>
  );
}
