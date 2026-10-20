import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { sampleProject } from '../data/sampleProject';
import { assess, DEFAULT_TYPES, newAssessment, type LoadAssessment } from '../calc/loadAssessment';
import type { Project } from '../types';
import { buildDesignBasis, designBasisSections, loadAssessmentBasis } from './designBasis';
import { buildStudyReportHtml, scopeOf } from './studyReport';
import { buildStudyDocx, docxBytes } from './studyWord';

const la = (patch: Partial<LoadAssessment> = {}): LoadAssessment => ({
  ...newAssessment(DEFAULT_TYPES[0], { gfaM2: 24000, floors: 20, parkingM2: 8000 }, { types: [] }),
  custom: [{ id: 'c1', label: 'Rooftop BMU', qty: 1, kw: 30, diversity: 0.5, onGenerator: false }],
  inReport: true,
  ...patch
});
const withLa = (a?: LoadAssessment): Project => ({ ...sampleProject, loadAssessment: a });
const scope = scopeOf(sampleProject, { boards: [], downstream: true });

describe('design basis — load assessment section', () => {
  it('is in the report only when added from the Load assessment page', () => {
    expect(buildDesignBasis(withLa(), []).loadAssessment).toBeUndefined();
    expect(buildDesignBasis(withLa(la({ inReport: undefined })), []).loadAssessment).toBeUndefined();
    const b = buildDesignBasis(withLa(la()), []);
    expect(b.loadAssessment).toBeDefined();
    expect(designBasisSections(b).map((s) => s.title)).toEqual(['Executive summary', 'Project scope', 'Electrical system description', 'Codes and standards', 'Design criteria', 'Load assessment']);
  });

  it('reports the assessment’s own figures: type, area schedule, services, categories, MD, VA/m², transformers, generator', () => {
    const a = la();
    const r = assess(a);
    const l = loadAssessmentBasis(a);
    expect(l.typeLabel).toBe('Residential tower');
    expect(l.rows).toHaveLength(a.rows.length);
    expect(l.areaM2).toBeCloseTo(24000);
    expect(l.services.map((s) => s.service)).toEqual(expect.arrayContaining(['Cooling', 'Domestic hot water', 'Lifts', 'EV charging', 'Fire and life safety', 'Rooftop BMU (custom)']));
    expect(l.notSelected).toEqual(expect.arrayContaining(['IT / server room', 'Laundry']));
    expect(l.categories).toHaveLength(r.categories.length);
    expect(l.categories.find((c) => c.label.startsWith('Fire'))!.demandKw).toBeUndefined(); // generator only
    expect(l.mdKva).toBeCloseTo(r.mdKva);
    expect(l.vaPerM2).toBeCloseTo(r.vaPerM2);
    expect(l.inBand).toBe(true);
    expect(l.tx).toMatchObject({ count: r.tx!.count, kva: r.tx!.kva });
    expect(l.generator).toEqual({ count: r.generatorCount, kva: r.generatorKva });
  });

  it('prints as section 6 in plain black and white, the band check told in words', () => {
    const html = buildStudyReportHtml(withLa(la()), scope, [], { title: 'T' }, {}, { designBasis: true });
    expect(html).toContain('6. Load assessment');
    const sec = html.slice(html.indexOf('6. Load assessment'));
    for (const t of ['Residential tower', 'Area schedule', 'Service requirements', 'Load categories and maximum demand', 'within the typical band', '2 × 1,250 kVA', '1 × 1,000 kVA']) expect(sec).toContain(t);
    // No colour of its own: no inline styles or colour classes in the section.
    const own = designBasisSections(buildDesignBasis(withLa(la()), [])).find((s) => s.title === 'Load assessment')!.html;
    expect(own).not.toMatch(/style=|color|#[0-9a-f]{3,6}\b/i);
    const out = designBasisSections(buildDesignBasis(withLa(la({ vaBand: [10, 20] })), [])).find((s) => s.title === 'Load assessment')!.html;
    expect(out).toContain('<td class="warn">');
    expect(out).toContain('OUTSIDE the typical band');
  });

  it('is in the Word report too', async () => {
    const bytes = await docxBytes(buildStudyDocx(withLa(la()), scope, [], { title: 'Design report' }, { designBasis: true }));
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    for (const t of ['Load assessment', 'Residential tower', 'Rooftop BMU (custom)', 'within the typical band']) expect(xml).toContain(t);
  });
});
