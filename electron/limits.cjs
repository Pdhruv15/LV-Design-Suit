// Size limits for what the main process reads, writes and passes to the calculation engine. One place,
// so the numbers are documented together and checked the same way everywhere. They sit far above real
// use (a project file is ~20 KB, a workbook ~15 KB) and stop a damaged or crafted file, or a runaway
// page, from filling memory or disk or blocking the app. Plain Node, so it can be unit tested.

const { readFileNoFollow } = require('./safeFs.cjs');

const MB = 1024 * 1024;
const LIMITS = Object.freeze({
  projectBytes: 50 * MB, // a project file, its .bak, a recovery copy, a deleted project
  settingsBytes: 1 * MB, // settings.json, the project list cache
  libraryBytes: 20 * MB, // Library.json
  workbookBytes: 20 * MB, // one .xlsx of the LV Database
  pdfHtmlBytes: 64 * MB, // HTML of one report to print as PDF
  textExportBytes: 64 * MB, // a text export (DXF, OpenDSS script…)
  binaryExportBytes: 128 * MB, // a binary export (xlsx, docx, pdf, zip)
  engineRequestBytes: 20 * MB, // what is sent to the Python engine
  engineStdoutBytes: 50 * MB, // the engine's answer
  engineStderrBytes: 64 * 1024, // the engine's error output (only the end is shown)
  jsonDepth: 64, // nesting of any JSON sent to the main process
  workbookRows: 2000, // rows in a workbook written from the app (the workbooks validate 2,000 rows)
  workbookColumns: 100, // fields in one row
  workbookCellChars: 10000 // characters in one cell
});

const human = (bytes) => (bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / 1024)} KB`);

class LimitError extends Error {}
const tooLarge = (what, max) => new LimitError(`${what} is too large (limit ${human(max)}).`);

/** Reads a file as a Buffer only when it is no larger than max bytes (checked on the open file, before
 * reading). A link at the file's own name is refused unless follow (a file the user picked). */
function readFileLimited(file, max, what = 'The file', { follow = false } = {}) {
  const r = readFileNoFollow(file, { max, what, follow });
  if (r.tooLarge) throw tooLarge(what, max);
  return r.buffer;
}

/** Reads a text file within max bytes (see readFileLimited). */
const readTextFileLimited = (file, max, what = 'The file', opts) => readFileLimited(file, max, what, opts).toString('utf-8');

/** Reads and parses a JSON file within max bytes. */
const readJsonLimited = (file, max, what, opts) => JSON.parse(readTextFileLimited(file, max, what, opts));

/** Bytes of a string as UTF-8. */
const utf8Bytes = (s) => Buffer.byteLength(s, 'utf-8');

/** Throws unless the string is within max bytes. */
function assertTextWithin(s, max, what) {
  // A UTF-8 character is at most 3 bytes per UTF-16 unit; only count when it could be over.
  if (s.length * 3 > max && utf8Bytes(s) > max) throw tooLarge(what, max);
}

/** Throws unless a JSON-like value nests no deeper than maxDepth and serializes within maxBytes.
 * Depth is checked first without recursion, so a deeply nested value cannot overflow the stack. */
function assertJsonWithin(value, maxBytes, what, maxDepth = LIMITS.jsonDepth) {
  const stack = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (d >= maxDepth) throw new LimitError(`${what} is nested too deeply.`);
    for (const k of Object.keys(v)) stack.push([v[k], d + 1]);
  }
  let text;
  try { text = JSON.stringify(value); } catch { throw new LimitError(`${what} is not plain data.`); }
  if (text !== undefined) assertTextWithin(text, maxBytes, what);
  return text;
}

/** Collects a child process stream up to max bytes. onOverflow runs once when the limit is passed;
 * keepTail keeps the last max bytes instead of the first (for error output). */
function boundedCollector(max, onOverflow, keepTail = false) {
  let chunks = [];
  let size = 0;
  let over = false;
  return {
    push(chunk) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (keepTail) {
        chunks.push(b);
        size += b.length;
        while (size > max && chunks.length > 1) size -= chunks.shift().length;
        if (size > max) { chunks = [b.subarray(b.length - max)]; size = max; }
        return;
      }
      if (over) return;
      if (size + b.length > max) { over = true; onOverflow(); return; }
      chunks.push(b);
      size += b.length;
    },
    text: () => Buffer.concat(chunks).toString('utf-8'),
    get overflowed() { return over; }
  };
}

module.exports = { LIMITS, LimitError, human, readFileLimited, readTextFileLimited, readJsonLimited, assertTextWithin, assertJsonWithin, utf8Bytes, boundedCollector };
