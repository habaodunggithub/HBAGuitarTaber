import { flushSync } from 'react-dom';

/**
 * Navigate inside a View Transition so the turntable morphs from one page to the next (the shared
 * element is `view-transition-name: deck`). `prepare` runs first (e.g. prefetch the target's data) so
 * the new page renders complete inside the transition instead of a loading state.
 * Falls back to a plain navigation without the API or with reduced motion.
 */
type DocVT = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

export async function transitionTo(navigate: (to: string) => void, to: string, prepare?: () => Promise<unknown>) {
  if (prepare) await prepare().catch(() => undefined);
  const doc = document as DocVT;
  const go = () => { navigate(to); window.scrollTo(0, 0); document.querySelector('.frame-body')?.scrollTo(0, 0); };
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    go();
    return;
  }
  const root = document.documentElement;
  root.dataset.vt ??= 'go'; // 'row' when a library sleeve already carries the name
  const vt = doc.startViewTransition(() => flushSync(go));
  await vt.finished.catch(() => undefined);
  delete document.documentElement.dataset.vt;
}

/** True for clicks the browser should handle itself (new tab, new window, download). */
export function isModifiedClick(e: React.MouseEvent) {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}
