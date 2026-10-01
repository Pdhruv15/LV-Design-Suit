import { PDFDocument } from 'pdf-lib';
import { finishPdf, type Bookmark } from './pdfTools';

/** Several PDFs as one submission document: each page stamped at the foot
 * with "project · revision · Page n of N", and a bookmark at the start of
 * each part (titles in the same order as the parts). */
export async function mergePdfs(parts: Uint8Array[], stamp: string, titles: string[] = []): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const bookmarks: Bookmark[] = [];
  for (const [i, bytes] of parts.entries()) {
    const src = await PDFDocument.load(bytes);
    if (titles[i]) bookmarks.push({ title: titles[i], page: out.getPageCount() });
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return finishPdf(out, { title: stamp, stamp, bookmarks });
}
