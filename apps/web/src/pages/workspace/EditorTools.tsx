import type { AssemblyParams, RevisionInfo, TruthInfo } from '../../api/types';
import Icon from '../../components/Icon';
import ParamsPanel from '../../components/ParamsPanel';
import { useT } from '../../i18n';
import { useCanRedo, useCanUndo, useEditor } from '../../stores/editor';
import type { SaveState } from './useAutosave';

export const EXPORTS = ['gp5', 'musicxml', 'midi', 'ascii', 'alphatex'] as const;

interface Props {
  saveState: SaveState;
  params: AssemblyParams;
  busy: boolean;
  onApplyParams: (p: AssemblyParams) => void;
  tapBpm: number | null;
  tapCount: number;
  onApplyTaps: () => void;
  onExport: (format: string, label: string) => void;
  revisions: RevisionInfo[];
  currentRevision: number;
  onRestore: (n: number) => void;
  truth: TruthInfo | null;
  truthBusy: boolean;
  onSaveTruth: () => void;
  onRemoveTruth: () => void;
}

/**
 * Keeps an opened popover inside the window. It hangs right-aligned under its button, which puts it past the
 * left edge when the tools wrap onto their own line in a narrow window.
 */
function keepInView(e: React.SyntheticEvent<HTMLDetailsElement>) {
  const body = e.currentTarget.querySelector<HTMLElement>(':scope > .pop-body');
  if (!body) return;
  body.style.translate = '';
  if (!e.currentTarget.open) return;
  const gutter = 12;
  // the opening animation scales from the top right corner, so the right edge is already where it ends up
  const right = body.getBoundingClientRect().right;
  const left = right - body.offsetWidth;
  // move right when past the left edge, else left when past the right edge, else not at all
  const shift = Math.max(gutter - left, Math.min(0, window.innerWidth - gutter - right));
  if (shift) body.style.translate = `${shift}px 0`;
}

/** The editor's tools in the top rail: save state, undo/redo, settings, export, version history. */
export default function EditorTools(p: Props) {
  const t = useT();
  const dirty = useEditor((s) => s.dirty);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const { saveState } = p;
  return (
    <>
      <span className={`save-chip${saveState === 'error' ? ' bad' : dirty || saveState === 'saving' ? ' pending' : ''}`} role="status" data-testid="save-state">
        {saveState === 'saving' ? t.tools.saving : saveState === 'error' ? t.tools.saveFailed : dirty ? t.tools.unsaved : t.tools.saved}
      </span>
      <div className="tool-group">
        <button type="button" className="icon-btn" onClick={() => useEditor.getState().undo()} disabled={!canUndo} aria-label={t.tools.undo} title={t.tools.undoTitle}><Icon name="undo" /></button>
        <button type="button" className="icon-btn" onClick={() => useEditor.getState().redo()} disabled={!canRedo} aria-label={t.tools.redo} title={t.tools.redoTitle}><Icon name="redo" /></button>
      </div>
      <details className="pop" onToggle={keepInView}>
        <summary className="tool"><Icon name="sliders" /><span className="tool-label">{t.tools.settings}</span></summary>
        <div className="pop-body wide">
          <ParamsPanel params={p.params} onApply={p.onApplyParams} busy={p.busy} tapBpm={p.tapBpm} tapCount={p.tapCount} onApplyTaps={p.onApplyTaps} />
        </div>
      </details>
      <details className="pop" onToggle={keepInView}>
        <summary className="tool"><Icon name="download" /><span className="tool-label">{t.tools.export}</span></summary>
        <ul className="pop-body menu">
          {EXPORTS.map((f) => (
            <li key={f}><button type="button" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); p.onExport(f, t.tools.exports[f]); }}>{t.tools.exports[f]}</button></li>
          ))}
        </ul>
      </details>
      <details className="pop" onToggle={keepInView}>
        <summary className="tool" data-testid="truth-tool">
          <Icon name={p.truth ? 'check' : 'library'} />
          <span className="tool-label">{p.truth ? t.tools.inTestSet : t.tools.testSet}</span>
        </summary>
        <div className="pop-body wide truth-pop">
          {p.truth ? (
            <p className="small" data-testid="truth-state">{t.tools.truthState(p.truth.revision, p.truth.notes, p.truth.added_notes ?? 0)}</p>
          ) : (
            <p className="small">{t.tools.truthHint}</p>
          )}
          <p className="muted small">
            {t.tools.truthWhereBefore} <code translate="no">just truth-eval</code> {t.tools.truthWhereAfter}
          </p>
          <div className="row">
            <button type="button" className="btn" disabled={p.truthBusy} onClick={p.onSaveTruth} data-testid="truth-save">
              <Icon name="check" /> {p.truth ? t.tools.truthReplace : t.tools.truthAdd}
            </button>
            {p.truth ? <button type="button" className="btn quiet" disabled={p.truthBusy} onClick={p.onRemoveTruth}>{t.tools.truthRemove}</button> : null}
          </div>
        </div>
      </details>
      {p.revisions.length > 1 ? (
        <label className="tool select-tool" title={t.tools.version}>
          <Icon name="history" />
          <select
            aria-label={t.tools.version}
            value={p.currentRevision}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n !== p.currentRevision && window.confirm(t.tools.restoreConfirm(n))) p.onRestore(n);
            }}
          >
            {p.revisions.map((r) => (
              <option key={r.number} value={r.number}>{t.tools.versionOption(r.number, t.tools.sources[r.source] ?? t.tools.recomputed)}</option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
