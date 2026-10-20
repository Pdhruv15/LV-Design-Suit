import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { DEFAULT_TYPES, newAssessment } from '../calc/loadAssessment';
import { newProject, type Project } from '../types';
import { buildConceptReportHtml, conceptReport } from './conceptReport';

const withLa = (p: Project): Project => ({ ...p, loadAssessment: newAssessment(DEFAULT_TYPES[0], { gfaM2: 24000, floors: 20, parkingM2: 8000 }, { types: [] }) });

describe('concept design report', () => {
  it('uses the load assessment for the building, demand and supply', () => {
    const r = conceptReport(withLa(sampleProject), { preparedBy: 'PG', date: '2026-10-20' });
    expect(r.la?.gfaM2).toBe(24000);
    expect(r.designed).toBeUndefined();
    expect(r.rooms.length).toBeGreaterThan(0); // from the SLD's main boards when no substation is set
    expect(r.roomSource).not.toBe('project');
    const html = buildConceptReportHtml(withLa(sampleProject), { preparedBy: 'PG', date: '2026-10-20' });
    expect(html).toContain('FOR CONCEPT REVIEW');
    expect(html).toContain('Prepared by: PG');
    for (const h of ['1. Building', '2. Area schedule', '3. Maximum demand', '4. Supply', '5. Space requirements', '6. Assumptions']) expect(html).toContain(h);
    // black and white only: every colour is a grey
    for (const c of html.match(/#[0-9a-f]{3,6}\b/gi) ?? []) expect(['#000', '#444', '#999', '#fff', '#f2f2f2']).toContain(c.toLowerCase());
  });

  it('says what is missing instead of inventing it', () => {
    const r = conceptReport({ ...newProject('Empty'), boards: [] });
    expect(r.la).toBeUndefined();
    expect(r.rooms).toEqual([]);
    expect(r.confirm.join(' ')).toMatch(/No load assessment/);
    expect(r.confirm.join(' ')).toMatch(/No substation defined/);
    expect(buildConceptReportHtml({ ...newProject('Empty'), boards: [] })).toContain('to confirm');
  });

  it('uses the substations set on the Substation area page', () => {
    const p: Project = { ...withLa(newProject('A')), substations: [{ id: 's1', name: 'SS-1', type: 'conventional', transformers: 2, kva: 1500 }] };
    const r = conceptReport(p);
    expect(r.roomSource).toBe('project');
    expect(r.rooms[0]).toMatchObject({ name: 'SS-1', transformers: 2, kva: 1500 });
    expect(r.rooms[0].totalM2).toBeGreaterThan(0);
  });
});
