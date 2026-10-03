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
    delete: (file) => ipcRenderer.invoke('projects:delete', file),
    pick: () => ipcRenderer.invoke('projects:pick')
  },
  recovery: {
    write: (r) => ipcRenderer.invoke('recovery:write', r),
    read: () => ipcRenderer.invoke('recovery:read'),
    clear: () => ipcRenderer.invoke('recovery:clear')
  },
  database: {
    init: (seeds) => ipcRenderer.invoke('database:init', seeds),
    read: () => ipcRenderer.invoke('database:read'),
    open: (file) => ipcRenderer.invoke('database:open', file),
    write: (bookId, rows) => ipcRenderer.invoke('database:write', bookId, rows),
    readLibrary: () => ipcRenderer.invoke('database:library:read'),
    writeLibrary: (data) => ipcRenderer.invoke('database:library:write', data),
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
    savePdf: (opts) => ipcRenderer.invoke('files:savePdf', opts),
    pdfBytes: (opts) => ipcRenderer.invoke('files:pdfBytes', opts)
  }
});
