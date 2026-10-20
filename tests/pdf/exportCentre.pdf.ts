// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { sampleProject } from '../../src/data/sampleProject';
import { runCalculations } from '../../src/calc/runs';
import { CATALOGUE, unavailable } from '../../src/components/docs/exportCatalogue';
import { mergePdfs } from '../../src/docs/mergePdf';

/** The export centre's "One PDF": every available document of the sample project printed through
 * the app's Chromium call and merged — all pages kept, one bookmark per document, in list order. */

const electron = createRequire(import.meta.url)('electron') as unknown as string;
const dir = mkdtempSync(path.join(tmpdir(), 'lvds-export-'));
// Rendered files are removed after the run (set KEEP_PDF=1 to keep them for a look).
afterAll(() => { if (!process.env.KEEP_PDF) rmSync(dir, { recursive: true, force: true }); });

function print(i: number, html: string): Uint8Array {
  const input = path.join(dir, `d${i}.html`), output = path.join(dir, `d${i}.pdf`);
  writeFileSync(input, html);
  const r = spawnSync(electron, [path.resolve('tests/pdf/render.cjs'), input, output, path.join(dir, `d${i}.json`), '1016'], { encoding: 'utf-8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(`Electron render failed: ${r.stderr || r.error}`);
  return readFileSync(output);
}

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

describe('export centre, one PDF', () => {
  it('merges every available document with a bookmark each', async () => {
    const ctx = { project: sampleProject, run: runCalculations(sampleProject), stale: [] };
    const parts = CATALOGUE.filter((e) => !unavailable(e, ctx)).flatMap((e) => e.build(ctx));
    expect(parts.length).toBeGreaterThan(10);
    const pdfs = parts.map((p, i) => print(i, p.html));
    const pages = await Promise.all(pdfs.map(async (b) => (await PDFDocument.load(b)).getPageCount()));
    expect(pages.every((n) => n > 0)).toBe(true);
    const merged = await PDFDocument.load(await mergePdfs(pdfs, 'Sample · documents', parts.map((p) => p.title)));
    expect(merged.getPageCount()).toBe(pages.reduce((a, b) => a + b, 0));
    expect(outlineTitles(merged)).toEqual(parts.map((p) => p.title));
  });
});
