import { useEffect, useState } from 'react';
import type { AssemblyParams } from '../api/types';
import { useT } from '../i18n';
import { presetName, TUNING_PRESETS } from '../lib/tuning';

interface Props {
  params: AssemblyParams;
  onApply: (p: AssemblyParams) => void;
  busy: boolean;
  /** Tap-tempo result, if any: lets the user apply it as the beat grid. */
  tapBpm: number | null;
  tapCount: number;
  onApplyTaps: () => void;
}

const TS = ['4/4', '3/4', '2/4', '6/8', '5/4', '7/8', '12/8'];

export default function ParamsPanel({ params, onApply, busy, tapBpm, tapCount, onApplyTaps }: Props) {
  const t = useT();
  const [draft, setDraft] = useState(params);
  useEffect(() => setDraft(params), [params]);
  const tuning = draft.tuning ?? { name: 'Standard', open_pitches: [64, 59, 55, 50, 45, 40], capo: 0 };
  const dirty = JSON.stringify(draft) !== JSON.stringify(params);

  return (
    <form
      className="params"
      aria-label={t.params.form}
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft);
      }}
    >
      <label className="field">
        <span>{t.params.tuning}</span>
        <select
          value={presetName(tuning)}
          onChange={(e) => {
            const p = TUNING_PRESETS[e.target.value];
            if (p) setDraft({ ...draft, tuning: { ...tuning, name: e.target.value, open_pitches: [...p] } });
          }}
        >
          {Object.keys(TUNING_PRESETS).map((k) => <option key={k} value={k}>{t.tunings[k] ?? k}</option>)}
          {presetName(tuning) === 'Custom' ? <option value="Custom">{t.tunings.Custom}</option> : null}
        </select>
      </label>
      <label className="field">
        <span>{t.params.capo}</span>
        <input type="number" name="capo" autoComplete="off" inputMode="numeric" min={0} max={12} value={tuning.capo ?? 0} onChange={(e) => setDraft({ ...draft, tuning: { ...tuning, capo: Math.max(0, Math.min(12, Number(e.target.value) || 0)) } })} />
      </label>
      <label className="field">
        <span>{t.params.timing}</span>
        <select value={draft.timing} onChange={(e) => setDraft({ ...draft, timing: e.target.value as AssemblyParams['timing'] })}>
          {Object.entries(t.params.timings).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{t.params.tempo}</span>
        <input type="number" name="tempo" autoComplete="off" inputMode="decimal" min={30} max={300} step={0.5} placeholder={t.params.tempoPlaceholder} value={draft.tempo_hint_bpm ?? ''}
          onChange={(e) => setDraft({ ...draft, tempo_hint_bpm: e.target.value === '' ? null : Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>{t.params.timeSignature}</span>
        <select value={draft.time_signature ?? '4/4'} onChange={(e) => setDraft({ ...draft, time_signature: e.target.value })}>
          {TS.map((t) => <option key={t}>{t}</option>)}
        </select>
      </label>
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy || !dirty}>{t.params.apply}</button>
        {tapBpm ? (
          <button type="button" className="btn" onClick={onApplyTaps} disabled={busy} title={t.params.taps(tapCount)}>
            {t.params.useTaps(Math.round(tapBpm))}
          </button>
        ) : null}
      </div>
      <p className="muted small">{t.params.lockedStay}</p>
    </form>
  );
}
