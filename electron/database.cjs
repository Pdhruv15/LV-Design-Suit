// LV Database: a folder of Excel workbooks (loads, cables, breakers,
// parameters) inside the projects folder, so it syncs through Google Drive
// and can be edited in Excel. The app creates any missing workbook (never
// overwrites one), reads them, and watches the folder for saves.
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const spec = require('./databaseSpec.json');

const MAX_ROWS = 2000; // rows given data validation in new workbooks

// The database folder: its own setting when chosen (e.g. a Google Drive
// folder shared with the team), else "LV Database" inside the projects folder.
let override = null;
const setFolder = (dir) => { override = dir || null; };
const folderFor = (projectsFolder) => override || path.join(projectsFolder, spec.folderName);

/** Plain value of an ExcelJS cell (formula results, rich text, hyperlinks). */
function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if (v instanceof Date) return v.toISOString();
  }
  return v;
}

async function createWorkbook(file, book, seedRows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  const ws = wb.addWorksheet(book.sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = book.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4F8F' } };
  header.alignment = { vertical: 'middle' };
  // Seed rows first: adding validation to empty rows makes ExcelJS treat
  // them as used, so rows added afterwards would land below row 2000.
  for (const row of seedRows ?? []) ws.addRow(row);
  book.columns.forEach((c, i) => {
    if (!c.list && !c.number) return;
    const letter = ws.getColumn(i + 1).letter;
    // Dropdown lists; numbers must be numbers (a typo is stopped by Excel).
    const rule = c.list
      ? { type: 'list', allowBlank: true, formulae: [`"${c.list.join(',').replace(/"/g, '""')}"`] }
      : { type: 'decimal', allowBlank: true, operator: 'greaterThanOrEqual', formulae: [0], showErrorMessage: true, errorTitle: 'Number expected', error: `${c.header}: enter a number (0 or more)` };
    for (let r = 2; r <= MAX_ROWS; r++) ws.getCell(`${letter}${r}`).dataValidation = rule;
  });

  const about = wb.addWorksheet('Read me');
  about.columns = [{ width: 28 }, { width: 10 }, { width: 90 }];
  about.addRow([`${book.file} — LV Design Studio database`]).font = { bold: true, size: 13 };
  for (const line of book.about) about.addRow([line]);
  about.addRow([]);
  const h = about.addRow(['Column', 'Required', 'Meaning / allowed values']);
  h.font = { bold: true };
  for (const c of book.columns) about.addRow([c.header, c.required ? 'yes' : '', [c.help, c.list ? `one of: ${c.list.join(', ')}` : c.number ? 'a number' : ''].filter(Boolean).join(' — ')]);
  about.addRow([]);
  about.addRow(['Keep the header row as it is; the app finds columns by their header text. Extra columns are ignored. The app makes a backup in Backups/ before it saves this file.']);

  // Write to a temp name then rename, so a watcher never reads a half-written file.
  // The name must be unique per call: init can run twice at once (React
  // StrictMode in dev), and a shared name lets one call rename the other's file.
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.xlsx`;
  await wb.xlsx.writeFile(tmp);
  fs.renameSync(tmp, file);
}

/** Creates the folder and any missing workbook. seeds: { [bookId]: rows[] }. */
async function ensureDatabase(projectsFolder, seeds = {}) {
  const folder = folderFor(projectsFolder);
  fs.mkdirSync(folder, { recursive: true });
  const created = [];
  for (const book of spec.books) {
    const file = path.join(folder, book.file);
    if (fs.existsSync(file)) continue;
    await createWorkbook(file, book, seeds[book.id]);
    created.push(book.file);
  }
  return { folder, created };
}

async function readBook(file, book) {
  const wb = new ExcelJS.Workbook();
  // Excel keeps an open file locked while saving; retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      await wb.xlsx.readFile(file);
      break;
    } catch (e) {
      if (attempt >= 4 || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const ws = wb.getWorksheet(book.sheet) ?? wb.worksheets[0];
  if (!ws) return { rows: [], missingColumns: book.columns.map((c) => c.header) };
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const colOf = {};
  ws.getRow(1).eachCell((cell, col) => {
    const h = norm(cellValue(cell.value));
    const c = book.columns.find((x) => norm(x.header) === h);
    if (c) colOf[c.key] = col;
  });
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const obj = { _row: n };
    let any = false;
    for (const c of book.columns) {
      if (!colOf[c.key]) continue;
      const v = cellValue(row.getCell(colOf[c.key]).value);
      if (v !== '') any = true;
      obj[c.key] = v;
    }
    if (any) rows.push(obj);
  });
  return { rows, missingColumns: book.columns.filter((c) => c.required && !colOf[c.key]).map((c) => c.header) };
}

/** Reads every workbook. Problems are reported per book, never thrown. */
async function readDatabase(projectsFolder) {
  const folder = folderFor(projectsFolder);
  const books = {};
  for (const book of spec.books) {
    const file = path.join(folder, book.file);
    if (!fs.existsSync(file)) {
      books[book.id] = { file: book.file, rows: [], error: 'File not found' };
      continue;
    }
    try {
      const { rows, missingColumns } = await readBook(file, book);
      books[book.id] = { file: book.file, rows, missingColumns, modified: fs.statSync(file).mtimeMs };
    } catch (e) {
      books[book.id] = { file: book.file, rows: [], error: e.message };
    }
  }
  return { folder, books, readAt: Date.now() };
}

/** Watches the folder; calls onChange (debounced) when a workbook is saved.
 * Excel's own "~$" lock files and our temp files are ignored. */
function watchDatabase(projectsFolder, onChange) {
  const folder = folderFor(projectsFolder);
  let timer = null;
  let watcher;
  try {
    watcher = fs.watch(folder, (_event, name) => {
      if (!name || name.startsWith('~$') || name.includes('.tmp-') || !name.toLowerCase().endsWith('.xlsx')) return;
      clearTimeout(timer);
      timer = setTimeout(onChange, 800);
    });
  } catch {
    return () => {};
  }
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/** Copies a workbook into Backups/ (kept: the last 20 per file). */
function backup(folder, fileName) {
  const src = path.join(folder, fileName);
  if (!fs.existsSync(src)) return;
  const dir = path.join(folder, 'Backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  fs.copyFileSync(src, path.join(dir, `${fileName.replace(/\.xlsx$/i, '')} ${stamp}.xlsx`));
  const mine = fs.readdirSync(dir).filter((f) => f.startsWith(fileName.replace(/\.xlsx$/i, '') + ' ')).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - 20))) fs.rmSync(path.join(dir, old), { force: true });
}

/** Writes rows (keyed by column key) into a workbook from the app: backup
 * first, then only the cell values of the known columns are replaced, so the
 * header, other columns, dropdowns and the Read me sheet stay as they are. */
async function writeBook(projectsFolder, bookId, rows) {
  const book = spec.books.find((b) => b.id === bookId);
  if (!book) throw new Error(`Unknown workbook ${bookId}`);
  const folder = folderFor(projectsFolder);
  const file = path.join(folder, book.file);
  if (!fs.existsSync(file)) await createWorkbook(file, book, []);
  backup(folder, book.file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(book.sheet) ?? wb.worksheets[0];
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const colOf = {};
  ws.getRow(1).eachCell((cell, col) => {
    const c = book.columns.find((x) => norm(x.header) === norm(cellValue(cell.value)));
    if (c) colOf[c.key] = col;
  });
  // Columns missing from an older file are added at the end.
  let next = ws.getRow(1).cellCount + 1;
  for (const c of book.columns) if (!colOf[c.key]) { ws.getRow(1).getCell(next).value = c.header; ws.getColumn(next).width = c.width; colOf[c.key] = next++; }
  const last = Math.max(ws.rowCount, rows.length + 1);
  for (let r = 2; r <= last; r++) {
    const data = rows[r - 2];
    for (const c of book.columns) {
      const v = data ? data[c.key] : undefined;
      ws.getRow(r).getCell(colOf[c.key]).value = v === undefined || v === null || v === '' ? null : c.number && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
    }
  }
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}.xlsx`;
  await wb.xlsx.writeFile(tmp);
  fs.renameSync(tmp, file);
  return { file: book.file };
}

/** Library.json: libraries that don't fit a table (title blocks, components,
 * feeder presets, notes), kept beside the workbooks so they sync too. */
const LIBRARY = 'Library.json';
function readLibrary(projectsFolder) {
  try { return JSON.parse(fs.readFileSync(path.join(folderFor(projectsFolder), LIBRARY), 'utf8')); } catch { return {}; }
}
function writeLibrary(projectsFolder, data) {
  const folder = folderFor(projectsFolder);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, LIBRARY);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  return true;
}

module.exports = { spec, folderFor, setFolder, ensureDatabase, readDatabase, watchDatabase, writeBook, readLibrary, writeLibrary };
