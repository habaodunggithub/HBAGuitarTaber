import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { keys } from '../../api/hooks';
import { getT } from '../../i18n';
import { errorText } from '../../lib/errors';
import { useEditor } from '../../stores/editor';

export type SaveState = 'saved' | 'saving' | 'error';

/**
 * Saves the editor's score after 2.5 s of quiet, and warns before leaving with unsaved edits.
 * `flush()` saves now; await it before anything that reads the server copy (reassemble, export...).
 */
export function useAutosave(id: string, onError: (msg: string) => void) {
  const qc = useQueryClient();
  const dirty = useEditor((s) => s.dirty);
  const score = useEditor((s) => s.score);
  const [state, setState] = useState<SaveState>('saved');
  const inFlight = useRef<Promise<void> | null>(null);
  const report = useRef(onError);
  report.current = onError;

  const flush = useCallback(async () => {
    if (inFlight.current) await inFlight.current;
    const st = useEditor.getState();
    if (!st.dirty || !st.score) return;
    const toSave = st.score;
    setState('saving');
    const p = api.save(id, toSave)
      .then((res) => {
        // mark as the base BEFORE the cache updates, so the sync effect doesn't reload our own save
        if (useEditor.getState().score === toSave) useEditor.getState().markSaved(res.current_revision);
        else useEditor.setState({ baseRevision: res.current_revision });
        qc.setQueryData(keys.transcription(id), res);
        void qc.invalidateQueries({ queryKey: keys.revisions(id) });
        setState('saved');
      })
      .catch((e: unknown) => {
        setState('error');
        report.current(getT().workspace.saveFailed(errorText(e)));
      })
      .finally(() => { inFlight.current = null; });
    inFlight.current = p;
    await p;
  }, [qc, id]);

  useEffect(() => {
    if (!dirty) return;
    const h = setTimeout(() => void flush(), 2500);
    return () => clearTimeout(h);
  }, [dirty, score, flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (useEditor.getState().dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return { saveState: state, flush };
}
