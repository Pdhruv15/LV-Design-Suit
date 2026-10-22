import { PDFDocument } from 'pdf-lib';
import { finishPdf, type Bookmark } from './pdfTools';

/** Several PDFs as one submission document: each page stamped at the very foot
 * with "project · revision · Page n of N" (below a report's own footer), and a
 * bookmark at the start of each part (titles in the same order as the parts). */
export async function mergePdfs(parts: Uint8Array[], stamp: string, titles: string[] = []): Promise<Uint8Array> {
  if (!parts.length) throw new Error('Cannot merge PDFs: no PDF parts were provided.');
  const out = await PDFDocument.create();
  const bookmarks: Bookmark[] = [];
  for (const [i, bytes] of parts.entries()) {
    if (!bytes.byteLength) throw new Error(`Cannot merge PDF part ${i + 1}: the file is empty.`);
    let src: PDFDocument;
    try { src = await PDFDocument.load(bytes); }
    catch { throw new Error(`Cannot merge PDF part ${i + 1}: the file is not a valid PDF.`); }
    if (!src.getPageCount()) throw new Error(`Cannot merge PDF part ${i + 1}: the PDF has no pages.`);
    if (titles[i]) bookmarks.push({ title: titles[i], page: out.getPageCount() });
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return finishPdf(out, { title: stamp, stamp, stampY: 4, bookmarks });
}
