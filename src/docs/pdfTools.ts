import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, StandardFonts, rgb } from 'pdf-lib';

/** Finishing touches on every PDF the app makes: "title · Page n of N" at
 * the foot of multi-page documents, bookmarks for the parts of a combined
 * file, the document information, and compact saving (object streams). */

export interface Bookmark { title: string; page: number /* 0-based */ }

/** Stamps the foot of each page; skipped for a single page (drawing sheets
 * carry their own title block). */
export async function stampPages(doc: PDFDocument, label: string, force = false): Promise<void> {
  const pages = doc.getPages();
  if (pages.length < 2 && !force) return;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const clean = (s: string) => s.replace(/[^\x20-\x7E·]/g, '-');
  pages.forEach((p, i) => {
    const text = clean(`${label ? `${label}   ·   ` : ''}Page ${i + 1} of ${pages.length}`);
    const size = 7;
    const w = font.widthOfTextAtSize(text, size);
    p.drawText(text, { x: p.getWidth() - w - 20, y: 9, size, font, color: rgb(0.36, 0.42, 0.51) });
  });
}

/** A flat outline (the bookmarks panel of a PDF viewer). */
export function addBookmarks(doc: PDFDocument, items: Bookmark[]): void {
  const pages = doc.getPages();
  const list = items.filter((b) => b.page >= 0 && b.page < pages.length && b.title.trim());
  if (!list.length) return;
  const ctx = doc.context;
  const outlinesRef = ctx.nextRef();
  const refs: PDFRef[] = list.map(() => ctx.nextRef());
  list.forEach((b, i) => {
    const dict = ctx.obj({}) as PDFDict;
    dict.set(PDFName.of('Title'), PDFHexString.fromText(b.title));
    dict.set(PDFName.of('Parent'), outlinesRef);
    if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < list.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
    const dest = PDFArray.withContext(ctx);
    dest.push(pages[b.page].ref);
    dest.push(PDFName.of('Fit'));
    dict.set(PDFName.of('Dest'), dest);
    ctx.assign(refs[i], dict);
  });
  const outlines = ctx.obj({}) as PDFDict;
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlines.set(PDFName.of('First'), refs[0]);
  outlines.set(PDFName.of('Last'), refs[refs.length - 1]);
  outlines.set(PDFName.of('Count'), PDFNumber.of(refs.length));
  ctx.assign(outlinesRef, outlines);
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

export interface FinishOptions { title: string; stamp?: string; author?: string; subject?: string; bookmarks?: Bookmark[] }

/** Document information, page numbers, bookmarks; saved compactly. */
export async function finishPdf(doc: PDFDocument, o: FinishOptions): Promise<Uint8Array> {
  await stampPages(doc, o.stamp ?? o.title);
  if (o.bookmarks?.length) addBookmarks(doc, o.bookmarks);
  doc.setTitle(o.title, { showInWindowTitleBar: true });
  if (o.author) doc.setAuthor(o.author);
  if (o.subject) doc.setSubject(o.subject);
  doc.setCreator('LV Design Studio');
  doc.setProducer('LV Design Studio');
  return doc.save({ useObjectStreams: true });
}

/** Title of an HTML document (its <title>), for the PDF information. */
export const htmlTitle = (html: string) => (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
