const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

ipcRenderer.on('desktop:state', (_event, state) => {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      /* ignore */
    }
  }
});

ipcRenderer.on('desktop:refresh', () => {
  window.dispatchEvent(new CustomEvent('desktop-refresh'));
});

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  getState: () => ipcRenderer.invoke('desktop:get-state'),
  minimize: () => ipcRenderer.invoke('desktop:minimize'),
  hide: () => ipcRenderer.invoke('desktop:hide'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  togglePin: () => ipcRenderer.invoke('desktop:toggle-pin'),
  setCompact: (compact, options) => ipcRenderer.invoke('desktop:set-compact', compact, options),
  setOpacity: (opacity) => ipcRenderer.invoke('desktop:set-opacity', opacity),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data-folder'),
  onState: (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
});
