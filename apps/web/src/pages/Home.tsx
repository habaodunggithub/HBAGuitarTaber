import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { keys, prefetchTranscription, useTranscriptions } from '../api/hooks';
import type { Transcription } from '../api/types';
import Composer from '../components/Composer';
import Icon from '../components/Icon';
import Shell from '../components/Shell';
import Sketch from '../components/Sketch';
import TabDoodle from '../components/TabDoodle';
import { fmtDateTime } from '../lib/format';
import { isModifiedClick, transitionTo } from '../lib/transition';

const STATUS: Record<Transcription['status'], string> = {
  ready: 'Ready', succeeded: 'Ready', queued: 'Queued', running: 'Analyzing', failed: 'Failed', canceled: 'Canceled', empty: 'Empty',
};
const FILTERS: [string, string, (t: Transcription) => boolean][] = [
  ['all', 'All', () => true],
  ['done', 'Ready', (t) => t.status === 'ready' || t.status === 'succeeded'],
  ['working', 'In progress', (t) => t.status === 'queued' || t.status === 'running'],
  ['failed', 'Failed', (t) => t.status === 'failed' || t.status === 'canceled'],
];
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export default function Home() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const loc = useLocation();
  const list = useTranscriptions();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filter = params.get('status') ?? 'all';

  // the editor chunk is heavy: fetch it while the user picks a file
  useEffect(() => { const h = window.setTimeout(() => void import('./Workspace'), 800); return () => window.clearTimeout(h); }, []);
  useEffect(() => {
    if (loc.hash === '#lib') document.getElementById('lib')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [loc.hash]);

  const setParam = (k: string, v: string, empty: string) => {
    const next = new URLSearchParams(params);
    if (v === empty) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  const go = (id: string) => transitionTo(nav, `/t/${id}`, () => prefetchTranscription(qc, id));
  const created = async (id: string) => {
    void qc.invalidateQueries({ queryKey: keys.list });
    await go(id);
  };

  const open = (e: React.MouseEvent<HTMLAnchorElement>, t: Transcription) => {
    if (isModifiedClick(e)) return;
    e.preventDefault();
    void go(t.id);
  };

  const pred = FILTERS.find(([k]) => k === filter)?.[2] ?? FILTERS[0]![2];
  const needle = q.trim().toLocaleLowerCase();
  const all = list.data ?? [];
  const shown = all.filter((t) => pred(t) && (!needle || t.title.toLocaleLowerCase().includes(needle)));
  const latest = all.find((t) => t.status === 'ready' || t.status === 'succeeded');
  const waypoints = shown.slice(0, 3);
  const older = shown.slice(3);
  const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : shortDate.format(d); };

  const search = (
    <label className="search">
      <Icon name="search" size={15} />
      <span className="sr-only">Search tabs</span>
      <input type="search" name="q" autoComplete="off" spellCheck={false} placeholder="Search tabs by name…" value={q} onChange={(e) => setParam('q', e.target.value, '')} />
    </label>
  );

  return (
    <Shell center={search}>
      <main id="content" className="home">
        <section className="hero">
          <h1 id="hero-title" className="display">
            <span className="l1">Write</span>
            <span className="l2"><span className="the">The</span>Solo</span>
            <span className="sr-only">: turn a guitar recording into tab</span>
          </h1>
          <p className="lede">Some solos are meant<br />to be written down,<br />not forgotten.</p>
          <span className="scroll-cue" aria-hidden="true">Scroll to your tabs ↓</span>

          <Sketch className="hero-sketch" />
          <div className="note hint" aria-hidden="true"><b>Click the amp lamp</b>switch the desk<br />from day to night</div>
          <div className="note arch"><b>String note</b>6 strings, E A D G B E<br />string 1 is the high e<br />frets counted from the nut</div>

          {latest ? (
            <Link className="take box" to={`/t/${latest.id}`} onClick={(e) => open(e, latest)}>
              <b>Last take</b>{latest.title}<br />{STATUS[latest.status]}, {when(latest.created_at)}
            </Link>
          ) : null}

          <Composer onCreated={created} />
        </section>

        <section aria-labelledby="lib" className="library-wrap">
          <div className="section-head">
            <h2 id="lib" className="display-sm">Your tabs{list.data ? ` (${list.data.length})` : ''}</h2>
            <div className="chips filters" role="group" aria-label="Filter by status">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" className={`chip pick${filter === k ? ' solid' : ''}`} aria-pressed={filter === k} onClick={() => setParam('status', k, 'all')}>{label}</button>
              ))}
            </div>
          </div>
          {list.isPending ? <p className="muted" role="status">Loading…</p> : null}
          {list.data && list.data.length === 0 ? (
            <p className="empty">No tabs yet. Drop a recording on the card above to start.</p>
          ) : list.data && shown.length === 0 ? (
            <p className="empty">No tabs match. <button type="button" className="text-btn inline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</button></p>
          ) : null}
          {waypoints.length ? (
            <div className="trail">
              <svg className="trail-path" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true"><path d="M10 40 C160 10 220 100 380 70 S640 10 720 60 S900 110 990 70" /></svg>
              <ul className="waypoints">
                {waypoints.map((t, i) => (
                  <li key={t.id} style={{ animationDelay: `${i * 70}ms` }}>
                    <Link to={`/t/${t.id}`} onClick={(e) => open(e, t)} className="wp">
                      <span className="wp-date">{when(t.created_at)}, <span className={`status s-${t.status}`}>{STATUS[t.status]}</span></span>
                      <span className="wp-name">{t.title}</span>
                      <TabDoodle seed={t.title + t.id} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {older.length ? (
            <ul className="library">
              {older.map((t) => (
                <li key={t.id}>
                  <Link to={`/t/${t.id}`} onClick={(e) => open(e, t)}>
                    <span className="lib-date">{fmtDateTime(t.created_at)}</span>
                    <span className="lib-title">{t.title}</span>
                    <span className={`status s-${t.status}`}>{STATUS[t.status]}</span>
                    <TabDoodle seed={t.title + t.id} width={140} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </main>
    </Shell>
  );
}
