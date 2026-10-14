// Checks on what the renderer sends over IPC. The renderer is the app's own code, but it shows content from
// project files and workbooks, so the main process does not trust payload shapes: each handler takes only
// the fields it needs, of the type it expects, and anything else is refused with a plain message.

const path = require('node:path');

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (what) => { throw new Error(`Refused: ${what}`); };

/** A file name for a save dialog's default: the last path part only, no control characters. */
function defaultFileName(v, fallback = 'export') {
  const s = typeof v === 'string' ? [...path.basename(v.replace(/\\/g, '/'))].filter((c) => c >= ' ' && !'<>:"|?*'.includes(c)).join('').trim() : '';
  return s && s !== '.' && s !== '..' ? s.slice(0, 200) : fallback;
}

/** Save-dialog filter: a short label and 1–10 plain extensions. */
function fileFilter(name, extensions) {
  if (!Array.isArray(extensions) || !extensions.length || extensions.length > 10 || !extensions.every((e) => typeof e === 'string' && /^[a-z0-9]{1,10}$/i.test(e))) fail('file type list');
  return { name: typeof name === 'string' && name.trim() ? name.slice(0, 80) : 'File', extensions };
}

function saveTextArgs(a) {
  if (!isObj(a) || typeof a.content !== 'string') fail('text export without text content');
  return { defaultName: defaultFileName(a.defaultName), content: a.content, filter: fileFilter(a.filterName, a.extensions) };
}

function saveBinaryArgs(a) {
  if (!isObj(a) || !(ArrayBuffer.isView(a.bytes) || a.bytes instanceof ArrayBuffer)) fail('binary export without bytes');
  return { defaultName: defaultFileName(a.defaultName), bytes: Buffer.from(ArrayBuffer.isView(a.bytes) ? a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + a.bytes.byteLength) : a.bytes), filter: fileFilter(a.filterName, a.extensions) };
}

const PAGE_SIZES = ['A4', 'A3', 'A2', 'A1'];

/** HTML → PDF options: HTML text, a known sheet size, true/false flags. */
function pdfArgs(a) {
  if (!isObj(a) || typeof a.html !== 'string') fail('PDF without HTML content');
  const pageSize = a.pageSize === undefined ? 'A4' : a.pageSize;
  if (!PAGE_SIZES.includes(pageSize)) fail(`PDF sheet size ${String(pageSize)}`);
  return { defaultName: defaultFileName(a.defaultName, 'report.pdf'), html: a.html, pageSize, landscape: a.landscape === undefined ? true : !!a.landscape, cssPages: !!a.cssPages };
}

/** Project save: the project data must look like a project; file, expected and force as their types. */
function projectSaveArgs(a) {
  if (!isObj(a) || !isObj(a.data) || !Array.isArray(a.data.boards) || !Array.isArray(a.data.feeders)) fail('saving something that is not a project');
  if (a.file !== undefined && a.file !== null && typeof a.file !== 'string') fail('project file name');
  return { file: a.file || undefined, data: a.data, expected: a.expected, force: a.force === true };
}

function recoveryArgs(r) {
  if (!isObj(r) || !isObj(r.project) || !Array.isArray(r.project.boards)) fail('recovery copy without a project');
  return r;
}

/** Workbook rows: a list of plain objects. */
function workbookRows(bookId, rows) {
  if (typeof bookId !== 'string') fail('workbook name');
  if (!Array.isArray(rows) || !rows.every(isObj)) fail(`rows for ${bookId}`);
  return rows;
}

function libraryData(d) {
  if (!isObj(d)) fail('library data');
  return d;
}

/** External-engine request: one of the known engines, with what that engine needs. */
function engineRequest(r) {
  if (!isObj(r) || !['probe', 'opendss', 'pandapower'].includes(r.engine)) fail('unknown calculation engine');
  if (r.engine !== 'probe' && !isObj(r.project)) fail('engine request without a project');
  if (r.engine === 'opendss' && typeof r.dss !== 'string') fail('OpenDSS request without a script');
  return r;
}

/** Permissions the app's pages may be granted (everything else, e.g. camera, location, notifications, is denied). */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

module.exports = { defaultFileName, fileFilter, saveTextArgs, saveBinaryArgs, pdfArgs, projectSaveArgs, recoveryArgs, workbookRows, libraryData, engineRequest, ALLOWED_PERMISSIONS, PAGE_SIZES };
