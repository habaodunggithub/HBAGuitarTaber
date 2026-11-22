import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useWorkers } from '../api/hooks';
import { LANGUAGES, type Messages, useLang, useT } from '../i18n';
import { useDesktopInfo } from '../lib/desktop';
import { toggleTheme, useTheme } from '../lib/theme';
import EngineDialog from './EngineDialog';
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
  const t = useT();

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
        <Link to="/" className="brand" aria-label={t.shell.home} translate="no">Taber</Link>
        <nav className="rail" aria-label={t.shell.main}>
          <Link to="/#lib" aria-current={atHome && loc.hash === '#lib' ? 'page' : undefined}>{t.shell.library}</Link>
          <span className="sep" aria-hidden="true">|</span>
          <Link to="/" aria-current={atHome && !loc.hash ? 'page' : undefined}>{t.shell.newTab}</Link>
          <span className="sep" aria-hidden="true">|</span>
          <button type="button" className="rail-btn" onClick={() => setKeysOpen(true)} title={t.shell.shortcutsTitle}>{t.shell.shortcuts}</button>
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
            {theme === 'night' ? t.shell.nightMode : t.shell.dayMode}
          </button>
          <LanguagePick />
          <WorkerLamp />
        </div>
      </header>
      <div className="frame-body">{children}</div>
      {keysOpen ? <ShortcutsDialog onClose={() => setKeysOpen(false)} /> : null}
    </div>
  );
}

/** The language switch: shown once the app has more than one language; the choice is remembered. */
function LanguagePick() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);
  if (LANGUAGES.length < 2) return null;
  return (
    <div className="lang-pick" role="group" aria-label={t.language.pick}>
      {LANGUAGES.map((l) => (
        <button key={l.lang} type="button" lang={l.lang} aria-pressed={lang === l.lang} onClick={() => setLang(l.lang)} title={l.name}>
          {l.lang.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function WorkerLamp() {
  const workers = useWorkers();
  const info = useDesktopInfo();
  const [open, setOpen] = useState(false);
  const t = useT();
  if (workers.isPending && !info) return null;
  const online = workers.data?.length ?? 0;
  const text = online ? t.shell.workersOnline(online) : t.shell.noWorker;
  if (!info) {
    return (
      <p className={`lamp-pill${online ? ' on' : ''}`} role="status">
        <span className="lamp" aria-hidden="true" />
        <span className="lamp-text">{text}</span>
      </p>
    );
  }
  // in the desktop app the light opens the engine panel (the app has no menu bar on Windows / Linux)
  const label = info.worker === 'running' && online ? t.shell.engineRuns(t.engine.variants[info.variant ?? ''] ?? t.shell.engineReady)
    : online ? text
      : info.worker === 'starting' || info.worker === 'running' ? t.shell.engineStarting
        : t.shell.engineOff;
  return (
    <>
      <button type="button" className={`lamp-pill lamp-btn${online ? ' on' : ''}`} aria-haspopup="dialog" onClick={() => setOpen(true)} title={t.shell.engineSettings(text)}>
        <span className="lamp" aria-hidden="true" />
        <span className="lamp-text">{label}</span>
        <Icon name="down" size={14} />
      </button>
      {open ? <EngineDialog info={info} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** The editor's shortcuts: the keys to press (from the catalog when they are words) and what they do. */
function shortcuts(t: Messages): [string[], string][] {
  const k = t.keys;
  const d = t.shortcuts;
  return [
    [[k.space], d.play],
    [['←', '→'], d.step],
    [['↑', '↓'], d.string],
    [['L'], d.lock],
    [[k.shift, '↑', '↓'], d.pitch],
    [['0', '…', '24'], d.fret],
    [['N'], d.add],
    [[k.doubleClick], d.addInLane],
    [[k.drag], d.box],
    [[k.shift, k.click], d.pickOne],
    [[k.delete], d.delete],
    [['T'], d.tap],
    [[k.ctrl, 'Z'], d.undo],
    [[k.ctrl, k.shift, 'Z'], d.redo],
    [[k.esc], d.deselect],
    [['?'], d.list],
  ];
}

export function KeyList({ compact = false }: { compact?: boolean }) {
  const all = shortcuts(useT());
  const list = compact ? all.slice(0, 5) : all;
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
  const t = useT();
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
        <h2 id="keys-title" className="display-sm">{t.shell.shortcuts}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t.app.close}><Icon name="close" /></button>
      </div>
      <KeyList />
    </dialog>
  );
}
