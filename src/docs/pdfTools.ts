import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, rgb } from 'pdf-lib';

/** Finishing touches on every PDF the app makes: "title · Page n of N" at
 * the foot of multi-page documents, bookmarks for the parts of a combined
 * file, the document information, and compact saving (object streams). */

export interface Bookmark { title: string; page: number /* 0-based */ }

/** Stamps the foot of each page; skipped for a single page (drawing sheets
 * carry their own title block). */
export async function stampPages(doc: PDFDocument, label: string, force = false, y = 9): Promise<void> {
  const pages = doc.getPages();
  if (pages.length < 2 && !force) return;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const clean = (s: string) => s.replace(/[^\x20-\x7E·]/g, '-');
  pages.forEach((p, i) => {
    const text = clean(`${label ? `${label}   ·   ` : ''}Page ${i + 1} of ${pages.length}`);
    const size = 7;
    const w = font.widthOfTextAtSize(text, size);
    p.drawText(text, { x: p.getWidth() - w - 20, y, size, font, color: rgb(0.36, 0.42, 0.51) });
  });
}

/** Running header and footer of a report: a ruled header (project · title)
 * and footer (document no. · revision, page n of N) on every page after the
 * cover. Pages larger than A4 (A3 SLD sheets) carry their own title block and
 * are left alone. */
export async function stampFrame(doc: PDFDocument, f: { headerLeft: string; headerRight: string; footerLeft: string }): Promise<void> {
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const clean = (s: string) => s.replace(/[^\x20-\x7E·]/g, '-');
  const grey = rgb(0.36, 0.42, 0.51), size = 7, inset = 40;
  pages.forEach((p, i) => {
    if (i === 0 || Math.max(p.getWidth(), p.getHeight()) > 900) return;
    const w = p.getWidth(), h = p.getHeight();
    const right = (t: string, y: number) => p.drawText(clean(t), { x: w - inset - font.widthOfTextAtSize(clean(t), size), y, size, font, color: grey });
    p.drawText(clean(f.headerLeft), { x: inset, y: h - 26, size, font, color: grey });
    right(f.headerRight, h - 26);
    p.drawLine({ start: { x: inset, y: h - 30 }, end: { x: w - inset, y: h - 30 }, thickness: 0.4, color: grey });
    p.drawLine({ start: { x: inset, y: 22 }, end: { x: w - inset, y: 22 }, thickness: 0.4, color: grey });
    p.drawText(clean(f.footerLeft), { x: inset, y: 13, size, font, color: grey });
    right(`Page ${i + 1} of ${pages.length}`, 13);
  });
}

/** The page (1-based) of each named destination — the anchors (id="…") that the
 * HTML links to, e.g. the contents entries. Chrome writes them to the catalog's
 * /Dests dictionary (older files: the /Names → /Dests tree). */
export function destinationPages(doc: PDFDocument): Record<string, number> {
  const refs = doc.getPages().map((p) => p.ref.toString());
  const out: Record<string, number> = {};
  const put = (name: string, d: unknown) => {
    const arr = d instanceof PDFDict ? d.lookup(PDFName.of('D')) : d;
    if (!(arr instanceof PDFArray)) return;
    const at = refs.indexOf(arr.get(0).toString());
    if (at >= 0) out[name] = at + 1;
  };
  const dests = doc.catalog.lookup(PDFName.of('Dests'));
  if (dests instanceof PDFDict) for (const [k, v] of dests.entries()) put(k.decodeText(), doc.context.lookup(v));
  const walk = (node: unknown) => {
    if (!(node instanceof PDFDict)) return;
    const names = node.lookup(PDFName.of('Names'));
    if (names instanceof PDFArray) for (let i = 0; i + 1 < names.size(); i += 2) {
      const k = names.lookup(i);
      put(k instanceof PDFHexString || k instanceof PDFString ? k.decodeText() : String(k), names.lookup(i + 1));
    }
    const kids = node.lookup(PDFName.of('Kids'));
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) walk(kids.lookup(i));
  };
  const tree = doc.catalog.lookup(PDFName.of('Names'));
  if (tree instanceof PDFDict) walk(tree.lookup(PDFName.of('Dests')));
  return out;
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

export interface FinishOptions { title: string; stamp?: string; /** Height of the stamp above the page foot (pt), e.g. below a report's own footer. */ stampY?: number; frame?: { headerLeft: string; headerRight: string; footerLeft: string }; author?: string; subject?: string; bookmarks?: Bookmark[] }

/** Document information, page numbers, bookmarks; saved compactly. */
export async function finishPdf(doc: PDFDocument, o: FinishOptions): Promise<Uint8Array> {
  if (o.frame) await stampFrame(doc, o.frame);
  else await stampPages(doc, o.stamp ?? o.title, false, o.stampY);
  if (o.bookmarks?.length) addBookmarks(doc, o.bookmarks);
  doc.setTitle(o.title, { showInWindowTitleBar: true });
  if (o.author) doc.setAuthor(o.author);
  if (o.subject) doc.setSubject(o.subject);
  doc.setCreator('LV Design Studio');
  doc.setProducer('LV Design Studio');
  return doc.save({ useObjectStreams: true });
}

/** Contents page numbers: render, read where each anchor landed, render again with those
 * pages, until the pages stop moving (numbers in the contents can push it onto another page). */
export async function paginatePdf(render: (html: string) => Promise<PDFDocument>, html: string, paginate: (pages: Record<string, number>) => string, maxPasses = 3, pagesOf = destinationPages): Promise<PDFDocument> {
  let doc = await render(html), pages = pagesOf(doc);
  for (let i = 0; i < maxPasses; i++) {
    doc = await render(paginate(pages));
    const next = pagesOf(doc);
    if (JSON.stringify(next) === JSON.stringify(pages)) break;
    pages = next;
  }
  return doc;
}

/** Title of an HTML document (its <title>), for the PDF information. */
export const htmlTitle = (html: string) => (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
