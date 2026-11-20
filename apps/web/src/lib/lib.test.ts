import { describe, expect, it } from 'vitest';
import {
  allLocs,
  altPositions,
  chainHead,
  cyclePosition,
  deleteNote,
  deleteNotes,
  getNote,
  insertNoteAt,
  measureRange,
  setFret,
  setLocked,
  setPosition,
  shiftPitch,
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


describe('note corrections', () => {
  it('deletes a note with its tie and remembers the analysis id', () => {
    const s = deleteNote(makeScore(), { m: 0, s: 1, n: 0 });
    expect(s.measures[0]!.slots[1]!.notes).toEqual([]);
    expect(s.measures[1]!.slots[0]!.notes).toEqual([]);
    expect(s.deleted_note_ids).toEqual(['n']);
  });

  it('shifts pitch along the tie chain, staying on the string', () => {
    const s = shiftPitch(makeScore(), { m: 1, s: 0, n: 0 }, 12)!;
    for (const n of [s.measures[0]!.slots[1]!.notes[0]!, s.measures[1]!.slots[0]!.notes[0]!]) {
      expect([n.pitch_midi, n.string, n.fret]).toEqual([76, 2, 17]);
    }
    expect(s.measures[0]!.slots[1]!.notes[0]!.locked).toBe(true);
    expect(shiftPitch(makeScore(), { m: 0, s: 1, n: 0 }, 40)).toBeNull();
  });

  it('adds a missed note inside a rest, on the grid next to the playhead', () => {
    const r = insertNoteAt(makeScore(), 0.5)!;
    expect(r.added).toBe(true);
    const slots = r.score.measures[0]!.slots;
    expect(slots.map((x) => [x.duration, x.start_s])).toEqual([['1/4', 0], ['1/4', 0.5], ['1/2', 1]]);
    const n = getNote(r.score, r.loc)!;
    expect(r.loc).toEqual({ m: 0, s: 1, n: 0 });
    expect(n.note_id?.startsWith('u')).toBe(true);
    expect(n.locked).toBe(true);
  });

  it('adds a re-picked note where a held note was ringing', () => {
    const r = insertNoteAt(makeScore(), 2.5)!;
    const slots = r.score.measures[1]!.slots;
    expect(slots.map((x) => x.start_s)).toEqual([2, 2.5, 3]);
    expect(slots[0]!.notes[0]!.tie_from_prev).toBe(true);
    const n = slots[1]!.notes[0]!;
    expect([n.pitch_midi, n.string, n.fret, n.tie_from_prev]).toEqual([64, 2, 5, false]);
  });

  it('does not add a second note where one is already struck', () => {
    const r = insertNoteAt(makeScore(), 1.01)!;
    expect(r.added).toBe(false);
    expect(r.loc).toEqual({ m: 0, s: 1, n: 0 });
  });

  it('deletes several notes in one step, ties included, whatever order they were picked in', () => {
    const sc = makeScore();
    const s = deleteNotes(sc, [{ m: 1, s: 1, n: 0 }, { m: 1, s: 0, n: 0 }, { m: 0, s: 1, n: 0 }]); // a tie tail too
    expect(allLocs(s)).toEqual([]);
    expect(s.deleted_note_ids).toEqual(['n']);
    expect(deleteNotes(sc, [])).toBe(sc);
  });

  it('a typed fret moves the note along its string, pitch and tie included', () => {
    const s = setFret(makeScore(), { m: 1, s: 0, n: 0 }, 7)!; // the tie tail of E4 on string 2
    for (const n of [s.measures[0]!.slots[1]!.notes[0]!, s.measures[1]!.slots[0]!.notes[0]!]) {
      expect([n.pitch_midi, n.string, n.fret]).toEqual([66, 2, 7]);
    }
    expect(s.measures[0]!.slots[1]!.notes[0]!.locked).toBe(true);
    expect(setFret(makeScore(), { m: 0, s: 1, n: 0 }, 23)).toBeNull(); // max_fret 22
    expect(setFret(makeScore(2), { m: 0, s: 1, n: 0 }, 21)).toBeNull(); // capo 2: 20 frets left
  });

  it('adds a note on the string that was clicked, near the pitch of the note before', () => {
    const r = insertNoteAt(makeScore(), 3.25, 3)!; // after A4 (69), on the G string (55)
    expect(r.added).toBe(true);
    const n = getNote(r.score, r.loc)!;
    expect([n.string, n.fret, n.pitch_midi]).toEqual([3, 14, 69]);
    // nothing before it: closest to the note after it (E4 on the G string = fret 9)
    const first = insertNoteAt(makeScore(), 0.5, 3)!;
    expect([getNote(first.score, first.loc)!.string, getNote(first.score, first.loc)!.fret]).toEqual([3, 9]);
  });

  it('a note struck on another string makes a chord; the same string returns that note', () => {
    const chord = insertNoteAt(makeScore(), 3.0, 4)!;
    expect(chord.added).toBe(true);
    expect(chord.score.measures[1]!.slots[1]!.notes.map((n) => n.string)).toEqual([1, 4]);
    const same = insertNoteAt(makeScore(), 3.0, 1)!;
    expect(same.added).toBe(false);
    expect(same.loc).toEqual({ m: 1, s: 1, n: 0 });
  });

  it('a note added on one string leaves what rings on the other strings alone', () => {
    // t = 2: E4 (string 2) is still ringing there as a tie; the new note goes on the G string next to it
    const r = insertNoteAt(makeScore(), 2.0, 3)!;
    const slot = r.score.measures[1]!.slots[0]!;
    expect(slot.notes.map((n) => [n.string, n.tie_from_prev])).toEqual([[2, true], [3, false]]);
    expect(getNote(r.score, r.loc)!.string).toBe(3);
    expect(r.score.measures[1]!.slots[1]!.notes.map((n) => n.string)).toEqual([1]); // A4 untouched
  });

  it('a note added on a ringing string replaces the ringing one there: never two notes on a string', () => {
    const sc = makeScore();
    // the E4 tail on string 2 plus a note struck on string 1 in the same slot
    sc.measures[1]!.slots[0]!.notes.push({ ...sc.measures[1]!.slots[1]!.notes[0]!, note_id: 'b' });
    const r = insertNoteAt(sc, 2.0, 2)!;
    const slot = r.score.measures[1]!.slots[0]!;
    expect(slot.notes.filter((n) => n.string === 2)).toHaveLength(1);
    expect(slot.notes.map((n) => [n.string, n.tie_from_prev, n.note_id === 'b'])).toEqual([[2, false, false], [1, false, true]]);
    expect(chainHead(r.score, { m: 1, s: 0, n: 0 })).toEqual({ m: 1, s: 0, n: 0 });
  });

  it('the rest of a ringing note on that string rings the new note instead', () => {
    // t = 1.5 splits E4's slot; the new note on string 2 takes over the tie into the next bar
    const r = insertNoteAt(makeScore(), 1.5, 2)!;
    const added = getNote(r.score, r.loc)!;
    const tail = r.score.measures[1]!.slots[0]!.notes;
    expect(tail).toHaveLength(1);
    expect([tail[0]!.note_id, tail[0]!.tie_from_prev, tail[0]!.fret]).toEqual([added.note_id, true, added.fret]);
    expect(r.score.measures[0]!.slots[1]!.notes[0]!.note_id).toBe('n'); // E4 itself is still struck at t = 1
  });
});
