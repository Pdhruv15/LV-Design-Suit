// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { sampleProject } from '../../src/data/sampleProject';
import { runCalculations } from '../../src/calc/runs';
import { buildSection, buildStudyReportHtml, planReport, scopeOf, sldStudies, STUDIES, type CalcData } from '../../src/docs/studyReport';
import { destinationPages, finishPdf, paginatePdf } from '../../src/docs/pdfTools';
import { pageFrame, reportDoc, type ReportMeta } from '../../src/docs/reportFrame';
import { mergePdfs } from '../../src/docs/mergePdf';

/** The full design report — every study, design basis, results, appendices and A3 SLD sheets —
 * printed through the same Chromium call as the desktop app, then checked page by page. */

const electron = createRequire(import.meta.url)('electron') as unknown as string;
const dir = mkdtempSync(path.join(tmpdir(), 'lvds-pdf-'));
const MM = 96 / 25.4;
/** Printable width of the report's A4 landscape page (reportFrame: margin 16mm 14mm 14mm). */
const CONTENT_PX = Math.floor((297 - 28) * MM);
const A4 = { w: 841.89, h: 595.28 }, A3 = { w: 1190.55, h: 841.89 };
const near = (a: number, b: number) => Math.abs(a - b) < 1.5;

let renders = 0;
const layouts: { overflow: { tag: string; caption: string; width: number }[] }[] = [];
async function render(html: string): Promise<PDFDocument> {
  const n = ++renders, input = path.join(dir, `r${n}.html`), output = path.join(dir, `r${n}.pdf`), layout = path.join(dir, `r${n}.json`);
  writeFileSync(input, html);
  const r = spawnSync(electron, [path.resolve('tests/pdf/render.cjs'), input, output, layout, String(CONTENT_PX)], { encoding: 'utf-8', timeout: 120_000 });
  if (r.status !== 0) throw new Error(`Electron render failed: ${r.stderr || r.error}`);
  layouts.push(JSON.parse(readFileSync(layout, 'utf-8')));
  return PDFDocument.load(readFileSync(output));
}

const run = runCalculations(sampleProject);
const data: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
const scope = scopeOf(run.project, { boards: [], downstream: true });
const sections = STUDIES.map((s) => buildSection(s.key, data, scope));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 1100"><rect x="10" y="10" width="1780" height="1080" fill="none" stroke="#000"/><text x="900" y="550">SLD</text></svg>';
const slds = Object.fromEntries(sldStudies(sections.map((s) => s.key)).map((k) => [k, svg]));
const meta: ReportMeta = { title: 'Electrical design report', docNo: 'E-RPT-001', preparedBy: 'QA', checkedBy: 'QA' };
const opts = { designBasis: true, results: true, data };
const html = (pages: Record<string, number>) => buildStudyReportHtml(run.project, scope, sections, meta, slds, { ...opts, pages });
const plan = planReport(run.project, scope, sections, meta, Object.keys(slds) as never, opts);

let doc: PDFDocument, pages: Record<string, number>, finalHtml: string, finished: PDFDocument;
beforeAll(async () => {
  doc = await paginatePdf(render, html({}), html);
  pages = destinationPages(doc);
  finalHtml = html(pages);
  finished = await PDFDocument.load(await finishPdf(doc, { title: meta.title, frame: pageFrame(reportDoc(run.project, meta)) }));
});

describe('design report PDF, rendered', () => {
  it('has every contents entry on a page, in contents order', () => {
    expect(doc.getPageCount()).toBeGreaterThan(plan.entries.length / 2);
    const at = plan.entries.map((e) => pages[e.anchor]);
    expect(at.every((p) => Number.isInteger(p) && p > 1)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  it('prints the page numbers it found: contents and destinations agree after pagination', () => {
    for (const e of plan.entries) expect(finalHtml).toContain(`href="#${e.anchor}"><span class="n">${e.number}</span>`);
    const printed = [...finalHtml.matchAll(/href="#([^"]+)">.*?<span class="pg">(\d*)<\/span>/g)].map((m) => [m[1], Number(m[2])]);
    expect(printed.length).toBe(plan.entries.length);
    expect(Object.fromEntries(printed)).toEqual(Object.fromEntries(plan.entries.map((e) => [e.anchor, pages[e.anchor]])));
  });

  it('A4 landscape report pages, and one A3 sheet per SLD inside its appendix', () => {
    const sizes = doc.getPages().map((p) => p.getSize());
    const a3 = sizes.map((s, i) => (near(s.width, A3.w) && near(s.height, A3.h) ? i + 1 : 0)).filter(Boolean);
    expect(sizes.every((s) => (near(s.width, A4.w) && near(s.height, A4.h)) || (near(s.width, A3.w) && near(s.height, A3.h)))).toBe(true);
    expect(a3).toHaveLength(Object.keys(slds).length);
    const app = plan.appendices.find((a) => a.kind === 'sld')!, next = plan.appendices[plan.appendices.indexOf(app) + 1];
    const start = pages[`app-${app.letter}`], end = next ? pages[`app-${next.letter}`] : doc.getPageCount() + 1;
    expect(a3.every((p) => p > start && p < end)).toBe(true);
    expect(a3).toEqual(a3.map((_, i) => a3[0] + i)); // consecutive sheets
  });

  it('nothing is wider than the printable page (tables, charts)', () => {
    expect(layouts[layouts.length - 1].overflow).toEqual([]);
  });

  it('the report frame leaves the cover and the A3 sheets alone, and keeps the page count', () => {
    expect(finished.getPageCount()).toBe(doc.getPageCount());
    expect(finished.getTitle()).toBe(meta.title);
  });

  it('inside an issue package the report keeps its pages and sizes', async () => {
    const cover = await PDFDocument.create();
    cover.addPage([A4.h, A4.w]);
    const merged = await PDFDocument.load(await mergePdfs([await cover.save(), await finished.save()], 'Snapshot', ['Cover', meta.title]));
    expect(merged.getPageCount()).toBe(1 + finished.getPageCount());
    const size = (d: PDFDocument, i: number) => d.getPage(i).getSize();
    for (let i = 0; i < finished.getPageCount(); i++) expect(size(merged, i + 1)).toEqual(size(finished, i));
  });
});
