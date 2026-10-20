// HTML → PDF bytes with Chromium's print, the same for the app (files:pdfBytes) and the
// headless export (headlessExport.cjs). The HTML is the app's own report; it is shown in a
// hidden window with no preload, no Node and no scripts.
const { BrowserWindow, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Sheet sizes in inches (A-series); Electron knows A3/A4 by name only.
const SHEETS = { A1: { width: 33.11, height: 23.39 }, A2: { width: 23.39, height: 16.54 } };

/** Reports render in their own session that loads nothing from the network: only the local report file
 * and data: images it carries. */
let pdfSess;
function pdfSession() {
  if (pdfSess) return pdfSess;
  pdfSess = session.fromPartition('lvds-pdf');
  pdfSess.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file|data|blob):/i.test(details.url) }));
  pdfSess.setPermissionRequestHandler((_wc, _p, callback) => callback(false));
  pdfSess.setPermissionCheckHandler(() => false);
  return pdfSess;
}

/** args: checked by ipcValidate.pdfArgs. cssPages: the document sets its own page sizes and margins (@page). */
async function htmlToPdf({ html, pageSize, landscape, cssPages }) {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, webSecurity: true, session: pdfSession() } });
  pdfWin.webContents.on('will-navigate', (e) => e.preventDefault());
  const tmp = path.join(os.tmpdir(), `lvds-part-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  try {
    fs.writeFileSync(tmp, html, 'utf-8');
    await pdfWin.loadFile(tmp);
    const size = SHEETS[pageSize] ?? pageSize;
    const pdf = cssPages
      ? await pdfWin.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })
      : await pdfWin.webContents.printToPDF({ pageSize: size, landscape: SHEETS[pageSize] ? false : landscape, printBackground: true, margins: { marginType: pageSize === 'A4' ? 'default' : 'none' } });
    return new Uint8Array(pdf);
  } finally {
    fs.rmSync(tmp, { force: true });
    pdfWin.destroy();
  }
}

module.exports = { htmlToPdf, pdfSession, SHEETS };
