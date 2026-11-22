import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { urls } from '../api/client';
import { ApiError } from '../api/http';
import { keys, useReassemble, useRestore, useRevisions, useTranscription, useTruth, useVideoTrack } from '../api/hooks';
import type { AssemblyParams, ReassembleIn, Transcription } from '../api/types';
import Icon from '../components/Icon';
import Inspector from '../components/Inspector';
import Lane from '../components/Lane';
import Metronome from '../components/Metronome';
import NeckOverlay from '../components/NeckOverlay';
import Shell from '../components/Shell';
import type { TabController } from '../components/TabView';
import { toast } from '../components/Toaster';
import Transport from '../components/Transport';
import VideoCalibrate from '../components/VideoCalibrate';
import { getT, lookup, serverText, useT } from '../i18n';
import { errorText } from '../lib/errors';
import { fmtTime, keyLabel } from '../lib/format';
import { cyclePosition, deleteNote, deleteNotes, getNote, insertNoteAt, measureRange, setFret, setLocked, setPosition, shiftPitch, stepLoc, type NoteLoc } from '../lib/scoreOps';
import { bpmFromTaps } from '../lib/timeline';
import { useEditor } from '../stores/editor';
import { BackLink, Message } from './workspace/common';
import EditorTools from './workspace/EditorTools';
import JobPanel from './workspace/JobPanel';
import { useAlphaTex } from './workspace/useAlphaTex';
import { useAutosave } from './workspace/useAutosave';
import { useEditorKeys } from './workspace/useEditorKeys';
import { usePlayback } from './workspace/usePlayback';

// alphaTab (+ its worker, fonts) is by far the heaviest dependency: load it only on this page
const TabView = lazy(() => import('../components/TabView'));

/** /t/:id: loading, error, the job in progress, or the editor, depending on the tab's status. */
export default function Workspace() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useTranscription(id);
  const t = q.data;
  const m = useT();

  if (q.isPending) return <Shell center={<BackLink />}><main id="content" className="page"><p className="muted" role="status">{m.app.loading}</p></main></Shell>;
  if (q.error || !t) {
    const missing = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Message title={missing ? m.workspace.notFound : m.workspace.loadFailed}>
        <p className="muted" role="alert">{missing ? m.workspace.notFoundBody : m.workspace.serverDown}</p>
        <Link to="/" className="btn">{m.workspace.backToTabs}</Link>
      </Message>
    );
  }
  if (t.status === 'ready') return <Editor key={t.id} t={t} />;
  if (t.status === 'failed' || t.status === 'canceled') {
    return (
      <Message title={t.title}>
        <p className="banner bad" role="alert"><Icon name="alert" /> <span>{t.status === 'canceled' ? m.workspace.canceled : m.workspace.failed(t.job?.error ?? null)}</span></p>
        <Link to="/" className="btn">{m.workspace.tryAnother}</Link>
      </Message>
    );
  }
  return <JobPanel t={t} onDone={() => void qc.invalidateQueries({ queryKey: keys.transcription(id) })} />;
}

// ───────────────────────────── editor ─────────────────────────────
function Editor({ t }: { t: Transcription }) {
  // `m` is the catalog (`t` is the tab here); callbacks memoized once read getT() so a language change reaches them
  const m = useT();
  const qc = useQueryClient();
  const score = useEditor((s) => s.score);
  const selection = useEditor((s) => s.selection);
  const picked = useEditor((s) => s.picked);
  const select = useEditor((s) => s.select);
  const reassemble = useReassemble(t.id);
  const restore = useRestore(t.id);
  const revisions = useRevisions(t.id);
  const truth = useTruth(t.id);

  const tabCtl = useRef<TabController | null>(null);
  const [showStaff, setShowStaff] = useState(true);
  const [videoHost, setVideoHost] = useState<HTMLDivElement | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [loopOn, setLoopOn] = useState(false);
  const [taps, setTaps] = useState<number[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const onPlaying = useCallback((on: boolean) => setPlaying(on), []);

  // the server's score goes into the editor store whenever the server revision changes
  useEffect(() => {
    const st = useEditor.getState();
    if (t.score && t.current_revision !== st.baseRevision) st.load(t.score, t.current_revision);
  }, [t.score, t.current_revision]);
  useEffect(() => () => useEditor.getState().reset(), []);

  const tex = useAlphaTex(score, setNotice);
  const { saveState, flush: flushSave } = useAutosave(t.id, setNotice);
  const { audioRef, getTime, seek, togglePlay, beatAt, skip } = usePlayback(tabCtl, loopOn);

  // ── audio source: the wet take (what the player hears), else DI, else the video's audio ──
  const media = useMemo(() => t.inputs.find((i) => i.role === 'wet') ?? t.inputs.find((i) => i.role === 'di') ?? t.inputs[0], [t.inputs]);
  const src = media ? urls.assetContent(media.asset_id) : null;
  const videoAsset = useMemo(() => t.inputs.find((i) => i.kind === 'video') ?? null, [t.inputs]);
  const playsVideo = !!media && media.kind === 'video';
  // the neck tracking overlay: only for a video that plays in the editor and went through the video stage
  const [showNeck, setShowNeck] = useState(true);
  const wantsNeck = playsVideo && (t.quality?.video?.frames ?? 0) > 0;
  const neckTrack = useVideoTrack(t.id, t.analysis_id, wantsNeck);
  // the separated guitar / backing, when the analysis removed the backing track and uploaded both
  const playback = t.quality?.separation?.playback;
  const hasStems = !!t.analysis_id && !!playback?.includes('guitar') && playback.includes('backing');
  const stems = useMemo(
    () => (hasStems && t.analysis_id ? { guitar: urls.stem(t.id, 'guitar', t.analysis_id), backing: urls.stem(t.id, 'backing', t.analysis_id) } : null),
    [hasStems, t.id, t.analysis_id],
  );

  // ── editing actions ──
  const pick = useCallback((string: number, fret: number) => {
    const sel = useEditor.getState().selection;
    if (!sel) return;
    try {
      useEditor.getState().edit((s) => setPosition(s, sel, string, fret));
    } catch (e) {
      setNotice(e instanceof RangeError ? getT().workspace.cannotMove : (e as Error).message);
    }
  }, []);

  const cycle = useCallback((dir: 1 | -1) => {
    const { score: sc, selection: sel } = useEditor.getState();
    if (!sc || !sel) return;
    const next = cyclePosition(sc, sel, dir);
    if (next) pick(next.string, next.fret);
  }, [pick]);

  const toggleLock = useCallback(() => {
    const { score: sc, selection: sel } = useEditor.getState();
    if (!sc || !sel) return;
    const note = getNote(sc, sel);
    if (note) useEditor.getState().edit((s) => setLocked(s, sel, !note.locked));
  }, []);

  const tap = useCallback(() => {
    const a = audioRef.current;
    if (a) setTaps((prev) => [...prev, a.currentTime]);
  }, [audioRef]);

  // ── note corrections: what makes a checked tab (your test set) possible ──
  const shiftSel = useCallback((semitones: number) => {
    const { score: sc, selection: sel } = useEditor.getState();
    if (!sc || !sel) return;
    const next = shiftPitch(sc, sel, semitones);
    if (next) useEditor.getState().edit(() => next);
    else setNotice(getT().workspace.pitchOutOfRange);
  }, []);

  const deleteSel = useCallback(() => {
    const { score: sc, selection: sel, picked } = useEditor.getState();
    if (sc && picked.length) { // the notes picked together go in one step (one undo)
      useEditor.getState().edit((s) => deleteNotes(s, picked));
      useEditor.getState().select(null);
      toast(getT().workspace.deletedMany(picked.length));
      return;
    }
    if (!sc || !sel || !getNote(sc, sel)) return;
    const prev = stepLoc(sc, sel, -1);
    useEditor.getState().edit((s) => deleteNote(s, sel));
    useEditor.getState().select(prev && !(prev.m === sel.m && prev.s === sel.s && prev.n === sel.n) ? prev : null);
  }, []);

  const addNote = useCallback(() => {
    const sc = useEditor.getState().score;
    if (!sc) return;
    const r = insertNoteAt(sc, getTime());
    if (!r) { setNotice(getT().workspace.addInside); return; }
    if (r.added) useEditor.getState().edit(() => r.score);
    else toast(getT().workspace.noteExists);
    useEditor.getState().select(r.loc);
  }, [getTime]);

  /** Double-click on a string in the lane: a note right there, on that string. */
  const addAt = useCallback((time: number, string: number) => {
    const sc = useEditor.getState().score;
    if (!sc) return;
    const r = insertNoteAt(sc, time, string);
    if (!r) { setNotice(getT().workspace.addInsideBars); return; }
    if (r.added) useEditor.getState().edit(() => r.score);
    else toast(getT().workspace.noteExistsOnString);
    useEditor.getState().select(r.loc);
  }, []);

  /** Notes picked together in the lane (a box, Shift+click). One note alone is just selected. */
  const pickMany = useCallback((locs: NoteLoc[], add: boolean) => {
    const st = useEditor.getState();
    const key = (l: NoteLoc) => `${l.m}.${l.s}.${l.n}`;
    const all = add ? [...new Map([...st.picked, ...locs].map((l) => [key(l), l])).values()] : locs;
    if (all.length === 1) { st.setPicked([]); st.select(all[0]!); return; }
    st.setPicked(all);
  }, []);

  /** Type the fret on the selected note's string (0-24): its pitch follows. */
  const typeFret = useCallback((fret: number) => {
    const { score: sc, selection: sel } = useEditor.getState();
    if (!sc || !sel) return;
    const next = setFret(sc, sel, fret);
    if (next) useEditor.getState().edit(() => next);
    else setNotice(getT().workspace.offNeck(fret));
  }, []);

  useEditorKeys({ togglePlay, cycle, toggleLock, tap, shiftPitch: shiftSel, addNote, deleteNote: deleteSel, typeFret });

  // ── server-side actions: save local edits first, the server recomputes from its copy ──
  const recompute = useCallback(async (body: ReassembleIn, done: () => void) => {
    await flushSave();
    reassemble.mutate(body, { onSuccess: done, onError: (e) => setNotice(errorText(e)) });
  }, [flushSave, reassemble]);

  const applyParams = (params: AssemblyParams) =>
    void recompute({ assembly_params: params }, () => toast(m.workspace.applied));

  const refingerMeasure = () => {
    const { score: sc, selection: sel } = useEditor.getState();
    if (!sc || !sel) return;
    const [from, to] = measureRange(sc, sel.m);
    void recompute({ range: { from_s: from, to_s: to } }, () => toast(m.workspace.refingered(sel.m + 1), 'refresh'));
  };

  const tapBpm = useMemo(() => bpmFromTaps(taps), [taps]);
  const applyTaps = () => {
    if (!score) return;
    const sorted = [...taps].sort((a, b) => a - b);
    void recompute(
      { assembly_params: { ...score.assembly_params, timing: 'user_tapped', user_beats_s: sorted } },
      () => { setTaps([]); toast(m.workspace.rebuilt); },
    );
  };

  const exportAs = async (fmt: string, label: string) => {
    await flushSave();
    const a = document.createElement('a');
    a.href = urls.export(t.id, fmt);
    a.download = '';
    a.click();
    toast(m.workspace.downloading(label), 'download');
  };

  const saveTruth = () => void flushSave().then(() => truth.save.mutate(undefined, {
    onSuccess: (i) => toast(m.workspace.truthAdded(i.notes), 'check'),
    onError: (e) => setNotice(errorText(e)),
  }));
  const removeTruth = () => truth.remove.mutate(undefined, { onSuccess: () => toast(m.workspace.truthRemoved), onError: (e) => setNotice(errorText(e)) });

  const restoreTo = (n: number) => void flushSave().then(() => restore.mutate(n, { onSuccess: () => toast(m.workspace.restored(n), 'history'), onError: (e) => setNotice(errorText(e)) }));

  if (!score) return <Shell center={<BackLink />}><main id="content" className="page"><p className="muted" role="status">{m.workspace.opening}</p></main></Shell>;

  const busy = reassemble.isPending || restore.isPending;
  // each warning in the app's language when the analysis sent its code (older analyses have only the English text)
  const notices = t.quality?.notices ?? [];
  const warnings = (t.quality?.warnings ?? []).map((text, i) => ({ text, said: serverText(m, 'notices', notices[i]?.code, notices[i]?.params) }));
  const loopLabel = selection ? m.workspace.bar(selection.m + 1) : null;
  const lastSlot = score.measures.at(-1)?.slots.at(-1);
  const key = t.quality?.key;
  const bpm = Math.round(score.measures[0]?.tempo_bpm ?? 0);

  const tools = (
    <EditorTools
      saveState={saveState}
      params={score.assembly_params as AssemblyParams}
      busy={busy}
      onApplyParams={applyParams}
      tapBpm={tapBpm}
      tapCount={taps.length}
      onApplyTaps={applyTaps}
      onExport={(f, label) => void exportAs(f, label)}
      revisions={revisions.data ?? []}
      currentRevision={t.current_revision}
      onRestore={restoreTo}
      truth={truth.info}
      truthBusy={truth.save.isPending || truth.remove.isPending}
      onSaveTruth={saveTruth}
      onRemoveTruth={removeTruth}
    />
  );

  return (
    <Shell center={<BackLink />} tools={tools}>
      <main id="content" className="editor">
        <section className="deck-col" aria-label={m.workspace.playback}>
          <div className="deck-wrap">
            <Metronome className="vt-deck" running={playing} beat={beatAt} bpm={bpm} label={m.workspace.metroLabel(key ? keyLabel(key) : null, bpm)} />
            {src ? <button type="button" className="deck-hit" tabIndex={-1} aria-hidden="true" onClick={togglePlay} /> : null}
          </div>
          <div className="now">
            <h1 className="display track" title={t.title}>{t.title}</h1>
            <div className="chips">
              {key ? <span className="chip solid" data-testid="key">{keyLabel(key)}</span> : null}
              <span className="chip">{m.workspace.bpm(bpm)}</span>
              {t.quality?.separation?.used ? <span className="chip" data-testid="separated">{m.workspace.backingRemoved}</span> : null}
            </div>
          </div>
          {src && (!playsVideo || videoHost) ? (
            <Transport
              src={src}
              audioRef={audioRef}
              videoHost={playsVideo ? videoHost : null}
              poster={playsVideo && media ? urls.frame(media.asset_id, 0.5) : undefined}
              onTap={tap}
              tapCount={taps.length}
              loopOn={loopOn}
              onLoopChange={setLoopOn}
              loopLabel={loopLabel}
              onSkip={skip}
              onPlayingChange={onPlaying}
              stems={stems}
            />
          ) : src ? null : <p className="muted small">{m.workspace.noAudio}</p>}
        </section>

        <div className="work">
          {warnings.length ? (
            <div className="banner warn" role="status">
              <Icon name="alert" />
              <div>{warnings.map((w) => w.said ? <p key={w.text}>{w.said}</p> : <p key={w.text} data-i18n="server">{w.text}</p>)}</div>
            </div>
          ) : null}
          {notice ? (
            <div className="banner bad" role="alert">
              <Icon name="alert" />
              <p>{notice}</p>
              <button type="button" className="icon-btn small" aria-label={m.app.dismiss} onClick={() => setNotice(null)}><Icon name="close" size={16} /></button>
            </div>
          ) : null}

          <section className="panel lane-panel" aria-labelledby="lane-h">
            <h2 id="lane-h" className="pixel-h">{m.workspace.lane}</h2>
            <div className="screen">
              <Lane score={score} selection={selection} onSelect={select} getTime={getTime} onSeek={seek} picked={picked} onPickMany={pickMany} onAddAt={addAt} />
            </div>
          </section>

          <div className={`pair${videoAsset ? ' with-video' : ''}`}>
            <div className="panel">
              <Inspector score={score} selection={selection} picked={picked.length} onClearPicked={() => useEditor.getState().setPicked([])} onPick={pick} onToggleLock={toggleLock} onRefingerMeasure={refingerMeasure} onShiftPitch={shiftSel} onDelete={deleteSel} onAddNote={addNote} busy={busy} />
            </div>
            {videoAsset ? (
              <section className="panel video-panel" aria-label={m.workspace.video}>
                <h2 className="pixel-h">{m.workspace.video}</h2>
                <div className="video-box" ref={setVideoHost} />
                {showNeck && neckTrack.data && videoHost && playsVideo ? <NeckOverlay host={videoHost} media={audioRef} track={neckTrack.data} /> : null}
                <VideoStatus video={t.quality?.video ?? null} />
                {wantsNeck ? (
                  <label className="switch">
                    <input type="checkbox" role="switch" checked={showNeck} onChange={(e) => setShowNeck(e.target.checked)}
                      disabled={!neckTrack.data} data-testid="show-neck" />
                    <span className="switch-track" aria-hidden="true" />
                    {m.workspace.showNeck}
                  </label>
                ) : null}
                {wantsNeck && neckTrack.data === null ? <p className="muted small">{m.workspace.reanalyzeForNeck}</p> : null}
                <button type="button" className="btn" onClick={() => setCalibrating(true)} data-testid="use-video">
                  <Icon name="video" /> {t.quality?.video?.used ? m.workspace.recalibrate : m.workspace.useVideo}
                </button>
              </section>
            ) : null}
          </div>

          <section className="panel sheet" aria-labelledby="sheet-h">
            <div className="sheet-head">
              <h2 id="sheet-h" className="pixel-h">{m.workspace.score}</h2>
              <p className="facts-line">{m.workspace.scoreFacts(score.measures.length, fmtTime(lastSlot?.start_s ?? 0))}</p>
              <div className="spacer" />
              <label className="switch">
                <input type="checkbox" role="switch" checked={showStaff} onChange={(e) => setShowStaff(e.target.checked)} />
                <span className="switch-track" aria-hidden="true" />
                {m.workspace.showStaff}
              </label>
            </div>
            <Suspense fallback={<div className="tab-skeleton" role="status"><span className="sr-only">{m.workspace.loadingScore}</span></div>}>
              {tex ? (
                <TabView tex={tex} score={score} selection={selection} onSelect={select} showStaff={showStaff} controllerRef={tabCtl as React.Ref<TabController>} onError={setNotice} />
              ) : <div className="tab-skeleton" role="status"><span className="sr-only">{m.workspace.renderingScore}</span></div>}
            </Suspense>
          </section>
        </div>
      </main>
      {calibrating && videoAsset ? (
        <VideoCalibrate
          transcriptionId={t.id}
          videoAssetId={videoAsset.asset_id}
          startTime={audioRef.current?.currentTime ?? 0}
          onClose={() => setCalibrating(false)}
          onStarted={() => { setCalibrating(false); toast(m.workspace.reanalyzing, 'video'); void flushSave().then(() => qc.invalidateQueries({ queryKey: keys.transcription(t.id) })); }}
        />
      ) : null}
    </Shell>
  );
}

type VideoQuality = NonNullable<NonNullable<Transcription['quality']>['video']>;

function VideoStatus({ video }: { video: VideoQuality | null }) {
  const m = useT();
  if (!video) return <p className="muted small">{m.workspace.videoUnused}</p>;
  if (!video.used) return <p className="muted small">{m.workspace.videoNoHelp(video.reason_code && Object.hasOwn(m.server.videoReasons, video.reason_code) ? lookup(m.server.videoReasons, video.reason_code) : video.reason ?? '')}</p>;
  return (
    <p className="muted small" data-testid="video-status">
      {m.workspace.videoUsed(Math.round((video.tracked_ratio ?? 0) * 100), Math.round((video.hands_ratio ?? 0) * 100), video.notes_with_evidence ?? 0)}
    </p>
  );
}
