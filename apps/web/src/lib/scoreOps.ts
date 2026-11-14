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

// ───────────── note-level corrections: delete, change pitch, add a missed note ─────────────
// These make a checked tab possible (your own test set). Re-assembling keeps them: deleted
// analysis notes are listed in `deleted_note_ids`, added notes carry ids starting with "u".

let seq = 0;
export const newNoteId = (): string => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Every (string, fret) that sounds `pitch` under the score's tuning. */
export function positionsFor(score: Score, pitch: number): { string: number; fret: number }[] {
  const t = score.assembly_params.tuning;
  const maxFret = score.assembly_params.max_fret - (t.capo ?? 0);
  const out: { string: number; fret: number }[] = [];
  for (let s = 1; s <= (t.open_pitches?.length ?? 6); s++) {
    const f = pitch - openPitch(t, s) - (t.capo ?? 0);
    if (f >= 0 && f <= maxFret) out.push({ string: s, fret: f });
  }
  return out;
}

/** Same string if the pitch fits there, else the place whose fret is closest. */
function nearestPosition(score: Score, pitch: number, near: { string: number; fret: number }) {
  const ps = positionsFor(score, pitch);
  return ps.find((p) => p.string === near.string)
    ?? ps.sort((a, b) => Math.abs(a.fret - near.fret) - Math.abs(b.fret - near.fret))[0]
    ?? null;
}

/** Remove a note (and its tied continuations). A slot left empty becomes a rest. */
export function deleteNote(score: Score, l: NoteLoc): Score {
  const head = chainHead(score, l);
  const note = getNote(score, head);
  if (!note) return score;
  const locs = chain(score, head);
  const next = structuredClone(score);
  // remove from the back so the note indices of earlier locs stay valid
  for (const loc of [...locs].reverse()) next.measures[loc.m]!.slots[loc.s]!.notes.splice(loc.n, 1);
  if (note.note_id && !note.note_id.startsWith('u')) {
    next.deleted_note_ids = [...new Set([...(score.deleted_note_ids ?? []), note.note_id])];
  }
  return next;
}

/** Move a note by `semitones` (e.g. ±1, ±12): it stays on its string when it can. Null if unplayable. */
export function shiftPitch(score: Score, l: NoteLoc, semitones: number): Score | null {
  const head = chainHead(score, l);
  const note = getNote(score, head);
  if (!note) return null;
  const pitch = note.pitch_midi + semitones;
  const pos = nearestPosition(score, pitch, note);
  if (!pos) return null;
  const next = structuredClone(score);
  for (const loc of chain(score, head)) {
    const n = getNote(next, loc)!;
    Object.assign(n, { pitch_midi: pitch, string: pos.string, fret: pos.fret, finger: null });
    if (!n.tie_from_prev) n.locked = true;
  }
  return next;
}

function frac(a: number, b: number): string {
  const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
  const d = g(a, b);
  return `${a / d}/${b / d}`;
}

/** End time of a slot: the next slot's start, or one beat after it at the very end. */
function slotEnd(score: Score, m: number, s: number): number {
  const nxt = nextSlot(score, { m, s, n: 0 });
  if (nxt) return nxt.slot.start_s;
  return score.measures[m]!.slots[s]!.start_s + 60 / (score.measures[m]!.tempo_bpm || 120);
}

/** Split a slot in two (in place). Its notes ring on into the second part; a rest stays a rest. */
function splitSlot(score: Score, m: number, s: number): boolean {
  const slot = score.measures[m]!.slots[s]!;
  const [a, b] = slot.duration.split('/').map(Number) as [number, number];
  if (b * 2 > 64) return false;
  // a/b -> two a/2b; dotted a/b (= 3a/2b) -> a/b + a/2b
  const first = slot.dotted ? `${a}/${b}` : frac(a, 2 * b);
  const second = frac(a, 2 * b);
  const share = slot.dotted ? 2 / 3 : 1 / 2;
  const start = slot.start_s;
  const end = slotEnd(score, m, s);
  const tail: Slot = {
    ...structuredClone(slot),
    duration: second,
    dotted: false,
    start_s: Math.round((start + share * (end - start)) * 1e4) / 1e4,
    notes: slot.notes.map((n) => ({ ...structuredClone(n), tie_from_prev: true, techniques: [] })),
  };
  slot.duration = first;
  slot.dotted = false;
  score.measures[m]!.slots.splice(s + 1, 0, tail);
  return true;
}

const GRID_TOL_S = 0.04;

/**
 * Add a note the transcription missed, at time `t` (the playhead). The slot under `t` is halved
 * until a slot starts within 40 ms of `t` (down to 1/64), and the new note goes there with the
 * pitch and string of the note before it; change its pitch afterwards. If a note is already
 * struck there, nothing is added and that note is returned.
 */
export function insertNoteAt(score: Score, t: number): { score: Score; loc: NoteLoc; added: boolean } | null {
  const next = structuredClone(score);
  // a slot starting within 40 ms of t wins; otherwise the slot that contains t
  let near: [number, number] | null = null;
  let inside: [number, number] | null = null;
  let best = GRID_TOL_S;
  for (let mi = 0; mi < next.measures.length; mi++) {
    const slots = next.measures[mi]!.slots;
    for (let si = 0; si < slots.length; si++) {
      const d = Math.abs(slots[si]!.start_s - t);
      if (d <= best) { best = d; near = [mi, si]; }
      if (!inside && slots[si]!.start_s <= t && t < slotEnd(next, mi, si)) inside = [mi, si];
    }
  }
  const at = near ?? inside;
  if (!at) return null;
  let [m, s] = at;
  for (let k = 0; k < 8; k++) {
    const sl = next.measures[m]!.slots[s]!;
    if (Math.abs(t - sl.start_s) <= GRID_TOL_S) break;
    if (!splitSlot(next, m, s)) break;
    const mid = next.measures[m]!.slots[s + 1]!.start_s;
    if (Math.abs(t - mid) < Math.abs(t - sl.start_s)) s += 1;
  }
  const slot = next.measures[m]!.slots[s]!;
  const struck = slot.notes.findIndex((n) => !n.tie_from_prev);
  if (struck >= 0) return { score, loc: { m, s, n: struck }, added: false };

  // the note sounding (or last struck) before this slot gives the pitch and the hand position
  const before = allLocs(next).filter((l) => l.m < m || (l.m === m && l.s < s)).map((l) => getNote(next, l)!);
  const prev = before.reverse().find((n) => !n.tie_from_prev) ?? null;
  const pitch = prev?.pitch_midi ?? 64;
  const pos = (prev && nearestPosition(next, pitch, prev)) ?? positionsFor(next, pitch)[0];
  if (!pos) return null;
  const id = newNoteId();
  const replaced = slot.notes.map((n) => ({ string: n.string, fret: n.fret }));
  slot.notes = [{ note_id: id, pitch_midi: pitch, string: pos.string, fret: pos.fret, finger: null, techniques: [], tie_from_prev: false, locked: true }];
  // the note that was ringing here stops; its remaining tied slots now ring the new note
  let cur = { m, s, n: 0 };
  for (;;) {
    const nx = nextSlot(next, cur);
    if (!nx) break;
    const i = nx.slot.notes.findIndex((n) => n.tie_from_prev && replaced.some((r) => r.string === n.string && r.fret === n.fret));
    if (i < 0) break;
    nx.slot.notes = [{ ...slot.notes[0]!, tie_from_prev: true, locked: true }];
    cur = { m: nx.m, s: nx.s, n: 0 };
  }
  return { score: next, loc: { m, s, n: 0 }, added: true };
}
