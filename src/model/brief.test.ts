import { describe, expect, it } from 'vitest';
import { newProject } from '../types';
import { sampleProject } from '../data/sampleProject';
import { buildDashboard } from '../calc/dashboard';
import { projectReadiness } from '../calc/projectReadiness';
import { applyBrief, defaultScope, deliverableCatalog, deliverableProgress, inScope, newBrief, withRole, withScope } from './brief';

describe('project brief', () => {
  it('starts each role with its own scope, deliverables and the right parties', () => {
    const c = newBrief('consultant', { company: 'ABC Eng' });
    expect(c.scope).toEqual(defaultScope('consultant'));
    expect(c.authority).toBe('DEWA');
    expect(c.parties.map((p) => [p.role, p.name])).toEqual([['owner', ''], ['consultant', 'ABC Eng'], ['contractor', ''], ['authority', 'DEWA']]);
    expect(c.deliverables.map((d) => d.id)).toEqual(['sld-set', 'load-schedules', 'calc-report', 'earthing-schematic', 'submission']);
    expect(c.deliverables[c.deliverables.length - 1].title).toBe('DEWA submission package');
    const k = newBrief('contractor');
    expect(k.boqType).toBe('new-installation');
    expect(k.deliverables.map((d) => d.id)).toContain('as-built');
    expect(k.deliverables.map((d) => d.id)).toContain('priced-boq');
    expect(c.boqType).toBeUndefined();
  });

  it('adds suggested deliverables for new scope and drops the unticked ones, keeping edits, done items and custom ones', () => {
    let b = newBrief('consultant');
    b = { ...b, deliverables: b.deliverables.map((d) => (d.id === 'calc-report' ? { ...d, targetDate: '2026-12-01', done: true } : d)).concat({ id: 'custom-1', title: 'Site survey report' }) };
    b = withScope(b, ['sld', 'ups']);
    const ids = b.deliverables.map((d) => d.id);
    expect(ids).toEqual(['sld-set', 'ups-report', 'submission', 'calc-report', 'custom-1']); // the done calc report stays (after the current ones); loads and earthing go
    expect(b.deliverables.find((d) => d.id === 'calc-report')).toMatchObject({ done: true, targetDate: '2026-12-01' });
    b = withScope(b, ['sld', 'ups', 'solar']);
    expect(b.deliverables.map((d) => d.id)).toContain('solar-report');
    expect(b.deliverables.filter((d) => d.id === 'sld-set')).toHaveLength(1);
  });

  it('changing role changes scope and deliverables but keeps the parties', () => {
    let b = newBrief('consultant', { company: 'ABC' });
    b = { ...b, parties: b.parties.map((p) => (p.role === 'owner' ? { ...p, name: 'Mansoori', tel: '04 123' } : p)) };
    const k = withRole(b, 'contractor', 'XYZ Contracting');
    expect(k.role).toBe('contractor');
    expect(k.scope).toEqual(defaultScope('contractor'));
    expect(k.parties.find((p) => p.role === 'owner')).toMatchObject({ name: 'Mansoori', tel: '04 123' });
    expect(k.parties.find((p) => p.role === 'contractor')!.name).toBe('XYZ Contracting');
    expect(k.parties.find((p) => p.role === 'consultant')!.name).toBe('ABC'); // kept
    expect(withRole(b, 'consultant')).toBe(b);
  });

  it('fills the header details from the parties without erasing what is there, and sets the BOQ type for a contractor', () => {
    const p = { ...newProject('Villa'), info: { owner: 'Old owner', consultant: 'Keep me', plotNo: '9', mdDemandFactor: 0.8 } };
    const b = newBrief('contractor', { company: 'XYZ' });
    const next = applyBrief(p, { ...b, boqType: 'fit-out', parties: b.parties.map((x) => (x.role === 'owner' ? { ...x, name: 'Mansoori', tel: '04 123' } : x)) });
    expect(next.info).toMatchObject({ owner: 'Mansoori', consultant: 'Keep me', contractor: 'XYZ', tel: '04 123', plotNo: '9', mdDemandFactor: 0.8 });
    expect(next.boq?.projectType).toBe('fit-out');
    expect(next.brief?.role).toBe('contractor');
    expect(applyBrief(p, newBrief('consultant')).boq).toBeUndefined();
  });

  it('everything is in scope without a brief; with one only what was chosen', () => {
    expect(inScope(newProject('A'), 'solar')).toBe(true);
    expect(inScope({ brief: newBrief('consultant') }, 'solar')).toBe(false);
    expect(inScope({ brief: newBrief('consultant') }, 'sld')).toBe(true);
  });

  it('counts deliverable progress', () => {
    const b = newBrief('consultant');
    expect(deliverableProgress(b)).toEqual({ done: 0, total: 5 });
    expect(deliverableProgress({ ...b, deliverables: b.deliverables.map((d, i) => ({ ...d, done: i < 2 })) })).toEqual({ done: 2, total: 5 });
    expect(deliverableProgress(undefined)).toEqual({ done: 0, total: 0 });
    expect(deliverableCatalog('consultant', [], '').map((d) => d.title)).toEqual(['authority submission package']);
  });
});

describe('readiness follows the scope', () => {
  const stages = (p: typeof sampleProject) => Object.fromEntries(projectReadiness(p, buildDashboard(p)).map((s) => [s.id, s.applicable]));
  it('counts every stage without a brief', () => {
    expect(Object.values(stages(sampleProject)).every(Boolean)).toBe(true);
  });
  it('leaves out stages the chosen scope does not need, but never setup or issue', () => {
    const boqOnly = { ...sampleProject, brief: { ...newBrief('contractor'), scope: ['boq' as const] } };
    expect(stages(boqOnly)).toEqual({ setup: true, design: false, calculate: false, resolve: false, drawings: false, issue: true });
    const earthOnly = { ...sampleProject, brief: { ...newBrief('consultant'), scope: ['earthing' as const] } };
    expect(stages(earthOnly)).toMatchObject({ design: false, calculate: true, drawings: true });
  });
});
