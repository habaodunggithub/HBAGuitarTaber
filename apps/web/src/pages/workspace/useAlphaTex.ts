import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { getT } from '../../i18n';
import type { Score } from '../../api/types';

/** alphaTex of the (possibly unsaved) local score, for the score view. Immediate until the first one arrives, then debounced. */
export function useAlphaTex(score: Score | null, onError: (msg: string) => void): string {
  const [tex, setTex] = useState('');
  const have = useRef(false);
  const report = useRef(onError);
  report.current = onError;

  useEffect(() => {
    if (!score) return;
    const ctl = new AbortController();
    const h = setTimeout(() => {
      api.alphatex(score, ctl.signal)
        .then((t) => { have.current = true; setTex(t); })
        .catch((e: unknown) => { if ((e as Error).name !== 'AbortError') report.current(getT().workspace.renderFailed((e as Error).message)); });
    }, have.current ? 120 : 0);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [score]);

  return tex;
}
