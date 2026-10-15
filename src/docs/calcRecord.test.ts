import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { REFERENCE_CABLE_TABLE, setCables } from '../calc/cableTable';
import { runCalculations } from '../calc/runs';
import pkg from '../../package.json';
import { buildCalcRecord, calcRecordHtml } from './calcRecord';
import { buildReportHtml } from './calcReport';
import { buildSection, buildStudyReportHtml, scopeOf } from './studyReport';
import { buildStudyDocx, docxBytes } from './studyWord';

afterEach(() => setCables(null));
const row = (r: ReturnType<typeof buildCalcRecord>, label: string) => r.rows.find((x) => x.label === label)!.lines.join(' | ');
const verified = () => setCables(REFERENCE_CABLE_TABLE.map((c) => ({ ...c, manufacturer: 'Maker', referenceDoc: 'DS-1' })));

describe('calculation record', () => {
  it('records project, time, software, basis, assumptions, cable data, checks and limitations', () => {
    const at = Date.UTC(2026, 9, 14, 15, 41);
    const r = buildCalcRecord(sampleProject, { calculatedAt: at, current: true, statuses: ['ok', 'warn', 'warn'] });
    expect(r.rows.map((x) => x.label)).toEqual(['Project', 'Calculated', 'Software', 'Calculation basis', 'Key assumptions', 'Cable data', 'Input checks', 'Calculation warnings', 'Limitations']);
    expect(row(r, 'Project')).toContain(sampleProject.name);
    expect(row(r, 'Calculated')).toContain('14 Oct 2026');
    expect(row(r, 'Calculated')).toContain('results current');
    expect(row(r, 'Software')).toBe(`LV Design Studio ${pkg.version} · built-in calculation engine (no external engine used)`);
    expect(row(r, 'Calculation basis')).toContain('not verified against a specific edition');
    expect(row(r, 'Key assumptions')).toContain('415 V, 3-phase + N, 50 Hz, TN-S');
    expect(row(r, 'Key assumptions')).toContain('c max = 1.05 and cable R at 20 °C');
    expect(row(r, 'Key assumptions')).toContain('not a full IEC 60909 study');
    expect(row(r, 'Cable data')).toMatch(/^\d+ sizes used: \d+ app reference value/);
    expect(row(r, 'Input checks')).toBe('No invalid inputs, no supply loops, no missing references');
    expect(row(r, 'Calculation warnings')).toBe('0 failures · 2 to check');
  });

  it('PRELIMINARY with reference cable data, failures, invalid inputs or stale results; never "approved"', () => {
    expect(buildCalcRecord(sampleProject, { statuses: [] }).status).toBe('PRELIMINARY');
    expect(buildCalcRecord(sampleProject, { statuses: [] }).statusText).toContain('using approximate reference or unverified cable data');
    verified();
    expect(buildCalcRecord(sampleProject, { statuses: ['ok'] }).status).toBe('CALCULATED — FOR ENGINEERING REVIEW');
    expect(buildCalcRecord(sampleProject, { statuses: ['bad'] }).statusText).toContain('with failing checks');
    expect(buildCalcRecord(sampleProject, { statuses: [], calculatedAt: 0, current: false }).status).toBe('PRELIMINARY');
    const bad = { ...sampleProject, voltageV: 0 };
    expect(buildCalcRecord(bad, { statuses: [] }).statusText).toContain('with invalid inputs');
    for (const s of [true, false]) {
      const r = buildCalcRecord(sampleProject, { statuses: s ? [] : ['bad'] });
      expect(`${r.status} ${r.statusText}`).not.toMatch(/\bapproved\b/i);
      expect(r.statusText).toContain('Not an engineering approval and not an approval by DEWA or any other authority');
    }
  });

  it('HTML: escaped values, bold unverified cable line, the status box', () => {
    const html = calcRecordHtml(buildCalcRecord({ ...sampleProject, name: 'A <b>&</b>' }, { statuses: [] }));
    expect(html).toContain('A &lt;b&gt;&amp;&lt;/b&gt;');
    expect(html).toMatch(/<b>\d+ sizes used: /);
    expect(html).toContain('<b>simplified, preliminary, not a full IEC 60909 study</b>');
    expect(html).toContain('Validation status: PRELIMINARY.');
  });

  it('is in the study report after Document control (PDF and Word) and at the end of the design report', async () => {
    const run = runCalculations(sampleProject);
    const data = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
    const scope = scopeOf(sampleProject, { boards: [], downstream: true });
    const sections = [buildSection('sc', data, scope)];
    const html = buildStudyReportHtml(sampleProject, scope, sections, { title: 'Short circuit' }, {}, { calculatedAt: run.at, current: true });
    expect(html.indexOf('Calculation record')).toBeGreaterThan(html.indexOf('Document control'));
    expect(html.indexOf('Calculation record')).toBeLessThan(html.indexOf('Contents'));
    expect(html).toContain('results current for the inputs in this report');
    const xml = await (await JSZip.loadAsync(await docxBytes(buildStudyDocx(sampleProject, scope, sections, { title: 'Short circuit' }, { calculatedAt: run.at, current: true })))).file('word/document.xml')!.async('string');
    expect(xml).toContain('Calculation record');
    expect(xml).toContain('Validation status: PRELIMINARY.');
    const design = buildReportHtml(sampleProject);
    expect(design).toContain('Calculation record');
    expect(design).toContain('At the time of this print, from the current inputs');
  });
});
