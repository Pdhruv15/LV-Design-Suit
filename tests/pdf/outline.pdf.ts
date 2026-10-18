// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { printDocs } from '../fixtures/printDocs';
import { destinationPages, finishPdf } from '../../src/docs/pdfTools';
import { bookmarkMarkers, markerBookmarks } from '../../src/docs/outline';

/** Bookmarks from section markers, printed through the app's Chromium call: every marker
 * becomes a bookmark, on the page its section landed on, in document order. */

const electron = createRequire(import.meta.url)('electron') as unknown as string;
const dir = mkdtempSync(path.join(tmpdir(), 'lvds-outline-'));
// Rendered files are removed after the run (set KEEP_PDF=1 to keep them for a look).
afterAll(() => { if (!process.env.KEEP_PDF) rmSync(dir, { recursive: true, force: true }); });
const docs = printDocs();

function render(name: string): Promise<PDFDocument> {
  const input = path.join(dir, `${name}.html`), output = path.join(dir, `${name}.pdf`);
  writeFileSync(input, docs[name]);
  const r = spawnSync(electron, [path.resolve('tests/pdf/render.cjs'), input, output, path.join(dir, `${name}.json`), '1016'], { encoding: 'utf-8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(`Electron render failed: ${r.stderr || r.error}`);
  return PDFDocument.load(readFileSync(output));
}

/** Titles of the top-level outline items of a finished PDF. */
function outlineTitles(doc: PDFDocument): string[] {
  const outlines = doc.catalog.lookup(PDFName.of('Outlines'));
  const out: string[] = [];
  let item = outlines instanceof PDFDict ? outlines.lookup(PDFName.of('First')) : undefined;
  while (item instanceof PDFDict) {
    const t = item.lookup(PDFName.of('Title'));
    out.push(t instanceof PDFHexString || t instanceof PDFString ? t.decodeText() : String(t));
    item = item.lookup(PDFName.of('Next'));
  }
  return out;
}

describe('PDF bookmarks from section markers', () => {
  for (const name of ['calculation-report', 'study-report']) {
    it(`${name}: one bookmark per section, on its page, in order`, async () => {
      const doc = await render(name);
      const markers = bookmarkMarkers(docs[name]);
      expect(markers.length).toBeGreaterThan(5);
      const bms = markerBookmarks(docs[name], destinationPages(doc));
      expect(bms.map((b) => b.title)).toEqual(markers.map((m) => m.title));
      const pages = bms.map((b) => b.page);
      expect(pages).toEqual([...pages].sort((a, b) => a - b));
      expect(Math.max(...pages)).toBeLessThan(doc.getPageCount());
      const finished = await PDFDocument.load(await finishPdf(doc, { title: name, stamp: false, bookmarks: bms }));
      expect(outlineTitles(finished)).toEqual(markers.map((m) => m.title));
      expect(finished.catalog.lookup(PDFName.of('Outlines'))).toBeInstanceOf(PDFDict);
    });
  }
});
