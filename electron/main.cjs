const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

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

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
