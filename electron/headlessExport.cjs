// Exports for `lvds` (the command line) that need the app's renderer: drawing sheets as DXF
// (SLD, DB circuit, riser and earthing sheets, drawn by the app's React diagrams) and Export
// centre reports as PDF (Chromium print). No window is shown and nothing is saved here:
// the results go back to lvds, which checks the approval and writes the files.
//   electron electron/headlessExport.cjs --lvds-headless-export <job.json> <result.json>
//   "LV Design Studio" --lvds-headless-export <job.json> <result.json>   (installed app, via main.cjs)
// job: { kind: 'sheets-dxf' | 'report-pdf', project, … } (src/headless/rendererExport.ts)
// result: { ok: true, files: [{ name, about, base64 }] } or { ok: false, error }
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const check = require('./ipcValidate.cjs');
const { htmlToPdf } = require('./pdfRender.cjs');

const at = process.argv.indexOf('--lvds-headless-export');
const [jobFile, resultFile] = at >= 0 ? process.argv.slice(at + 1, at + 3) : [];
const TIMEOUT_MS = 10 * 60 * 1000;

// Its own profile: never the app's (which may be open), and nothing kept afterwards.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-headless-'));
app.setPath('userData', profile);
app.disableHardwareAcceleration();
if (process.platform === 'darwin') app.dock?.hide();

function finish(result) {
  try { if (resultFile) fs.writeFileSync(resultFile, JSON.stringify(result)); } catch (e) { console.error(e); process.exitCode = 1; }
  if (!result.ok) process.exitCode = 1;
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp folder */ }
  app.exit(process.exitCode ?? 0);
}

async function run() {
  if (!jobFile || !resultFile) throw new Error('Usage: --lvds-headless-export <job.json> <result.json>');
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf-8'));
  const index = path.join(__dirname, '..', 'dist', 'index.html');
  if (!fs.existsSync(index)) throw new Error(`The app is not built (${index} is missing): run "npm run build".`);
  // No device or browser permissions; nothing from the network.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  const win = new BrowserWindow({ show: false, width: 2400, height: 1400, webPreferences: { preload: path.join(__dirname, 'headlessPreload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('console-message', (e) => { if (e.level === 'error') console.error(`renderer: ${e.message}`); });
  win.webContents.ipc.handle('files:pdfBytes', (_evt, args) => htmlToPdf(check.pdfArgs(args)));
  try {
    await win.loadFile(index, { query: { 'lvds-export': '1' } });
    await win.webContents.executeJavaScript('new Promise((ok) => { const t = () => (window.__lvdsExport ? ok(true) : setTimeout(t, 25)); t(); })');
    const out = await win.webContents.executeJavaScript(`window.__lvdsExport(${JSON.stringify(job)})`);
    return { ok: true, files: out.files.map((f) => ({ name: f.name, about: f.about, base64: Buffer.from(typeof f.data === 'string' ? Buffer.from(f.data, 'utf-8') : f.data).toString('base64') })) };
  } finally {
    win.destroy();
  }
}

app.whenReady().then(() => {
  const timer = setTimeout(() => finish({ ok: false, error: `Export took longer than ${TIMEOUT_MS / 60000} minutes and was stopped.` }), TIMEOUT_MS);
  run().then(
    (result) => { clearTimeout(timer); finish(result); },
    (e) => { clearTimeout(timer); finish({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
  );
});
app.on('window-all-closed', () => { /* finish() quits */ });
