const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getEdition: () => ipcRenderer.invoke('app:get-edition'),
  printReceipt: (saleData) => ipcRenderer.invoke('printer:print-receipt', saleData),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  localDb: {
    outboxEnqueue: (payload) => ipcRenderer.invoke('localdb:outboxEnqueue', payload),
    outboxList: () => ipcRenderer.invoke('localdb:outboxList'),
    outboxRemove: (id) => ipcRenderer.invoke('localdb:outboxRemove', id),
    cacheSet: (key, json) => ipcRenderer.invoke('localdb:cacheSet', { key, json }),
    cacheGet: (key) => ipcRenderer.invoke('localdb:cacheGet', key),
  },
  updater: {
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    check: () => ipcRenderer.invoke('updater:check'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    },
  },
});
