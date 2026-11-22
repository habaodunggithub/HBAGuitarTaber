import { useEffect, useState } from 'react';

/**
 * The desktop app's bridge (apps/desktop/src/preload.ts): present only inside the desktop window, where it replaces
 * the native menu bar's Engine commands. In a browser `desktop` is null and the app hides these controls.
 */
export interface DesktopInfo {
  version: string;
  platform: string;
  variant: 'gpu' | 'cpu' | 'lite' | null;
  python: string | null;
  torch: string | null;
  gpu: string | null;
  gpuNote: string | null;
  api: string;
  worker: 'stopped' | 'starting' | 'running' | 'crashed' | string;
  workerEnabled: boolean;
  paths: { data: string; runtime: string; cache: string; logs: string };
}

export type DesktopAction =
  | 'restart-engine' | 'change-engine' | 'open-logs' | 'open-data' | 'check-updates' | 'report-problem' | 'download-page' | 'devtools';

interface Bridge {
  /** the language the user picked, kept by the desktop app (settings.json); null: none picked yet */
  lang?: string | null;
  setLanguage?(lang: string): void;
  info(): Promise<DesktopInfo | null>;
  onState(cb: (info: DesktopInfo) => void): () => void;
  action(name: DesktopAction): void;
  setWorker(on: boolean): void;
}

declare global {
  interface Window {
    taberDesktop?: Bridge;
  }
}

export const desktop: Bridge | null = typeof window !== 'undefined' ? window.taberDesktop ?? null : null;

/** Live engine state from the desktop app, null in a browser (or until the first answer). */
export function useDesktopInfo(): DesktopInfo | null {
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let live = true;
    void desktop.info().then((i) => live && i && setInfo(i));
    const off = desktop.onState((i) => live && setInfo(i));
    return () => {
      live = false;
      off();
    };
  }, []);
  return info;
}

/** Plain text a user can paste into a bug report: versions, engine, where the logs are. In English on purpose: it is read by whoever fixes the bug. */
export function diagnostics(i: DesktopInfo): string {
  return [
    `HBA Guitar Taber ${i.version} (${i.platform})`,
    `Engine: ${i.variant ?? 'not installed'}, Python ${i.python ?? '?'}, torch ${i.torch ?? 'none'}`,
    `GPU: ${i.gpu ?? (i.gpuNote ? `not used: ${i.gpuNote}` : 'not used')}`,
    `API: ${i.api}, local worker: ${i.worker}${i.workerEnabled ? '' : ' (turned off)'}`,
    `Logs: ${i.paths.logs}`,
  ].join('\n');
}
