// Audio time <-> score position. The audio element is the master clock (docs §9.3).
import type { Score } from './scoreOps';

export interface Cell {
  m: number;
  s: number;
  t: number; // slot start, seconds
}

const cache = new WeakMap<Score, Cell[]>();

export function cells(score: Score): Cell[] {
  let c = cache.get(score);
  if (!c) {
    c = [];
    score.measures.forEach((m, mi) => m.slots.forEach((s, si) => c!.push({ m: mi, s: si, t: s.start_s })));
    c.sort((a, b) => a.t - b.t);
    cache.set(score, c);
  }
  return c;
}

/** The slot sounding at time t (last slot starting at or before t), or null before the first. */
export function locate(score: Score, t: number): Cell | null {
  const c = cells(score);
  if (!c.length || t < c[0]!.t - 0.05) return null;
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c[mid]!.t <= t) lo = mid;
    else hi = mid - 1;
  }
  return c[lo]!;
}

export function slotTime(score: Score, m: number, s: number): number {
  return score.measures[m]?.slots[s]?.start_s ?? 0;
}

/** BPM from tap timestamps (seconds): median interval, robust to a sloppy tap. */
export function bpmFromTaps(taps: number[]): number | null {
  if (taps.length < 3) return null;
  const iv = taps.slice(1).map((t, i) => t - taps[i]!).sort((a, b) => a - b);
  const med = iv[Math.floor(iv.length / 2)]!;
  return med > 0 ? Math.round((60 / med) * 10) / 10 : null;
}
