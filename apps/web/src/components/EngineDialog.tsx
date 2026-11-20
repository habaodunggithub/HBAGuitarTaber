import { useEffect, useRef } from 'react';
import { desktop, diagnostics, type DesktopAction, type DesktopInfo, VARIANT_LABEL } from '../lib/desktop';
import Icon from './Icon';
import { toast } from './Toaster';

const WORKER_STATE: Record<string, string> = {
  running: 'running',
  starting: 'starting',
  crashed: 'stopped unexpectedly',
  stopped: 'off',
};

/**
 * The desktop app's engine panel, opened from the worker light in the top bar. It holds what the native
 * Engine / File / Help menus had: the app has no menu bar on Windows and Linux.
 */
export default function EngineDialog({ info, onClose }: { info: DesktopInfo; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    d?.addEventListener('cancel', onCancel);
    return () => d?.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const run = (a: DesktopAction, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    desktop?.action(a);
    if (a === 'restart-engine' || a === 'change-engine') onClose();
  };
  const copy = () => {
    void navigator.clipboard.writeText(diagnostics(info)).then(
      () => toast('Copied. Paste it into your message, with the log files.'),
      () => toast('Could not copy', 'alert'),
    );
  };
  const busy = 'If a take is being analyzed now, its analysis starts over. Continue?';

  return (
    <dialog ref={ref} className="sheet-dialog engine" aria-labelledby="engine-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-head">
        <h2 id="engine-title" className="display-sm">Engine</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      <dl className="engine-facts">
        <dt>Runs on</dt>
        <dd>{info.variant ? VARIANT_LABEL[info.variant] ?? info.variant : 'not installed'}{info.gpu ? `: ${info.gpu}` : ''}</dd>
        {info.gpuNote ? (<><dt>GPU</dt><dd className="warn-text">not used: {info.gpuNote}</dd></>) : null}
        <dt>Analysis</dt>
        <dd>{WORKER_STATE[info.worker] ?? info.worker}</dd>
        <dt>Version</dt>
        <dd>{info.version}{info.torch ? `, PyTorch ${info.torch}` : ''}</dd>
      </dl>
      <label className="engine-toggle">
        <input type="checkbox" checked={info.workerEnabled} onChange={(e) => desktop?.setWorker(e.currentTarget.checked)} />
        <span>
          Analyze on this computer
          <small>Turn off when every take goes to a Kaggle worker.</small>
        </span>
      </label>
      <div className="engine-actions">
        <button type="button" className="btn" onClick={() => run('restart-engine', busy)}><Icon name="refresh" size={16} /> Restart engine</button>
        <button type="button" className="btn" onClick={() => run('change-engine', busy)}><Icon name="sliders" size={16} /> Change engine…</button>
      </div>
      <p className="label engine-sub">When something goes wrong</p>
      <div className="engine-links">
        <button type="button" className="text-btn" onClick={() => run('open-logs')}>Open the logs folder</button>
        <button type="button" className="text-btn" onClick={copy}>Copy diagnostics</button>
        <button type="button" className="text-btn" onClick={() => run('report-problem')}>Report a problem <Icon name="arrowUpRight" size={14} /></button>
        <button type="button" className="text-btn" onClick={() => run('open-data')}>Open the data folder</button>
        <button type="button" className="text-btn" onClick={() => run('check-updates')}>Check for updates</button>
      </div>
    </dialog>
  );
}
