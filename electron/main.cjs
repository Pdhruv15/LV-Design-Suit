const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const database = require('./database.cjs');

const isDev = !app.isPackaged;

// Settings file lives in the OS user-data folder (not synced) and stores
// only ONE thing: the path to the projects folder, which the user can
// point at a Google Drive / OneDrive / Dropbox sync folder.
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return { projectsFolder: path.join(os.homedir(), 'LV Design Studio Projects') };
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

function ensureProjectsFolder() {
  const { projectsFolder } = readSettings();
  fs.mkdirSync(projectsFolder, { recursive: true });
  return projectsFolder;
}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0a1120',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    // If the Vite dev server isn't running the window would stay blank, so
    // explain what's wrong and retry until the server comes up.
    win.webContents.on('did-fail-load', (_e, _code, _desc, url) => {
      if (!url.startsWith('http://localhost:5173')) return;
      const html = `<body style="background:#0a1120;color:#dbe4f5;font:15px system-ui;padding:40px">
        <h2>Waiting for the dev server…</h2>
        <p>The app screens come from the Vite dev server at http://localhost:5173, which isn't running.</p>
        <p>Start the app with <code>npm run dev</code> from the project folder. This window retries every 3 seconds.</p></body>`;
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      setTimeout(() => !win.isDestroyed() && win.loadURL('http://localhost:5173'), 3000);
    });
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ensureProjectsFolder();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: settings ----
ipcMain.handle('settings:get', () => readSettings());

ipcMain.handle('settings:chooseProjectsFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose folder for project files (e.g. a Google Drive synced folder)',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return readSettings();
  const settings = { ...readSettings(), projectsFolder: result.filePaths[0] };
  writeSettings(settings);
  return settings;
});

// ---- IPC: projects (plain JSON files, one per project) ----
ipcMain.handle('projects:list', () => {
  const folder = ensureProjectsFolder();
  return fs
    .readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const full = path.join(folder, f);
      const stat = fs.statSync(full);
      let name = f.replace(/\.json$/, '');
      try {
        const parsed = JSON.parse(fs.readFileSync(full, 'utf-8'));
        if (parsed.name) name = parsed.name;
      } catch {}
      return { file: f, name, updatedAt: stat.mtimeMs };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
});

ipcMain.handle('projects:load', (_evt, file) => {
  const folder = ensureProjectsFolder();
  const full = path.join(folder, file);
  return JSON.parse(fs.readFileSync(full, 'utf-8'));
});

ipcMain.handle('projects:save', (_evt, { file, data }) => {
  const folder = ensureProjectsFolder();
  const safeFile = file || `${slugify(data.name || 'untitled')}-${Date.now()}.json`;
  const full = path.join(folder, safeFile);
  fs.writeFileSync(full, JSON.stringify(data, null, 2), 'utf-8');
  return { file: safeFile };
});

ipcMain.handle('projects:delete', (_evt, file) => {
  const folder = ensureProjectsFolder();
  fs.unlinkSync(path.join(folder, file));
  return true;
});

// ---- IPC: export a generated text file (e.g. OpenDSS script) ----
ipcMain.handle('files:saveText', async (_evt, { defaultName, content, filterName, extensions }) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: path.join(ensureProjectsFolder(), defaultName),
    filters: [{ name: filterName, extensions }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return result.filePath;
});

// ---- IPC: export a generated binary file (e.g. an .xlsx workbook) ----
ipcMain.handle('files:saveBinary', async (_evt, { defaultName, bytes, filterName, extensions }) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: path.join(ensureProjectsFolder(), defaultName),
    filters: [{ name: filterName, extensions }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, Buffer.from(bytes));
  return result.filePath;
});

// ---- IPC: LV Database (Excel workbooks in the projects folder) ----
let stopWatching = () => {};
let watchedFolder = null;

async function initDatabase(seeds) {
  const projectsFolder = ensureProjectsFolder();
  const { created } = await database.ensureDatabase(projectsFolder, seeds);
  if (watchedFolder !== projectsFolder) {
    stopWatching();
    watchedFolder = projectsFolder;
    stopWatching = database.watchDatabase(projectsFolder, async () => {
      if (win && !win.isDestroyed()) win.webContents.send('database:changed', await database.readDatabase(projectsFolder));
    });
  }
  return { ...(await database.readDatabase(projectsFolder)), created };
}

ipcMain.handle('database:init', (_evt, seeds) => initDatabase(seeds));
ipcMain.handle('database:read', () => database.readDatabase(ensureProjectsFolder()));
ipcMain.handle('database:open', (_evt, file) => {
  const folder = database.folderFor(ensureProjectsFolder());
  // Only files the spec knows about, or the folder itself.
  const book = database.spec.books.find((b) => b.file === file);
  return shell.openPath(book ? path.join(folder, book.file) : folder);
});

// ---- IPC: render an HTML report to PDF ----
ipcMain.handle('files:savePdf', async (_evt, { defaultName, html }) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Save PDF report',
    defaultPath: path.join(ensureProjectsFolder(), defaultName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePath) return null;
  // Render in a hidden window with no preload/bridge: the report is plain
  // HTML generated by the app and never needs Node or IPC access.
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, javascript: false } });
  try {
    const tmp = path.join(os.tmpdir(), `lvds-report-${Date.now()}.html`);
    fs.writeFileSync(tmp, html, 'utf-8');
    await pdfWin.loadFile(tmp);
    const pdf = await pdfWin.webContents.printToPDF({ pageSize: 'A4', landscape: true, printBackground: true, margins: { marginType: 'default' } });
    fs.writeFileSync(result.filePath, pdf);
    fs.rmSync(tmp, { force: true });
    return result.filePath;
  } finally {
    pdfWin.destroy();
  }
});

// ---- IPC: external calculation engines (Python helper) ----
// engines/python/lvds_engine.py runs OpenDSS (OpenDSSDirect.py) and
// pandapower. It reads one JSON request on stdin and answers on stdout.
const engineScript = isDev
  ? path.join(__dirname, '..', 'engines', 'python', 'lvds_engine.py')
  : path.join(process.resourcesPath, 'python', 'lvds_engine.py');

function pythonPath() {
  return readSettings().pythonPath || (process.platform === 'win32' ? 'python' : 'python3');
}

function runEngine(request, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(pythonPath(), [engineScript], { windowsHide: true });
    } catch (e) {
      resolve({ error: `Could not start Python (${pythonPath()}): ${e.message}` });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      resolve({ error: `Engine timed out after ${timeoutMs / 1000} s` });
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ error: `Could not start Python (${pythonPath()}): ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ error: `Engine exited with code ${code}. ${stderr.trim().split(/\r?\n/).slice(-3).join(' ')}` });
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

ipcMain.handle('engines:probe', () => runEngine({ engine: 'probe' }, 30000));
ipcMain.handle('engines:run', (_evt, request) => runEngine(request));

ipcMain.handle('settings:choosePython', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose the Python executable that has OpenDSSDirect.py / pandapower installed',
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return readSettings();
  const settings = { ...readSettings(), pythonPath: result.filePaths[0] };
  writeSettings(settings);
  return settings;
});

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
