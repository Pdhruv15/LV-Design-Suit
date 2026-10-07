// File handling for projects and recovery copies. Plain Node (no Electron), so
// it can be unit tested in a temporary folder (src/model/projectFiles.test.ts).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** A step that may fail without stopping the operation it belongs to (a backup copy, a cache, a
 * cleanup). A file that is not there is expected and stays quiet; any other failure is logged with
 * what was being done, never swallowed. Returns the step's result, or undefined when it failed. */
function bestEffort(what, fn) {
  try {
    return fn();
  } catch (e) {
    if (!(e && e.code === 'ENOENT')) console.warn(`[projects] ${what}: ${e && e.message ? e.message : e}`);
    return undefined;
  }
}

/** What a file is right now: modified time, size and a hash of its content. null when it does not exist. */
function stampOf(full) {
  try {
    const st = fs.statSync(full);
    return { mtimeMs: st.mtimeMs, size: st.size, hash: sha(fs.readFileSync(full, 'utf-8')) };
  } catch {
    return null;
  }
}

/** Whether a save may go ahead. `expected` is what the file was when this app opened or last saved it;
 * `disk` is what it is now. A file that is missing, or whose content is what we expect (even if a sync
 * tool touched its date), is safe to write. Anything else was changed by someone else: a conflict. */
function decideSave(expected, disk) {
  if (!disk || !expected) return 'write';
  return expected.hash === disk.hash ? 'write' : 'conflict';
}

/** Writes a file safely: to a temporary file first, flushed to disk, then renamed over the old one (a
 * crash or a sync mid-write never leaves a half-written file). The previous version is kept as
 * name.json.bak. With keepTheirs the previous version is also kept under its own timestamped name (an
 * overwrite after a conflict). The result is read back and checked before it is reported as saved. */
function writeFileSafe(full, text, opts = {}) {
  const { keepBackup = true, keepTheirs = false, verifyJson = false } = opts;
  const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text, 'utf-8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (fs.existsSync(full)) {
    if (keepBackup) bestEffort(`backup copy of ${path.basename(full)}`, () => fs.copyFileSync(full, `${full}.bak`));
    if (keepTheirs) bestEffort(`copy of the other version of ${path.basename(full)}`, () => fs.copyFileSync(full, `${full}.theirs-${Date.now()}.bak`));
  }
  fs.renameSync(tmp, full);
  const back = fs.readFileSync(full, 'utf-8');
  if (sha(back) !== sha(text)) throw new Error('The file was written but reading it back did not match; it may not have been saved correctly.');
  if (verifyJson) JSON.parse(back);
  return stampOf(full);
}

/** name.json, or name-2.json, name-3.json … when that is taken. */
function uniqueFileName(folder, base) {
  let file = `${base}.json`, n = 2;
  while (fs.existsSync(path.join(folder, file))) file = `${base}-${n++}.json`;
  return file;
}

/** Files that look like a sync tool's conflicted copy of another project file in the same list
 * ("x (John's conflicted copy 2026-10-05).json", "x (1).json", "x.sync-conflict-….json").
 * Maps each such file to the file it conflicts with (which must exist). */
function conflictSiblings(files) {
  const have = new Set(files.map((f) => f.toLowerCase()));
  const out = {};
  const patterns = [/^(.+?) \([^)]*conflicted copy[^)]*\)$/i, /^(.+?)\.sync-conflict-[\w-]+$/i, /^(.+?) \(\d+\)$/];
  for (const f of files) {
    const name = f.replace(/\.json$/i, '');
    for (const re of patterns) {
      const m = name.match(re);
      if (m && have.has(`${m[1]}.json`.toLowerCase()) && `${m[1]}.json`.toLowerCase() !== f.toLowerCase()) { out[f] = `${m[1]}.json`; break; }
    }
  }
  return out;
}

// ---- Recovery copies of unsaved work: one file per project -------------------

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
const recoveryFile = (dir, id) => path.join(dir, `${safeId(id)}.json`);

function writeRecovery(dir, r) {
  const id = r && (r.projectId || (r.project && r.project.id));
  if (!id) throw new Error('A recovery copy needs a project id');
  fs.mkdirSync(dir, { recursive: true });
  writeFileSafe(recoveryFile(dir, id), JSON.stringify({ ...r, projectId: id }), { keepBackup: false });
  return true;
}

function clearRecovery(dir, id) {
  bestEffort('remove the recovery copy', () => fs.unlinkSync(recoveryFile(dir, id)));
  return true;
}

/** Every recovery copy, newest first. An older single-file recovery (before one per project) is moved
 * into the folder. A copy whose project file was changed after the copy was made is flagged
 * (fileChangedSince), never dropped: the user decides. */
function readRecoveries(dir, projectsFolder, legacyFile) {
  if (legacyFile && fs.existsSync(legacyFile)) {
    bestEffort('move the older recovery copy', () => {
      const old = JSON.parse(fs.readFileSync(legacyFile, 'utf-8'));
      if (old && old.project) writeRecovery(dir, { ...old, projectId: (old.project && old.project.id) || 'legacy-single' });
    });
    bestEffort('remove the older recovery copy', () => fs.unlinkSync(legacyFile));
  }
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const list = [];
  for (const f of names) {
    const r = bestEffort(`read recovery copy ${f}`, () => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
    if (!r || !r.project || !Array.isArray(r.project.boards)) continue;
    // The project file may be gone (moved or deleted): then it has not changed since.
    const st = r.file && projectsFolder ? bestEffort(`check ${r.file}`, () => fs.statSync(path.join(projectsFolder, r.file))) : undefined;
    list.push({ ...r, fileChangedSince: st ? st.mtimeMs > r.at : false });
  }
  return list.sort((a, b) => b.at - a.at);
}

// ---- The projects list (what the dashboard shows), with a cache --------------

/** What the dashboard shows about a project file. Keep in step with metaOf in src/model/projectStore.ts
 * (a test compares them). */
function metaFromProject(file, p, updatedAt) {
  const revs = Array.isArray(p.revisions) ? p.revisions : [];
  return {
    file,
    id: p.id,
    name: p.name || file.replace(/\.json$/i, ''),
    updatedAt,
    status: p.status,
    owner: p.info && p.info.owner,
    consultant: p.info && p.info.consultant,
    contractor: p.info && p.info.contractor,
    plotNo: p.info && p.info.plotNo,
    area: p.info && p.info.area,
    revision: revs.length ? revs[revs.length - 1].id : undefined,
    updatedBy: p.updatedBy,
    boards: Array.isArray(p.boards) ? p.boards.length : undefined,
    createdAt: p.createdAt,
    archivedAt: p.archivedAt,
    tags: Array.isArray(p.tags) && p.tags.length ? p.tags : undefined
  };
}

/** The list of project files with their details. Each file is read and parsed only when its modified time or
 * size changed since the cache (a JSON file next to the app's data) was written, so a long list of large
 * projects opens quickly. Returns { list, parsed } (parsed = how many files were actually read). */
function listProjectsMeta(folder, cachePath) {
  let cache = {};
  cache = bestEffort('read the project list cache', () => JSON.parse(fs.readFileSync(cachePath, 'utf-8'))) || {};
  const files = fs.readdirSync(folder).filter((f) => f.endsWith('.json'));
  const next = {};
  let parsed = 0;
  const list = files.map((f) => {
    const st = fs.statSync(path.join(folder, f));
    const c = cache[f];
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) { next[f] = c; return { ...c.meta, updatedAt: st.mtimeMs }; }
    // A file that cannot be read is still listed, under its file name.
    let meta = bestEffort(`read ${f}`, () => metaFromProject(f, JSON.parse(fs.readFileSync(path.join(folder, f), 'utf-8')), st.mtimeMs));
    if (meta) parsed++;
    else meta = { file: f, name: f.replace(/\.json$/i, ''), updatedAt: st.mtimeMs };
    next[f] = { mtimeMs: st.mtimeMs, size: st.size, meta };
    return { ...meta };
  });
  const siblings = conflictSiblings(files);
  for (const m of list) if (siblings[m.file]) m.conflictOf = siblings[m.file];
  if (JSON.stringify(Object.keys(next).sort()) !== JSON.stringify(Object.keys(cache).sort()) || parsed) bestEffort('write the project list cache', () => fs.writeFileSync(cachePath, JSON.stringify(next)));
  return { list: list.sort((a, b) => b.updatedAt - a.updatedAt), parsed };
}

// ---- Trash: a deleted project stays recoverable for a while -------------------

const TRASH = '.trash';
const TRASH_DAYS = 30;
const trashDir = (folder) => path.join(folder, TRASH);
const trashName = (file, at) => `${at}__${file}`;
const splitTrashName = (name) => { const m = name.match(/^(\d+)__(.+)$/); return m ? { deletedAt: Number(m[1]), file: m[2] } : null; };

/** Moves a project file (and its .bak) to the trash folder. */
function moveToTrash(folder, file, now = Date.now()) {
  const dir = trashDir(folder);
  fs.mkdirSync(dir, { recursive: true });
  const name = trashName(file, now);
  fs.renameSync(path.join(folder, file), path.join(dir, name));
  bestEffort(`move ${file}.bak to the trash`, () => fs.renameSync(path.join(folder, `${file}.bak`), path.join(dir, `${name}.bak`)));
  return name;
}

/** Deleted projects, newest first, with their name and when they will be removed for good. */
function listTrash(folder, now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(trashDir(folder)).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const parts = splitTrashName(n);
    if (!parts) continue;
    let name = parts.file.replace(/\.json$/i, ''), id;
    const p = bestEffort(`read deleted project ${n}`, () => JSON.parse(fs.readFileSync(path.join(trashDir(folder), n), 'utf-8')));
    if (p) { if (p.name) name = p.name; id = p.id; }
    out.push({ trashFile: n, file: parts.file, name, id, deletedAt: parts.deletedAt, daysLeft: Math.max(0, Math.ceil(TRASH_DAYS - (now - parts.deletedAt) / 86400000)) });
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Puts a deleted project back in the projects folder (under a new name if the old one is taken). */
function restoreFromTrash(folder, trashFile) {
  const parts = splitTrashName(path.basename(trashFile));
  if (!parts) throw new Error(`Not a deleted project: ${trashFile}`);
  const src = path.join(trashDir(folder), path.basename(trashFile));
  const file = fs.existsSync(path.join(folder, parts.file)) ? uniqueFileName(folder, parts.file.replace(/\.json$/i, '')) : parts.file;
  fs.renameSync(src, path.join(folder, file));
  bestEffort(`restore ${file}.bak`, () => fs.renameSync(`${src}.bak`, path.join(folder, `${file}.bak`)));
  return file;
}

/** Removes what has been in the trash longer than `days` (all of it when days is 0). Returns how many. */
function purgeTrash(folder, days = TRASH_DAYS, now = Date.now()) {
  let n = 0;
  let names = [];
  try { names = fs.readdirSync(trashDir(folder)); } catch { return 0; }
  for (const f of names) {
    const parts = splitTrashName(f.replace(/\.bak$/, ''));
    if (!parts) continue;
    if (days === 0 || now - parts.deletedAt > days * 86400000) {
      if (bestEffort(`remove ${f} from the trash`, () => { fs.unlinkSync(path.join(trashDir(folder), f)); return true; }) && f.endsWith('.json')) n++;
    }
  }
  return n;
}

module.exports = { bestEffort, metaFromProject, listProjectsMeta, moveToTrash, listTrash, restoreFromTrash, purgeTrash, TRASH_DAYS, sha, stampOf, decideSave, writeFileSafe, uniqueFileName, conflictSiblings, writeRecovery, clearRecovery, readRecoveries, recoveryFile };
