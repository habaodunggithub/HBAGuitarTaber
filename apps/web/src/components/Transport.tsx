import { useEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { fmtTime } from '../lib/format';
import Icon from './Icon';

interface Props {
  src: string;
  audioRef: Ref<HTMLAudioElement>;
  /** When the take is a video, the <video> element is rendered here (visible); otherwise a hidden <audio>. */
  videoHost?: HTMLElement | null;
  /** First-frame image for a video take (shown before playback). */
  poster?: string;
  /** Tap-tempo button handler (receives audio time). */
  onTap: () => void;
  tapCount: number;
  loopOn: boolean;
  onLoopChange: (v: boolean) => void;
  loopLabel: string | null;
  /** Jump to the previous / next measure. */
  onSkip: (dir: 1 | -1) => void;
  onPlayingChange?: (playing: boolean) => void;
  onRateChange?: (rate: number) => void;
}

const RATES = [0.5, 0.75, 1];

export default function Transport({ src, audioRef, videoHost, poster, onTap, tapCount, loopOn, onLoopChange, loopLabel, onSkip, onPlayingChange, onRateChange }: Props) {
  const waveRef = useRef<HTMLDivElement>(null);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const timeRef = useRef<HTMLSpanElement>(null); // updated imperatively: no re-render per frame
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const cbs = useRef({ onPlayingChange });
  cbs.current = { onPlayingChange };

  const setRefs = (el: HTMLAudioElement | null) => {
    audioEl.current = el;
    if (typeof audioRef === 'function') audioRef(el);
    else if (audioRef) (audioRef as { current: HTMLAudioElement | null }).current = el;
  };

  useEffect(() => {
    const a = audioEl.current;
    const host = waveRef.current;
    if (!a || !host) return;
    type WS = { destroy: () => void; setOptions: (o: Record<string, unknown>) => void; on: (e: string, f: (x: unknown) => void) => void };
    let ws: WS | null = null;
    let disposed = false;
    const colors = () => {
      const style = getComputedStyle(document.documentElement);
      const v = (n: string, d: string) => style.getPropertyValue(n).trim() || d;
      return { waveColor: v('--wave', '#b9ad95'), progressColor: v('--blue', '#2457c5'), cursorColor: 'transparent' };
    };
    const onScheme = () => ws?.setOptions(colors()); // follow the day/night switch
    window.addEventListener('taber-theme', onScheme);
    void import('wavesurfer.js').then(({ default: WaveSurfer }) => {
      if (disposed) return;
      ws = WaveSurfer.create({
        container: host,
        media: a,
        url: src,
        height: 44,
        ...colors(),
        cursorWidth: 0,
        barWidth: 3,
        barGap: 3,
        barRadius: 3,
        barMinHeight: 3,
        normalize: true,
        dragToSeek: true,
      }) as unknown as WS;
      ws.on('error', (e) => setLoadError(String(e)));
    });
    return () => {
      disposed = true;
      window.removeEventListener('taber-theme', onScheme);
      ws?.destroy();
    };
  }, [src]);

  useEffect(() => {
    const a = audioEl.current;
    if (!a) return;
    const onPlay = () => { setPlaying(true); cbs.current.onPlayingChange?.(true); };
    const onPause = () => { setPlaying(false); cbs.current.onPlayingChange?.(false); };
    const onMeta = () => setDuration(a.duration);
    let raf = 0;
    let shown = '';
    const tick = () => {
      const s = fmtTime(a.currentTime);
      if (s !== shown && timeRef.current) { timeRef.current.textContent = s; shown = s; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onPause);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('durationchange', onMeta);
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onPause);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('durationchange', onMeta);
    };
  }, []);

  const toggle = () => {
    const a = audioEl.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  };

  const changeRate = (r: number) => {
    setRate(r);
    onRateChange?.(r);
    if (audioEl.current) {
      audioEl.current.playbackRate = r;
      audioEl.current.preservesPitch = true; // slow down without changing the pitch
    }
  };

  const ri = RATES.indexOf(rate);
  return (
    <div className="transport">
      {videoHost
        ? createPortal(<video ref={setRefs as unknown as Ref<HTMLVideoElement>} preload="auto" playsInline poster={poster} className="take-video" aria-label="Recording video" />, videoHost)
        : <audio ref={setRefs} preload="auto" />}

      <div className="scrub">
        <span className="time" ref={timeRef} data-testid="time">0:00</span>
        <div ref={waveRef} className="wave" aria-label="Waveform, click or drag to seek" />
        <span className="time muted">{fmtTime(duration)}</span>
      </div>

      <div className="controls">
        <button type="button" className={`ctl${loopOn ? ' on' : ''}`} aria-pressed={loopOn} disabled={!loopLabel}
          onClick={() => onLoopChange(!loopOn)} aria-label={loopLabel ? `Loop ${loopLabel}` : 'Loop bar (select a note first)'} title={loopLabel ? `Loop ${loopLabel}` : 'Select a note to loop its bar'}>
          <Icon name="repeat" size={20} />
        </button>
        <button type="button" className="ctl" onClick={() => onSkip(-1)} aria-label="Previous bar" title="Previous bar"><Icon name="skipBack" size={22} /></button>
        <button type="button" className={`play${playing ? ' is-playing' : ''}`} onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} data-testid="play">
          <svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true" className="play-icon i-play">
            <path d="M5 2.8v10.4a.6.6 0 0 0 .9.5l8.2-5.2a.6.6 0 0 0 0-1L5.9 2.3a.6.6 0 0 0-.9.5z" />
          </svg>
          <svg viewBox="0 0 16 16" width="24" height="24" aria-hidden="true" className="play-icon i-pause">
            <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" />
          </svg>
        </button>
        <button type="button" className="ctl" onClick={() => onSkip(1)} aria-label="Next bar" title="Next bar"><Icon name="skipForward" size={22} /></button>
        <button type="button" className="ctl" onClick={onTap} aria-label={`Tap tempo${tapCount ? `, ${tapCount} taps` : ''}`} title="Tap along with the beat while listening (T)">
          <Icon name="tap" size={20} />
          {tapCount > 0 ? <span className="badge">{tapCount}</span> : null}
        </button>
      </div>

      <div className="speed" role="group" aria-label="Playback speed">
        <span className="speed-pill" aria-hidden="true" style={{ transform: `translateX(${Math.max(ri, 0) * 100}%)` }} />
        {RATES.map((r) => (
          <button key={r} type="button" className={rate === r ? 'on' : ''} aria-pressed={rate === r} onClick={() => changeRate(r)}>
            {Math.round(r * 100)}%
          </button>
        ))}
      </div>
      {loadError ? <p className="muted small">Could not draw the waveform: {loadError}</p> : null}
    </div>
  );
}
