import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWorkers } from '../api/hooks';
import { toggleTheme, useTheme } from '../lib/theme';
import Icon from './Icon';

/**
 * The sketchbook page every screen lives on: a mono rail across the top (where you are, what you can
 * do, the day/night switch, the worker) and the page below it.
 */
interface Props {
  /** Centre of the top rail (search on the library, the way back on the editor). */
  center?: ReactNode;
  /** Page tools, right side of the rail. */
  tools?: ReactNode;
  children: ReactNode;
}

export default function Shell({ center, tools, children }: Props) {
  const [keysOpen, setKeysOpen] = useState(false);
  const loc = useLocation();
  const atHome = loc.pathname === '/';
  const theme = useTheme();

  // "?" opens the shortcut sheet from anywhere (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === '?') { e.preventDefault(); setKeysOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="frame">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Taber, go to home" translate="no">Taber</Link>
        <nav className="rail" aria-label="Main">
          <Link to="/#lib" aria-current={atHome && loc.hash === '#lib' ? 'page' : undefined}>Library</Link>
          <span className="sep" aria-hidden="true">|</span>
          <Link to="/" aria-current={atHome && !loc.hash ? 'page' : undefined}>New tab</Link>
          <span className="sep" aria-hidden="true">|</span>
          <button type="button" className="rail-btn" onClick={() => setKeysOpen(true)} title="Keyboard shortcuts (?)">Shortcuts</button>
        </nav>
        <div className="topbar-center">{center}</div>
        <div className="topbar-tools">
          {tools}
          <button
            type="button"
            className="mode"
            aria-pressed={theme === 'night'}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); }}
          >
            <span className="mode-glyph" aria-hidden="true" />
            {theme === 'night' ? 'Night mode' : 'Day mode'}
          </button>
          <WorkerLamp />
        </div>
      </header>
      <div className="frame-body">{children}</div>
      {keysOpen ? <ShortcutsDialog onClose={() => setKeysOpen(false)} /> : null}
    </div>
  );
}

function WorkerLamp() {
  const workers = useWorkers();
  if (workers.isPending) return null;
  const online = workers.data?.length ?? 0;
  return (
    <p className={`lamp-pill${online ? ' on' : ''}`} role="status">
      <span className="lamp" aria-hidden="true" />
      <span className="lamp-text">{online ? `${online} worker${online > 1 ? 's' : ''} online` : 'No worker'}</span>
    </p>
  );
}

export const SHORTCUTS: [string[], string][] = [
  [['Space'], 'play or pause'],
  [['←', '→'], 'previous or next note'],
  [['↑', '↓'], 'move to another string, same pitch'],
  [['L'], 'lock or unlock the note'],
  [['Shift', '↑', '↓'], 'raise or lower the pitch a semitone'],
  [['0', '…', '24'], 'put the selected note on that fret (same string)'],
  [['N'], 'add a missed note at the playhead'],
  [['Double-click'], 'add a note on that string, in the lane'],
  [['Drag'], 'pick the notes in a box, in the lane (Shift adds)'],
  [['Shift', 'Click'], 'add a note to the picked ones, or take it out'],
  [['Delete'], 'delete the note, or all the picked ones'],
  [['T'], 'tap the beat while listening'],
  [['Ctrl', 'Z'], 'undo'],
  [['Ctrl', 'Shift', 'Z'], 'redo'],
  [['Esc'], 'deselect (and drop the picked notes)'],
  [['?'], 'open this list'],
];

export function KeyList({ compact = false }: { compact?: boolean }) {
  const list = compact ? SHORTCUTS.slice(0, 5) : SHORTCUTS;
  return (
    <dl className="keys">
      {list.map(([ks, what]) => (
        <div key={what} className="key-row">
          <dt>{ks.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    d?.addEventListener('cancel', onCancel);
    return () => d?.removeEventListener('cancel', onCancel);
  }, [onClose]);
  return (
    <dialog ref={ref} className="sheet-dialog" aria-labelledby="keys-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-head">
        <h2 id="keys-title" className="display-sm">Shortcuts</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <KeyList />
    </dialog>
  );
}
