import { describe, expect, it } from 'vitest';
import {
  allLocs,
  altPositions,
  chainHead,
  cyclePosition,
  getNote,
  measureRange,
  setLocked,
  setPosition,
  stepLoc,
  type Score,
} from './scoreOps';
import { bpmFromTaps, cells, locate } from './timeline';
import { noteName, openPitch, presetName, soundingPitch, STANDARD } from './tuning';

const tuning = { name: 'Standard', open_pitches: [...STANDARD], capo: 0 };

/** Two measures: E4 (string 2 fret 5) held across the bar line, then A4. */
function makeScore(capo = 0): Score {
  const note = (string: number, fret: number, pitch: number, tie = false) => ({
    note_id: 'n', pitch_midi: pitch, string, fret, finger: '1' as const, techniques: [], tie_from_prev: tie, locked: false,
  });
  return {
    schema_version: '1.0',
    title: 't',
    analysis_id: 'a',
    assembly_params: { tuning: { ...tuning, capo }, max_fret: 22, timing: 'auto', fingering_weights: {} },
    measures: [
      { index: 0, time_signature: '4/4', tempo_bpm: 120, slots: [
        { duration: '1/2', dotted: false, notes: [], start_s: 0 },
        { duration: '1/2', dotted: false, notes: [note(2, 5, 64)], start_s: 1 },
      ] },
      { index: 1, time_signature: '4/4', tempo_bpm: 120, slots: [
        { duration: '1/2', dotted: false, notes: [note(2, 5, 64, true)], start_s: 2 },
        { duration: '1/2', dotted: false, notes: [note(1, 5, 69)], start_s: 3 },
      ] },
    ],
    sync_points: [{ measure_index: 0, time_s: 0 }, { measure_index: 1, time_s: 2 }],
  } as unknown as Score;
}

describe('tuning', () => {
  it('uses string 1 = highest', () => {
    expect(openPitch(tuning, 1)).toBe(64);
    expect(openPitch(tuning, 6)).toBe(40);
    expect(() => openPitch(tuning, 0)).toThrow(RangeError);
    expect(() => openPitch(tuning, 7)).toThrow(RangeError);
  });
  it('capo raises the sounding pitch', () => {
    expect(soundingPitch({ ...tuning, capo: 2 }, 1, 0)).toBe(66);
    expect(noteName(64)).toBe('E4');
    expect(noteName(61)).toBe('C#4');
  });
  it('recognises presets', () => {
    expect(presetName(tuning)).toContain('Standard');
    expect(presetName({ ...tuning, open_pitches: [60, 60, 60, 60, 60, 60] })).toBe('Custom');
  });
});

describe('alternatives', () => {
  it('lists every position of the pitch, within the fret limit', () => {
    const alts = altPositions(makeScore(), { m: 0, s: 1, n: 0 });
    expect(alts).toEqual([
      { string: 1, fret: 0 }, { string: 2, fret: 5 }, { string: 3, fret: 9 }, { string: 4, fret: 14 }, { string: 5, fret: 19 },
    ]);
    for (const a of alts) expect(soundingPitch(tuning, a.string, a.fret)).toBe(64);
  });
  it('respects the capo (frets are relative to it)', () => {
    const alts = altPositions(makeScore(2), { m: 0, s: 1, n: 0 });
    expect(alts.find((a) => a.string === 1)).toBeUndefined(); // open string 1 is already F#4 with the capo
    for (const a of alts) expect(soundingPitch({ ...tuning, capo: 2 }, a.string, a.fret)).toBe(64);
  });
  it('cycles through the alternatives in both directions', () => {
    const s = makeScore();
    const loc = { m: 0, s: 1, n: 0 };
    expect(cyclePosition(s, loc, 1)).toEqual({ string: 1, fret: 0 }); // up = thinner string
    expect(cyclePosition(s, loc, -1)).toEqual({ string: 3, fret: 9 });
  });
});

describe('editing', () => {
  it('moves the note, locks it, and does not mutate the input', () => {
    const s = makeScore();
    const next = setPosition(s, { m: 0, s: 1, n: 0 }, 3, 9);
    expect(getNote(next, { m: 0, s: 1, n: 0 })).toMatchObject({ string: 3, fret: 9, locked: true });
    expect(getNote(s, { m: 0, s: 1, n: 0 })).toMatchObject({ string: 2, fret: 5, locked: false });
  });
  it('moves the whole tie chain, even from the continuation', () => {
    const s = makeScore();
    const next = setPosition(s, { m: 1, s: 0, n: 0 }, 3, 9); // edit the tied continuation in bar 2
    expect(getNote(next, { m: 0, s: 1, n: 0 })).toMatchObject({ string: 3, fret: 9, locked: true });
    expect(getNote(next, { m: 1, s: 0, n: 0 })).toMatchObject({ string: 3, fret: 9, tie_from_prev: true });
    expect(chainHead(s, { m: 1, s: 0, n: 0 })).toEqual({ m: 0, s: 1, n: 0 });
  });
  it('rejects a position with a different pitch', () => {
    expect(() => setPosition(makeScore(), { m: 0, s: 1, n: 0 }, 3, 8)).toThrow(RangeError);
  });
  it('toggles the lock', () => {
    const l = { m: 0, s: 1, n: 0 };
    const locked = setLocked(makeScore(), l, true);
    expect(getNote(locked, l)?.locked).toBe(true);
    expect(getNote(setLocked(locked, l, false), l)?.locked).toBe(false);
  });
});

describe('navigation', () => {
  it('steps over struck notes only', () => {
    const s = makeScore();
    expect(allLocs(s)).toHaveLength(3);
    expect(stepLoc(s, null, 1)).toEqual({ m: 0, s: 1, n: 0 });
    expect(stepLoc(s, { m: 0, s: 1, n: 0 }, 1)).toEqual({ m: 1, s: 1, n: 0 }); // skips the tie
    expect(stepLoc(s, { m: 1, s: 1, n: 0 }, 1)).toEqual({ m: 1, s: 1, n: 0 }); // stays at the end
    expect(stepLoc(s, { m: 0, s: 1, n: 0 }, -1)).toEqual({ m: 0, s: 1, n: 0 });
  });
  it('knows each measure time range', () => {
    const s = makeScore();
    expect(measureRange(s, 0)).toEqual([0, 2]);
    expect(measureRange(s, 1)[0]).toBe(2);
    expect(measureRange(s, 1)[1]).toBeGreaterThan(3);
  });
});

describe('timeline', () => {
  const s = makeScore();
  it('locates the slot at a given time', () => {
    expect(cells(s)).toHaveLength(4);
    expect(locate(s, -1)).toBeNull();
    expect(locate(s, 0)).toMatchObject({ m: 0, s: 0 });
    expect(locate(s, 1.4)).toMatchObject({ m: 0, s: 1 });
    expect(locate(s, 2)).toMatchObject({ m: 1, s: 0 });
    expect(locate(s, 99)).toMatchObject({ m: 1, s: 1 });
    expect(locate({ ...s, measures: [] } as Score, 1)).toBeNull();
  });
  it('estimates BPM from taps', () => {
    expect(bpmFromTaps([0, 0.5, 1.0, 1.5, 2.0])).toBe(120);
    expect(bpmFromTaps([0, 0.5, 1.0, 1.7, 2.2, 2.7])).toBe(120); // one sloppy tap
    expect(bpmFromTaps([0, 1])).toBeNull();
  });
});
