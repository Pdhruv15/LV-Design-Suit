import { describe, expect, it } from 'vitest';
import type { StudyReportKind } from '../types';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { buildSection, buildStudyReportHtml, scopeOf, STUDIES, type CalcData } from './studyReport';
import { buildReviewDoc, defaultSetup, SECTION_IDS } from './reviewReport';
import { buildSldSheetHtml, pageTitleBlock } from './sldSheet';

const run = runCalculations(sampleProject);
const data: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
const scope = scopeOf(sampleProject, { boards: [], downstream: true });
const svg = '<svg viewBox="0 0 3000 1800" xmlns="http://www.w3.org/2000/svg"><rect width="3000" height="1800"/></svg>';
const [K1, K2] = STUDIES.filter((x) => x.sld).map((x) => x.key) as [StudyReportKind, StudyReportKind];
const html = (keys: StudyReportKind[]) => buildStudyReportHtml(sampleProject, scope, keys.map((k) => buildSection(k, data, scope)), { title: 'Study', docNo: 'E-CALC-1', preparedBy: 'A. Eng', checkedBy: 'B. Chk' }, Object.fromEntries(keys.map((k) => [k, svg])));

describe('SLD pages of the study report', () => {
  it('carry the drawing title block: project, owner, drawing number, revision, drawn and checked, and the sheet position', () => {
    const h = html([K1, K2]);
    expect(h.match(/class="sld"/g)).toHaveLength(2);
    expect(h).toContain('class="tb"');
    for (const text of ['Drawing no.', 'Revision', 'Drawn', 'Checked', 'E-CALC-1', 'A. Eng', 'B. Chk', sampleProject.name, '1 of 2', '2 of 2', 'single line diagram']) expect(h).toContain(text);
  });
  it('ends with the last SLD page: the disclaimer is on the cover, not alone on a final page', () => {
    const h = html([K1]);
    expect(h.lastIndexOf('class="note"')).toBeLessThan(h.indexOf('class="study"'));
    expect(h.slice(h.lastIndexOf('</section>'))).not.toContain('class="note"');
  });
  it('uses the same title block as a drawing sheet', () => {
    const one = { no: 'E-1', title: 'T', count: 1, index: 1 };
    expect(buildSldSheetHtml(sampleProject, svg, 'A3', one)).toContain(pageTitleBlock(sampleProject, one).html.trim().slice(0, 40));
  });
});

describe('design review report', () => {
  it('has a single line diagrams section that lists the sheets and says where they appear', () => {
    expect(SECTION_IDS).toContain('diagrams');
    const d = buildReviewDoc(sampleProject, defaultSetup(), { ran: true, stale: [], findings: [] });
    const s = d.sections.find((x) => x.id === 'diagrams')!;
    expect(JSON.stringify(s)).toMatch(/title blocks|no drawing set/i);
  });
});

import { readFileSync } from 'fs';
describe('form PDFs', () => {
  it('no page break after the last form table (the closing line after it used to land alone on a final page)', () => {
    const css = readFileSync('src/docs/sheetPdf.ts', 'utf8');
    expect(css).toContain('table.form:last-of-type { page-break-after: auto; }');
    expect(css).not.toContain('table.form:last-child');
  });
});
