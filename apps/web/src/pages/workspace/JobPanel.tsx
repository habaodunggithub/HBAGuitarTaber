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
import { STAGE_LABEL } from '../../lib/format';
import { backLink } from './common';

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
  if (!info.workerEnabled) {
    return (
      <div className="banner warn" role="status">
        <Icon name="alert" />
        <div>
          <p>Analysis on this computer is turned off, so the tab waits for a Kaggle worker.</p>
          <div className="row tight"><button type="button" className="btn" onClick={() => desktop?.setWorker(true)}>Analyze on this computer</button></div>
        </div>
      </div>
    );
  }
  if (info.worker === 'starting' || info.worker === 'running') {
    return (
      <p className="banner" role="status">
        <Icon name="refresh" />
        <span>
          The engine is starting. The first start after installing can take a minute or two
          {info.platform === 'win32' ? ' while Windows checks the new files' : ''}.
        </span>
      </p>
    );
  }
  return (
    <div className="banner bad" role="alert">
      <Icon name="alert" />
      <div>
        <p>{info.worker === 'crashed' ? 'The analysis engine stopped unexpectedly.' : 'The analysis engine is not running.'} Restart it; if it stops again, the logs say why.</p>
        <div className="row tight">
          <button type="button" className="btn" onClick={() => desktop?.action('restart-engine')}>Restart engine</button>
          <button type="button" className="btn quiet" onClick={() => desktop?.action('open-logs')}>Open logs</button>
        </div>
      </div>
    </div>
  );
}

/** The page while the worker analyses the take: live stage list over SSE, and cancel. */
export default function JobPanel({ t, onDone }: { t: Transcription; onDone: () => void }) {
  const p = useJobEvents(t.job?.id ?? null, onDone);
  const workers = useWorkers();
  const info = useDesktopInfo();
  const qc = useQueryClient();
  const onStep = useSecondsSince(`${p.status}:${p.stage}`);
  const idx = ORDER.indexOf(p.stage);
  const noWorker = (workers.data?.length ?? 0) === 0;
  const waiting = p.status === 'connecting' || p.status === 'queued' || (p.status === 'running' && p.stage === '');
  const failed = p.status === 'failed' || p.status === 'canceled';
  const label = waiting ? (noWorker ? 'Waiting for a worker' : 'Waiting for the worker to pick it up') : STAGE_LABEL[p.stage] ?? 'Analyzing';
  const pct = Math.round(p.progress * 100);
  const running = !waiting && !failed;
  // the worker's own line, when it says more than the step name: a first-use model download, a retry
  const detail = running && p.message && (/^Downloading /.test(p.message) || p.stage === 'retry') ? p.message : '';

  const cancel = () => {
    if (!t.job || !window.confirm('Cancel this analysis? You will need to upload the file again.')) return;
    void api.cancelJob(t.job.id).then(() => qc.invalidateQueries({ queryKey: keys.transcription(t.id) }));
  };

  return (
    <Shell center={backLink}>
      <main id="content" className="job">
        <div className="job-deck">
          {/* while the worker listens, the metronome keeps a slow 60 BPM */}
          <Metronome className="vt-deck" running={!waiting && !failed} beat={jobBeat} bpm={60} label={waiting ? 'waiting' : `listening ${pct}%`} />
        </div>
        <div className="job-side" aria-live="polite">
          <h1 className="display">{t.title}</h1>
          <div className="chips">
            <span className={`chip solid${failed ? ' bad' : ''}`}>{failed ? 'Stopped' : waiting ? 'Queued' : 'Analyzing'}</span>
            {!waiting && !failed ? <span className="chip">{pct}%</span> : null}
          </div>
          <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Analysis progress">
            <span style={{ transform: `scaleX(${Math.max(p.progress, 0.02)})` }} />
          </div>
          <p className="stage-now">
            {label}
            {running ? <span className="stage-time"> · {clock(onStep)}</span> : null}
          </p>
          {detail ? <p className="stage-detail">{detail}</p> : null}
          <ol className="tracklist" aria-label="Analysis steps">
            {ORDER.map((s, i) => {
              const state = i < idx ? 'done' : i === idx && !waiting && !failed ? 'now' : '';
              return (
                <li key={s} className={state}>
                  <span className="track-no">{String(i + 1).padStart(2, '0')}</span>
                  <span className="track-name">{STAGE_LABEL[s] ?? s}</span>
                  <span className="track-state" aria-hidden="true">
                    {state === 'done' ? <Icon name="check" size={16} /> : state === 'now' ? <span className="eq"><i /><i /><i /></span> : null}
                  </span>
                  {state === 'done' ? <span className="sr-only"> (done)</span> : state === 'now' ? <span className="sr-only"> (running)</span> : null}
                </li>
              );
            })}
          </ol>
          {waiting && noWorker && info ? <DesktopWaiting info={info} /> : null}
          {waiting && noWorker && !desktop ? (
            <p className="banner warn" role="status">
              <Icon name="alert" />
              <span>No worker is running, so the tab is waiting in the queue. Open a terminal and run <code translate="no">just worker</code>, or start a worker on Kaggle.</span>
            </p>
          ) : null}
          {running && onStep >= LONG_STEP_S ? (
            <div className="banner" role="status">
              <Icon name="alert" />
              <div>
                <p>
                  This step has taken {Math.floor(onStep / 60)} minutes. On the processor a long take can need that long. If the time keeps
                  growing and nothing changes, {desktop ? 'restart the engine (the analysis starts again) or send the logs.' : 'check the worker\'s terminal.'}
                </p>
                {desktop ? (
                  <div className="row tight">
                    <button type="button" className="btn quiet" onClick={() => desktop?.action('open-logs')}>Open logs</button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {failed ? <p className="banner bad" role="alert"><Icon name="alert" /> <span>{p.error}</span></p> : null}
          <div className="row">
            {failed ? <Link to="/" className="btn">Back to your tabs</Link> : (
              <button type="button" className="btn" onClick={cancel}>Cancel analysis</button>
            )}
          </div>
        </div>
      </main>
    </Shell>
  );
}
