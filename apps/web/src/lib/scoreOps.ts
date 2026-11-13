// Pure, immutable edit operations on a Score (docs §9.3). Nothing here touches React.
import type { Score, ScoreNote, Slot } from '../api/types';
import { openPitch, soundingPitch } from './tuning';

export type { Score, ScoreNote, Slot };

export interface NoteLoc {
  m: number; // measure index in score.measures
  s: number; // slot index
  n: number; // note index inside the slot
}

export const sameLoc = (a: NoteLoc | null, b: NoteLoc | null): boolean =>
  a === b || (!!a && !!b && a.m === b.m && a.s === b.s && a.n === b.n);

export function getNote(score: Score, l: NoteLoc): ScoreNote | undefined {
  return score.measures[l.m]?.slots[l.s]?.notes[l.n];
}

/** All notes in reading order (tied continuations included). */
export function allLocs(score: Score): NoteLoc[] {
  const out: NoteLoc[] = [];
  score.measures.forEach((m, mi) =>
    m.slots.forEach((s, si) => s.notes.forEach((_, ni) => out.push({ m: mi, s: si, n: ni }))),
  );
  return out;
}

/** Reading-order neighbour of a loc among *struck* notes (skips tie continuations). */
export function stepLoc(score: Score, from: NoteLoc | null, dir: 1 | -1): NoteLoc | null {
  const locs = allLocs(score).filter((l) => !getNote(score, l)?.tie_from_prev);
  if (!locs.length) return null;
  if (!from) return dir === 1 ? locs[0]! : locs[locs.length - 1]!;
  const i = locs.findIndex((l) => l.m === from.m && l.s === from.s && l.n === from.n);
  const next = locs[(i === -1 ? 0 : i) + dir];
  return next ?? locs[i === -1 ? 0 : i]!;
}

/** The first note of a tie chain (the one that is actually struck). */
export function chainHead(score: Score, l: NoteLoc): NoteLoc {
  let cur = l;
  for (;;) {
    const note = getNote(score, cur);
    if (!note?.tie_from_prev) return cur;
    const prev = prevSlot(score, cur);
    if (!prev) return cur;
    const idx = prev.slot.notes.findIndex((x) => x.string === note.string);
    if (idx < 0) return cur;
    cur = { m: prev.m, s: prev.s, n: idx };
  }
}

function prevSlot(score: Score, l: NoteLoc): { m: number; s: number; slot: Slot } | null {
  if (l.s > 0) return { m: l.m, s: l.s - 1, slot: score.measures[l.m]!.slots[l.s - 1]! };
  for (let m = l.m - 1; m >= 0; m--) {
    const slots = score.measures[m]!.slots;
    if (slots.length) return { m, s: slots.length - 1, slot: slots[slots.length - 1]! };
  }
  return null;
}

/** Every (string, fret) that sounds the same pitch as this note under the score's tuning. */
export function altPositions(score: Score, l: NoteLoc): { string: number; fret: number }[] {
  const note = getNote(score, l);
  if (!note) return [];
  const t = score.assembly_params.tuning;
  const maxFret = score.assembly_params.max_fret - (t.capo ?? 0);
  const out: { string: number; fret: number }[] = [];
  for (let s = 1; s <= (t.open_pitches?.length ?? 6); s++) {
    const f = note.pitch_midi - openPitch(t, s) - (t.capo ?? 0);
    if (f >= 0 && f <= maxFret) out.push({ string: s, fret: f });
  }
  return out;
}

/** Collect the tie chain starting at `head` (same string/fret in following slots). */
function chain(score: Score, head: NoteLoc): NoteLoc[] {
  const out = [head];
  let cur = head;
  const base = getNote(score, head);
  if (!base) return out;
  for (;;) {
    const nxt = nextSlot(score, cur);
    if (!nxt) break;
    const idx = nxt.slot.notes.findIndex(
      (x) => x.tie_from_prev && x.string === base.string && x.fret === base.fret,
    );
    if (idx < 0) break;
    cur = { m: nxt.m, s: nxt.s, n: idx };
    out.push(cur);
  }
  return out;
}

function nextSlot(score: Score, l: NoteLoc): { m: number; s: number; slot: Slot } | null {
  const slots = score.measures[l.m]!.slots;
  if (l.s + 1 < slots.length) return { m: l.m, s: l.s + 1, slot: slots[l.s + 1]! };
  for (let m = l.m + 1; m < score.measures.length; m++) {
    const sl = score.measures[m]!.slots;
    if (sl.length) return { m, s: 0, slot: sl[0]! };
  }
  return null;
}

/** Move a note (and its tied continuations) to another position of the same pitch and lock it. */
export function setPosition(score: Score, l: NoteLoc, string: number, fret: number): Score {
  const t = score.assembly_params.tuning;
  const note = getNote(score, l);
  if (!note) return score;
  if (soundingPitch(t, string, fret) !== note.pitch_midi) {
    throw new RangeError('position does not sound the same pitch');
  }
  const next = structuredClone(score);
  for (const loc of chain(next, chainHead(next, l))) {
    const n = getNote(next, loc)!;
    n.string = string;
    n.fret = fret;
    if (!n.tie_from_prev) n.locked = true;
    n.finger = null;
  }
  return next;
}

export function setLocked(score: Score, l: NoteLoc, locked: boolean): Score {
  const next = structuredClone(score);
  const n = getNote(next, chainHead(next, l));
  if (n) n.locked = locked;
  return next;
}

/** Next alternative position in the string order (dir=+1 → toward thinner/higher strings first). */
export function cyclePosition(score: Score, l: NoteLoc, dir: 1 | -1): { string: number; fret: number } | null {
  const note = getNote(score, l);
  const alts = altPositions(score, l);
  if (!note || alts.length < 2) return null;
  const i = alts.findIndex((a) => a.string === note.string && a.fret === note.fret);
  const j = (i + (dir === 1 ? -1 : 1) + alts.length) % alts.length;
  return alts[j] ?? null;
}

/** Seconds covered by one measure: [start, end). */
export function measureRange(score: Score, m: number): [number, number] {
  const start = score.sync_points.find((p) => p.measure_index === m)?.time_s ?? 0;
  const nextP = score.sync_points.find((p) => p.measure_index === m + 1);
  if (nextP) return [start, nextP.time_s];
  const m0 = score.measures[m];
  const last = m0?.slots[m0.slots.length - 1];
  const bpm = m0?.tempo_bpm ?? 120;
  return [start, Math.max(start + 0.5, (last?.start_s ?? start) + 60 / bpm)];
}
