import type { Score } from '../api/types';
import { altPositions, getNote, type NoteLoc } from '../lib/scoreOps';
import { useT } from '../i18n';
import { noteName } from '../lib/tuning';
import Icon from './Icon';
import { KeyList } from './Shell';

interface Props {
  score: Score;
  selection: NoteLoc | null;
  /** how many notes are picked together in the lane (0: none) */
  picked?: number;
  onClearPicked?: () => void;
  onPick: (string: number, fret: number) => void;
  onToggleLock: () => void;
  onRefingerMeasure: () => void;
  onShiftPitch: (semitones: number) => void;
  onDelete: () => void;
  onAddNote: () => void;
  busy: boolean;
}

const INLAY = new Set([3, 5, 7, 9, 15, 17, 19, 21]);

/** A slice of the neck around every place this pitch can be played; tap a dot to move the note there. */
function Fretboard({ alts, current, strings, onPick }: {
  alts: { string: number; fret: number }[];
  current: { string: number; fret: number };
  strings: number;
  onPick: (string: number, fret: number) => void;
}) {
  const t = useT();
  const frets = alts.map((a) => a.fret);
  const lo = Math.max(0, Math.min(...frets) - 1);
  const hi = Math.max(lo + 5, Math.max(...frets) + 1);
  const cols = hi - lo + 1;
  return (
    <div className="fb screen">
      <svg className="fb-bg" viewBox={`0 0 ${cols} ${strings}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {Array.from({ length: cols - 1 }, (_, k) => (
          <line key={`f${k}`} x1={k + 1} x2={k + 1} y1={0} y2={strings} className={lo === 0 && k === 0 ? 'fb-nut' : 'fb-fret'} vectorEffect="non-scaling-stroke" />
        ))}
        {Array.from({ length: strings }, (_, i) => (
          <line key={`s${i}`} x1={lo === 0 ? 1 : 0} x2={cols} y1={i + 0.5} y2={i + 0.5} className="fb-string" style={{ strokeWidth: 1 + i * 0.3 }} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <ul className="fb-grid" role="listbox" aria-label={t.inspector.otherPlacesList} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${strings}, 1fr)` }}>
        {alts.map((a) => {
          const on = a.string === current.string && a.fret === current.fret;
          return (
            <li key={`${a.string}-${a.fret}`} style={{ gridRow: a.string, gridColumn: a.fret - lo + 1 }}>
              <button type="button" role="option" aria-selected={on} className={`fb-dot${on ? ' on' : ''}`} onClick={() => onPick(a.string, a.fret)}
                aria-label={t.inspector.stringFret(a.string, a.fret)} title={t.inspector.stringFret(a.string, a.fret)}>
                {a.fret}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="fb-nums" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }, (_, c) => {
          const f = lo + c;
          return <span key={f} className={INLAY.has(f) || f === 12 ? 'mark' : ''}>{f === 0 ? t.inspector.open : f}</span>;
        })}
      </div>
    </div>
  );
}

export default function Inspector({ score, selection, picked = 0, onClearPicked, onPick, onToggleLock, onRefingerMeasure, onShiftPitch, onDelete, onAddNote, busy }: Props) {
  const t = useT();
  const i = t.inspector;
  const note = selection ? getNote(score, selection) : undefined;
  if (picked > 1) {
    return (
      <section className="inspector" aria-label={i.region}>
        <h2 className="pixel-h" data-testid="picked-count">{i.picked(picked)}</h2>
        <p className="muted small">{i.pickedHint}</p>
        <div className="row">
          <button type="button" className="btn" onClick={onDelete} data-testid="delete-picked"><Icon name="close" /> {i.deletePicked(picked)}</button>
          <button type="button" className="btn quiet" onClick={onClearPicked}>{i.keepPicked}</button>
        </div>
        <p className="muted small">{i.pickedMore}</p>
      </section>
    );
  }
  if (!selection || !note) {
    return (
      <section className="inspector" aria-label={i.region}>
        <h2 className="pixel-h">{i.selected}</h2>
        <p className="muted small">{i.selectHint}</p>
        <ul className="muted small edit-tips">
          {i.tips.map(([b, rest]) => <li key={b}><b>{b}</b>{rest}</li>)}
        </ul>
        <button type="button" className="btn quiet" onClick={onAddNote} data-testid="add-note">
          <Icon name="plus" /> {i.addMissed}
        </button>
        <KeyList compact />
      </section>
    );
  }
  const alts = altPositions(score, selection);
  const strings = score.assembly_params.tuning.open_pitches?.length ?? 6;
  return (
    <section className="inspector" aria-label={i.region}>
      <div className="note-head">
        <h2 className="note-name pixel-h">{noteName(note.pitch_midi)}</h2>
        <span className="chip">{i.bar(selection.m + 1)}</span>
        {note.locked ? <span className="chip solid"><Icon name="lock" size={13} /> {i.locked}</span> : null}
      </div>
      <dl className="facts">
        <dt>{i.position}</dt>
        <dd data-testid="position">{i.stringFret(note.string, note.fret)}</dd>
        <dt>{i.finger}</dt>
        <dd>{note.finger === '0' ? i.openString : note.finger === 'T' ? i.thumb : note.finger ? i.fingerN(note.finger) : i.unknown}</dd>
        <dt>{i.technique}</dt>
        <dd>
          {note.techniques.length ? note.techniques.map((x) => (
            <span key={x.type} className="chip" title={i.confidence(Math.round((x.confidence ?? 1) * 100))}>
              {i.techniques[x.type] ?? x.type}
              {x.value != null ? ` ${x.value}` : ''}
            </span>
          )) : i.none}
        </dd>
      </dl>

      <h3 className="panel-sub">{i.wrongNote} <span className="muted small">{i.wrongNoteHint}</span></h3>
      <div className="row pitch-row" role="group" aria-label={i.changePitch}>
        <button type="button" className="btn quiet" onClick={() => onShiftPitch(-12)} title={i.octaveDown} data-i18n="as-is">−8va</button>
        <button type="button" className="btn quiet" onClick={() => onShiftPitch(-1)} title={i.semitoneDownTitle} aria-label={i.semitoneDown}><Icon name="minus" /></button>
        <button type="button" className="btn quiet" onClick={() => onShiftPitch(1)} title={i.semitoneUpTitle} aria-label={i.semitoneUp}><Icon name="plus" /></button>
        <button type="button" className="btn quiet" onClick={() => onShiftPitch(12)} title={i.octaveUp} data-i18n="as-is">+8va</button>
        <button type="button" className="btn quiet" onClick={onDelete} data-testid="delete-note" title={i.deleteTitle}><Icon name="close" /> {i.delete}</button>
        <button type="button" className="btn quiet" onClick={onAddNote} title={i.addAtPlayheadTitle}><Icon name="plus" /> {i.addAtPlayhead}</button>
      </div>

      <h3 className="panel-sub">{i.otherPlaces}</h3>
      {alts.length > 1 ? (
        <Fretboard alts={alts} current={{ string: note.string, fret: note.fret }} strings={strings} onPick={onPick} />
      ) : (
        <p className="muted small">{i.onePlace}</p>
      )}

      <div className="row">
        <button type="button" className={`btn${note.locked ? ' on' : ''}`} aria-pressed={!!note.locked} onClick={onToggleLock}>
          <Icon name={note.locked ? 'lock' : 'unlock'} />
          {note.locked ? i.locked : i.lock}
        </button>
        <button type="button" className="btn quiet" onClick={onRefingerMeasure} disabled={busy} title={i.refingerTitle}>
          <Icon name="refresh" />
          {i.refinger}
        </button>
      </div>
    </section>
  );
}
