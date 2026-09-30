import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { boardDemandKw, evaluateFeeder } from './electrical';
import { addVdCable, editVdCable, groupByPanel, vdCandidates, vdRow, vdRows } from './voltageDrop';

describe('voltage drop calculation', () => {
  it('leaves out final circuits on DB load schedules', () => {
    const ids = vdCandidates(sampleProject).map((f) => f.id);
    expect(ids).toContain('INC-DBGF1');
    expect(ids).toContain('MCC-WP');
    expect(ids.some((id) => id.startsWith('DB-GF1-'))).toBe(false);
  });

  it('lists cables in supply order, MDB first', () => {
    const froms = vdCandidates(sampleProject).map((f) => f.boardId);
    expect(froms[0]).toBe('MDB-1');
    expect(froms.indexOf('DB-GF1')).toBe(-1);
    expect(froms.lastIndexOf('MDB-1')).toBeLessThan(froms.indexOf('SMDB-GF'));
  });

  it('matches the feeder check on every cable', () => {
    for (const f of vdCandidates(sampleProject)) {
      const r = vdRow(sampleProject, f);
      const e = evaluateFeeder(sampleProject, f);
      expect(r.vdPct).toBeCloseTo(e.vdPct, 9);
      expect(r.totalPct).toBeCloseTo(e.vdTotalPct, 9);
      expect(r.status).toBe(e.vdStatus);
    }
  });

  it('Vd (V) = mV/A/m × Ib × L, and Vd % is against the line voltage for 3-phase', () => {
    const r = vdRow(sampleProject, sampleProject.feeders.find((f) => f.id === 'MCC-WP')!);
    expect(r.vdV).toBeCloseTo((r.mvPerAm * r.ib * 20) / 1000, 9);
    expect(r.vdPct).toBeCloseTo((r.vdV / 415) * 100, 9);
    expect(r.toName).toBe('Water pump');
    expect(r.toType).toBe('Motor (DOL)');
  });

  it("takes a DB incomer's load from the DB's load schedule", () => {
    const r = vdRow(sampleProject, sampleProject.feeders.find((f) => f.id === 'INC-DBGF1')!);
    expect(r.from.id).toBe('SMDB-GF');
    expect(r.toName).toBe('DB-GF1');
    expect(r.toType).toBe('DB');
    expect(r.scheduleCircuits).toBe(21);
    expect(r.loadKw).toBeCloseTo(boardDemandKw(sampleProject, 'DB-GF1'), 9);
    // Adding load on the schedule raises the incomer's voltage drop.
    const heavier = {
      ...sampleProject,
      feeders: sampleProject.feeders.map((f) => (f.id === 'DB-GF1-R3' ? { ...f, loadKw: 12 } : f))
    };
    expect(vdRow(heavier, heavier.feeders.find((f) => f.id === 'INC-DBGF1')!).vdPct).toBeGreaterThan(r.vdPct);
  });

  it('calculates only the selected cables, grouped by panel', () => {
    const rows = vdRows(sampleProject, ['MCC-FP', 'INC-GF', 'DB-GF1-R1', 'GONE']);
    expect(rows.map((r) => r.feeder.id)).toEqual(['INC-GF', 'MCC-FP']);
    expect(groupByPanel(rows).map((g) => g.board.id)).toEqual(['MDB-1', 'MCC-1']);
  });

  it('writes table edits back to the project', () => {
    const p = editVdCable(sampleProject, 'MCC-WP', { lengthM: 55, cableCsaMm2: 70, name: 'Booster pump', remarks: 'Via isolator' });
    const f = p.feeders.find((x) => x.id === 'MCC-WP')!;
    expect([f.lengthM, f.cableCsaMm2, f.name, f.remarks]).toEqual([55, 70, 'Booster pump', 'Via isolator']);
    expect(editVdCable(p, 'MCC-WP', { remarks: '' }).feeders.find((x) => x.id === 'MCC-WP')!.remarks).toBeUndefined();
  });

  it("never overwrites a panel feeder's load (it comes from the panel)", () => {
    const p = editVdCable(sampleProject, 'INC-GF', { loadKw: 999, lengthM: 40 });
    const f = p.feeders.find((x) => x.id === 'INC-GF')!;
    expect(f.loadKw).toBe(0);
    expect(f.lengthM).toBe(40);
  });

  it('adds an equipment cable with a unique id', () => {
    const a = addVdCable(sampleProject, 'MCC-1');
    const b = addVdCable(a.project, 'MCC-1');
    expect([a.id, b.id]).toEqual(['MCC-1-EQ1', 'MCC-1-EQ2']);
    expect(vdCandidates(b.project).map((f) => f.id)).toContain('MCC-1-EQ2');
  });
});

describe('voltage drop page additions', async () => {
  const { sampleProject: p } = await import('../data/sampleProject');
  const { vdPath, suggestCable, worstFinalCircuits, vdFormula, vdRow } = await import('./voltageDrop');
  const { riserVd, newRiser } = await import('./busbar');
  const { resistanceFactor } = await import('./electrical');
  it('conductor temperature changes the resistance', () => {
    const f = p.feeders.find((x) => x.feedsBoardId)!;
    const r70 = vdRow({ ...p, vdTempC: 70 }, f), r90 = vdRow({ ...p, vdTempC: 90 }, f);
    expect(r90.vdPct).toBeGreaterThan(r70.vdPct);
    expect(resistanceFactor(90)).toBeCloseTo(1.2751, 3);
    expect(resistanceFactor()).toBe(1.2);
  });
  it('follows the supply path from the main board', () => {
    const deep = p.feeders.find((f) => f.boardId === 'SMDB-GF' && !f.phase)!;
    const path = vdPath(p, deep);
    expect(path[0].from.id).toBe('MDB-1');
    expect(path[path.length - 1].feeder.id).toBe(deep.id);
    expect(path[path.length - 1].totalPct).toBeCloseTo(path.reduce((a, r) => a + r.vdPct, 0), 6);
  });
  it('suggests a bigger cable that passes', () => {
    const f = { ...p.feeders.find((x) => !x.feedsBoardId && !x.phase)!, lengthM: 900 };
    const s = suggestCable({ ...p, feeders: p.feeders.map((x) => (x.id === f.id ? f : x)) }, f);
    if (s) { expect(s.csaMm2).toBeGreaterThan(f.cableCsaMm2); expect(s.totalPct).toBeLessThanOrEqual(p.vdLimitPct); }
  });
  it('finds each DB’s worst final circuit and writes the formula', () => {
    const w = worstFinalCircuits(p);
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].finalCircuit).toBe(true);
    expect(vdFormula(p, w[0])).toContain('ΔV =');
  });
  it('splits a riser into concentrated and distributed lengths', () => {
    const r = { ...newRiser('R1', 'MDB-1'), feedM: 10, offsetFloors: 1, floorHeightM: 3.6 };
    const v = riserVd(p, r);
    expect(v.concentratedM).toBeCloseTo(10 + 3.6, 6);
    expect(v.distributedM).toBeCloseTo(5 * 3.6, 6);
    expect(v.segments[0].kind).toBe('concentrated');
    expect(v.segments[v.segments.length - 1].currentA).toBeLessThan(v.segments[0].currentA);
    // Uniform-load quick check is close to (and not below) the exact result for equal floors.
    expect(v.uniformTopPct).toBeGreaterThanOrEqual(v.exactTopPct - 1e-9);
  });
});
