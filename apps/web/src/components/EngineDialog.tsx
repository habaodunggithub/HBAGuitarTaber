import { useEffect, useRef } from 'react';
import { useT } from '../i18n';
import { desktop, diagnostics, type DesktopAction, type DesktopInfo } from '../lib/desktop';
import Icon from './Icon';
import { toast } from './Toaster';

/**
 * The desktop app's engine panel, opened from the worker light in the top bar. It holds what the native
 * Engine / File / Help menus had: the app has no menu bar on Windows and Linux.
 */
export default function EngineDialog({ info, onClose }: { info: DesktopInfo; onClose: () => void }) {
  const t = useT();
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
      () => toast(t.engine.copied),
      () => toast(t.engine.copyFailed, 'alert'),
    );
  };
  const busy = t.engine.busy;

  return (
    <dialog ref={ref} className="sheet-dialog engine" aria-labelledby="engine-title" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-head">
        <h2 id="engine-title" className="display-sm">{t.engine.title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t.app.close}><Icon name="close" /></button>
      </div>
      <dl className="engine-facts">
        <dt>{t.engine.runsOn}</dt>
        <dd>{info.variant ? t.engine.variants[info.variant] ?? info.variant : t.engine.notInstalled}{info.gpu ? `: ${info.gpu}` : ''}</dd>
        {info.gpuNote ? (<><dt>{t.engine.gpu}</dt><dd className="warn-text">{t.engine.gpuNotUsed(info.gpuNote)}</dd></>) : null}
        <dt>{t.engine.analysis}</dt>
        <dd>{t.engine.workerState[info.worker] ?? info.worker}</dd>
        <dt>{t.engine.version}</dt>
        <dd>{info.version}{info.torch ? `, PyTorch ${info.torch}` : ''}</dd>
      </dl>
      <label className="engine-toggle">
        <input type="checkbox" checked={info.workerEnabled} onChange={(e) => desktop?.setWorker(e.currentTarget.checked)} />
        <span>
          {t.engine.analyzeHere}
          <small>{t.engine.analyzeHereHint}</small>
        </span>
      </label>
      <div className="engine-actions">
        <button type="button" className="btn" onClick={() => run('restart-engine', busy)}><Icon name="refresh" size={16} /> {t.engine.restart}</button>
        <button type="button" className="btn" onClick={() => run('change-engine', busy)}><Icon name="sliders" size={16} /> {t.engine.change}</button>
      </div>
      <p className="label engine-sub">{t.engine.whenWrong}</p>
      <div className="engine-links">
        <button type="button" className="text-btn" onClick={() => run('open-logs')}>{t.engine.openLogs}</button>
        <button type="button" className="text-btn" onClick={copy}>{t.engine.copyDiagnostics}</button>
        <button type="button" className="text-btn" onClick={() => run('report-problem')}>{t.engine.report} <Icon name="arrowUpRight" size={14} /></button>
        <button type="button" className="text-btn" onClick={() => run('open-data')}>{t.engine.openData}</button>
        <button type="button" className="text-btn" onClick={() => run('check-updates')}>{t.engine.checkUpdates}</button>
      </div>
    </dialog>
  );
}
