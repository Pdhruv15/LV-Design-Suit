import { describe, expect, it } from 'vitest';
import type { SpacePlan } from '../types';
import { areaLoad, autoAssign, emptyPlan, panelLoad, planTransformerKva, summarize, transformersFor } from './spacePlan';

/** Three buildings and a chiller plant, like the example. */
function example(): SpacePlan {
  const p = emptyPlan();
  p.areas = [
    { id: 'a1', building: 'Building A', floor: 'GF–5', name: 'Apartments', use: 'residential', areaM2: 9000 },
    { id: 'a2', building: 'Building A', floor: 'GF', name: 'Retail', use: 'retail', areaM2: 800 },
    { id: 'a3', building: 'Building A', floor: 'Roof', name: 'Chillers', use: 'services', kw: 450 },
    { id: 'b1', building: 'Building B', floor: 'GF–4', name: 'Apartments', use: 'residential', areaM2: 7500 },
    { id: 'c1', building: 'Building C', floor: 'B1', name: 'Car park', use: 'parking', areaM2: 6000 }
  ];
  return p;
}

describe('space planning', () => {
  it('area load: area × W/m², or a specific kW, times the demand factor', () => {
    const p = example();
    const l = areaLoad(p, p.areas[0]);
    expect([l.wPerM2, l.demandFactor, l.connectedKw]).toEqual([80, 0.7, 720]);
    expect(l.demandKw).toBeCloseTo(504, 9);
    expect(areaLoad(p, p.areas[2])).toMatchObject({ connectedKw: 450, demandKw: 450 });
    expect(areaLoad(p, { ...p.areas[0], wPerM2: 50, demandFactor: 1 })).toMatchObject({ connectedKw: 450, demandKw: 450 });
  });

  it('transformer count at the loading limit, and the DEWA size giving fewer units', () => {
    expect(transformersFor(2400, 1500, 80)).toBe(2); // 2 × 1200 kVA usable
    expect(transformersFor(2401, 1500, 80)).toBe(3);
    expect(transformersFor(0, 1500, 80)).toBe(0);
    const p = emptyPlan();
    expect(planTransformerKva(p, 700)).toBe(1000); // 1 unit either way → the smaller
    expect(planTransformerKva(p, 1500)).toBe(1000); // 2 × 1000 at 75 % vs 2 × 1500
    expect(planTransformerKva(p, 2000)).toBe(1500); // 3 × 1000 vs 2 × 1500 → fewer units
    expect(planTransformerKva({ ...p, settings: { ...p.settings, transformerKva: 1500 } }, 700)).toBe(1500);
  });

  it('auto-assign: MDB per building, transformers packed to the limit, 2 per RMU', () => {
    const p = autoAssign(example());
    const byArea = new Map(p.areas.map((a) => [a.id, a.panel]));
    expect(byArea.get('a1')).toBe(byArea.get('a2')); // same building, one MDB while it fits
    expect(byArea.get('b1')).not.toBe(byArea.get('a1'));
    expect(p.panels.every((x) => x.kind === 'MDB' && x.transformer)).toBe(true);
    const s = summarize(p);
    expect(s.transformers.every((t) => t.loadingPct <= 80 + 1e-9)).toBe(true);
    expect(s.transformers.length).toBeGreaterThanOrEqual(s.requiredTransformers);
    expect(s.rmus.every((r) => r.transformers.length <= 2)).toBe(true);
    expect(s.rmus.length).toBe(Math.ceil(p.transformers.length / 2));
    expect(s.unassignedAreas).toEqual([]);
    expect(s.unfedPanels).toEqual([]);
    // Every kW is somewhere: transformer demand = total demand.
    expect(s.transformers.reduce((x, t) => x + t.demandKva, 0)).toBeCloseTo(s.demandKva, 6);
  });

  it('one transformer can feed MDBs in different buildings', () => {
    const p = autoAssign(example());
    const buildingsPerTx = summarize(p).transformers.map((t) => new Set(t.panels.map((x) => x.building)).size);
    expect(Math.max(...buildingsPerTx)).toBeGreaterThan(1);
  });

  it('a building too big for one transformer is split over several MDBs', () => {
    const p = emptyPlan();
    p.areas = [
      // 12 000 m² × 80 W/m² × 0.7 ÷ 0.9 ≈ 747 kVA each: both won't fit one 1000 or 1500 kVA at 80 %
      { id: 't1', building: 'Tower', floor: '1–20', name: 'Apartments low', use: 'residential', areaM2: 12000 },
      { id: 't2', building: 'Tower', floor: '21–40', name: 'Apartments high', use: 'residential', areaM2: 12000 }
    ];
    const a = autoAssign(p);
    expect(new Set(a.areas.map((x) => x.panel)).size).toBe(2);
    expect(summarize(a).transformers.every((t) => t.status === 'ok')).toBe(true);
  });

  it('keeps what is already assigned and only fills the gaps', () => {
    const p = example();
    p.panels = [{ id: 'MDB-X', building: 'Building A', kind: 'MDB', transformer: 'TX-9' }];
    p.transformers = [{ id: 'TX-9', kva: 1500, rmu: 'RMU-7' }];
    p.areas[0].panel = 'MDB-X';
    const a = autoAssign(p);
    expect(a.areas[0].panel).toBe('MDB-X');
    expect(a.panels.find((x) => x.id === 'MDB-X')!.transformer).toBe('TX-9');
    expect(a.transformers.find((t) => t.id === 'TX-9')!.rmu).toBe('RMU-7');
  });

  it('an SMDB below an MDB counts in the MDB and its transformer', () => {
    const p = example();
    p.panels = [
      { id: 'MDB-A1', building: 'Building A', kind: 'MDB', transformer: 'TX-1' },
      { id: 'SMDB-A1-R', building: 'Building A', kind: 'SMDB', parent: 'MDB-A1' }
    ];
    p.transformers = [{ id: 'TX-1', kva: 1500 }];
    p.areas[0].panel = 'MDB-A1';
    p.areas[1].panel = 'SMDB-A1-R';
    const l = panelLoad(p, 'MDB-A1');
    expect(l.demandKw).toBeCloseTo(504 + 800 * 0.12 * 0.8, 9);
    expect(summarize(p).transformers[0].demandKva).toBeCloseTo(l.demandKva, 9);
  });
});

describe('create SLD from the plan', () => {
  it('RMU → transformer → MDBs → areas, every feeder sized and passing', async () => {
    const { planToSld } = await import('../model/planToSld');
    const { newProject } = await import('../types');
    const { evaluateProject, boardDemandKw } = await import('./electrical');
    const plan = autoAssign(example());
    plan.panels.push({ id: 'SMDB-A-ROOF', building: 'Building A', kind: 'SMDB', parent: plan.areas[0].panel, location: 'Roof' });
    plan.areas[2].panel = 'SMDB-A-ROOF'; // chillers on a roof SMDB
    const { project: p, counts } = planToSld(newProject('Plan'), plan);
    expect(counts).toEqual({ rmus: summarize(plan).rmus.length, transformers: plan.transformers.length, panels: plan.panels.length, loads: 5 });
    const roots = p.boards.filter((b) => !b.upstreamId);
    expect(roots.map((b) => b.id)).toEqual(plan.transformers.map((t) => t.id));
    expect(roots.every((b) => b.sourceKva && b.rmu)).toBe(true);
    const smdb = p.boards.find((b) => b.id === 'SMDB-A-ROOF')!;
    expect(smdb.upstreamId).toBe(plan.areas[0].panel);
    expect(p.feeders.find((f) => f.boardId === 'SMDB-A-ROOF')).toMatchObject({ name: 'Roof Chillers', loadKw: 450 });
    // Demand per transformer matches the plan (kW; the plan adds PF + growth on top).
    const s = summarize(plan);
    for (const t of s.transformers) {
      const kw = boardDemandKw(p, t.transformer.id);
      expect(kw / plan.settings.powerFactor).toBeCloseTo(t.demandKva, 3);
    }
    // Sized by the app: nothing fails.
    expect(evaluateProject(p).filter((r) => r.status === 'bad').map((r) => r.feeder.id)).toEqual([]);
  });
});
