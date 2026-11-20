/**
 * Bridges, written as a script (no import/export) because sandboxed preloads are not CommonJS modules.
 *  - the setup page (file://): the install flow;
 *  - the app page (served by the local API on 127.0.0.1): the few commands the Engine menu had, as
 *    `window.taberDesktop`. In a plain browser it is absent and the app hides those controls.
 * The main process checks the sender of every call again (src/main.ts, fromApp).
 */
const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('taber', {
    onState(cb: (state: unknown) => void) {
      ipcRenderer.on('setup:state', (_e, s) => cb(s));
      ipcRenderer.send('setup:ready');
    },
    install: (variant: string) => ipcRenderer.send('setup:install', variant),
    retry: () => ipcRenderer.send('setup:retry'),
    change: () => ipcRenderer.send('setup:change'),
    openLogs: () => ipcRenderer.send('setup:open-logs'),
    quit: () => ipcRenderer.send('setup:quit'),
  });
} else if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
  contextBridge.exposeInMainWorld('taberDesktop', {
    info: () => ipcRenderer.invoke('desktop:info'),
    onState(cb: (info: unknown) => void) {
      const h = (_e: unknown, info: unknown) => cb(info);
      ipcRenderer.on('desktop:state', h);
      return () => ipcRenderer.removeListener('desktop:state', h);
    },
    action: (name: string) => ipcRenderer.send('desktop:action', String(name)),
    setWorker: (on: boolean) => ipcRenderer.send('desktop:action', 'worker', Boolean(on)),
  });
}
