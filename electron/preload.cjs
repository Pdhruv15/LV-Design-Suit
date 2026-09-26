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
  engines: {
    probe: () => ipcRenderer.invoke('engines:probe'),
    run: (request) => ipcRenderer.invoke('engines:run', request)
  },
  files: {
    saveText: (opts) => ipcRenderer.invoke('files:saveText', opts),
    savePdf: (opts) => ipcRenderer.invoke('files:savePdf', opts)
  }
});
