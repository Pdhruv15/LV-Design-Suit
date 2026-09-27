const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lvds', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    chooseProjectsFolder: () => ipcRenderer.invoke('settings:chooseProjectsFolder'),
    choosePython: () => ipcRenderer.invoke('settings:choosePython')
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    load: (file) => ipcRenderer.invoke('projects:load', file),
    save: (file, data) => ipcRenderer.invoke('projects:save', { file, data }),
    delete: (file) => ipcRenderer.invoke('projects:delete', file)
  },
  database: {
    init: (seeds) => ipcRenderer.invoke('database:init', seeds),
    read: () => ipcRenderer.invoke('database:read'),
    open: (file) => ipcRenderer.invoke('database:open', file),
    onChange: (cb) => {
      const listener = (_evt, data) => cb(data);
      ipcRenderer.on('database:changed', listener);
      return () => ipcRenderer.removeListener('database:changed', listener);
    }
  },
  engines: {
    probe: () => ipcRenderer.invoke('engines:probe'),
    run: (request) => ipcRenderer.invoke('engines:run', request)
  },
  files: {
    saveText: (opts) => ipcRenderer.invoke('files:saveText', opts),
    saveBinary: (opts) => ipcRenderer.invoke('files:saveBinary', opts),
    savePdf: (opts) => ipcRenderer.invoke('files:savePdf', opts)
  }
});
