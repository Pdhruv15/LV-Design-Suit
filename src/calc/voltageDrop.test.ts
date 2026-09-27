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
