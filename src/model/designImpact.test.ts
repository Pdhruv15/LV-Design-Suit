import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { UPS_DEFAULTS } from '../calc/ups';
import { sheetsByCount } from './drawingSet';
import { updateCircuit } from './schedule';
import { impactBetween } from './designImpact';
import type { Project } from '../types';

const base = (): Project => ({
  ...sampleProject,
  drawingSet: sheetsByCount(sampleProject, 10),
  upsSystems: [{ ...UPS_DEFAULTS, id: 'u1', name: 'UPS-1', boardId: 'DB-GF1', chem: 'li-ion', blockV: 51.2, loads: [] }]
});
const feeder = (p: Project, id: string) => p.feeders.find((f) => f.id === id)!;
const set = (p: Project, id: string, patch: Record<string, unknown>): Project => ({ ...p, feeders: p.feeders.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

describe('impact of a design change', () => {
  it('a load change: the panel, what feeds it, the studies whose inputs differ, the sheets that show it, the quantities', () => {
    const a = base();
    const b = updateCircuit(a, 'DB-GF1-R3', { points: { cooker: 2 } });
    const i = impactBetween(a, b);
    expect(i.empty).toBe(false);
    const why = Object.fromEntries(i.panels.map((p) => [p.id, p.why]));
    expect(why['DB-GF1']).toBe('changed');
    expect(why['SMDB-GF']).toBe('upstream'); expect(why['MDB-1']).toBe('upstream');
    expect(why['SMDB-FF']).toBeUndefined(); // the other branch is untouched
    expect(i.studies.map((s) => s.id)).toEqual(expect.arrayContaining(['vd', 'checks', 'sizing']));
    expect(i.studies.find((s) => s.id === 'vd')!.reason).toBe('its inputs changed');
    expect(i.documents.some((d) => /E-SLD/.test(d.label) && d.reason.startsWith('shows'))).toBe(true);
    expect(i.documents.map((d) => d.label)).toEqual(expect.arrayContaining(['Load schedule', 'DB schedule', 'Calculation report and study reports']));
    expect(i.demand.find((k) => k.boardId === 'DB-GF1')!.to).toBeGreaterThan(i.demand.find((k) => k.boardId === 'DB-GF1')!.from);
    expect(i.changes[0].fields).toContainEqual({ field: 'Points', from: 'cooker 1', to: 'cooker 2' });
    expect(i.quantities.some((q) => q.to > q.from)).toBe(true);
    expect(i.quantities.every((q) => !('rate' in q) && !('cost' in q))).toBe(true);
  });

  it('a UPS that is fed from the changed panel is listed; a changed UPS lists the UPS study', () => {
    const a = base();
    const loadChange = impactBetween(a, set(a, 'DB-GF1-R1', { loadKw: 5 }));
    expect(loadChange.studies.find((s) => s.id === 'ups')).toMatchObject({ reason: expect.stringContaining('UPS-1 is fed from a panel whose load changed') });
    const upsChange = impactBetween(a, { ...a, upsSystems: [{ ...a.upsSystems![0], autonomyMin: 60 }] });
    expect(upsChange.studies.map((s) => s.id)).toEqual(['ups']);
    expect(upsChange.studies[0].reason).toBe('UPS data changed');
    expect(upsChange.assumptions.some((t) => /UPS runtime and battery size are not recomputed/.test(t))).toBe(true);
    expect(upsChange.panels).toEqual([]);
    const upstreamOnly = impactBetween(a, set(a, 'DB-GF1-R1', { loadKw: 5 }));
    expect(upstreamOnly.panels.find((p) => p.id === 'SMDB-GF')!.why).toBe('upstream');
  });

  it('a cable or breaker change lists the right schedules and the studies that use them', () => {
    const a = base();
    const cable = impactBetween(a, set(a, 'DB-GF1-R3', { lengthM: feeder(a, 'DB-GF1-R3').lengthM + 20 }));
    expect(cable.documents.map((d) => d.label)).toEqual(expect.arrayContaining(['Cable schedule', 'Cable tray schedule']));
    expect(cable.studies.map((s) => s.id)).toEqual(expect.arrayContaining(['vd', 'fault']));
    expect(cable.assumptions.some((t) => /design lengths/.test(t))).toBe(true);
    const brk = impactBetween(a, set(a, 'DB-GF1-R3', { breakerRatingA: feeder(a, 'DB-GF1-R3').breakerRatingA + 10 }));
    expect(brk.studies.map((s) => s.id)).toEqual(expect.arrayContaining(['checks', 'protection']));
    expect(brk.studies.map((s) => s.id)).not.toContain('vd');
  });

  it('an incomer change reaches the panels it feeds', () => {
    const a = base();
    const inc = a.feeders.find((f) => f.feedsBoardId === 'SMDB-GF')!;
    const i = impactBetween(a, set(a, inc.id, { cableCsaMm2: inc.cableCsaMm2 + 25 }));
    const why = Object.fromEntries(i.panels.map((p) => [p.id, p.why]));
    expect(why[inc.boardId]).toBe('changed');
    expect(why['SMDB-GF']).toBe('downstream'); expect(why['DB-GF1']).toBe('downstream');
  });

  it('a rename changes drawings and schedules, but needs no study run again', () => {
    const a = base();
    const b = { ...a, boards: a.boards.map((x) => (x.id === 'DB-GF1' ? { ...x, name: 'Ground floor DB (new name)' } : x)) };
    const i = impactBetween(a, b);
    expect(i.studies).toEqual([]);
    expect(i.documents.some((d) => /E-SLD/.test(d.label))).toBe(true);
    expect(i.assumptions).toEqual([]); // nothing needs re-running, so there is nothing to caveat
  });

  it('pricing, project details and bookkeeping are not design impact', () => {
    const a = base();
    expect(impactBetween(a, { ...a, boq: { discountPct: 5 }, status: 'review', tags: ['x'], updatedBy: 'Z', notes: 'n' }).empty).toBe(true);
  });

  it('never states a result: only what to run again, with the assumptions it makes', () => {
    const a = base();
    const i = impactBetween(a, set(a, 'DB-GF1-R1', { loadKw: 9 }));
    expect(Object.keys(i).sort()).toEqual(['assumptions', 'changes', 'demand', 'documents', 'empty', 'panels', 'quantities', 'studies']);
    expect(i.assumptions[0]).toMatch(/No new study results are shown/);
    expect(i.assumptions.some((t) => /no cost is shown/.test(t))).toBe(i.quantities.length > 0);
  });

  it('works on a frozen snapshot as the "before"', () => {
    const a = base();
    const snap = JSON.parse(JSON.stringify(a)) as Project;
    const b = set(a, 'DB-GF1-R1', { loadKw: 6 });
    expect(impactBetween(snap, b).panels.map((p) => p.id)).toContain('DB-GF1');
    expect(snap).toEqual(JSON.parse(JSON.stringify(a))); // the "before" is not modified
  });
});
