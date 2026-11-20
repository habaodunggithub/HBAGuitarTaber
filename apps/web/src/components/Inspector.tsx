import type { Score } from '../api/types';
import { altPositions, getNote, type NoteLoc } from '../lib/scoreOps';
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

const TECH_LABEL: Record<string, string> = {
  bend: 'Bend', release: 'Release', prebend: 'Pre-bend', vibrato: 'Vibrato', whammy: 'Whammy',
  slide_in: 'Slide in', slide_out: 'Slide out', slide_legato: 'Slide', slide_shift: 'Shift slide',
  hammer_on: 'Hammer-on', pull_off: 'Pull-off', palm_mute: 'Palm mute', let_ring: 'Let ring',
  harmonic_natural: 'Harmonic', harmonic_pinch: 'Pinch harmonic', tap: 'Tapping', dead_note: 'Dead note',
};

const INLAY = new Set([3, 5, 7, 9, 15, 17, 19, 21]);

/** A slice of the neck around every place this pitch can be played; tap a dot to move the note there. */
function Fretboard({ alts, current, strings, onPick }: {
  alts: { string: number; fret: number }[];
  current: { string: number; fret: number };
  strings: number;
  onPick: (string: number, fret: number) => void;
}) {
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
      <ul className="fb-grid" role="listbox" aria-label="Other places to play it" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${strings}, 1fr)` }}>
        {alts.map((a) => {
          const on = a.string === current.string && a.fret === current.fret;
          return (
            <li key={`${a.string}-${a.fret}`} style={{ gridRow: a.string, gridColumn: a.fret - lo + 1 }}>
              <button type="button" role="option" aria-selected={on} className={`fb-dot${on ? ' on' : ''}`} onClick={() => onPick(a.string, a.fret)}
                aria-label={`String ${a.string}, fret ${a.fret}`} title={`String ${a.string}, fret ${a.fret}`}>
                {a.fret}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="fb-nums" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }, (_, c) => {
          const f = lo + c;
          return <span key={f} className={INLAY.has(f) || f === 12 ? 'mark' : ''}>{f === 0 ? 'open' : f}</span>;
        })}
      </div>
    </div>
  );
}

export default function Inspector({ score, selection, picked = 0, onClearPicked, onPick, onToggleLock, onRefingerMeasure, onShiftPitch, onDelete, onAddNote, busy }: Props) {
  const note = selection ? getNote(score, selection) : undefined;
  if (picked > 1) {
    return (
      <section className="inspector" aria-label="Note details">
        <h2 className="pixel-h" data-testid="picked-count">{picked} notes picked</h2>
        <p className="muted small">Notes that are not part of the solo (the backing guitar bleeding through, string noise)? Delete them in one go; Ctrl+Z brings them back.</p>
        <div className="row">
          <button type="button" className="btn" onClick={onDelete} data-testid="delete-picked"><Icon name="close" /> Delete {picked} notes</button>
          <button type="button" className="btn quiet" onClick={onClearPicked}>Keep them (Esc)</button>
        </div>
        <p className="muted small">Shift+click a note in the lane to add or take it out; Shift+drag adds a box.</p>
      </section>
    );
  }
  if (!selection || !note) {
    return (
      <section className="inspector" aria-label="Note details">
        <h2 className="pixel-h">Selected note</h2>
        <p className="muted small">Click a note in the lane or the score, or use the arrow keys, to see and change where it is played.</p>
        <ul className="muted small edit-tips">
          <li><b>Add</b>: double-click a string in the lane, where the note is missing.</li>
          <li><b>Delete many</b>: drag across the lane to pick the notes, then press Delete.</li>
          <li><b>Set the fret</b>: select a note and type the number (12 = 1 then 2).</li>
        </ul>
        <button type="button" className="btn quiet" onClick={onAddNote} data-testid="add-note">
          <Icon name="plus" /> Add a missed note at the playhead (N)
        </button>
        <KeyList compact />
      </section>
    );
  }
  const alts = altPositions(score, selection);
  const strings = score.assembly_params.tuning.open_pitches?.length ?? 6;
  return (
    <section className="inspector" aria-label="Note details">
      <div className="note-head">
        <h2 className="note-name pixel-h">{noteName(note.pitch_midi)}</h2>
        <span className="chip">Bar {selection.m + 1}</span>
        {note.locked ? <span className="chip solid"><Icon name="lock" size={13} /> Locked</span> : null}
      </div>
      <dl className="facts">
        <dt>Position</dt>
        <dd data-testid="position">String {note.string}, fret {note.fret}</dd>
        <dt>Finger</dt>
        <dd>{note.finger === '0' ? 'Open string' : note.finger === 'T' ? 'Thumb' : note.finger ? `Finger ${note.finger}` : 'Unknown'}</dd>
        <dt>Technique</dt>
        <dd>
          {note.techniques.length ? note.techniques.map((t) => (
            <span key={t.type} className="chip" title={`confidence ${Math.round((t.confidence ?? 1) * 100)}%`}>
              {TECH_LABEL[t.type] ?? t.type}
              {t.value != null ? ` ${t.value}` : ''}
            </span>
          )) : 'None'}
        </dd>
      </dl>

      <h3 className="panel-sub">Wrong note? <span className="muted small">type a fret number to put it there</span></h3>
      <div className="row pitch-row" role="group" aria-label="Change the pitch">
        <button type="button" className="btn quiet" onClick={() => onShiftPitch(-12)} title="Down an octave">−8va</button>
        <button type="button" className="btn quiet" onClick={() => onShiftPitch(-1)} title="Down a semitone (Shift+↓)" aria-label="Down a semitone"><Icon name="minus" /></button>
        <button type="button" className="btn quiet" onClick={() => onShiftPitch(1)} title="Up a semitone (Shift+↑)" aria-label="Up a semitone"><Icon name="plus" /></button>
        <button type="button" className="btn quiet" onClick={() => onShiftPitch(12)} title="Up an octave">+8va</button>
        <button type="button" className="btn quiet" onClick={onDelete} data-testid="delete-note" title="Not a real note (Delete)"><Icon name="close" /> Delete</button>
        <button type="button" className="btn quiet" onClick={onAddNote} title="A note was missed at the playhead (N)"><Icon name="plus" /> Add at playhead</button>
      </div>

      <h3 className="panel-sub">Same pitch, other places</h3>
      {alts.length > 1 ? (
        <Fretboard alts={alts} current={{ string: note.string, fret: note.fret }} strings={strings} onPick={onPick} />
      ) : (
        <p className="muted small">This pitch can only be played in one place.</p>
      )}

      <div className="row">
        <button type="button" className={`btn${note.locked ? ' on' : ''}`} aria-pressed={!!note.locked} onClick={onToggleLock}>
          <Icon name={note.locked ? 'lock' : 'unlock'} />
          {note.locked ? 'Locked' : 'Lock note (L)'}
        </button>
        <button type="button" className="btn quiet" onClick={onRefingerMeasure} disabled={busy} title="Re-run string/fret choice for this bar, keeping locked notes">
          <Icon name="refresh" />
          Re-finger bar
        </button>
      </div>
    </section>
  );
}
