import { useEffect, useRef } from 'react';
import { stepLoc } from '../../lib/scoreOps';
import { useEditor } from '../../stores/editor';

interface Actions {
  togglePlay: () => void;
  cycle: (dir: 1 | -1) => void;
  toggleLock: () => void;
  tap: () => void;
}

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
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target as HTMLElement | null) || document.querySelector('dialog[open]')) return;
      const st = useEditor.getState();
      const act = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      if (mod || e.altKey) return;
      switch (e.key) {
        case ' ': e.preventDefault(); act.togglePlay(); break;
        case 'ArrowUp': e.preventDefault(); act.cycle(1); break;
        case 'ArrowDown': e.preventDefault(); act.cycle(-1); break;
        case 'ArrowRight': e.preventDefault(); if (st.score) st.select(stepLoc(st.score, st.selection, 1)); break;
        case 'ArrowLeft': e.preventDefault(); if (st.score) st.select(stepLoc(st.score, st.selection, -1)); break;
        case 'l': case 'L': act.toggleLock(); break;
        case 't': case 'T': act.tap(); break;
        case 'Escape': st.select(null); break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
