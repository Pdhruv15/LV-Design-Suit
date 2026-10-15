import { describe, expect, it } from 'vitest';
import { sampleProject } from '../../data/sampleProject';
import { runCalculations } from '../../calc/runs';
import { CATALOGUE, CATEGORIES, unavailable, type ExportContext } from './exportCatalogue';
import { PFC_CALC_DEFAULT } from '../../calc/pfcCalc';
import { UPS_DEFAULTS } from '../../calc/ups';
import { PV_DEFAULTS } from '../../calc/solar';
import { CONTAINMENT_DEFAULT } from '../../calc/containment';
import { emptyTrayPlan } from '../../calc/cableTray';
import type { Project } from '../../types';

const run = runCalculations(sampleProject);
const ctx: ExportContext = { project: sampleProject, run, stale: [] };

describe('export centre catalogue', () => {
  it('has every one of the seven groups, and unique keys', () => {
    for (const c of CATEGORIES) expect(CATALOGUE.some((e) => e.category === c), c).toBe(true);
    expect(new Set(CATALOGUE.map((e) => e.key)).size).toBe(CATALOGUE.length);
  });

  it('builds every available document of the sample project as a complete HTML page', () => {
    const built = CATALOGUE.filter((e) => !unavailable(e, ctx));
    expect(built.length).toBeGreaterThanOrEqual(10);
    for (const e of built) {
      const parts = e.build(ctx);
      expect(parts.length, e.key).toBeGreaterThan(0);
      for (const p of parts) {
        expect(p.html.trimStart().toLowerCase().startsWith('<!doctype html>'), `${e.key}: doctype`).toBe(true);
        expect(p.html, `${e.key}: no unfilled tokens`).not.toContain('${');
        expect(p.file, `${e.key}: file name`).toMatch(/^[\w.-][\w .()-]*$/);
      }
    }
  });

  it('holds back documents that need results until the calculations are run and current', () => {
    const needs = CATALOGUE.filter((e) => e.needsRun);
    expect(needs.length).toBeGreaterThan(0);
    for (const e of needs) {
      expect(unavailable(e, { ...ctx, run: undefined })).toMatch(/Run the calculations/);
      expect(unavailable(e, { ...ctx, stale: ['vd'] as ExportContext['stale'] })).toMatch(/out of date/);
    }
    expect(CATALOGUE.filter((e) => !e.needsRun && !e.missing).every((e) => !unavailable(e, { ...ctx, run: undefined }))).toBe(true);
  });

  it('says why a document has nothing to export', () => {
    const empty = { ...sampleProject, pfcCalc: undefined, upsSystems: [], substations: [] };
    const c = { ...ctx, project: empty };
    expect(unavailable(CATALOGUE.find((e) => e.key === 'pfc-calc')!, c)).toBe('No PFC calculation entered');
    expect(unavailable(CATALOGUE.find((e) => e.key === 'ups')!, c)).toBe('No UPS system entered');
    expect(unavailable(CATALOGUE.find((e) => e.key === 'dm-form')!, c)).toBe('No substation entered');
  });

  it('builds the documents that need their own inputs once those are entered', () => {
    const p = {
      ...sampleProject, pfcCalc: { ...PFC_CALC_DEFAULT, title: 'MDB-1' },
      upsSystems: [{ ...UPS_DEFAULTS, id: 'u', name: 'UPS-1', loads: [{ id: 'a', name: 'Servers', qty: 10, w: 1000, pf: 0.9 }] }],
      pv: PV_DEFAULTS, containmentCalc: CONTAINMENT_DEFAULT,
      trays: { ...emptyTrayPlan(), routes: [{ id: 'r', name: 'A', lengthM: 20, cables: [{ id: 'c', cores: 4, csaMm2: 95, qty: 2 }] }] },
      substations: [{ id: 's', name: 'SS-1', type: 'conventional', transformers: 2 }],
      drawingSet: { prefix: 'E-SLD-', register: true, sheets: [{ id: 'a', number: 'E-SLD-001', title: 'SLD — MDB-1', kind: 'system', boards: ['MDB-1'], size: 'A3' }],
        issues: [{ id: 'T-001', date: '2026-10-15', purpose: 'FOR APPROVAL', description: 'First issue', to: 'DEWA', sheets: [{ id: 'a', number: 'E-SLD-001', title: 'SLD — MDB-1', rev: 'A' }] }] }
    } as unknown as Project;
    const c = { ...ctx, project: p };
    for (const key of ['pfc-calc', 'ups', 'solar', 'containment', 'tray-schedule', 'dm-form', 'drawing-register', 'submissions']) {
      const e = CATALOGUE.find((x) => x.key === key)!;
      expect(unavailable(e, c), key).toBeUndefined();
      const parts = e.build(c);
      expect(parts.length, key).toBe(1);
      expect(parts[0].html.trimStart().toLowerCase().startsWith('<!doctype html>'), key).toBe(true);
    }
  });
});
