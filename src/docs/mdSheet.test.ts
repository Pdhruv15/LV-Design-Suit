import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyMdEdits, buildMdSheet, connectedPhaseKw, hasMdSheet, suggestedMeter, type MdSheet } from './mdSheet';

const col = (s: MdSheet, k: string) => s.keys.indexOf(k as never);
const rowOf = (s: MdSheet, id: string) => s.rows.findIndex((r) => (r.type === 'feeder' || r.type === 'incomer') && r.feeder?.id === id);

describe('connected load & maximum demand sheet', () => {
  it('is made for boards with outgoing feeders, not for a DB with only circuits', () => {
    expect(['MDB-1', 'SMDB-GF', 'SMDB-FF', 'MCC-1'].every((b) => hasMdSheet(sampleProject, b))).toBe(true);
    expect(hasMdSheet(sampleProject, 'DB-GF1')).toBe(false);
  });

  it('lists the incomer, OUT GOING, each outgoing feeder and a spare line', () => {
    const s = buildMdSheet(sampleProject, 'SMDB-GF');
    expect(s.data.map((r) => r[0])).toEqual(['INCOMER', 'OUT GOING', 'LIGHTING', 'SOCKETS', 'HVAC', 'DB-GF1 (VILLA GROUND FLOOR DB)', '']);
    expect(s.merges.A2).toEqual([s.keys.length, 1]);
    // Incomer row: the MDB's feeder to this SMDB.
    const inc = s.data[0];
    expect([inc[col(s, 'sptp')], inc[col(s, 'MCCB')], inc[col(s, 'cores')], inc[col(s, 'size')], inc[col(s, 'length')]]).toEqual(['TP', 500, '4C', 300, 35]);
    expect(inc[col(s, 'R')]).toBe('');
  });

  it("takes a DB's connected load per phase from its load schedule", () => {
    const s = buildMdSheet(sampleProject, 'SMDB-GF');
    const y = rowOf(s, 'INC-DBGF1');
    const p = connectedPhaseKw(sampleProject, 'DB-GF1');
    expect(s.data[y][col(s, 'R')]).toBe(p.R.toFixed(2));
    expect(s.data[y][col(s, 'tcl')]).toBe((p.R + p.Y + p.B).toFixed(2));
    expect(s.data[y][col(s, 'mdl')]).toBe(((p.R + p.Y + p.B) * 0.8).toFixed(2));
  });

  it('totals the connected load, and maximum demand = TCL × demand factor', () => {
    const s = buildMdSheet(sampleProject, 'MDB-1');
    const tcl = connectedPhaseKw(sampleProject, 'MDB-1');
    const total = tcl.R + tcl.Y + tcl.B;
    expect(s.totals[col(s, 'tcl')]).toBe(total.toFixed(2));
    expect(s.form.maxDemandKw).toBeCloseTo(total * 0.8, 9);
    expect(s.form.demandFactor).toBe(0.8);
    expect(s.form.connectedTo[0]).toBe('MDB CONNECTED TO: DEWA METER CABINET');
  });

  it('leaves generation (PV) out of the connected load', () => {
    const s = buildMdSheet(sampleProject, 'MDB-1');
    expect(s.data[rowOf(s, 'DB-PV')][col(s, 'tcl')]).toBe('0.00');
  });

  it('an authority-fed board shows its supply on the INCOMER row, with a suggested meter', () => {
    const s = buildMdSheet(sampleProject, 'MDB-1');
    expect(s.data[0][col(s, 'cores')]).toBe('BY DEWA');
    expect(s.merges[`${String.fromCharCode(65 + col(s, 'cores'))}1`]).toEqual([3, 1]);
    expect(s.data[0][col(s, 'MCCB')]).toBe(1600);
    expect(s.data[0][col(s, 'CT')]).toBe(1);
    expect([suggestedMeter(40, false), suggestedMeter(100, true), suggestedMeter(200, true)]).toEqual(['1-PH', '3-PH', 'CT']);
  });

  it('writes ratings, cable, meters and remarks back; loads and panel names stay locked', () => {
    const s = buildMdSheet(sampleProject, 'SMDB-GF');
    const y = rowOf(s, 'INC-DBGF1');
    expect(s.editable(y, col(s, 'R'))).toBe(false);
    expect(s.editable(y, col(s, 'name'))).toBe(false);
    const { project, rejected } = applyMdEdits(sampleProject, s, [
      { y, x: col(s, 'ISOL'), value: '100' },
      { y, x: col(s, 'type'), value: 'XLPE/SWA/PVC' },
      { y, x: col(s, '3-PH'), value: '1' },
      { y, x: col(s, 'remarks'), value: 'Via 100A TP isolator' },
      { y, x: col(s, 'size'), value: '37' },
      { y, x: col(s, 'R'), value: '99' }
    ]);
    expect(rejected).toEqual(['I6: "37" is not a cable size from the cable table']);
    const f = project.feeders.find((x) => x.id === 'INC-DBGF1')!;
    expect([f.device, f.breakerRatingA, f.cableType, f.kwhMeter, f.remarks, f.cableCsaMm2]).toEqual(['ISOL', 100, 'XLPE/SWA/PVC', '3-PH', 'Via 100A TP isolator', 35]);
    const again = buildMdSheet(project, 'SMDB-GF');
    expect(again.data[y][col(again, 'ISOL')]).toBe(100);
    expect(again.data[y][col(again, 'MCCB')]).toBe('');
    expect(again.totals[col(again, '3-PH')]).toBe('1');
  });

  it("edits an authority-fed incomer's supply on the board", () => {
    const s = buildMdSheet(sampleProject, 'MDB-1');
    const { project } = applyMdEdits(sampleProject, s, [
      { y: 0, x: col(s, 'MCCB'), value: '100' },
      { y: 0, x: col(s, 'fault'), value: '35' },
      { y: 0, x: col(s, 'cores'), value: 'BY FEWA' },
      { y: 0, x: col(s, 'ecc'), value: '2X1CX35' },
      { y: 0, x: col(s, 'CT'), value: '1' }
    ]);
    expect(project.boards.find((b) => b.id === 'MDB-1')!.supply).toEqual({ device: 'MCCB', ratingA: 100, faultKa: 35, cable: 'BY FEWA', ecc: '2X1CX35', meter: 'CT' });
  });

  it('equipment names can be typed; clearing a meter removes it', () => {
    const s = buildMdSheet(sampleProject, 'MCC-1');
    const y = rowOf(s, 'MCC-WP');
    const withMeter = applyMdEdits(sampleProject, s, [{ y, x: col(s, 'name'), value: 'AHU-01' }, { y, x: col(s, 'CT'), value: '1' }]).project;
    const f = withMeter.feeders.find((x) => x.id === 'MCC-WP')!;
    expect([f.name, f.kwhMeter]).toEqual(['AHU-01', 'CT']);
    const cleared = applyMdEdits(withMeter, buildMdSheet(withMeter, 'MCC-1'), [{ y, x: col(s, 'CT'), value: '' }]).project;
    expect('kwhMeter' in cleared.feeders.find((x) => x.id === 'MCC-WP')!).toBe(false);
  });
});
