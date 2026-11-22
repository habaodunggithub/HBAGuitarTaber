import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type * as AT from '@coderline/alphatab';
import type { Score } from '../api/types';
import { useT } from '../i18n';
import type { NoteLoc } from '../lib/scoreOps';

export interface TabController {
  /** Move the playback cursor (null hides it). Cheap: no React state involved. */
  setCursor: (cell: { m: number; s: number } | null) => void;
  /** Scroll so the given measure is visible. */
  revealMeasure: (m: number) => void;
}

interface Props {
  tex: string;
  score: Score;
  selection: NoteLoc | null;
  onSelect: (loc: NoteLoc | null) => void;
  showStaff: boolean;
  controllerRef: Ref<TabController>;
  onError?: (message: string) => void;
}

const css = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** alphaTab's note -> our (measure, slot, note) location. alphaTab string 1 is the LOWEST string. */
function toLoc(score: Score, note: AT.model.Note): NoteLoc | null {
  const bar = note.beat.voice.bar;
  const m = bar.index;
  const s = note.beat.index;
  const nStrings = bar.staff.tuning.length;
  const ours = nStrings + 1 - note.string;
  const slot = score.measures[m]?.slots[s];
  const n = slot?.notes.findIndex((x) => x.string === ours && x.fret === note.fret) ?? -1;
  return n >= 0 ? { m, s, n } : null;
}

export default function TabView({ tex, score, selection, onSelect, showStaff, controllerRef, onError }: Props) {
  const t = useT();
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AT.AlphaTabApi | null>(null);
  const overlay = useRef<{ root: HTMLDivElement; cursor: HTMLDivElement; sel: HTMLDivElement } | null>(null);
  // latest props for event handlers created once (no re-subscribing on every render)
  const latest = useRef({ score, selection, onSelect, onError });
  latest.current = { score, selection, onSelect, onError };
  const cursorCell = useRef<{ m: number; s: number } | null>(null);
  const lastCursorY = useRef(-1);

  const beatAt = (m: number, s: number): AT.model.Beat | undefined =>
    apiRef.current?.score?.tracks[0]?.staves[0]?.bars[m]?.voices[0]?.beats[s];

  const paintCursor = () => {
    const ov = overlay.current;
    const api = apiRef.current;
    const cell = cursorCell.current;
    if (!ov || !api) return;
    const beat = cell ? beatAt(cell.m, cell.s) : undefined;
    const b = beat ? api.boundsLookup?.findBeat(beat)?.realBounds : undefined;
    if (!b) {
      ov.cursor.style.display = 'none';
      return;
    }
    ov.cursor.style.display = 'block';
    ov.cursor.style.transform = `translate(${b.x}px, ${b.y}px)`;
    ov.cursor.style.width = `${Math.max(b.w, 6)}px`;
    ov.cursor.style.height = `${b.h}px`;
    if (b.y !== lastCursorY.current) {
      lastCursorY.current = b.y;
      const sc = scrollRef.current;
      if (sc && (b.y < sc.scrollTop || b.y + b.h > sc.scrollTop + sc.clientHeight)) {
        sc.scrollTo({ top: Math.max(b.y - 24, 0), behavior: 'smooth' });
      }
    }
  };

  const paintSelection = () => {
    const ov = overlay.current;
    const api = apiRef.current;
    const sel = latest.current.selection;
    if (!ov || !api) return;
    const beat = sel ? beatAt(sel.m, sel.s) : undefined;
    const slotNote = sel ? latest.current.score.measures[sel.m]?.slots[sel.s]?.notes[sel.n] : undefined;
    const nb = beat && slotNote
      ? api.boundsLookup?.findBeat(beat)?.notes?.find((x) => {
          const n = x.note;
          return n.string === beat.voice.bar.staff.tuning.length + 1 - slotNote.string && n.fret === slotNote.fret;
        })?.noteHeadBounds
      : undefined;
    if (!nb) {
      ov.sel.style.display = 'none';
      return;
    }
    const pad = 4;
    ov.sel.style.display = 'block';
    ov.sel.style.transform = `translate(${nb.x - pad}px, ${nb.y - pad}px)`;
    ov.sel.style.width = `${nb.w + pad * 2}px`;
    ov.sel.style.height = `${nb.h + pad * 2}px`;
  };

  useImperativeHandle(controllerRef, () => ({
    setCursor: (cell) => {
      cursorCell.current = cell;
      paintCursor();
    },
    revealMeasure: (m) => {
      const mb = apiRef.current?.boundsLookup?.findMasterBarByIndex(m);
      const sc = scrollRef.current;
      if (mb && sc) sc.scrollTo({ top: Math.max(mb.visualBounds.y - 24, 0), behavior: 'smooth' });
    },
  }));

  // create the alphaTab instance once (the library is a separate lazy chunk)
  useEffect(() => {
    let disposed = false;
    let api: AT.AlphaTabApi | null = null;
    let onScheme: (() => void) | null = null;
    void import('@coderline/alphatab').then((at) => {
      if (disposed || !hostRef.current) return;
      const host = hostRef.current;
      api = new at.AlphaTabApi(host, {
        core: { useWorkers: true, fontDirectory: '/font/', includeNoteBounds: true, enableLazyLoading: false }, // needed for note clicks + selection box
        // our own cursor drives the scrolling; alphaTab would otherwise scroll the whole page (html) on render
        player: { playerMode: at.PlayerMode.Disabled, scrollMode: at.ScrollMode.Off, scrollElement: scrollRef.current ?? undefined },
        display: {
          layoutMode: at.LayoutMode.Page,
          scale: 1.05,
          staveProfile: showStaff ? at.StaveProfile.ScoreTab : at.StaveProfile.Tab,
          resources: {
            mainGlyphColor: css('--tab-ink', '#e8e0d4'),
            secondaryGlyphColor: css('--tab-ink-2', '#a79d90'),
            staffLineColor: css('--tab-line', '#5a5249'),
            barSeparatorColor: css('--tab-line', '#5a5249'),
            barNumberColor: css('--tab-ink-2', '#a79d90'),
            scoreInfoColor: css('--tab-ink', '#e8e0d4'),
          },
        },
      });
      apiRef.current = api;
      // the page header already shows the title
      api.settings.notation.elements.set(at.NotationElement.ScoreTitle, false);
      api.updateSettings();
      // alphaTab reads colours once: repaint with the new palette when light/dark mode changes
      onScheme = () => {
        const a = apiRef.current;
        if (!a) return;
        const r = a.settings.display.resources;
        const c = (v: string, d: string) => at.model.Color.fromJson(css(v, d))!;
        r.mainGlyphColor = c('--tab-ink', '#1b2220');
        r.secondaryGlyphColor = c('--tab-ink-2', '#69736e');
        r.staffLineColor = c('--tab-line', '#b9c1ba');
        r.barSeparatorColor = c('--tab-line', '#b9c1ba');
        r.barNumberColor = c('--tab-ink-2', '#69736e');
        r.scoreInfoColor = c('--tab-ink', '#1b2220');
        a.updateSettings();
        a.render();
      };
      window.addEventListener('taber-theme', onScheme);
      // The overlay lives on the host, NOT inside .at-surface: alphaTab replaces the surface's
      // children right after every render and would delete it. Same origin, so bounds line up.
      const root = document.createElement('div');
      root.className = 'tab-overlay';
      const sel = document.createElement('div');
      sel.className = 'tab-selection';
      const cursor = document.createElement('div');
      cursor.className = 'tab-cursor';
      root.append(sel, cursor);
      host.append(root);
      overlay.current = { root, cursor, sel };
      api.renderFinished.on(() => {
        lastCursorY.current = -1;
        paintCursor();
        paintSelection();
      });
      api.noteMouseDown.on((note) => {
        const loc = toLoc(latest.current.score, note);
        if (loc) latest.current.onSelect(loc);
      });
      api.error.on((e) => latest.current.onError?.(e.message));
      api.tex(tex);
    });
    return () => {
      disposed = true;
      if (onScheme) window.removeEventListener('taber-theme', onScheme);
      overlay.current = null;
      apiRef.current = null;
      api?.destroy();
    };
    // created once; tex/staff updates are handled by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // new score text -> re-render
  const firstTex = useRef(true);
  useEffect(() => {
    if (firstTex.current) {
      firstTex.current = false;
      return;
    }
    apiRef.current?.tex(tex);
  }, [tex]);

  // staff on/off
  const firstStaff = useRef(true);
  useEffect(() => {
    if (firstStaff.current) {
      firstStaff.current = false;
      return;
    }
    const api = apiRef.current;
    if (!api) return;
    void import('@coderline/alphatab').then((at) => {
      api.settings.display.staveProfile = showStaff ? at.StaveProfile.ScoreTab : at.StaveProfile.Tab;
      api.updateSettings();
      api.render();
    });
  }, [showStaff]);

  useEffect(() => {
    paintSelection();
    const sel = selection;
    if (sel) {
      const b = apiRef.current?.boundsLookup;
      const beat = beatAt(sel.m, sel.s);
      const r = beat ? b?.findBeat(beat)?.realBounds : undefined;
      const sc = scrollRef.current;
      if (r && sc && (r.y < sc.scrollTop || r.y + r.h > sc.scrollTop + sc.clientHeight)) {
        sc.scrollTo({ top: Math.max(r.y - 24, 0), behavior: 'smooth' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, score]);

  return (
    <div ref={scrollRef} className="tab-scroll" role="region" aria-label={t.tabView.region} tabIndex={-1}>
      <div ref={hostRef} className="tab-host" />
    </div>
  );
}
