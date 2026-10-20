// The one bridge the headless export needs (headlessExport.cjs): HTML → PDF bytes.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lvds', {
  files: {
    pdfBytes: (opts) => ipcRenderer.invoke('files:pdfBytes', opts)
  }
});
