import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { buildSection, buildStudyReportHtml, scopeOf, type CalcData } from './studyReport';
import { missingFields, NOT_DEFINED, numberSections, pageFrame, reportDoc } from './reportFrame';
import { stampFrame } from './pdfTools';
import type { Project } from '../types';

const run = runCalculations(sampleProject);
const data: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
const bare: Project = { ...sampleProject, info: undefined, params: undefined, drawing: undefined, revisions: undefined };

describe('design report frame', () => {
  it('numbers sections 1, 1.1, 1.1.1 with stable anchors', () => {
    const t = numberSections([{ title: 'A', children: [{ title: 'A1', children: [{ title: 'A1a' }] }] }, { title: 'B' }]);
    expect(t.map((e) => e.number)).toEqual(['1', '1.1', '1.1.1', '2']);
    expect(t[2].anchor).toBe('sec-1-1-1');
  });

  it('never invents identification data: missing fields read "Not defined"', () => {
    const d = reportDoc(bare, { title: 'T' });
    expect(missingFields(d)).toEqual(['Project no.', 'Client', 'Document no.', 'Revision', 'Prepared by', 'Checked by', 'Approved by', 'Issue status']);
    expect(pageFrame(d).footerLeft).toContain(NOT_DEFINED);
  });

  it('takes names from the report first, then the project parameters', () => {
    const p: Project = { ...bare, params: { approvedBy: 'C. App', checkedBy: 'P. Chk' } };
    const d = reportDoc(p, { title: 'T', checkedBy: 'R. Chk' });
    expect(d.approvedBy).toBe('C. App');
    expect(d.checkedBy).toBe('R. Chk');
  });

  it('report order: cover, document control, contents, numbered sections', () => {
    const scope = scopeOf(sampleProject, { boards: [], downstream: true });
    const html = buildStudyReportHtml(bare, scope, [buildSection('sc', data, scope), buildSection('lf', data, scope)], { title: 'Design report', issueStatus: 'For review' });
    const at = (s: string) => html.indexOf(s);
    expect(at('class="cover"')).toBeLessThan(at('class="doc-control"'));
    expect(at('class="doc-control"')).toBeLessThan(at('class="toc"'));
    expect(at('class="toc"')).toBeLessThan(at('class="study"'));
    expect(html).toContain('href="#sec-2"');
    expect(html).toContain('id="sec-2"');
    expect(html).toContain('Approved by');
    expect(html).toContain('For review');
    expect(html).toContain('unissued draft');
    expect(html.match(/class="missing"/g)!.length).toBeGreaterThan(3);
  });

  it('header and footer skip the cover and A3 drawing pages', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]); doc.addPage([842, 595]); doc.addPage([1191, 842]);
    await stampFrame(doc, { headerLeft: 'P', headerRight: 'T', footerLeft: 'Doc' });
    const bytes = await doc.save({ useObjectStreams: false });
    expect(bytes.length).toBeGreaterThan(0);
  });
});

import { buildDesignBasis } from './designBasis';
describe('design basis (phase 2)', () => {
  const scope = scopeOf(sampleProject, { boards: [], downstream: true });
  const secs = [buildSection('sc', data, scope), buildSection('earth', data, scope)];
  it('sections 1–5 come before the studies, which are numbered on from 6', () => {
    const html = buildStudyReportHtml(sampleProject, scope, secs, { title: 'T' }, {}, { designBasis: true });
    for (const t of ['1. Executive summary', '2. Project scope', '3. Electrical system description', '4. Codes and standards', '5. Design criteria', '6. Short circuit study']) expect(html).toContain(t);
    expect(html.indexOf('5. Design criteria')).toBeLessThan(html.indexOf('class="study"'));
  });
  it('uses the calculation outputs, never invented values', () => {
    const b = buildDesignBasis(sampleProject, secs);
    expect(b.summary.connectedKw).toBeGreaterThan(0);
    expect(b.criteria.find((c) => c.parameter.startsWith('Voltage drop limit'))!.value).toBe(`${sampleProject.vdLimitPct} %`);
    expect(b.standards.methods.map((m) => m.standard)).toContain('IEC 60909-0');
    expect(b.standards.methods.map((m) => m.standard)).not.toContain('IEC 60831'); // no PFC study in this report
  });
  it('flags what is not defined: no project standards, no scope, app-default criteria', () => {
    const p: Project = { ...sampleProject, standards: undefined, brief: undefined, studySettings: undefined, info: undefined };
    const b = buildDesignBasis(p, secs);
    expect(b.standards.project).toEqual([]);
    expect(b.scope.defined).toBe(false);
    expect(b.criteria.find((c) => c.parameter === 'Power factor target')!.flag).toMatch(/app default/);
    expect(b.criteria.find((c) => c.parameter.startsWith('Maximum demand factor'))!.value).toBeUndefined();
    const html = buildStudyReportHtml(p, scope, secs, { title: 'T' }, {}, { designBasis: true });
    expect(html).toContain('No project standards or specifications are defined');
    expect(html).toContain('The project scope is not defined');
  });
  it('is off unless asked for (older callers unchanged)', () => {
    expect(buildStudyReportHtml(sampleProject, scope, secs, { title: 'T' })).toContain('1. Short circuit study');
  });
});

describe('calculation sections (phase 3)', () => {
  const scope = scopeOf(sampleProject, { boards: [], downstream: true });
  const keys = ['load', 'sizing', 'dist', 'cable', 'lf', 'sc', 'earth'] as const;
  const secs = keys.map((k) => buildSection(k, data, scope));
  const html = buildStudyReportHtml(sampleProject, scope, secs, { title: 'T' });
  it('each calculation section has input, criteria, method, result and verification', () => {
    for (const s of secs.filter((x) => !['load', 'dist'].includes(x.key))) {
      expect(s.criteria?.length, s.key).toBeGreaterThan(0);
      expect(s.verification?.rows.length, s.key).toBeGreaterThan(0);
    }
    expect(html).toMatch(/<h3><span class="sn">\d+\.\d+<\/span> Input<\/h3>/);
    expect(html).toContain('Verification — Breaking capacity at each busbar');
  });
  it('cable section shows a card per major feeder, in the standard format', () => {
    const cable = secs.find((s) => s.key === 'cable')!;
    expect(cable.cards!.length).toBeGreaterThan(0);
    expect(cable.cards![0].rows.map((r) => r[0])).toEqual(['Design current (Ib)', 'Protective device (In)', 'Selected cable', 'Derated capacity (Iz)', 'Ib ≤ In ≤ Iz', 'Voltage drop (total)', 'Breaking capacity check', 'Overall status']);
    expect(cable.cards![0].title).toMatch(/^Feeder: .+ → .+/);
  });
  it('long per-circuit tables move to lettered appendices, listed in the contents', () => {
    expect(html).toContain('Appendix A — ');
    expect(html).toContain('href="#app-A"');
    const studyPart = html.slice(html.indexOf('class="study"'), html.indexOf('class="appendix"'));
    expect(studyPart).not.toContain('</span> Cables and breakers</h3>');
    expect(html.slice(html.indexOf('class="appendix"'))).toMatch(/<span class="sn">[A-Z]\.\d+<\/span> Cables and breakers<\/h3>/);
  });
  it('load assessment and verification figures come from the calculations', () => {
    const load = secs.find((s) => s.key === 'load')!;
    const sum = buildDesignBasis(sampleProject, []).summary;
    expect(load.summary[0].value).toBe(`${Math.round(sum.connectedKw)} kW`);
    const lf = secs.find((s) => s.key === 'lf')!;
    expect(lf.verification!.rows.every((r) => r[3] === sampleProject.vdLimitPct)).toBe(true);
  });
});

import { buildResults } from './compliance';
import { REPORT_STATUS_TEXT, STATUS_TEXT } from '../calc/statusText';
describe('results and compliance (phase 4)', () => {
  const scope = scopeOf(sampleProject, { boards: [], downstream: true });
  const secs = (['cable', 'sc'] as const).map((k) => buildSection(k, data, scope));
  it('one status vocabulary: PASS / WARNING / FAIL / NOT CHECKED / DATA REQUIRED', () => {
    expect(Object.values(STATUS_TEXT)).toEqual(['PASS', 'WARNING', 'FAIL']);
    expect(Object.values(REPORT_STATUS_TEXT)).toEqual(['PASS', 'WARNING', 'FAIL', 'NOT CHECKED', 'DATA REQUIRED']);
  });
  it('compliance rows trace to the calculation results with a margin', () => {
    const r = buildResults(data, scope);
    const vd = r.compliance.find((c) => c.check === 'Voltage drop')!;
    const worstVd = Math.max(...data.results.map((x) => x.vdTotalPct));
    expect(vd.calculated).toBe(`${Number(worstVd.toFixed(2))} %`);
    expect(vd.requirement).toBe(`${sampleProject.vdLimitPct} %`);
    expect(r.compliance.map((c) => c.check)).toEqual(expect.arrayContaining(['Transformer loading', 'Fault level (breaking capacity)', 'Cable capacity (Ib ≤ Iz)', 'Overload protection (Ib ≤ In ≤ Iz)']));
  });
  it('missing ratings are DATA REQUIRED, never zero', () => {
    const p = { ...sampleProject, boards: sampleProject.boards.map((b) => ({ ...b, ratedCurrentA: undefined })) };
    const r = buildResults({ ...data, project: p }, scopeOf(p, { boards: [], downstream: true }));
    const row = r.compliance.find((c) => c.check === 'Board loading')!;
    expect(row.status).toBe('data');
    expect(r.charts.map((c) => c.title)).not.toContain('Board loading');
  });
  it('results and compliance sections follow the studies, with numbered figures', () => {
    const html = buildStudyReportHtml(sampleProject, scope, secs, { title: 'T' }, {}, { results: true, data });
    expect(html.indexOf('3. Results summary')).toBeGreaterThan(html.indexOf('2. Short circuit study'));
    expect(html).toContain('4. Compliance summary');
    expect(html).toContain('Figure 1 — Connected load vs maximum demand');
    expect(html).toContain('</span> Cable summary</h3>');
    expect(html).toContain('<caption>Table 1</caption>');
  });
});

import { applyReportType, matchingType, REPORT_TYPES } from './reportTypes';
import { validateReport } from './reportValidation';
describe('report generator (phase 5)', () => {
  const scope = scopeOf(sampleProject, { boards: [], downstream: true });
  it('report types set the sections and are recognised until customised', () => {
    const base = { boards: [], downstream: true, studies: [], sld: false, separate: false };
    const s = { ...base, ...applyReportType('sc') };
    expect(s.studies).toEqual(['sc', 'disc']);
    expect(matchingType(s)).toBe('sc');
    expect(matchingType({ ...s, studies: ['sc'] })).toBeUndefined();
    expect(REPORT_TYPES.map((t) => t.key)).toEqual(['full', 'calc', 'load', 'cable', 'sc', 'authority']);
  });
  it('numbers sub-sections and tables automatically', () => {
    const html = buildStudyReportHtml(sampleProject, scope, [buildSection('sc', data, scope)], { title: 'T' });
    expect(html).toContain('<span class="sn">1.1</span>');
    expect(html).toContain('<caption>Table 1</caption>');
    expect(html).toContain('<span class="sn">A.1</span>');
  });
  it('pre-export check: not run, stale, missing data and references are reported, never hidden', () => {
    const sections = [buildSection('sc', data, scope)];
    const base = { project: bare, meta: { title: 'T' }, scope, sections, designBasis: true, resultsSummary: true };
    const notRun = validateReport({ ...base, stale: [] });
    expect(notRun.some((x) => x.level === 'error' && /not been run/.test(x.message))).toBe(true);
    const stale = validateReport({ ...base, data, stale: ['Feeder F1'] });
    expect(stale.some((x) => /out of date/.test(x.message))).toBe(true);
    expect(stale.some((x) => x.area === 'Project data')).toBe(true);
    const broken: Project = { ...sampleProject, feeders: [...sampleProject.feeders, { ...sampleProject.feeders[0], id: 'GHOST', boardId: 'NOPE' }] };
    expect(validateReport({ ...base, project: broken, data, stale: [] }).some((x) => x.area === 'Missing references' && /GHOST/.test(x.message))).toBe(true);
  });
  it('a clean, run project has no errors from data or references', () => {
    const v = validateReport({ project: sampleProject, meta: { title: 'T' }, scope, sections: [buildSection('cable', data, scope)], data, stale: [], designBasis: false, resultsSummary: false });
    expect(v.filter((x) => x.level === 'error')).toEqual([]);
  });
});
