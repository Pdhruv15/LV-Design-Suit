import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** Several PDFs as one submission document, each page stamped at the foot
 * with "project · revision · Page n of N". */
export async function mergePdfs(parts: Uint8Array[], stamp: string): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  pages.forEach((p, i) => {
    const text = `${stamp}   ·   Page ${i + 1} of ${pages.length}`.replace(/[^\x20-\x7E·]/g, '-');
    const size = 7;
    const w = font.widthOfTextAtSize(text, size);
    p.drawText(text, { x: p.getWidth() - w - 20, y: 8, size, font, color: rgb(0.36, 0.42, 0.51) });
  });
  out.setTitle(stamp);
  out.setProducer('LV Design Studio');
  return out.save();
}
