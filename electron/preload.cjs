const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lvds', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    chooseProjectsFolder: () => ipcRenderer.invoke('settings:chooseProjectsFolder')
  },
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    load: (file) => ipcRenderer.invoke('projects:load', file),
    save: (file, data) => ipcRenderer.invoke('projects:save', { file, data }),
    delete: (file) => ipcRenderer.invoke('projects:delete', file)
  },
  files: {
    saveText: (opts) => ipcRenderer.invoke('files:saveText', opts)
  }
});
