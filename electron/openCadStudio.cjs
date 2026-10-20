const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 20;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

function installationCandidates(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') {
    return [
      { kind: 'bundle', path: '/Applications/OpenCADStudio.app' },
      { kind: 'bundle', path: path.join(home, 'Applications', 'OpenCADStudio.app') }
    ];
  }
  if (platform === 'win32') {
    return [
      env.LOCALAPPDATA && { kind: 'executable', path: path.join(env.LOCALAPPDATA, 'Programs', 'OpenCADStudio', 'OpenCADStudio.exe') },
      env.ProgramFiles && { kind: 'executable', path: path.join(env.ProgramFiles, 'OpenCADStudio', 'OpenCADStudio.exe') },
      env['ProgramFiles(x86)'] && { kind: 'executable', path: path.join(env['ProgramFiles(x86)'], 'OpenCADStudio', 'OpenCADStudio.exe') }
    ].filter(Boolean);
  }
  return [
    { kind: 'executable', path: '/usr/bin/OpenCADStudio' },
    { kind: 'executable', path: '/usr/local/bin/OpenCADStudio' },
    { kind: 'executable', path: path.join(home, '.local', 'bin', 'OpenCADStudio') }
  ];
}

function findInstallation(options = {}) {
  const exists = options.existsSync || fs.existsSync;
  return installationCandidates(options.platform, options.home, options.env).find((candidate) => exists(candidate.path)) || null;
}

function executableForInstallation(installation, platform = process.platform, exists = fs.existsSync) {
  if (!installation) return null;
  if (platform === 'darwin' && installation.kind === 'bundle') {
    const inner = path.join(installation.path, 'Contents', 'MacOS', 'OpenCADStudio-App');
    const launcher = path.join(installation.path, 'Contents', 'MacOS', 'OpenCADStudio');
    return exists(inner) ? inner : launcher;
  }
  return installation.path;
}

function safeDxfName(value, index) {
  const base = path.basename(String(value || `drawing-${index + 1}.dxf`))
    .replace(/[^a-z0-9._ -]+/gi, '-')
    .replace(/^\.+/, '')
    .trim();
  const named = base || `drawing-${index + 1}.dxf`;
  return /\.dxf$/i.test(named) ? named : `${named}.dxf`;
}

function validateDxfFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('No DXF drawing was supplied.');
  if (files.length > MAX_FILES) throw new Error(`Open at most ${MAX_FILES} DXF drawings at a time.`);
  let total = 0;
  return files.map((file, index) => {
    if (!file || typeof file.content !== 'string') throw new Error(`DXF drawing ${index + 1} has no text content.`);
    const bytes = Buffer.byteLength(file.content, 'utf8');
    if (bytes > MAX_FILE_BYTES) throw new Error(`${safeDxfName(file.name, index)} is larger than 50 MB.`);
    total += bytes;
    if (total > MAX_TOTAL_BYTES) throw new Error('The DXF drawings are larger than 100 MB in total.');
    return { name: safeDxfName(file.name, index), content: file.content };
  });
}

function cleanupTemporaryDrawings(tempRoot, now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const parent = path.join(tempRoot, 'lv-design-studio', 'opencadstudio');
  let entries = [];
  try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('open-')) continue;
    const folder = path.join(parent, entry.name);
    try {
      if (now - fs.statSync(folder).mtimeMs > maxAgeMs) fs.rmSync(folder, { recursive: true, force: true });
    } catch { /* A live or externally removed handoff is harmless. */ }
  }
}

function writeTemporaryDrawings(tempRoot, files) {
  const valid = validateDxfFiles(files);
  const parent = path.join(tempRoot, 'lv-design-studio', 'opencadstudio');
  cleanupTemporaryDrawings(tempRoot);
  fs.mkdirSync(parent, { recursive: true });
  const folder = fs.mkdtempSync(path.join(parent, 'open-'));
  return valid.map((file) => {
    const destination = path.join(folder, file.name);
    fs.writeFileSync(destination, file.content, { encoding: 'utf8', flag: 'wx' });
    return destination;
  });
}

module.exports = {
  installationCandidates,
  findInstallation,
  executableForInstallation,
  safeDxfName,
  validateDxfFiles,
  cleanupTemporaryDrawings,
  writeTemporaryDrawings
};
