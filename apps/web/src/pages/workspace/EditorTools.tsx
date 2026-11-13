import type { AssemblyParams, RevisionInfo } from '../../api/types';
import Icon from '../../components/Icon';
import ParamsPanel from '../../components/ParamsPanel';
import { useCanRedo, useCanUndo, useEditor } from '../../stores/editor';
import type { SaveState } from './useAutosave';

export const EXPORTS: [string, string][] = [
  ['gp5', 'Guitar Pro (.gp5)'],
  ['musicxml', 'MusicXML'],
  ['midi', 'MIDI'],
  ['ascii', 'ASCII tab'],
  ['alphatex', 'alphaTex'],
];

const SOURCE: Record<string, string> = { user: 'your edit', auto: 'automatic' };

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
}

/** The editor's tools in the top rail: save state, undo/redo, settings, export, version history. */
export default function EditorTools(p: Props) {
  const dirty = useEditor((s) => s.dirty);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const { saveState } = p;
  return (
    <>
      <span className={`save-chip${saveState === 'error' ? ' bad' : dirty || saveState === 'saving' ? ' pending' : ''}`} role="status" data-testid="save-state">
        {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : dirty ? 'Unsaved' : 'Saved'}
      </span>
      <div className="tool-group">
        <button type="button" className="icon-btn" onClick={() => useEditor.getState().undo()} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
        <button type="button" className="icon-btn" onClick={() => useEditor.getState().redo()} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
      </div>
      <details className="pop">
        <summary className="tool"><Icon name="sliders" /><span className="tool-label">Settings</span></summary>
        <div className="pop-body wide">
          <ParamsPanel params={p.params} onApply={p.onApplyParams} busy={p.busy} tapBpm={p.tapBpm} tapCount={p.tapCount} onApplyTaps={p.onApplyTaps} />
        </div>
      </details>
      <details className="pop">
        <summary className="tool"><Icon name="download" /><span className="tool-label">Export</span></summary>
        <ul className="pop-body menu">
          {EXPORTS.map(([f, label]) => (
            <li key={f}><button type="button" onClick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); p.onExport(f, label); }}>{label}</button></li>
          ))}
        </ul>
      </details>
      {p.revisions.length > 1 ? (
        <label className="tool select-tool" title="Version">
          <Icon name="history" />
          <select
            aria-label="Version"
            value={p.currentRevision}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n !== p.currentRevision && window.confirm(`Restore version ${n}? The current version stays in the history.`)) p.onRestore(n);
            }}
          >
            {p.revisions.map((r) => (
              <option key={r.number} value={r.number}>Version {r.number}, {SOURCE[r.source] ?? 'recomputed'}</option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
