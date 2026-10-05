const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const database = require('./database.cjs');
const projectFiles = require('./projectFiles.cjs');

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
  const { projectsFolder, databaseFolder } = readSettings();
  database.setFolder(databaseFolder);
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
      nodeIntegration: false,
      sandbox: true
    }
  });

  // The app never navigates away or opens windows of its own: links to the
  // web open in the system browser, anything else is refused.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  // The app asks before closing with unsaved changes (beforeunload);
  // Electron leaves showing the question to us.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved changes',
      message: 'The project has unsaved changes.',
      detail: 'Close anyway? A recovery copy is kept, and the app offers it the next time it starts.'
    });
    if (choice === 0) e.preventDefault(); // preventDefault here lets the window close
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

/** The Excel database in its own folder (e.g. on Google Drive); projects stay where they are.
 * reset: back to "LV Database" inside the projects folder. */
ipcMain.handle('settings:chooseDatabaseFolder', async (_evt, reset) => {
  if (reset) { const { databaseFolder: _d, ...rest } = readSettings(); writeSettings(rest); return readSettings(); }
  const result = await dialog.showOpenDialog(win, {
    title: 'Choose the folder with the LV Database workbooks (e.g. a Google Drive folder)',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return readSettings();
  const settings = { ...readSettings(), databaseFolder: result.filePaths[0] };
  writeSettings(settings);
  return settings;
});

// ---- IPC: projects (plain JSON files, one per project) ----
ipcMain.handle('projects:list', () => {
  const folder = ensureProjectsFolder();
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.json'));
  const siblings = projectFiles.conflictSiblings(files);
  return files
    .map((f) => {
      const full = path.join(folder, f);
      const stat = fs.statSync(full);
      const meta = { file: f, name: f.replace(/\.json$/, ''), updatedAt: stat.mtimeMs };
      if (siblings[f]) meta.conflictOf = siblings[f];
      try {
        // What the projects dashboard shows (see metaOf in src/model/projectStore.ts).
        const p = JSON.parse(fs.readFileSync(full, 'utf-8'));
        const revs = Array.isArray(p.revisions) ? p.revisions : [];
        Object.assign(meta, {
          id: p.id,
          name: p.name || meta.name,
          status: p.status,
          owner: p.info && p.info.owner,
          plotNo: p.info && p.info.plotNo,
          area: p.info && p.info.area,
          revision: revs.length ? revs[revs.length - 1].id : undefined,
          updatedBy: p.updatedBy,
          boards: Array.isArray(p.boards) ? p.boards.length : undefined
        });
      } catch {}
      return meta;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
});

/** A project file inside the projects folder: a plain .json name, never a
 * path that leads outside it (e.g. "../x"). */
function projectPath(folder, file) {
  if (typeof file !== 'string' || !/^[^\\/:*?"<>|]+\.json$/i.test(file) || file.startsWith('.')) throw new Error(`Not a project file name: ${file}`);
  const full = path.resolve(folder, file);
  if (path.dirname(full) !== path.resolve(folder)) throw new Error(`Outside the projects folder: ${file}`);
  return full;
}

ipcMain.handle('projects:load', (_evt, file) => readProject(file).project);

/** The project and what the file was when it was read (to notice later changes made by someone else). */
ipcMain.handle('projects:read', (_evt, file) => readProject(file));

function readProject(file) {
  const full = projectPath(ensureProjectsFolder(), file);
  const text = fs.readFileSync(full, 'utf-8');
  const stamp = projectFiles.stampOf(full);
  try {
    return { project: JSON.parse(text), stamp };
  } catch (e) {
    // A damaged file: offer the last good version kept beside it.
    const bak = `${full}.bak`;
    if (fs.existsSync(bak)) {
      const p = JSON.parse(fs.readFileSync(bak, 'utf-8'));
      return { project: { ...p, _restoredFromBackup: true }, stamp };
    }
    throw new Error(`${file} is damaged and could not be read (${e.message}).`);
  }
}

ipcMain.handle('projects:stat', (_evt, file) => projectFiles.stampOf(projectPath(ensureProjectsFolder(), file)));

/** Saves a project. `expected` is what the file was when this app opened or last saved it; when the file
 * now holds something else (another computer, a sync tool, another program) nothing is written and the
 * answer is a conflict — unless `force`, which keeps the other version as name.json.theirs-….bak. */
ipcMain.handle('projects:save', (_evt, { file, data, expected, force }) => {
  const folder = ensureProjectsFolder();
  const idPart = String((data && data.id) || Date.now()).replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const safeFile = file || projectFiles.uniqueFileName(folder, `${slugify(data.name || 'untitled')}-${idPart}`);
  const full = projectPath(folder, safeFile);
  let conflicted = false;
  if (file) {
    const disk = projectFiles.stampOf(full);
    if (projectFiles.decideSave(expected, disk) === 'conflict') {
      if (!force) return { conflict: true, file: safeFile, disk };
      conflicted = true;
    }
  }
  const stamp = projectFiles.writeFileSafe(full, JSON.stringify(data, null, 2), { keepTheirs: conflicted, verifyJson: true });
  return { file: safeFile, stamp };
});

/** Open project…: pick a .json project anywhere. Inside the projects folder
 * it opens as that file; elsewhere its content opens as a new, unsaved
 * project (Save then keeps it in the projects folder). */
ipcMain.handle('projects:pick', async () => {
  const folder = ensureProjectsFolder();
  const result = await dialog.showOpenDialog(win, { title: 'Open project', defaultPath: folder, filters: [{ name: 'LV Design Studio project', extensions: ['json'] }], properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const full = result.filePaths[0];
  if (path.dirname(path.resolve(full)) === path.resolve(folder)) return { file: path.basename(full) };
  const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
  if (!data || !Array.isArray(data.boards)) throw new Error(`${path.basename(full)} is not an LV Design Studio project.`);
  return { data, from: full };
});

ipcMain.handle('projects:delete', (_evt, file) => {
  fs.unlinkSync(projectPath(ensureProjectsFolder(), file));
  return true;
});

// ---- IPC: recovery copies of unsaved work (autosave), one file per project ----
const recoveryDir = path.join(app.getPath('userData'), 'recovery');
const legacyRecoveryPath = path.join(app.getPath('userData'), 'recovery.json');
ipcMain.handle('recovery:write', (_evt, r) => projectFiles.writeRecovery(recoveryDir, r));
ipcMain.handle('recovery:readAll', () => projectFiles.readRecoveries(recoveryDir, ensureProjectsFolder(), legacyRecoveryPath));
ipcMain.handle('recovery:read', () => projectFiles.readRecoveries(recoveryDir, ensureProjectsFolder(), legacyRecoveryPath)[0] || null);
ipcMain.handle('recovery:clear', (_evt, id) => (id ? projectFiles.clearRecovery(recoveryDir, id) : true));

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
  if (watchedFolder !== database.folderFor(projectsFolder)) {
    stopWatching();
    watchedFolder = database.folderFor(projectsFolder);
    stopWatching = database.watchDatabase(projectsFolder, async () => {
      if (win && !win.isDestroyed()) win.webContents.send('database:changed', await database.readDatabase(projectsFolder));
    });
  }
  return { ...(await database.readDatabase(projectsFolder)), created };
}

ipcMain.handle('database:init', (_evt, seeds) => initDatabase(seeds));
ipcMain.handle('database:read', () => database.readDatabase(ensureProjectsFolder()));
ipcMain.handle('database:write', (_evt, bookId, rows) => database.writeBook(ensureProjectsFolder(), bookId, rows));
ipcMain.handle('database:library:read', () => database.readLibrary(ensureProjectsFolder()));
ipcMain.handle('database:library:write', (_evt, data) => database.writeLibrary(ensureProjectsFolder(), data));
ipcMain.handle('database:open', (_evt, file) => {
  const folder = database.folderFor(ensureProjectsFolder());
  // Only files the spec knows about, or the folder itself.
  const book = database.spec.books.find((b) => b.file === file);
  return shell.openPath(book ? path.join(folder, book.file) : folder);
});

// ---- IPC: render an HTML report to PDF ----
// Sheet sizes in inches (A-series); Electron knows A3/A4 by name only.
const SHEETS = { A1: { width: 33.11, height: 23.39 }, A2: { width: 23.39, height: 16.54 } };

ipcMain.handle('files:savePdf', async (_evt, { defaultName, html, pageSize = 'A4', landscape = true, cssPages = false }) => {
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
    const size = SHEETS[pageSize] ?? pageSize;
    // cssPages: the document sets its own page sizes and margins (@page),
    // e.g. A4 tables with A3 drawing pages in one file.
    const pdf = cssPages
      ? await pdfWin.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })
      : await pdfWin.webContents.printToPDF({ pageSize: size, landscape: SHEETS[pageSize] ? false : landscape, printBackground: true, margins: { marginType: pageSize === 'A4' ? 'default' : 'none' } });
    fs.writeFileSync(result.filePath, pdf);
    fs.rmSync(tmp, { force: true });
    return result.filePath;
  } finally {
    pdfWin.destroy();
  }
});

// ---- IPC: HTML → PDF bytes (no dialog), to merge several parts into one file ----
ipcMain.handle('files:pdfBytes', async (_evt, { html, pageSize = 'A4', landscape = true, cssPages = false }) => {
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, javascript: false } });
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
