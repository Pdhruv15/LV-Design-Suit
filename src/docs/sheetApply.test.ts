import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addSpareWay } from '../model/spareWays';
import { newSheet, type Sheet } from '../model/sheets';
import type { Project } from '../types';
import { applyLinked, pendingMarks } from './sheetApply';
import { addCircuitRow, fillLinked, typeLinked } from './sheetLink';
import { panelData, panelRowKeys } from './panelFields';
import { scheduleRowKeys, templateData } from './scheduleFields';

/** A panel schedule on DB-GF1: the board number in B2, the first circuit row 6, a column each for the typed values and one of your own. */
const linked = (): Sheet => ({ ...newSheet(), link: { category: 'db', boardId: 'DB-GF1', firstRow: 6, cells: { B2: { field: 'board.id' } }, rows: [], columns: { A: 'row.ref', B: 'row.room', C: 'row.mcb', D: 'row.wire', E: 'row.ecc', F: 'row.length', G: 'row.watts', H: 'row.remarks', I: 'own' } } });
const shown = (p: Project, s: Sheet = linked()) => fillLinked(p, s);
const typed = (p: Project, s: Sheet, edits: Record<string, string>) => typeLinked(p, s, edits).sheet;
const feeder = (p: Project, id: string) => p.feeders.find((f) => f.id === id)!;
const N = scheduleRowKeys(sampleProject, 'DB-GF1').length; // the first free row after the circuits is 6 + N

describe('applyLinked', () => {
  it('room and remarks reach the circuit; the typed values leave the sheet and the next fill shows them from the project', () => {
    const s = typed(sampleProject, shown(sampleProject), { B6: 'Hall lights', H6: 'dimmable' });
    expect(s.link!.pending).toEqual({ 'DB-GF1-R1': { B: 'Hall lights', H: 'dimmable' } });
    const r = applyLinked(sampleProject, s);
    expect(r).toMatchObject({ changed: 1, added: 0, rejected: [] });
    expect(feeder(r.project, 'DB-GF1-R1')).toMatchObject({ room: 'Hall lights', remarks: 'dimmable' });
    expect(r.sheet.link!.pending).toBeUndefined();
    expect(shown(r.project, r.sheet).cells.B6).toBe('Hall lights');
  });

  it('a typed MCB is kept as sized by hand', () => {
    const s = typed(sampleProject, shown(sampleProject), { C7: '16' });
    const f = feeder(applyLinked(sampleProject, s).project, 'DB-GF1-Y1');
    expect(f).toMatchObject({ breakerRatingA: 16, manualSize: true });
  });

  it('an invalid cable size is rejected with the user\'s cell and stays pending; the rest is applied', () => {
    const s = typed(sampleProject, shown(sampleProject), { D6: '3', B6: 'Hall' });
    const r = applyLinked(sampleProject, s);
    expect(r.rejected).toEqual(['D6: "3" is not a valid cable size']);
    expect(r.changed).toBe(1);
    expect(feeder(r.project, 'DB-GF1-R1').cableCsaMm2).toBe(2.5);
    expect(r.sheet.link!.pending).toEqual({ 'DB-GF1-R1': { D: '3' } });
    const only = typed(sampleProject, shown(sampleProject), { D6: '3' });
    const none = applyLinked(sampleProject, only);
    expect(none.rejected).toHaveLength(1);
    expect(none.project).toBe(sampleProject);
    expect(none.sheet).toBe(only);
  });

  it('a typed load is one load item: ltg for a lights description, spare1 otherwise', () => {
    const s = typed(sampleProject, shown(sampleProject), { B6: 'Hall LIGHTS', G6: '2500', B7: 'Store', G7: '600' });
    const r = applyLinked(sampleProject, s);
    expect(r.changed).toBe(2);
    expect(feeder(r.project, 'DB-GF1-R1')).toMatchObject({ points: {}, loadItems: [{ name: 'Hall LIGHTS', pointType: 'ltg', quantity: 1, unitWatts: 2500 }] });
    expect(feeder(r.project, 'DB-GF1-Y1').loadItems).toEqual([{ name: 'Store', pointType: 'spare1', quantity: 1, unitWatts: 600 }]);
    const rows = templateData(r.project, 'DB-GF1').rows;
    expect([rows[0]['row.watts'], rows[1]['row.watts']]).toEqual([2500, 600]);
    const bad = applyLinked(sampleProject, typed(sampleProject, shown(sampleProject), { G6: 'lots', G7: '0' }));
    expect(bad.rejected).toEqual(['G6: "lots" is not a load in watts', 'G7: "0" is not a load in watts']);
  });

  it('a new row with a description and a load becomes a circuit sized by the rules, and its own text stays beside it', () => {
    const s0 = addCircuitRow(shown(sampleProject));
    const s1 = shown(sampleProject, s0);
    expect(s1.link!.rows[N]).toBe('new:0');
    const row = 6 + N;
    const s = typed(sampleProject, s1, { [`B${row}`]: 'New store', [`G${row}`]: '1500', [`I${row}`]: 'mine' });
    expect(s.link!.added).toEqual([{ B: 'New store', G: '1500' }]);
    const r = applyLinked(sampleProject, s);
    expect(r).toMatchObject({ changed: 0, added: 1, rejected: [] });
    expect(r.project.feeders).toHaveLength(sampleProject.feeders.length + 1);
    const made = r.project.feeders.find((f) => !sampleProject.feeders.some((x) => x.id === f.id))!;
    expect(made).toMatchObject({ boardId: 'DB-GF1', room: 'New store' });
    expect(made.manualSize).toBeFalsy();
    expect(made.breakerRatingA).toBeGreaterThan(0);
    expect(made.cableCsaMm2).toBeGreaterThanOrEqual(2.5);
    expect(r.sheet.link!.added).toBeUndefined();
    const again = shown(r.project, r.sheet);
    const keys = scheduleRowKeys(r.project, 'DB-GF1');
    const at = keys.indexOf(made.id);
    expect(again.cells[`I${6 + at}`]).toBe('mine');
    expect(again.cells[`B${6 + at}`]).toBe('New store');
    expect(Object.values(again.cells).filter((v) => v === 'mine')).toHaveLength(1);
  });

  it('a new row with nothing useful is rejected and kept; the rows left are numbered again', () => {
    const base = shown(sampleProject, addCircuitRow(addCircuitRow(shown(sampleProject))));
    const s = typed(sampleProject, shown(sampleProject, base), { [`H${6 + N}`]: 'remark only', [`B${7 + N}`]: 'Pump room' });
    const r = applyLinked(sampleProject, s);
    expect(r.rejected).toEqual([`Row ${6 + N}: give a description or a load`]);
    expect(r.added).toBe(1);
    expect(r.sheet.link!.added).toEqual([{ H: 'remark only' }]);
    expect(r.sheet.link!.rows[N]).toBe('new:0');
    expect(r.sheet.link!.rows).toHaveLength(N + 2);
    expect(r.sheet.link!.rows[N + 1]).toMatch(/^DB-GF1-/);
  });

  it('a spare takes its MCB rating', () => {
    const p = addSpareWay(sampleProject, 'DB-GF1', 'spare').project;
    const keys = scheduleRowKeys(p, 'DB-GF1'), at = keys.findIndex((k) => k.startsWith('spare:'));
    const s = typed(p, shown(p), { [`C${6 + at}`]: '25' });
    const r = applyLinked(p, s);
    expect(r.changed).toBe(1);
    expect(r.project.boards.find((b) => b.id === 'DB-GF1')!.spareWays![0].ratingA).toBe(25);
  });

  it('has nothing to do for a sheet with nothing typed', () => {
    const s = shown(sampleProject);
    const r = applyLinked(sampleProject, s);
    expect(r).toEqual({ project: sampleProject, sheet: s, changed: 0, added: 0, rejected: [] });
    expect(r.project).toBe(sampleProject);
    expect(r.sheet).toBe(s);
  });
});

describe('pendingMarks', () => {
  it('marks a typed value pending, a refused one with its reason, and a size that fails its check', () => {
    const s = typed(sampleProject, shown(sampleProject), { B6: 'Hall', D7: '3', C8: '32' });
    const marks = pendingMarks(sampleProject, s);
    expect(marks.B6).toEqual({ kind: 'pending', text: 'Typed, not applied yet' });
    expect(marks.D7).toEqual({ kind: 'refused', text: '"3" is not a valid cable size' });
    expect(marks.C8.kind).toBe('check');
    expect(marks.C8.text).toBe('After Apply this circuit needs a check: Cable not protected: In 32 A > Iz 31.3 A; DEWA Table 1: 32 A breaker on 2.5 mm² (max 16 A)');
    expect(Object.keys(marks).sort()).toEqual(['B6', 'C8', 'D7']);
    expect(pendingMarks(sampleProject, shown(sampleProject))).toEqual({});
  });
});

/** A panel schedule: the board number in B2, the first feeder row 6, a column for each typed value and one of your own. */
const panel = (boardId: string): Sheet => ({ ...newSheet(), link: { category: 'md', boardId, firstRow: 6, cells: { B2: { field: 'board.id' } }, rows: [], columns: { A: 'row.sl', B: 'row.name', C: 'row.device', D: 'row.rating', E: 'row.fault', F: 'row.cores', G: 'row.cableType', H: 'row.size', I: 'row.ecc', J: 'row.length', K: 'row.tcl', L: 'row.remarks', M: 'own' } } });
const withWay = addSpareWay(sampleProject, 'SMDB-GF', 'spare').project;
const wayOf = (p: Project) => p.boards.find((b) => b.id === 'SMDB-GF')!.spareWays![0];

describe('applyLinked — panel schedules', () => {
  it("an equipment feeder's name and remarks reach the feeder, and the next fill shows them", () => {
    const s = typed(sampleProject, shown(sampleProject, panel('MCC-1')), { B6: 'Duty pump', L6: 'duty' });
    expect(s.link!.pending).toEqual({ 'MCC-WP': { B: 'Duty pump', L: 'duty' } });
    const r = applyLinked(sampleProject, s);
    expect(r).toMatchObject({ changed: 1, added: 0, rejected: [] });
    expect(feeder(r.project, 'MCC-WP')).toMatchObject({ name: 'Duty pump', remarks: 'duty' });
    expect(r.sheet.link!.pending).toBeUndefined();
    expect(shown(r.project, r.sheet).cells).toMatchObject({ B6: 'DUTY PUMP', L6: 'duty' });
  });

  it("a typed rating lands on the breaker of the device the feeder uses", () => {
    const r = applyLinked(sampleProject, typed(sampleProject, shown(sampleProject, panel('MCC-1')), { D6: '200' }));
    expect(feeder(r.project, 'MCC-WP')).toMatchObject({ breakerRatingA: 200, device: 'MCCB' });
    expect(r.rejected).toEqual([]);
  });

  it('a typed device moves the rating to that device; both typed together are one change', () => {
    const base = shown(sampleProject, panel('MCC-1'));
    const moved = applyLinked(sampleProject, typed(sampleProject, base, { C6: 'acb' }));
    expect(feeder(moved.project, 'MCC-WP')).toMatchObject({ device: 'ACB', breakerRatingA: 160 });
    const after = shown(moved.project, moved.sheet);
    expect([after.cells.C6, after.cells.D6]).toEqual(['ACB', '160']);
    const both = applyLinked(sampleProject, typed(sampleProject, base, { C6: ' isol ', D6: '125' }));
    expect(feeder(both.project, 'MCC-WP')).toMatchObject({ device: 'ISOL', breakerRatingA: 125 });
    expect(both.changed).toBe(1);
    const bad = applyLinked(sampleProject, typed(sampleProject, base, { C6: 'MCB' }));
    expect(bad.rejected).toEqual(['C6: "MCB" is not ACB, MCCB or ISOL']);
    expect(bad.project).toBe(sampleProject);
  });

  it("an invalid cable size is rejected with the user's cell and stays pending; the rest is applied", () => {
    const r = applyLinked(sampleProject, typed(sampleProject, shown(sampleProject, panel('MCC-1')), { H6: '3', L6: 'ok' }));
    expect(r.rejected).toEqual(['H6: "3" is not a cable size from the cable table']);
    expect(r.changed).toBe(1);
    expect(feeder(r.project, 'MCC-WP')).toMatchObject({ remarks: 'ok', cableCsaMm2: 70 });
    expect(r.sheet.link!.pending).toEqual({ 'MCC-WP': { H: '3' } });
    const only = typed(sampleProject, shown(sampleProject, panel('MCC-1')), { H6: '3' }), none = applyLinked(sampleProject, only);
    expect([none.project, none.sheet]).toEqual([sampleProject, only]);
    expect(none.project).toBe(sampleProject);
  });

  it('a typed load changes an equipment feeder; on a feeder that supplies a board it is rejected', () => {
    const r = applyLinked(sampleProject, typed(sampleProject, shown(sampleProject, panel('MCC-1')), { K6: '90' }));
    expect(feeder(r.project, 'MCC-WP').loadKw).toBe(90);
    expect(panelData(r.project, 'MCC-1').rows[0]['row.tcl']).toBe(90);
    const s = typed(sampleProject, shown(sampleProject, panel('SMDB-GF')), { K10: '50' });
    expect(panelRowKeys(sampleProject, 'SMDB-GF')[4]).toBe('INC-DBGF1');
    const bad = applyLinked(sampleProject, s);
    expect(bad.rejected).toEqual(['K10: Connected load (TCL), kW cannot be changed on this row']);
    expect(bad.sheet.link!.pending).toEqual({ 'INC-DBGF1': { K: '50' } });
    expect(bad.project).toBe(sampleProject);
  });

  it('a spare way takes its rating; other values on it are rejected', () => {
    const key = panelRowKeys(withWay, 'SMDB-GF')[5], row = 6 + 5;
    expect(key).toMatch(/^spare:/);
    const s = typed(withWay, shown(withWay, panel('SMDB-GF')), { [`D${row}`]: '63', [`L${row}`]: 'future' });
    const r = applyLinked(withWay, s);
    expect(r).toMatchObject({ changed: 1, rejected: [] });
    expect(wayOf(r.project)).toMatchObject({ ratingA: 63, remarks: 'future' });
    const forced: Sheet = { ...s, link: { ...s.link!, pending: { [key]: { B: 'x' } } } };
    expect(applyLinked(withWay, forced).rejected).toEqual([`B${row}: Feeder / circuit name cannot be changed on this row`]);
  });

  it('a new row with a name and a load becomes an outgoing feeder; its own text stays beside it', () => {
    const base = fillLinked(sampleProject, panel('MCC-1')), n = panelRowKeys(sampleProject, 'MCC-1').length;
    const s = typed(sampleProject, shown(sampleProject, addCircuitRow(base)), { [`B${6 + n}`]: 'Jockey pump', [`K${6 + n}`]: '12', [`M${6 + n}`]: 'note' });
    const r = applyLinked(sampleProject, s);
    expect(r).toMatchObject({ changed: 0, added: 1, rejected: [] });
    const made = r.project.feeders.find((f) => f.boardId === 'MCC-1' && f.name === 'Jockey pump')!;
    expect(made.loadKw).toBe(12);
    expect(r.sheet.link!.added).toBeUndefined();
    expect(r.sheet.link!.rows[n]).toBe(made.uid ?? made.id);
    const f = shown(r.project, r.sheet);
    expect(f.link!.rows).toEqual(panelRowKeys(r.project, 'MCC-1'));
    expect([f.cells[`B${6 + n}`], f.cells[`K${6 + n}`], f.cells[`M${6 + n}`]]).toEqual(['JOCKEY PUMP', '12', 'note']);
  });

  it('a new row with nothing useful, or a value that fails, is not made', () => {
    const n = panelRowKeys(sampleProject, 'MCC-1').length, base = shown(sampleProject, addCircuitRow(fillLinked(sampleProject, panel('MCC-1'))));
    const none = applyLinked(sampleProject, typed(sampleProject, base, { [`L${6 + n}`]: 'remark only' }));
    expect(none.rejected).toEqual([`Row ${6 + n}: give a feeder name or a load`]);
    expect([none.added, none.project]).toEqual([0, sampleProject]);
    const bad = applyLinked(sampleProject, typed(sampleProject, base, { [`B${6 + n}`]: 'Pump', [`H${6 + n}`]: '3' }));
    expect(bad.rejected).toEqual([`H${6 + n}: "3" is not a cable size from the cable table`]);
    expect(bad.added).toBe(0);
    expect(bad.project).toBe(sampleProject);
  });

  it('pendingMarks gives pending, and refused with the reason', () => {
    const s = typed(sampleProject, shown(sampleProject, panel('MCC-1')), { L6: 'ok', H7: '3' });
    expect(pendingMarks(sampleProject, s)).toEqual({ L6: { kind: 'pending', text: 'Typed, not applied yet' }, H7: { kind: 'refused', text: '"3" is not a cable size from the cable table' } });
  });
});
