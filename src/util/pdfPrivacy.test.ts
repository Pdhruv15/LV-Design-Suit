// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFHexString, PDFString } from 'pdf-lib';
import { pdfAuthor, pdfPageSetup, renderPdf } from './files';
import { buildReportHtml } from '../docs/calcReport';
import { anonymizeProject } from '../model/anonymize';
import { sampleProject } from '../data/sampleProject';

/** The PDF of an anonymized sample must not carry the user's profile name (Author) or any project identity in
 * its document information, bookmarks or attachments; a normal report keeps the author as before. */

const PROFILE = 'Profile Person Name';

async function blankPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  return d.save();
}

/** Every text in the document information, the outline (bookmarks) and the names tree (attachments). */
function metaText(doc: PDFDocument): string {
  const out: string[] = [];
  const walk = (o: unknown, depth = 0) => {
    if (depth > 12 || !o) return;
    if (o instanceof PDFHexString || o instanceof PDFString) out.push(o.decodeText());
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) walk(v instanceof PDFDict || v instanceof PDFHexString || v instanceof PDFString ? v : doc.context.lookup(v as never), depth + 1);
  };
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  walk(info);
  const outlines = doc.catalog.get(PDFName.of('Outlines'));
  if (outlines) walk(doc.context.lookup(outlines));
  return out.join('\n');
}

describe('PDF privacy', () => {
  beforeEach(() => {
    localStorage.setItem('lvds.preferences', JSON.stringify({ profile: { name: PROFILE } }));
    (window as unknown as { lvds: unknown }).lvds = { files: { pdfBytes: async () => blankPdf() } };
  });
  afterEach(() => {
    localStorage.clear();
    delete (window as unknown as { lvds?: unknown }).lvds;
  });

  it('names the profile as author on a normal report, and nobody on an anonymized sample', () => {
    expect(pdfAuthor()).toBe(PROFILE);
    expect(pdfAuthor({ anonymous: true })).toBeUndefined();
  });

  it('an anonymized calculation report has no author, no project identity and no attachments', async () => {
    const sample = anonymizeProject({ ...sampleProject, info: { ...sampleProject.info, owner: 'Real Client LLC' } }).project;
    const bytes = await renderPdf(buildReportHtml(sample), { pageSize: 'A4', anonymous: true, bookmarks: [{ title: 'Results summary', page: 0 }] });
    const doc = await PDFDocument.load(bytes!);
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getTitle()).toMatch(/Anonymized sample/);
    const meta = metaText(doc);
    expect(meta).toMatch(/Anonymized sample[\s\S]*Results summary/); // the walk reads the information and the outline
    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeDefined(); // bookmarks were written, and are checked below
    for (const s of [PROFILE, 'Real Client LLC', 'Demo Owner', 'DEMO-001', sampleProject.name]) expect(meta).not.toContain(s);
    expect(doc.catalog.get(PDFName.of('Names'))).toBeUndefined(); // no embedded files
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined(); // no XMP packet
  });

  it('keeps the author on an ordinary report', async () => {
    const bytes = await renderPdf(buildReportHtml(sampleProject), { pageSize: 'A4' });
    expect((await PDFDocument.load(bytes!)).getAuthor()).toBe(PROFILE);
  });
});

describe('PDF page setup', () => {
  const html = '<html><head><style>@page { size: A4 portrait; }</style></head><body></body></html>';

  it('makes an explicit landscape export override the document fallback', () => {
    const out = pdfPageSetup(html, { pageSize: 'A4', landscape: true });
    expect(out.page).toMatchObject({ pageSize: 'A4', landscape: true });
    expect(out.html).toContain('<style data-pdf-page>@page { size: A4 landscape; }</style></head>');
  });

  it('uses the document orientation when the caller omits it', () => {
    const out = pdfPageSetup(html, { pageSize: 'A4' });
    expect(out.page.landscape).toBe(false);
    expect(out.html).toContain('@page { size: A4 portrait; }');
  });

  it('does not override mixed CSS-sized pages', () => {
    expect(pdfPageSetup(html, { cssPages: true }).html).toBe(html);
  });
});
