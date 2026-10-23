import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyRecommendation, recommend } from '../calc/sizing';
import { addOutgoingFeeder } from '../model/mdFeeders';
import { applyMdEdits, buildMdSheet, connectedPhaseKw, panelDf, hasMdSheet, suggestedMeter, type MdSheet } from './mdSheet';

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
    const df = panelDf(sampleProject, sampleProject.boards.find((b) => b.id === 'SMDB-GF')!);
    expect(s.data[y][col(s, 'mdl')]).toBe(((p.R + p.Y + p.B) * df).toFixed(2));
  });

  it('totals the connected load, and maximum demand = TCL × demand factor', () => {
    const s = buildMdSheet(sampleProject, 'MDB-1');
    const tcl = connectedPhaseKw(sampleProject, 'MDB-1');
    const total = tcl.R + tcl.Y + tcl.B;
    expect(s.totals[col(s, 'tcl')]).toBe(total.toFixed(2));
    const df = panelDf(sampleProject, sampleProject.boards.find((b) => b.id === 'MDB-1')!);
    expect(s.form.maxDemandKw).toBeCloseTo(total * df, 9);
    expect(s.form.demandFactor).toBe(df);
    expect(s.form.connectedTo[0]).toBe('MDB CONNECTED TO: DEWA METER CABINET');
  });

  it("uses the panel's own diversity factor: typed on the panel, else its loads' demand ÷ connected", () => {
    const b = sampleProject.boards.find((x) => x.id === 'MDB-1')!;
    const own = panelDf(sampleProject, b);
    expect(own).toBeGreaterThan(0);
    expect(own).toBeLessThanOrEqual(1);
    const typed = { ...sampleProject, boards: sampleProject.boards.map((x) => (x.id === 'MDB-1' ? { ...x, mdDemandFactor: 0.8 } : x)) };
    expect(buildMdSheet(typed, 'MDB-1').form.demandFactor).toBe(0.8);
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
      { y, x: col(s, 'remarks'), value: 'Via 100A TP isolator' },
      { y, x: col(s, 'size'), value: '37' },
      { y, x: col(s, 'R'), value: '99' }
    ]);
    expect(rejected).toEqual(['I6: "37" is not a cable size from the cable table']);
    const f = project.feeders.find((x) => x.id === 'INC-DBGF1')!;
    expect([f.device, f.breakerRatingA, f.cableType, f.remarks, f.cableCsaMm2]).toEqual(['ISOL', 100, 'XLPE/SWA/PVC', 'Via 100A TP isolator', 35]);
    const again = buildMdSheet(project, 'SMDB-GF');
    expect(again.data[y][col(again, 'ISOL')]).toBe(100);
    expect(again.data[y][col(again, 'MCCB')]).toBe('');
    // A meter proposed on the MDB form (it has the kWh columns).
    const mdb = buildMdSheet(project, 'MDB-1');
    const ym = rowOf(mdb, 'DB-EV');
    const metered = buildMdSheet(applyMdEdits(project, mdb, [{ y: ym, x: col(mdb, '3-PH'), value: '1' }]).project, 'MDB-1');
    expect(metered.totals[col(metered, '3-PH')]).toBe('1');
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
    const s = buildMdSheet(sampleProject, 'MDB-1');
    const y = rowOf(s, 'DB-EV');
    const withMeter = applyMdEdits(sampleProject, s, [{ y, x: col(s, 'name'), value: 'AHU-01' }, { y, x: col(s, 'CT'), value: '1' }]).project;
    const f = withMeter.feeders.find((x) => x.id === 'DB-EV')!;
    expect([f.name, f.kwhMeter]).toEqual(['AHU-01', 'CT']);
    const cleared = applyMdEdits(withMeter, buildMdSheet(withMeter, 'MDB-1'), [{ y, x: col(s, 'CT'), value: '' }]).project;
    expect('kwhMeter' in cleared.feeders.find((x) => x.id === 'DB-EV')!).toBe(false);
  });

  it("an equipment feeder's TCL sets its load and re-sizes its breaker and cable; a panel's stays calculated", () => {
    const s = buildMdSheet(sampleProject, 'MCC-1');
    const y = rowOf(s, 'MCC-WP');
    expect(s.editable(y, col(s, 'tcl'))).toBe(true);
    expect(s.editable(y, col(s, 'R'))).toBe(false);
    expect(s.editable(y, col(s, 'mdl'))).toBe(false);
    const { project, rejected } = applyMdEdits(sampleProject, s, [{ y, x: col(s, 'tcl'), value: '15' }]);
    expect(rejected).toEqual([]);
    const f = project.feeders.find((x) => x.id === 'MCC-WP')!;
    expect(f.loadKw).toBe(15);
    const want = applyRecommendation({ ...f }, recommend(project, f, 'optimise'));
    expect([f.breakerRatingA, f.cableCsaMm2]).toEqual([want.breakerRatingA, want.cableCsaMm2]);
    expect(f.breakerRatingA).toBeLessThan(160);
    expect(f.cableCsaMm2).toBeLessThan(50);
    const again = buildMdSheet(project, 'MCC-1');
    expect(again.data[y][col(again, 'tcl')]).toBe('15.00');
    expect(again.data[y][col(again, 'R')]).toBe('5.00');

    const mdb = buildMdSheet(sampleProject, 'MDB-1');
    const panel = mdb.rows.findIndex((r) => r.type === 'feeder' && !!r.toBoard);
    expect(mdb.editable(panel, col(mdb, 'tcl'))).toBe(false);
    expect(mdb.editable(0, col(mdb, 'tcl'))).toBe(false); // incomer
    const ignored = applyMdEdits(sampleProject, mdb, [{ y: panel, x: col(mdb, 'tcl'), value: '5' }]).project;
    expect(ignored).toBe(sampleProject);
  });

  it('a feeder added from the form gets its kW typed in its TCL cell', () => {
    const added = addOutgoingFeeder(sampleProject, 'SMDB-GF');
    const s = buildMdSheet(added.project, 'SMDB-GF');
    const y = rowOf(s, added.id!);
    expect(s.data[y][col(s, 'tcl')]).toBe('10.00');
    const { project } = applyMdEdits(added.project, s, [{ y, x: col(s, 'tcl'), value: '45 kW' }]);
    const f = project.feeders.find((x) => x.id === added.id)!;
    expect(f.loadKw).toBe(45);
    expect(f.breakerRatingA).toBeGreaterThan(added.project.feeders.find((x) => x.id === added.id)!.breakerRatingA);
    expect(buildMdSheet(project, 'SMDB-GF').totals[col(s, 'tcl')]).toBe((Number(s.totals[col(s, 'tcl')]) + 35).toFixed(2));
  });

  it('keeps hand-set sizes, and sizes typed in the same edit, when the TCL changes; rejects a bad load', () => {
    const manual = { ...sampleProject, feeders: sampleProject.feeders.map((f) => (f.id === 'MCC-WP' ? { ...f, manualSize: true } : f)) };
    const s = buildMdSheet(manual, 'MCC-1');
    const y = rowOf(s, 'MCC-WP');
    const kept = applyMdEdits(manual, s, [{ y, x: col(s, 'tcl'), value: '15' }]).project.feeders.find((x) => x.id === 'MCC-WP')!;
    expect([kept.loadKw, kept.breakerRatingA, kept.cableCsaMm2]).toEqual([15, 160, 50]);
    const typed = applyMdEdits(sampleProject, s, [{ y, x: col(s, 'tcl'), value: '15' }, { y, x: col(s, 'MCCB'), value: '125' }]).project.feeders.find((x) => x.id === 'MCC-WP')!;
    expect([typed.loadKw, typed.breakerRatingA, typed.cableCsaMm2]).toEqual([15, 125, 50]);
    const bad = applyMdEdits(sampleProject, s, [{ y, x: col(s, 'tcl'), value: '0' }, { y, x: col(s, 'tcl'), value: 'abc' }]);
    expect(bad.rejected).toHaveLength(2);
    expect(bad.project).toBe(sampleProject);
  });
});
