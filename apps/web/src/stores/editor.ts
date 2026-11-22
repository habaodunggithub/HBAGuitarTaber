import { create } from 'zustand';
import type { Score } from '../api/types';
import { sameLoc, type NoteLoc } from '../lib/scoreOps';

const HISTORY_LIMIT = 60;

interface EditorState {
  score: Score | null;
  /** server revision the local copy is based on */
  baseRevision: number;
  dirty: boolean;
  selection: NoteLoc | null;
  /** several notes picked at once in the lane (drag a box, Shift+click), e.g. to delete them together */
  picked: NoteLoc[];
  past: Score[];
  future: Score[];
  /** Load a score from the server (resets history and dirty flag). */
  load: (score: Score, revision: number) => void;
  select: (loc: NoteLoc | null) => void;
  setPicked: (locs: NoteLoc[]) => void;
  /** Apply a local edit; pushes undo history. */
  edit: (fn: (s: Score) => Score) => void;
  undo: () => void;
  redo: () => void;
  markSaved: (revision: number) => void;
  reset: () => void;
}

export const useEditor = create<EditorState>((set, get) => ({
  score: null,
  baseRevision: 0,
  dirty: false,
  selection: null,
  picked: [],
  past: [],
  future: [],
  // note locations change with any edit: a multi-selection never outlives one
  load: (score, revision) => set({ score, baseRevision: revision, dirty: false, past: [], future: [], picked: [] }),
  // one note or a picked set, never both: the keys (digits, L, arrows, Delete) act on what the Inspector shows
  select: (loc) => {
    const { selection, picked } = get();
    if (!sameLoc(selection, loc) || picked.length) set({ selection: loc, picked: [] });
  },
  setPicked: (locs) => set(locs.length ? { picked: locs, selection: null } : { picked: [] }),
  edit: (fn) => {
    const { score, past } = get();
    if (!score) return;
    const next = fn(score);
    if (next === score) return;
    set({ score: next, dirty: true, past: [...past.slice(-HISTORY_LIMIT + 1), score], future: [], picked: [] });
  },
  undo: () => {
    const { past, score, future } = get();
    const prev = past[past.length - 1];
    if (!prev || !score) return;
    set({ score: prev, past: past.slice(0, -1), future: [score, ...future], dirty: true, picked: [] });
  },
  redo: () => {
    const { future, score, past } = get();
    const nxt = future[0];
    if (!nxt || !score) return;
    set({ score: nxt, future: future.slice(1), past: [...past, score], dirty: true, picked: [] });
  },
  markSaved: (revision) => set({ baseRevision: revision, dirty: false }),
  reset: () => set({ score: null, baseRevision: 0, dirty: false, selection: null, picked: [], past: [], future: [] }),
}));

// Derived booleans: components subscribe to these, not to whole arrays (fewer re-renders).
export const useCanUndo = () => useEditor((s) => s.past.length > 0);
export const useCanRedo = () => useEditor((s) => s.future.length > 0);
