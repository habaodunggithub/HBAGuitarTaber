import { describe, expect, it } from 'vitest';
import type { Score } from '../api/types';
import { laneModel, slotBeats, soundingAt } from './lane';

const note = (string: number, fret: number, tie = false) => ({
  note_id: 'n', pitch_midi: 60, string, fret, finger: '1', techniques: tie ? [] : [{ type: 'vibrato' }], tie_from_prev: tie, locked: false,
});
const slot = (duration: string, start_s: number, notes: unknown[] = [], extra = {}) => ({ duration, dotted: false, tuplet: null, notes, start_s, ...extra });

// 120 bpm: quarter = 0.5 s. Bar 1: rest(1/2), note A (1/2, tied into bar 2). Bar 2: A cont (1/4), B (1/4), rest (1/2)
const score = {
  assembly_params: { tuning: { open_pitches: [64, 59, 55, 50, 45, 40], capo: 0 } },
  measures: [
    { index: 0, tempo_bpm: 120, time_signature: '4/4', slots: [slot('1/2', 0), slot('1/2', 1, [note(2, 5)])] },
    { index: 1, tempo_bpm: 120, time_signature: '4/4', slots: [slot('1/4', 2, [note(2, 5, true)]), slot('1/4', 2.5, [note(1, 8)]), slot('1/2', 3)] },
  ],
  sync_points: [{ measure_index: 0, time_s: 0 }, { measure_index: 1, time_s: 2 }],
} as unknown as Score;

describe('lane model', () => {
  it('knows slot lengths', () => {
    expect(slotBeats(slot('1/8', 0) as never)).toBe(0.5);
    expect(slotBeats(slot('1/4', 0, [], { dotted: true }) as never)).toBe(1.5);
    expect(slotBeats(slot('1/8', 0, [], { tuplet: [3, 2] }) as never)).toBeCloseTo(1 / 3);
  });
  it('merges tied notes into one sounding span and skips rests', () => {
    const m = laneModel(score);
    expect(m.notes.map((n) => [n.string, n.fret, n.start, n.end])).toEqual([[2, 5, 1, 2.5], [1, 8, 2.5, 3]]);
    expect(m.notes[0]!.techniques).toEqual(['vibrato']);
    expect(m.bars).toEqual([{ index: 0, t: 0 }, { index: 1, t: 2 }]);
    expect(m.end).toBe(4);
    expect(m.strings).toBe(6);
    expect(laneModel(score)).toBe(m); // memoised per score object
  });
  it('finds what sounds at a time', () => {
    const m = laneModel(score);
    expect(soundingAt(m, 0.5)).toEqual([]);
    expect(soundingAt(m, 1)).toEqual([0]);
    expect(soundingAt(m, 2.2)).toEqual([0]); // the tie keeps ringing over the bar line
    expect(soundingAt(m, 2.5)).toEqual([1]);
    expect(soundingAt(m, 3.5)).toEqual([]);
  });
});
