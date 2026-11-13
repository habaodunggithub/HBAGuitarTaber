import { useCallback, useEffect, useRef } from 'react';
import type { TabController } from '../../components/TabView';
import { measureRange } from '../../lib/scoreOps';
import { locate } from '../../lib/timeline';
import { useEditor } from '../../stores/editor';

/**
 * The take's <audio>/<video> element as the clock of the editor:
 *  - one rAF loop moves the score cursor and enforces the bar loop (no React state per frame)
 *  - picking a note while paused moves the playhead to it
 *  - transport actions: play/pause, seek, skip bars, and the current beat for the metronome
 */
export function usePlayback(tabCtl: React.RefObject<TabController | null>, loopOn: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const selection = useEditor((s) => s.selection);
  const loop = useRef(loopOn);
  loop.current = loopOn;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      const { score, selection: sel } = useEditor.getState();
      if (a && score) {
        if (loop.current && sel && !a.paused) {
          const [from, to] = measureRange(score, sel.m);
          if (a.currentTime >= to || a.currentTime < from - 0.05) a.currentTime = from;
        }
        const cell = locate(score, a.currentTime);
        tabCtl.current?.setCursor(cell && !(a.paused && a.currentTime === 0) ? { m: cell.m, s: cell.s } : null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tabCtl]);

  // only when the selection changes, not on every edit
  useEffect(() => {
    const a = audioRef.current;
    const score = useEditor.getState().score;
    if (!a || !a.paused || !selection || !score) return;
    const t0 = score.measures[selection.m]?.slots[selection.s]?.start_s;
    if (t0 !== undefined && Math.abs(a.currentTime - t0) > 0.02) a.currentTime = t0;
  }, [selection]);

  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);
  const seek = useCallback((t: number) => { if (audioRef.current) audioRef.current.currentTime = t; }, []);
  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (a) { if (a.paused) void a.play(); else a.pause(); }
  }, []);

  /** The metronome follows the take's own beats: bar start + tempo of that bar. */
  const beatAt = useCallback(() => {
    const a = audioRef.current;
    const score = useEditor.getState().score;
    if (!a || !score) return null;
    const cell = locate(score, a.currentTime);
    if (!cell) return null;
    const [start] = measureRange(score, cell.m);
    const bpm = score.measures[cell.m]?.tempo_bpm ?? 120;
    return ((a.currentTime - start) * bpm) / 60;
  }, []);

  /** Previous / next measure, like track skip: "previous" first returns to the start of the current one. */
  const skip = useCallback((dir: 1 | -1) => {
    const a = audioRef.current;
    const score = useEditor.getState().score;
    if (!a || !score) return;
    const m = locate(score, a.currentTime)?.m ?? 0;
    const [start] = measureRange(score, m);
    let target = m + dir;
    if (dir === -1 && a.currentTime - start > 0.6) target = m;
    target = Math.min(Math.max(target, 0), score.measures.length - 1);
    a.currentTime = measureRange(score, target)[0];
  }, []);

  return { audioRef, getTime, seek, togglePlay, beatAt, skip };
}
