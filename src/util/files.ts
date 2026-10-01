const hasBridge = () => typeof window !== 'undefined' && !!window.lvds?.files;

export const safeFileName = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'export';

/** One CSV cell: quoted when it contains a comma, quote or newline. */
function cell(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // BOM so Excel opens UTF-8 (mm², Ω, ≤) correctly.
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

function browserDownload(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Saves text through the desktop save dialog, or downloads it in a plain
 * browser. Resolves to a short status message, or null if cancelled. */
export async function saveText(defaultName: string, content: string, filterName: string, ext: string): Promise<string | null> {
  if (!hasBridge()) {
    browserDownload(defaultName, content, 'text/plain;charset=utf-8');
    return `Downloaded ${defaultName}`;
  }
  const saved = await window.lvds.files.saveText({ defaultName, content, filterName, extensions: [ext] });
  return saved ? `Saved ${saved.split(/[\\/]/).pop()}` : null;
}

/** Saves binary content (e.g. an .xlsx workbook) through the desktop save
 * dialog, or downloads it in a plain browser. */
export async function saveBinary(defaultName: string, bytes: Uint8Array, filterName: string, ext: string, mime: string): Promise<string | null> {
  const save = typeof window !== 'undefined' ? window.lvds?.files?.saveBinary : undefined;
  if (!save) {
    browserDownload(defaultName, bytes as BlobPart, mime);
    return `Downloaded ${defaultName}`;
  }
  const saved = await save({ defaultName, bytes, filterName, extensions: [ext] });
  return saved ? `Saved ${saved.split(/[\\/]/).pop()}` : null;
}

export const saveCsv = (baseName: string, headers: string[], rows: unknown[][]) =>
  saveText(`${safeFileName(baseName)}.csv`, toCsv(headers, rows), 'CSV (Excel)', 'csv');

/** Renders a self-contained HTML document to PDF. In the desktop app this
 * uses Electron's printToPDF; in a browser it opens the print dialog. */
export async function savePdf(defaultName: string, html: string, page?: { pageSize?: 'A4' | 'A3' | 'A2' | 'A1'; landscape?: boolean; cssPages?: boolean; bookmarks?: { title: string; page: number }[] }): Promise<string | null> {
  if (!hasBridge()) {
    const w = window.open('', '_blank');
    if (!w) return 'Allow pop-ups to print the report';
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    return 'Opened the print dialog';
  }
  // Chrome lays the page out; pdf-lib adds page numbers, the document
  // information and bookmarks, and saves it compactly.
  const toBytes = window.lvds.files.pdfBytes;
  if (toBytes) {
    const { PDFDocument } = await import('pdf-lib');
    const { finishPdf, htmlTitle } = await import('../docs/pdfTools');
    const { pageSize, landscape, cssPages, bookmarks } = page ?? {};
    const doc = await PDFDocument.load(await toBytes({ html, pageSize, landscape, cssPages }));
    const title = htmlTitle(html) || defaultName.replace(/[.]pdf$/i, '');
    let author: string | undefined;
    try { author = JSON.parse(localStorage.getItem('lvds.preferences') ?? '{}').profile?.name || undefined; } catch { /* none */ }
    const bytes = await finishPdf(doc, { title, author, bookmarks });
    return saveBinary(defaultName, bytes, 'PDF', 'pdf', 'application/pdf');
  }
  const saved = await window.lvds.files.savePdf({ defaultName, html, ...page });
  return saved ? `Saved ${saved.split(/[\\/]/).pop()}` : null;
}
