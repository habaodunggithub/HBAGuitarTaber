import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { keys, useJobEvents, useWorkers } from '../../api/hooks';
import type { Transcription } from '../../api/types';
import Icon from '../../components/Icon';
import Metronome from '../../components/Metronome';
import Shell from '../../components/Shell';
import { desktop, type DesktopInfo, useDesktopInfo } from '../../lib/desktop';
import { fill, lookup, useT } from '../../i18n';
import { BackLink } from './common';

const jobBeat = () => performance.now() / 1000;
const ORDER = ['ingest', 'separation', 'beats', 'f0', 'segment', 'video', 'quality'];
const LONG_STEP_S = 15 * 60;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Seconds since `key` last changed, ticking once a second. */
function useSecondsSince(key: string): number {
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setSince(Date.now()), [key]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((now - since) / 1000));
}

/** Why the tab is still queued, in the desktop app: the local engine's own state, with the fix next to it. */
function DesktopWaiting({ info }: { info: DesktopInfo }) {
  const t = useT();
  if (!info.workerEnabled) {
    return (
      <div className="banner warn" role="status">
        <Icon name="alert" />
        <div>
          <p>{t.job.localOff}</p>
          <div className="row tight"><button type="button" className="btn" onClick={() => desktop?.setWorker(true)}>{t.job.analyzeHere}</button></div>
        </div>
      </div>
    );
  }
  if (info.worker === 'starting' || info.worker === 'running') {
    return (
      <p className="banner" role="status">
        <Icon name="refresh" />
        <span>{t.job.starting(info.platform === 'win32')}</span>
      </p>
    );
  }
  return (
    <div className="banner bad" role="alert">
      <Icon name="alert" />
      <div>
        <p>{info.worker === 'crashed' ? t.job.crashed : t.job.notRunning} {t.job.restartHint}</p>
        <div className="row tight">
          <button type="button" className="btn" onClick={() => desktop?.action('restart-engine')}>{t.job.restart}</button>
          <button type="button" className="btn quiet" onClick={() => desktop?.action('open-logs')}>{t.job.openLogs}</button>
        </div>
      </div>
    </div>
  );
}

/** The page while the worker analyses the take: live stage list over SSE, and cancel. */
export default function JobPanel({ t: tab, onDone }: { t: Transcription; onDone: () => void }) {
  const t = useT();
  const p = useJobEvents(tab.job?.id ?? null, onDone);
  const workers = useWorkers();
  const info = useDesktopInfo();
  const qc = useQueryClient();
  const onStep = useSecondsSince(`${p.status}:${p.stage}`);
  const idx = ORDER.indexOf(p.stage);
  const noWorker = (workers.data?.length ?? 0) === 0;
  const waiting = p.status === 'connecting' || p.status === 'queued' || (p.status === 'running' && p.stage === '');
  const failed = p.status === 'failed' || p.status === 'canceled';
  const label = waiting ? (noWorker ? t.job.waitingNoWorker : t.job.waitingPickup) : (Object.hasOwn(t.stages, p.stage) ? lookup(t.stages, p.stage) : t.job.analyzing);
  const pct = Math.round(p.progress * 100);
  const running = !waiting && !failed;
  // the worker's own line, when it says more than the step name: a first-use model download, a retry
  const detail = running && p.message && (/^Downloading /.test(p.message) || p.stage === 'retry') ? p.message : '';

  const cancel = () => {
    if (!tab.job || !window.confirm(t.job.cancelConfirm)) return;
    void api.cancelJob(tab.job.id).then(() => qc.invalidateQueries({ queryKey: keys.transcription(tab.id) }));
  };

  return (
    <Shell center={<BackLink />}>
      <main id="content" className="job">
        <div className="job-deck">
          {/* while the worker listens, the metronome keeps a slow 60 BPM */}
          <Metronome className="vt-deck" running={!waiting && !failed} beat={jobBeat} bpm={60} label={waiting ? t.job.metroWaiting : t.job.metroListening(pct)} />
        </div>
        <div className="job-side" aria-live="polite">
          <h1 className="display">{tab.title}</h1>
          <div className="chips">
            <span className={`chip solid${failed ? ' bad' : ''}`}>{failed ? t.job.stopped : waiting ? t.job.queued : t.job.analyzing}</span>
            {!waiting && !failed ? <span className="chip">{pct}%</span> : null}
          </div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t.job.progress}>
            <span style={{ transform: `scaleX(${Math.max(p.progress, 0.02)})` }} />
          </div>
          <p className="stage-now">
            {label}
            {running ? <span className="stage-time"> · {clock(onStep)}</span> : null}
          </p>
          {detail ? <p className="stage-detail" data-i18n="server">{detail}</p> : null}
          <ol className="tracklist" aria-label={t.job.steps}>
            {ORDER.map((s, i) => {
              const state = i < idx ? 'done' : i === idx && !waiting && !failed ? 'now' : '';
              return (
                <li key={s} className={state}>
                  <span className="track-no">{String(i + 1).padStart(2, '0')}</span>
                  <span className="track-name">{lookup(t.stages, s)}</span>
                  <span className="track-state" aria-hidden="true">
                    {state === 'done' ? <Icon name="check" size={16} /> : state === 'now' ? <span className="eq"><i /><i /><i /></span> : null}
                  </span>
                  {state === 'done' ? <span className="sr-only">{t.job.stepDone}</span> : state === 'now' ? <span className="sr-only">{t.job.stepRunning}</span> : null}
                </li>
              );
            })}
          </ol>
          {waiting && noWorker && info ? <DesktopWaiting info={info} /> : null}
          {waiting && noWorker && !desktop ? (
            <p className="banner warn" role="status">
              <Icon name="alert" />
              <span>{fill(t.job.noWorker, { cmd: <code translate="no">just worker</code> })}</span>
            </p>
          ) : null}
          {running && onStep >= LONG_STEP_S ? (
            <div className="banner" role="status">
              <Icon name="alert" />
              <div>
                <p>{t.job.longStep(Math.floor(onStep / 60), !!desktop)}</p>
                {desktop ? (
                  <div className="row tight">
                    <button type="button" className="btn quiet" onClick={() => desktop?.action('open-logs')}>{t.job.openLogs}</button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {failed ? <p className="banner bad" role="alert"><Icon name="alert" /> <span data-i18n="server">{p.error}</span></p> : null}
          <div className="row">
            {failed ? <Link to="/" className="btn">{t.job.backToTabs}</Link> : (
              <button type="button" className="btn" onClick={cancel}>{t.job.cancel}</button>
            )}
          </div>
        </div>
      </main>
    </Shell>
  );
}
