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

export const saveCsv = (baseName: string, headers: string[], rows: unknown[][]) =>
  saveText(`${safeFileName(baseName)}.csv`, toCsv(headers, rows), 'CSV (Excel)', 'csv');

/** Renders a self-contained HTML document to PDF. In the desktop app this
 * uses Electron's printToPDF; in a browser it opens the print dialog. */
export async function savePdf(defaultName: string, html: string): Promise<string | null> {
  if (!hasBridge()) {
    const w = window.open('', '_blank');
    if (!w) return 'Allow pop-ups to print the report';
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
    return 'Opened the print dialog';
  }
  const saved = await window.lvds.files.savePdf({ defaultName, html });
  return saved ? `Saved ${saved.split(/[\\/]/).pop()}` : null;
}
