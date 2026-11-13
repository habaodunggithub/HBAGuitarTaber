// Time model for the play-along lane: when each struck note starts and stops sounding.
import type { Score, Slot } from '../api/types';
import type { NoteLoc } from './scoreOps';

export interface LaneNote {
  loc: NoteLoc;
  string: number;
  fret: number;
  start: number; // seconds, on the timeline of the original recording
  end: number;
  techniques: string[];
  locked: boolean;
}

export interface LaneBar {
  index: number;
  t: number;
}

export interface LaneModel {
  notes: LaneNote[]; // sorted by start
  bars: LaneBar[];
  end: number;
  strings: number;
}

/** Slot length in quarter-note beats ("1/8" dotted, triplets...). */
export function slotBeats(slot: Slot): number {
  const den = Number(slot.duration.split('/')[1]);
  let beats = 4 / den;
  if (slot.dotted) beats *= 1.5;
  if (slot.tuplet) beats = (beats * slot.tuplet[1]) / slot.tuplet[0];
  return beats;
}

const cache = new WeakMap<Score, LaneModel>();

export function laneModel(score: Score): LaneModel {
  const hit = cache.get(score);
  if (hit) return hit;
  // flatten slots with their end time (= next slot start, or own length for the last one)
  const flat: { m: number; s: number; slot: Slot; start: number; end: number }[] = [];
  score.measures.forEach((meas, m) =>
    meas.slots.forEach((slot, s) => flat.push({ m, s, slot, start: slot.start_s, end: 0 })),
  );
  flat.forEach((f, i) => {
    const next = flat[i + 1];
    const bpm = score.measures[f.m]?.tempo_bpm || 120;
    f.end = next ? next.start : f.start + (slotBeats(f.slot) * 60) / bpm;
  });

  const notes: LaneNote[] = [];
  flat.forEach((f, i) => {
    f.slot.notes.forEach((note, n) => {
      if (note.tie_from_prev) return;
      // follow the tie chain on the same string to find where the sound stops
      let end = f.end;
      for (let j = i + 1; j < flat.length; j++) {
        const cont = flat[j]!.slot.notes.find((x) => x.tie_from_prev && x.string === note.string && x.fret === note.fret);
        if (!cont) break;
        end = flat[j]!.end;
      }
      notes.push({
        loc: { m: f.m, s: f.s, n },
        string: note.string,
        fret: note.fret,
        start: f.start,
        end,
        techniques: note.techniques.map((t) => t.type),
        locked: !!note.locked,
      });
    });
  });
  notes.sort((a, b) => a.start - b.start || a.string - b.string);
  const bars = score.sync_points.map((p) => ({ index: p.measure_index, t: p.time_s }));
  const model = {
    notes,
    bars,
    end: flat.length ? flat[flat.length - 1]!.end : 0,
    strings: score.assembly_params.tuning.open_pitches.length || 6,
  };
  cache.set(score, model);
  return model;
}

/** Indices of the notes sounding at time t (chords give several). */
export function soundingAt(model: LaneModel, t: number): number[] {
  const ns = model.notes;
  let lo = 0;
  let hi = ns.length; // first note starting after t
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ns[mid]!.start <= t) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo - 1; i >= 0 && i >= lo - 8; i--) if (ns[i]!.end > t) out.push(i);
  return out.reverse();
}
