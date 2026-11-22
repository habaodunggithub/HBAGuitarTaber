import { useEffect, useRef } from 'react';
import { type NoteLoc, sameLoc, stepLoc } from '../../lib/scoreOps';
import { useEditor } from '../../stores/editor';

interface Actions {
  togglePlay: () => void;
  cycle: (dir: 1 | -1) => void;
  toggleLock: () => void;
  shiftPitch: (semitones: number) => void;
  addNote: () => void;
  deleteNote: () => void;
  tap: () => void;
  /** a fret typed on the keyboard for the selected note */
  typeFret: (fret: number) => void;
}

const FRET_WAIT_MS = 600; // after a 1 or 2, wait this long for a second digit (fret 10-24)

const isTyping = (el: HTMLElement | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

/**
 * Editor shortcuts (see the Shortcuts dialog). No animation is attached to any of these:
 * they are used hundreds of times. Ignored while typing or while a dialog is open.
 */
export function useEditorKeys(actions: Actions) {
  const latest = useRef(actions);
  latest.current = actions;

  useEffect(() => {
    // a first digit 1 or 2 waits for a second one; it belongs to the note that was selected when it was typed
    let pending: { digit: number; timer: number; sel: NoteLoc } | null = null;
    const cancel = () => {
      if (pending) window.clearTimeout(pending.timer);
      pending = null;
    };
    const flush = () => {
      if (!pending) return;
      const { digit, sel } = pending;
      cancel();
      if (sameLoc(useEditor.getState().selection, sel)) latest.current.typeFret(digit);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target as HTMLElement | null) || document.querySelector('dialog[open]')) return;
      const st = useEditor.getState();
      const act = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod) cancel(); // undo / redo / copy: a half-typed fret must not land afterwards, on another score
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      if (mod || e.altKey) return;
      if (/^[0-9]$/.test(e.key) && st.selection) {
        e.preventDefault();
        const d = Number(e.key);
        if (pending) { // second digit: 10..24, or else two separate frets
          const both = pending.digit * 10 + d;
          window.clearTimeout(pending.timer);
          pending = null;
          if (both <= 24) { act.typeFret(both); return; }
          act.typeFret(Math.floor(both / 10));
        }
        if (d === 1 || d === 2) pending = { digit: d, timer: window.setTimeout(flush, FRET_WAIT_MS), sel: st.selection };
        else act.typeFret(d);
        return;
      }
      if (e.key === 'Escape') cancel(); // Esc drops a half-typed fret, it does not apply it
      else flush();
      switch (e.key) {
        case ' ': e.preventDefault(); act.togglePlay(); break;
        case 'ArrowUp': e.preventDefault(); if (e.shiftKey) act.shiftPitch(1); else act.cycle(1); break;
        case 'ArrowDown': e.preventDefault(); if (e.shiftKey) act.shiftPitch(-1); else act.cycle(-1); break;
        case 'n': case 'N': act.addNote(); break;
        case 'Delete': case 'Backspace': e.preventDefault(); act.deleteNote(); break;
        case 'ArrowRight': e.preventDefault(); if (st.score) st.select(stepLoc(st.score, st.selection, 1)); break;
        case 'ArrowLeft': e.preventDefault(); if (st.score) st.select(stepLoc(st.score, st.selection, -1)); break;
        case 'l': case 'L': act.toggleLock(); break;
        case 't': case 'T': act.tap(); break;
        case 'Escape': st.select(null); st.setPicked([]); break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); cancel(); };
  }, []);
}
