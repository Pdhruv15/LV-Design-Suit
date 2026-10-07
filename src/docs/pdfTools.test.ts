// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { mergePdfs } from './mergePdf';
import { finishPdf, htmlTitle } from './pdfTools';

const blank = async (n: number) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([595, 842]); return d.save(); };

describe('PDF finishing', () => {
  it('merges with bookmarks at the start of each part and page numbers', async () => {
    const bytes = await mergePdfs([await blank(1), await blank(3), await blank(2)], 'Villa · Rev A', ['Summary', 'Study report', 'Load schedule — DB-1']);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(6);
    const outlines = doc.catalog.lookup(PDFName.of('Outlines'));
    expect(outlines).toBeTruthy();
    expect(String((outlines as any).get(PDFName.of('Count')))).toBe('3');
    expect(doc.getTitle()).toBe('Villa · Rev A');
  });
  it('stamps multi-page reports, not single sheets, and sets the information', async () => {
    const one = await PDFDocument.load(await finishPdf(await PDFDocument.load(await blank(1)), { title: 'Sheet', author: 'PG' }));
    expect(one.getAuthor()).toBe('PG');
    const many = await finishPdf(await PDFDocument.load(await blank(3)), { title: 'Voltage drop' });
    expect(many.length).toBeGreaterThan(0);
    expect(htmlTitle('<html><head><title>A &amp; B</title></head></html>')).toBe('A & B');
  });
});

import { paginatePdf } from './pdfTools';
describe('contents pagination', () => {
  it('renders again until the contents page numbers stop moving', async () => {
    // The anchors move once (contents grew a page), then settle.
    const maps = [{ a: 2 }, { a: 3 }, { a: 3 }];
    const seen: string[] = [];
    let i = 0;
    await paginatePdf(async (h) => { seen.push(h); return PDFDocument.create(); }, 'first', (p) => `with ${JSON.stringify(p)}`, 3, () => maps[Math.min(i++, maps.length - 1)]);
    expect(seen).toEqual(['first', 'with {"a":2}', 'with {"a":3}']);
  });
});
