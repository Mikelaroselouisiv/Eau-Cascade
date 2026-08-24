const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  platform: process.platform,
  printReceipt: (saleData) => ipcRenderer.invoke('printer:print-receipt', saleData),
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  getEdition: () => ipcRenderer.invoke('app:get-edition'),
  localDb: {
    outboxEnqueue: (payload) => ipcRenderer.invoke('localdb:outboxEnqueue', payload),
    outboxList: () => ipcRenderer.invoke('localdb:outboxList'),
    outboxRemove: (id) => ipcRenderer.invoke('localdb:outboxRemove', id),
    cacheSet: (key, json) => ipcRenderer.invoke('localdb:cacheSet', { key, json }),
    cacheGet: (key) => ipcRenderer.invoke('localdb:cacheGet', key),
  },
  updater: {
    getState: () => ipcRenderer.invoke('updater:get-state'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    snooze: (optionKey) => ipcRenderer.invoke('updater:snooze', optionKey),
    dismiss: () => ipcRenderer.invoke('updater:dismiss'),
    getSnoozeOptions: () => ipcRenderer.invoke('updater:get-snooze-options'),
    onState: (handler) => {
      const listener = (_event, state) => handler(state);
      ipcRenderer.on('updater:state', listener);
      return () => ipcRenderer.removeListener('updater:state', listener);
    },
    onOpenPrompt: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('updater:open-prompt', listener);
      return () => ipcRenderer.removeListener('updater:open-prompt', listener);
    },
  },
});
