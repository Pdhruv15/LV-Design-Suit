// File handling for projects and recovery copies. Plain Node (no Electron), so
// it can be unit tested in a temporary folder (src/model/projectFiles.test.ts).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

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
    if (keepBackup) { try { fs.copyFileSync(full, `${full}.bak`); } catch {} }
    if (keepTheirs) { try { fs.copyFileSync(full, `${full}.theirs-${Date.now()}.bak`); } catch {} }
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
  try { fs.unlinkSync(recoveryFile(dir, id)); } catch {}
  return true;
}

/** Every recovery copy, newest first. An older single-file recovery (before one per project) is moved
 * into the folder. A copy whose project file was changed after the copy was made is flagged
 * (fileChangedSince), never dropped: the user decides. */
function readRecoveries(dir, projectsFolder, legacyFile) {
  if (legacyFile && fs.existsSync(legacyFile)) {
    try {
      const old = JSON.parse(fs.readFileSync(legacyFile, 'utf-8'));
      if (old && old.project) writeRecovery(dir, { ...old, projectId: (old.project && old.project.id) || 'legacy-single' });
    } catch {}
    try { fs.unlinkSync(legacyFile); } catch {}
  }
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const list = [];
  for (const f of names) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      if (!r || !r.project || !Array.isArray(r.project.boards)) continue;
      let fileChangedSince = false;
      if (r.file && projectsFolder) {
        try { fileChangedSince = fs.statSync(path.join(projectsFolder, r.file)).mtimeMs > r.at; } catch {}
      }
      list.push({ ...r, fileChangedSince });
    } catch {}
  }
  return list.sort((a, b) => b.at - a.at);
}

module.exports = { sha, stampOf, decideSave, writeFileSafe, uniqueFileName, conflictSiblings, writeRecovery, clearRecovery, readRecoveries, recoveryFile };
