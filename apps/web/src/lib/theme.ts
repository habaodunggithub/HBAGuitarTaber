import { useSyncExternalStore } from 'react';

/**
 * Day / night desk. Starts from the system setting, remembers the player's choice, and switches with
 * the new theme spreading out as a circle from whatever was clicked (the amp lamp, the mode button).
 * Components that paint with JS (alphaTab, the waveform) listen for the `taber-theme` event.
 */
export type Theme = 'day' | 'night';
const KEY = 'taber-theme';

export const currentTheme = (): Theme => (document.documentElement.classList.contains('night') ? 'night' : 'day');

function apply(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle('night', t === 'night');
  root.style.colorScheme = t === 'night' ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'night' ? '#161c2c' : '#efe7d6');
  window.dispatchEvent(new Event('taber-theme'));
}

export function initTheme() {
  let t: Theme | null = null;
  try { t = localStorage.getItem(KEY) as Theme | null; } catch { /* private mode */ }
  apply(t === 'day' || t === 'night' ? t : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day');
}

type DocVT = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } };

export function toggleTheme(origin?: { x: number; y: number }) {
  const next: Theme = currentTheme() === 'night' ? 'day' : 'night';
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  const doc = document as DocVT;
  if (!doc.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(next); return; }
  const x = origin?.x ?? window.innerWidth - 80;
  const y = origin?.y ?? 40;
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  document.documentElement.dataset.vt = 'theme';
  const vt = doc.startViewTransition(() => apply(next));
  void vt.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 820, easing: 'cubic-bezier(0.77, 0, 0.175, 1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
  void vt.finished.finally(() => { if (document.documentElement.dataset.vt === 'theme') delete document.documentElement.dataset.vt; });
}

const subscribe = (cb: () => void) => { window.addEventListener('taber-theme', cb); return () => window.removeEventListener('taber-theme', cb); };
export const useTheme = () => useSyncExternalStore(subscribe, currentTheme, () => 'day' as Theme);
