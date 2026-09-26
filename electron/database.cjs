// LV Database: a folder of Excel workbooks (loads, cables, breakers,
// parameters) inside the projects folder, so it syncs through Google Drive
// and can be edited in Excel. The app creates any missing workbook (never
// overwrites one), reads them, and watches the folder for saves.
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const spec = require('./databaseSpec.json');

const MAX_ROWS = 2000; // rows given data validation in new workbooks

const folderFor = (projectsFolder) => path.join(projectsFolder, spec.folderName);

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
    if (!c.list) return;
    const letter = ws.getColumn(i + 1).letter;
    for (let r = 2; r <= MAX_ROWS; r++) {
      ws.getCell(`${letter}${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${c.list.join(',').replace(/"/g, '""')}"`]
      };
    }
  });

  const about = wb.addWorksheet('About');
  about.getColumn(1).width = 120;
  about.addRow([`${book.file} — LV Design Studio database`]).font = { bold: true, size: 13 };
  for (const line of book.about) about.addRow([line]);
  about.addRow([]);
  about.addRow(['Keep the header row as it is; the app finds columns by their header text. Extra columns are ignored.']);

  // Write to a temp name then rename, so a watcher never reads a half-written file.
  const tmp = `${file}.tmp-${process.pid}.xlsx`;
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

module.exports = { spec, folderFor, ensureDatabase, readDatabase, watchDatabase };
