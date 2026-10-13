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

type Bookmarks = { title: string; page: number }[];
export type PdfPage = { pageSize?: 'A4' | 'A3' | 'A2' | 'A1'; landscape?: boolean; cssPages?: boolean; frame?: { headerLeft: string; headerRight: string; footerLeft: string };
  /** Fixed, or from the page (1-based) each anchor landed on. */
  bookmarks?: Bookmarks | ((pages: Record<string, number>) => Bookmarks);
  /** The document prints its own running header, footer and page numbers (CSS @page boxes): no stamped page foot. */
  selfNumbered?: boolean;
  /** Print, read the page of each anchor, and print the HTML this returns (e.g. contents with page numbers) until the pages settle. */
  paginate?: (pages: Record<string, number>) => string };

/** The finished PDF of an HTML document — layout by Chrome, then contents page numbers, the report
 * frame (header and footer), document information and bookmarks — the same for a saved PDF and a PDF
 * placed in an issue package. Undefined outside the desktop app. */
export async function renderPdf(html: string, page: PdfPage = {}, fallbackTitle = ''): Promise<Uint8Array | undefined> {
  const toBytes = hasBridge() ? window.lvds.files.pdfBytes : undefined;
  if (!toBytes) return undefined;
  const { PDFDocument } = await import('pdf-lib');
  const { destinationPages, finishPdf, htmlTitle, paginatePdf } = await import('../docs/pdfTools');
  const { pageSize, landscape, cssPages, frame, paginate, selfNumbered } = page;
  const render = async (h: string) => PDFDocument.load(await toBytes({ html: h, pageSize, landscape, cssPages }));
  const doc = paginate ? await paginatePdf(render, html, paginate) : await render(html);
  let author: string | undefined;
  try { author = JSON.parse(localStorage.getItem('lvds.preferences') ?? '{}').profile?.name || undefined; } catch { /* none */ }
  const bookmarks = typeof page.bookmarks === 'function' ? page.bookmarks(destinationPages(doc)) : page.bookmarks;
  return finishPdf(doc, { title: htmlTitle(html) || fallbackTitle, author, bookmarks, frame, stamp: selfNumbered ? false : undefined });
}

/** Prints an HTML document from a hidden frame (the browser's print dialog, where
 * "Save as PDF" is offered). A frame, not a new window: exports finish after async
 * work, when the browser no longer counts the click and blocks pop-ups. */
function printInFrame(html: string): string {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return;
    const remove = () => setTimeout(() => frame.remove(), 1000);
    w.addEventListener('afterprint', remove);
    w.focus();
    w.print();
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
  return 'Opened the print dialog — choose “Save as PDF”';
}

/** Renders a self-contained HTML document to PDF. In the desktop app this
 * uses Electron's printToPDF; in a browser it opens the print dialog. */
export async function savePdf(defaultName: string, html: string, page?: PdfPage): Promise<string | null> {
  if (!hasBridge()) return printInFrame(html);
  const bytes = await renderPdf(html, page, defaultName.replace(/[.]pdf$/i, ''));
  if (bytes) return saveBinary(defaultName, bytes, 'PDF', 'pdf', 'application/pdf');
  const saved = await window.lvds.files.savePdf({ defaultName, html, ...page });
  return saved ? `Saved ${saved.split(/[\\/]/).pop()}` : null;
}
