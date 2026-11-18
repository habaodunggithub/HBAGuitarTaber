/**
 * Bridge for the setup page only (file://). The web app served by the API gets nothing: it stays a plain web page.
 * Written as a script (no import/export) because sandboxed preloads are not CommonJS modules.
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
}
