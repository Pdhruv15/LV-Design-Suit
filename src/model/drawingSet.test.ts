import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { autoSheets, autoSize, renumber, sheetProject, sheetsByCount } from './drawingSet';
import type { Project } from '../types';

const two: Project = { ...sampleProject, boards: [...sampleProject.boards, { id: 'MDB-2', name: 'MDB 2', kind: 'MDB', sourceKva: 1000, sourceImpedancePct: 5 }] };

describe('drawing set', () => {
  it('one sheet per MDB (overview when several), DBs as boxes, DB diagrams only on request', () => {
    const one = autoSheets(sampleProject, 'perMdb');
    expect(one.sheets.map((s) => s.number)).toEqual(['E-SLD-001']);
    expect(one.sheets[0].boards).toContain('DB-GF1');
    const t = autoSheets(two, 'perMdb');
    expect(t.sheets.map((s) => s.title)).toEqual(['SLD — overall (main boards and sub-mains)', 'SLD — MDB-1', 'SLD — MDB-2']);
    expect(t.sheets[0].boards).not.toContain('DB-GF1');
    const withDb = autoSheets(sampleProject, 'perMdb', true);
    expect(withDb.sheets[withDb.sheets.length - 1]).toMatchObject({ kind: 'board', boards: ['DB-GF1'], number: 'E-SLD-002' });
  });
  it('per SMDB: overview then a sheet for each SMDB with DBs', () => {
    const s = autoSheets(sampleProject, 'perSmdb');
    expect(s.sheets[0].boards).toEqual(['MDB-1', 'SMDB-GF', 'SMDB-FF', 'MCC-1']);
    expect(s.sheets.map((x) => x.title)).toContain('SLD — SMDB-GF');
  });
  it('feeders to a panel on another sheet end in "to X — sheet N"', () => {
    const s = autoSheets(sampleProject, 'perSmdb');
    const p = sheetProject(sampleProject, s, s.sheets[0]);
    const inc = p.feeders.find((f) => f.name.startsWith('To DB-GF1'))!;
    const gf = s.sheets.find((x) => x.title === 'SLD — SMDB-GF')!;
    expect(inc.name).toBe(`To DB-GF1 — sheet ${gf.number}`);
    expect(inc.feedsBoardId).toBeUndefined();
    expect(p.boards.map((b) => b.id)).not.toContain('DB-GF1');
  });
  it('size from what is drawn; renumbering', () => {
    expect(autoSize(800, 500).size).toBe('A4');
    expect(autoSize(1800, 700).size).toBe('A3');
    expect(autoSize(3800, 1500).size).toBe('A1');
    expect(autoSize(9000, 3000).fits).toBe(false);
    expect(renumber({ prefix: 'X-', sheets: autoSheets(two, 'perMdb').sheets }).sheets.map((s) => s.number)).toEqual(['X-001', 'X-002', 'X-003']);
  });
});

describe('sheets by panel count', () => {
  it('puts at most n panels on a sheet, every panel once, in supply order', async () => {

    const set = sheetsByCount(sampleProject, 2);
    const all = set.sheets.flatMap((s) => s.boards);
    expect(set.sheets.every((s) => s.boards.length <= 2)).toBe(true);
    expect(new Set(all).size).toBe(sampleProject.boards.length);
    expect(all.length).toBe(sampleProject.boards.length);
    expect(set.sheets[0].boards[0]).toBe('MDB-1');
    expect(sheetsByCount(sampleProject, 10).sheets.length).toBe(1);
  });
  it('keeps the connected load of a panel drawn on another sheet', () => {
    const set = sheetsByCount(sampleProject, 1);
    const first = sheetProject(sampleProject, set, set.sheets[0]);
    const cut = first.feeders.find((f) => f.name.startsWith('To SMDB-GF'))!;
    expect(cut.loadKw).toBeGreaterThan(0);
    expect(cut.demandFactor).toBeLessThanOrEqual(1);
  });
});

describe('drawing register', () => {
  it('numbers with prefix, start, digits and suffix; manual numbers are kept', () => {
    const set = sheetsByCount(sampleProject, 2, 'EL-');
    const r = renumber({ ...set, start: 101, digits: 4, suffix: '-SLD' }, true);
    expect(r.sheets[0].number).toBe('EL-0101-SLD');
    expect(r.sheets[1].number).toBe('EL-0102-SLD');
    const manual = { ...r, manualNumbers: true, sheets: r.sheets.map((s, i) => (i === 0 ? { ...s, number: 'E-100' } : s)) };
    expect(renumber(manual).sheets[0].number).toBe('E-100');
    expect(renumber(manual, true).sheets[0].number).toBe('EL-0101-SLD');
  });
});

describe('sheet exports use the whole network', async () => {
  const { sampleProject } = await import('../data/sampleProject');
  const { evaluateProject } = await import('../calc/electrical');
  const { sheetProject, sheetsByCount, autoSize, scaleOn, LEGEND_RESERVE_MM } = await import('./drawingSet');
  it('a sheet without its upstream panels would lose the upstream voltage drop on its own', () => {
    const set = sheetsByCount(sampleProject, 2);
    const down = set.sheets.find((s) => !s.boards.includes(sampleProject.boards.find((b) => !b.upstreamId)!.id))!;
    const part = evaluateProject(sheetProject(sampleProject, set, down));
    const full = new Map(evaluateProject(sampleProject).map((r) => [r.feeder.id, r]));
    const f = part.find((r) => full.get(r.feeder.id)!.vdUpstreamPct > 0)!;
    expect(f.vdUpstreamPct).toBeLessThan(full.get(f.feeder.id)!.vdUpstreamPct); // why sheets now take the full calculation
  });
  it('sizes for the legend column and checks a chosen paper', () => {
    expect(scaleOn('A3', 1800, 700, LEGEND_RESERVE_MM)).toBeLessThan(scaleOn('A3', 1800, 700));
    expect(autoSize(1800, 700, LEGEND_RESERVE_MM).size).not.toBe('A4');
  });
});
