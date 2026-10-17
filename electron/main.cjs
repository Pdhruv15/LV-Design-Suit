const { app, BrowserWindow, session, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const check = require('./ipcValidate.cjs');
const database = require('./database.cjs');
const projectFiles = require('./projectFiles.cjs');
const trust = require('./trust.cjs');
const { LIMITS, readTextFileLimited, readJsonLimited } = require('./limits.cjs');
const { runJsonProcess } = require('./engineRunner.cjs');
const safeFs = require('./safeFs.cjs');

const isDev = !app.isPackaged;
/** The app's own page: the bundled index.html, or in development the exact dev-server origin (LVDS_DEV_URL,
 * default http://127.0.0.1:5173). Development builds load from that server and must never be distributed. */
const DEV_ORIGIN = isDev ? trust.devUrlFrom() : undefined;
const ENTRY_FILE = path.join(__dirname, '..', 'dist', 'index.html');
const isAppUrl = trust.appUrlTest({ isDev, devOrigin: DEV_ORIGIN, entryFile: ENTRY_FILE });
const isAppOrigin = trust.appOriginTest({ isDev, devOrigin: DEV_ORIGIN });

// Settings file lives in the OS user-data folder (not synced) and stores
// only ONE thing: the path to the projects folder, which the user can
// point at a Google Drive / OneDrive / Dropbox sync folder.
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_PROJECTS = () => path.join(os.homedir(), 'LV Design Studio Projects');
/** Settings, with every field checked: a folder or program path is an absolute path, else it is left out
 * (a damaged settings file falls back to the defaults rather than crashing on a wrong type). */
function readSettings() {
  let raw;
  try { raw = readJsonLimited(settingsPath, LIMITS.settingsBytes, 'settings.json'); } catch { raw = {}; }
  const absPath = (v) => (typeof v === 'string' && v.length < 4096 && path.isAbsolute(v) ? v : undefined);
  const out = { projectsFolder: absPath(raw && raw.projectsFolder) || DEFAULT_PROJECTS() };
  const db = absPath(raw && raw.databaseFolder);
  const py = absPath(raw && raw.pythonPath);
  if (db) out.databaseFolder = db;
  if (py) out.pythonPath = py;
  return out;
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  safeFs.replaceFile(settingsPath, JSON.stringify(settings, null, 2)); // atomic, private, never through a link
}

function ensureProjectsFolder() {
  const { projectsFolder, databaseFolder } = readSettings();
  database.setFolder(databaseFolder);
  fs.mkdirSync(projectsFolder, { recursive: true });
  return projectsFolder;
}

let win;

/** Every IPC handler goes through this: only the app's own page in its main window, top frame, may call. */
const handle = trust.trustedHandler(ipcMain, () => win, isAppUrl, (channel, why) => console.warn(`[lvds] refused IPC ${channel}: ${why}`));
/** The window a dialog belongs to: the (already checked) sender's. */
const ownerOf = (evt) => BrowserWindow.fromWebContents(evt.sender) ?? win;

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
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });

  // The app never navigates away or opens windows of its own: links to the
  // web open in the system browser, anything else is refused.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = trust.externalUrl(url);
    if (external) shell.openExternal(external);
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
      if (!url.startsWith(DEV_ORIGIN)) return;
      const html = `<body style="background:#0a1120;color:#dbe4f5;font:15px system-ui;padding:40px">
        <h2>Waiting for the dev server…</h2>
        <p>The app screens come from the Vite dev server at ${DEV_ORIGIN}, which isn't running.</p>
        <p>Start the app with <code>npm run dev</code> from the project folder. This window retries every 3 seconds.</p></body>`;
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      setTimeout(() => !win.isDestroyed() && win.loadURL(DEV_ORIGIN), 3000);
    });
    win.loadURL(DEV_ORIGIN);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(ENTRY_FILE);
  }
}

app.whenReady().then(() => {
  // Pages get no device or browser permissions (camera, location, notifications…) except writing to the
  // clipboard, and only the app's own page in its main window gets that.
  const allowed = check.ALLOWED_PERMISSIONS;
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) =>
    callback(trust.permissionRequestOk({ wc, win, permission, requestingUrl: (details && details.requestingUrl) || wc.getURL(), allowed, isAppUrl })));
  session.defaultSession.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
    trust.permissionCheckOk({ wc, win, permission, requestingOrigin, allowed, isAppOrigin }));
  ensureProjectsFolder();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Any other web contents (the hidden PDF windows, anything unexpected): no webviews, no new windows.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: settings ----
handle('settings:get', () => readSettings());

handle('settings:chooseProjectsFolder', async (evt) => {
  const result = await dialog.showOpenDialog(ownerOf(evt), {
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
handle('settings:chooseDatabaseFolder', async (evt, reset) => {
  if (reset === true) { const { databaseFolder: _d, ...rest } = readSettings(); writeSettings(rest); return readSettings(); }
  const result = await dialog.showOpenDialog(ownerOf(evt), {
    title: 'Choose the folder with the LV Database workbooks (e.g. a Google Drive folder)',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return readSettings();
  const settings = { ...readSettings(), databaseFolder: result.filePaths[0] };
  writeSettings(settings);
  return settings;
});

// ---- IPC: projects (plain JSON files, one per project) ----
const projectsIndexPath = path.join(app.getPath('userData'), 'projects-index.json');
let trashPurged = false;
handle('projects:list', () => {
  const folder = ensureProjectsFolder();
  if (!trashPurged) { trashPurged = true; projectFiles.bestEffort('empty the trash', () => projectFiles.purgeTrash(folder)); } // once per run: what has been deleted for 30 days goes
  return projectFiles.listProjectsMeta(folder, projectsIndexPath).list;
});

/** A project file inside the projects folder: a plain .json name, never a
 * path that leads outside it (e.g. "../x"). */
function projectPath(folder, file) {
  if (typeof file !== 'string' || !/^[^\\/:*?"<>|]+\.json$/i.test(file) || file.startsWith('.')) throw new Error(`Not a project file name: ${file}`);
  const full = path.resolve(folder, file);
  if (path.dirname(full) !== path.resolve(folder)) throw new Error(`Outside the projects folder: ${file}`);
  safeFs.assertNotLink(full, file); // a link in the projects folder is never opened, saved over or deleted
  return full;
}

handle('projects:load', (_evt, file) => readProject(file).project);

/** The project and what the file was when it was read (to notice later changes made by someone else). */
handle('projects:read', (_evt, file) => readProject(file));

function readProject(file) {
  const full = projectPath(ensureProjectsFolder(), file);
  const text = readTextFileLimited(full, LIMITS.projectBytes, file);
  const stamp = projectFiles.stampOf(full);
  try {
    return { project: JSON.parse(text), stamp };
  } catch (e) {
    // A damaged file: offer the last good version kept beside it.
    const bak = `${full}.bak`;
    if (fs.existsSync(bak)) {
      let p;
      try { p = readJsonLimited(bak, LIMITS.projectBytes, `${file}.bak`); } catch (e2) {
        throw new Error(`${file} is damaged and could not be read (${e.message}); its backup ${file}.bak is damaged too (${e2.message}).`);
      }
      return { project: { ...p, _restoredFromBackup: true }, stamp };
    }
    throw new Error(`${file} is damaged and could not be read (${e.message}).`);
  }
}

handle('projects:stat', (_evt, file) => projectFiles.stampOf(projectPath(ensureProjectsFolder(), file)));

/** Saves a project. `expected` is what the file was when this app opened or last saved it; when the file
 * now holds something else (another computer, a sync tool, another program) nothing is written and the
 * answer is a conflict — unless `force`, which keeps the other version as name.json.theirs-….bak. */
handle('projects:save', (_evt, args) => {
  const { file, data, expected, force } = check.projectSaveArgs(args);
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
handle('projects:pick', async (evt) => {
  const folder = ensureProjectsFolder();
  const result = await dialog.showOpenDialog(ownerOf(evt), { title: 'Open project', defaultPath: folder, filters: [{ name: 'LV Design Studio project', extensions: ['json'] }], properties: ['openFile'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const full = result.filePaths[0];
  if (path.dirname(path.resolve(full)) === path.resolve(folder)) return { file: path.basename(full) };
  let data;
  try { data = readJsonLimited(full, LIMITS.projectBytes, path.basename(full), { follow: true }); } catch (e) { throw new Error(`${path.basename(full)} could not be read as a project (${e.message}).`); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.boards) || !Array.isArray(data.feeders)) throw new Error(`${path.basename(full)} is not an LV Design Studio project.`);
  return { data, from: full };
});

/** Delete moves the project to the trash folder (kept 30 days, restorable). */
handle('projects:delete', (_evt, file) => {
  projectFiles.moveToTrash(ensureProjectsFolder(), path.basename(projectPath(ensureProjectsFolder(), file)));
  return true;
});
handle('projects:trashList', () => projectFiles.listTrash(ensureProjectsFolder()));
handle('projects:restore', (_evt, trashFile) => projectFiles.restoreFromTrash(ensureProjectsFolder(), trashFile));
handle('projects:emptyTrash', () => projectFiles.purgeTrash(ensureProjectsFolder(), 0));

// ---- IPC: recovery copies of unsaved work (autosave), one file per project ----
const recoveryDir = path.join(app.getPath('userData'), 'recovery');
const legacyRecoveryPath = path.join(app.getPath('userData'), 'recovery.json');
handle('recovery:write', (_evt, r) => projectFiles.writeRecovery(recoveryDir, check.recoveryArgs(r)));
handle('recovery:readAll', () => projectFiles.readRecoveries(recoveryDir, ensureProjectsFolder(), legacyRecoveryPath));
handle('recovery:read', () => projectFiles.readRecoveries(recoveryDir, ensureProjectsFolder(), legacyRecoveryPath)[0] || null);
handle('recovery:clear', (_evt, id) => (typeof id === 'string' && id ? projectFiles.clearRecovery(recoveryDir, id) : true));

// ---- IPC: export a generated text file (e.g. OpenDSS script) ----
handle('files:saveText', async (evt, args) => {
  const { defaultName, content, filter } = check.saveTextArgs(args);
  const result = await dialog.showSaveDialog(ownerOf(evt), {
    title: 'Export',
    defaultPath: path.join(ensureProjectsFolder(), defaultName),
    filters: [filter]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return result.filePath;
});

// ---- IPC: export a generated binary file (e.g. an .xlsx workbook) ----
handle('files:saveBinary', async (evt, args) => {
  const { defaultName, bytes, filter } = check.saveBinaryArgs(args);
  const result = await dialog.showSaveDialog(ownerOf(evt), {
    title: 'Export',
    defaultPath: path.join(ensureProjectsFolder(), defaultName),
    filters: [filter]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, bytes);
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

handle('database:init', (_evt, seeds) => initDatabase(seeds));
handle('database:read', () => database.readDatabase(ensureProjectsFolder()));
handle('database:write', (_evt, bookId, rows) => database.writeBook(ensureProjectsFolder(), bookId, check.workbookRows(bookId, rows)));
handle('database:library:read', () => database.readLibrary(ensureProjectsFolder()));
handle('database:library:write', (_evt, data) => database.writeLibrary(ensureProjectsFolder(), check.libraryData(data)));
handle('database:open', (_evt, file) => {
  const folder = database.folderFor(ensureProjectsFolder());
  // Only files the spec knows about, or the folder itself.
  const book = database.spec.books.find((b) => b.file === file);
  return shell.openPath(book ? path.join(folder, book.file) : folder);
});

// ---- IPC: render an HTML report to PDF ----
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
// Sheet sizes in inches (A-series); Electron knows A3/A4 by name only.
const SHEETS = { A1: { width: 33.11, height: 23.39 }, A2: { width: 23.39, height: 16.54 } };

handle('files:savePdf', async (evt, args) => {
  const { defaultName, html, pageSize, landscape, cssPages } = check.pdfArgs(args);
  const result = await dialog.showSaveDialog(ownerOf(evt), {
    title: 'Save PDF report',
    defaultPath: path.join(ensureProjectsFolder(), defaultName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePath) return null;
  // Render in a hidden window with no preload/bridge: the report is plain
  // HTML generated by the app and never needs Node or IPC access.
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, webSecurity: true, session: pdfSession() } });
  pdfWin.webContents.on('will-navigate', (e) => e.preventDefault());
  // The HTML goes in a private temporary folder (unpredictable name, this user only), removed afterwards.
  const tmpDir = safeFs.makePrivateTempDir('lvds-pdf-');
  try {
    const tmp = path.join(tmpDir, 'report.html');
    safeFs.writeNewFile(tmp, html);
    await pdfWin.loadFile(tmp);
    const size = SHEETS[pageSize] ?? pageSize;
    // cssPages: the document sets its own page sizes and margins (@page),
    // e.g. A4 tables with A3 drawing pages in one file.
    const pdf = cssPages
      ? await pdfWin.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })
      : await pdfWin.webContents.printToPDF({ pageSize: size, landscape: SHEETS[pageSize] ? false : landscape, printBackground: true, margins: { marginType: pageSize === 'A4' ? 'default' : 'none' } });
    fs.writeFileSync(result.filePath, pdf);
    return result.filePath;
  } finally {
    pdfWin.destroy();
    safeFs.removeDir(tmpDir);
  }
});

// ---- IPC: HTML → PDF bytes (no dialog), to merge several parts into one file ----
handle('files:pdfBytes', async (_evt, args) => {
  const { html, pageSize, landscape, cssPages } = check.pdfArgs(args);
  const pdfWin = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false, webSecurity: true, session: pdfSession() } });
  pdfWin.webContents.on('will-navigate', (e) => e.preventDefault());
  const tmpDir = safeFs.makePrivateTempDir('lvds-pdf-');
  const tmp = path.join(tmpDir, 'part.html');
  try {
    safeFs.writeNewFile(tmp, html);
    await pdfWin.loadFile(tmp);
    const size = SHEETS[pageSize] ?? pageSize;
    const pdf = cssPages
      ? await pdfWin.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true })
      : await pdfWin.webContents.printToPDF({ pageSize: size, landscape: SHEETS[pageSize] ? false : landscape, printBackground: true, margins: { marginType: pageSize === 'A4' ? 'default' : 'none' } });
    return new Uint8Array(pdf);
  } finally {
    pdfWin.destroy();
    safeFs.removeDir(tmpDir);
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

/** The Python engine, run once per request (bounded output, timeout, settles exactly once). */
const runEngine = (request, timeoutMs = 120000) => runJsonProcess({ command: pythonPath(), args: [engineScript], input: request, timeoutMs, what: 'Engine', startError: (m) => `Could not start Python (${pythonPath()}): ${m}` });

handle('engines:probe', () => runEngine({ engine: 'probe' }, 30000));
handle('engines:run', (_evt, request) => runEngine(check.engineRequest(request)));

handle('settings:choosePython', async (evt) => {
  const result = await dialog.showOpenDialog(ownerOf(evt), {
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
