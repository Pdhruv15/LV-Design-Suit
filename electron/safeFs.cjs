// File operations that never follow a link planted inside the app's folders. Plain Node, unit tested in a
// temporary folder (src/model/safeFs.test.ts).
//
// - Reads open the file with O_NOFOLLOW (where the OS has it) and check type and size on the open
//   handle, so nothing changes between the check and the read.
// - Writes go to a new temporary file created exclusively (O_EXCL, private permissions) in the same
//   folder and are then renamed into place. A rename replaces a link itself, never the file it points
//   at, and keeps the replace atomic.
// - Backups are written the same way (read the source without following, write a new file, rename), so
//   a link at name.json.bak cannot redirect the copy.
// - Folders the app creates inside the user's folders (.trash, Backups, recovery) must be real folders.
//   The folders the user chose themselves may be links (e.g. into a cloud-sync folder); that is theirs.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const PRIVATE_FILE = 0o600;

class UnsafePathError extends Error {}

/** A random name next to `full` for a temporary file. */
const tempNameFor = (full) => `${full}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;

/** True when the path exists and is a symbolic link (not followed). */
function isLink(full) {
  try { return fs.lstatSync(full).isSymbolicLink(); } catch { return false; }
}

/** Throws when the path is a link or exists but is not a regular file. A missing file is fine. */
function assertNotLink(full, what = path.basename(full)) {
  let st;
  try { st = fs.lstatSync(full); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (st.isSymbolicLink()) throw new UnsafePathError(`${what} is a link, not a file; it is not opened or changed.`);
  if (!st.isFile()) throw new UnsafePathError(`${what} is not a file.`);
}

/** Reads a whole file as a Buffer without following a link at its own name, within max bytes.
 * follow: true for a file the user picked in a dialog (their choice, may be a link). */
function readFileNoFollow(full, { max = Infinity, what = path.basename(full), follow = false } = {}) {
  if (!follow) assertNotLink(full, what); // also covers systems without O_NOFOLLOW
  let fd;
  try {
    fd = fs.openSync(full, fs.constants.O_RDONLY | (follow ? 0 : NOFOLLOW));
  } catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EMLINK') throw new UnsafePathError(`${what} is a link, not a file; it is not opened.`);
    throw e;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new UnsafePathError(`${what} is not a file.`);
    if (st.size > max) return { tooLarge: true, size: st.size };
    return { buffer: fs.readFileSync(fd), size: st.size };
  } finally {
    fs.closeSync(fd);
  }
}

/** Writes data to a new file that must not exist yet (no link is followed), private to this user. */
function writeNewFile(full, data) {
  const fd = fs.openSync(full, 'wx', PRIVATE_FILE);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Permissions for a file the user sees (a project, a workbook, a backup): what the file has now, else the
 * usual default for a new file (read-write for the user, readable by others, as the umask allows). */
function publicModeFor(full) {
  try {
    const st = fs.lstatSync(full);
    if (st.isFile()) return st.mode & 0o777;
  } catch { /* new file */ }
  return 0o666 & ~process.umask();
}

/** Replaces `full` with `data` atomically: a new private temporary file in the same folder, renamed over
 * it. A link at `full` is replaced, not followed. mode: the finished file's permissions ('private' keeps
 * it readable by this user only, the default for the app's own files; 'public' see publicModeFor). */
function replaceFile(full, data, { mode = 'private' } = {}) {
  const finalMode = mode === 'public' ? publicModeFor(full) : PRIVATE_FILE;
  const tmp = tempNameFor(full);
  writeNewFile(tmp, data);
  try {
    if (finalMode !== PRIVATE_FILE) fs.chmodSync(tmp, finalMode);
    fs.renameSync(tmp, full);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

/** Copies src to dest without following a link at either name (dest is replaced atomically). */
function copyFileNoFollow(src, dest, max = Infinity, opts = { mode: 'public' }) {
  const r = readFileNoFollow(src, { max });
  if (r.tooLarge) throw new UnsafePathError(`${path.basename(src)} is too large to copy.`);
  replaceFile(dest, r.buffer, opts);
}

/** Makes sure `dir` (inside a folder the user chose) is a real folder, creating it if needed. */
function ensureRealDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new UnsafePathError(`${path.basename(dir)} is not a real folder; nothing is written there.`);
  return dir;
}

/** The regular files (not links, not folders) of a folder, by name, optionally filtered. */
function listFiles(dir, filter = () => true) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && filter(d.name)).map((d) => d.name);
}

/** A private temporary folder; remove it with removeDir when done. */
function makePrivateTempDir(prefix, base = require('node:os').tmpdir()) {
  return fs.mkdtempSync(path.join(base, prefix)); // created 0700, unpredictable name
}
const removeDir = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };

module.exports = { UnsafePathError, NOFOLLOW, PRIVATE_FILE, publicModeFor, isLink, assertNotLink, readFileNoFollow, writeNewFile, replaceFile, copyFileNoFollow, ensureRealDir, listFiles, makePrivateTempDir, removeDir, tempNameFor };
