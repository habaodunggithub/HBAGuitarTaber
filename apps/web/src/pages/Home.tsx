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
import { useT } from '../i18n';
import { fmtDateTime } from '../lib/format';
import { isModifiedClick, transitionTo } from '../lib/transition';

const FILTERS = {
  all: () => true,
  done: (t: Transcription) => t.status === 'ready' || t.status === 'succeeded',
  working: (t: Transcription) => t.status === 'queued' || t.status === 'running',
  failed: (t: Transcription) => t.status === 'failed' || t.status === 'canceled',
} as const;
type Filter = keyof typeof FILTERS;

/** Lines of a short note, with a line break between them. */
function lines(ls: string[]) {
  return ls.map((l, i) => <span key={i}>{i ? <br /> : null}{l}</span>);
}

export default function Home() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const loc = useLocation();
  const list = useTranscriptions();
  const t = useT();
  const STATUS = t.home.status;
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

  const pred = FILTERS[filter as Filter] ?? FILTERS.all;
  const needle = q.trim().toLocaleLowerCase();
  const all = list.data ?? [];
  const shown = all.filter((x) => pred(x) && (!needle || x.title.toLocaleLowerCase().includes(needle)));
  const latest = all.find((x) => x.status === 'ready' || x.status === 'succeeded');
  const waypoints = shown.slice(0, 3);
  const older = shown.slice(3);
  const shortDate = new Intl.DateTimeFormat(t.language.dayMonthLocale, { day: 'numeric', month: 'short' });
  const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : shortDate.format(d); };

  const search = (
    <label className="search">
      <Icon name="search" size={15} />
      <span className="sr-only">{t.home.searchLabel}</span>
      <input type="search" name="q" autoComplete="off" spellCheck={false} placeholder={t.home.searchPlaceholder} value={q} onChange={(e) => setParam('q', e.target.value, '')} />
    </label>
  );

  return (
    <Shell center={search}>
      <main id="content" className="home">
        <section className="hero">
          <h1 id="hero-title" className="display">
            <span className="l1">{t.home.heroWrite}</span>
            <span className="l2"><span className="the">{t.home.heroThe}</span>{t.home.heroSolo}</span>
            <span className="sr-only">{t.home.heroSr}</span>
          </h1>
          <p className="lede">{lines(t.home.lede)}</p>
          <span className="scroll-cue" aria-hidden="true">{t.home.scrollCue}</span>

          <Sketch className="hero-sketch" />
          <div className="note hint" aria-hidden="true"><b>{t.home.lampTitle}</b>{lines(t.home.lampBody)}</div>
          <div className="note arch"><b>{t.home.stringsTitle}</b>{lines(t.home.stringsBody)}</div>

          {latest ? (
            <Link className="take box" to={`/t/${latest.id}`} onClick={(e) => open(e, latest)}>
              <b>{t.home.lastTake}</b>{latest.title}<br />{STATUS[latest.status]}, {when(latest.created_at)}
            </Link>
          ) : null}

          <Composer onCreated={created} />
        </section>

        <section aria-labelledby="lib" className="library-wrap">
          <div className="section-head">
            <h2 id="lib" className="display-sm">{t.home.yourTabs(list.data ? list.data.length : null)}</h2>
            <div className="chips filters" role="group" aria-label={t.home.filterBy}>
              {(Object.keys(FILTERS) as Filter[]).map((k) => (
                <button key={k} type="button" className={`chip pick${filter === k ? ' solid' : ''}`} aria-pressed={filter === k} onClick={() => setParam('status', k, 'all')}>{t.home.filters[k]}</button>
              ))}
            </div>
          </div>
          {list.isPending ? <p className="muted" role="status">{t.app.loading}</p> : null}
          {list.data && list.data.length === 0 ? (
            <p className="empty">{t.home.empty}</p>
          ) : list.data && shown.length === 0 ? (
            <p className="empty">{t.home.noMatch} <button type="button" className="text-btn inline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>{t.home.clearFilters}</button></p>
          ) : null}
          {waypoints.length ? (
            <div className="trail">
              <svg className="trail-path" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true"><path d="M10 40 C160 10 220 100 380 70 S640 10 720 60 S900 110 990 70" /></svg>
              <ul className="waypoints">
                {waypoints.map((x, i) => (
                  <li key={x.id} style={{ animationDelay: `${i * 70}ms` }}>
                    <Link to={`/t/${x.id}`} onClick={(e) => open(e, x)} className="wp">
                      <span className="wp-date">{when(x.created_at)}, <span className={`status s-${x.status}`}>{STATUS[x.status]}</span></span>
                      <span className="wp-name">{x.title}</span>
                      <TabDoodle seed={x.title + x.id} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {older.length ? (
            <ul className="library">
              {older.map((x) => (
                <li key={x.id}>
                  <Link to={`/t/${x.id}`} onClick={(e) => open(e, x)}>
                    <span className="lib-date">{fmtDateTime(x.created_at)}</span>
                    <span className="lib-title">{x.title}</span>
                    <span className={`status s-${x.status}`}>{STATUS[x.status]}</span>
                    <TabDoodle seed={x.title + x.id} width={140} />
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
