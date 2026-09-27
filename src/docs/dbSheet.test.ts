import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { boardPhaseKw, scheduleCircuits } from '../calc/loadSchedule';
import type { Project } from '../types';
import { applySheetEdits, buildDbSheet, colName, isEditable, type DbSheet } from './dbSheet';

const col = (s: DbSheet, key: string) => s.sheetCols.findIndex((c) => c.key === key);
const rowOf = (s: DbSheet, ref: string) => s.data.findIndex((r) => r[col(s, 'ref')] === ref);

describe('DB load schedule sheet', () => {
  const sheet = buildDbSheet(sampleProject, 'DB-GF1');

  it('names columns like a spreadsheet', () => {
    expect([colName(0), colName(25), colName(26), colName(27), colName(701)]).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ']);
  });

  it('follows the villa form: its point columns in order, then any other type in use', () => {
    const titles = sheet.sheetCols.filter((c) => c.key.startsWith('pt:')).map((c) => c.title);
    expect(titles.slice(0, 13)).toEqual(['LTG', 'EX.FAN', 'SH.S/O', '13A S.S/O', '13A T.S/O', 'W/H', 'FCU', 'SPUR O/L', 'ISOL', 'COOKER', 'S A/C', 'WAT.PUMP', 'OTH']);
    expect(titles).toContain('C.FAN'); // used on the guest bedroom, not in the villa form
  });

  it('lists every way R, Y, B with empty slots, rounded up to whole ELCB sections', () => {
    const refs = sheet.data.slice(1).map((r) => r[col(sheet, 'ref')]);
    expect(refs.slice(0, 6)).toEqual(['R1', 'Y1', 'B1', 'R2', 'Y2', 'B2']);
    // DB-GF1 uses ways 1–8; one spare way, rounded up to 2-way sections → 10 ways.
    expect(refs).toHaveLength(30);
    expect(sheet.rows.filter((r) => r.type === 'circuit')).toHaveLength(21);
  });

  it('merges the incomer over all rows and each ELCB over its section', () => {
    expect(sheet.merges.A2).toEqual([1, 30]);
    expect(sheet.data[1][0]).toBe('100A TP ISOLATOR');
    expect(sheet.merges.B2).toEqual([1, 6]);
    expect(String(sheet.data[1][1])).toMatch(/^ELCB-1 \d+ A \d+ mA 4P$/);
  });

  it('shows each circuit load on its own phase and totals in kW', () => {
    const y = rowOf(sheet, 'R3'); // cooker, 6 kW
    expect(sheet.data[y][col(sheet, 'R')]).toBe(6000);
    expect(sheet.data[y][col(sheet, 'Y')]).toBe('');
    expect(sheet.data[y][col(sheet, 'wpu')]).toBe('6000');
    const ph = boardPhaseKw(sampleProject, 'DB-GF1');
    expect(sheet.totals[col(sheet, 'R')]).toBe(ph.R.toFixed(2));
    expect(sheet.cableText).toBe('CABLE SIZE: 4Cx35 Sqmm CU/XLPE/SWA/PVC + 1C 16 Sqmm CU. PVC ECC');
  });

  it('locks calculated cells; empty ways accept only room, points and remarks', () => {
    const r = rowOf(sheet, 'R1');
    expect(isEditable(sheet, r, col(sheet, 'room'))).toBe(true);
    expect(isEditable(sheet, r, col(sheet, 'R'))).toBe(false);
    expect(isEditable(sheet, r, col(sheet, 'sl'))).toBe(false);
    const slot = rowOf(sheet, 'R9');
    expect(isEditable(sheet, slot, col(sheet, 'pt:ltg'))).toBe(true);
    expect(isEditable(sheet, slot, col(sheet, 'mcb'))).toBe(false);
    expect(isEditable(sheet, 0, col(sheet, 'pt:ltg'))).toBe(true); // WATT / UNIT row
    expect(isEditable(sheet, 0, col(sheet, 'room'))).toBe(false);
  });

  it('typing a room and points into an empty way creates that circuit, sized by the engine', () => {
    const y = rowOf(sheet, 'Y9');
    const { project, rejected } = applySheetEdits(sampleProject, sheet, [
      { y, x: col(sheet, 'room'), value: 'Store' },
      { y, x: col(sheet, 'pt:ltg'), value: '4' }
    ]);
    expect(rejected).toEqual([]);
    const f = project.feeders.find((x) => x.id === 'DB-GF1-Y9')!;
    expect([f.room, f.phase, f.way, f.points?.ltg, f.loadKw]).toEqual(['Store', 'Y', 9, 4, 0.4]);
    expect(f.cableCsaMm2).toBeGreaterThanOrEqual(2.5);
    expect(buildDbSheet(project, 'DB-GF1').rows.length).toBe(sheet.rows.length); // still inside the spare way
  });

  it('applies a pasted block across circuits and rejects values that do not fit', () => {
    const y1 = rowOf(sheet, 'R1');
    const y2 = rowOf(sheet, 'Y1');
    const { project, rejected } = applySheetEdits(sampleProject, sheet, [
      { y: y1, x: col(sheet, 'pt:ltg'), value: '14' },
      { y: y2, x: col(sheet, 'pt:ltg'), value: 'ten' },
      { y: y2, x: col(sheet, 'wire'), value: '3' },
      { y: y1, x: col(sheet, 'R'), value: '999' } // locked: ignored silently
    ]);
    expect(rejected).toHaveLength(2);
    const r1 = project.feeders.find((f) => f.id === 'DB-GF1-R1')!;
    expect(r1.points?.ltg).toBe(14);
    expect(r1.loadKw).toBeCloseTo(1.4, 9);
    expect(project.feeders.find((f) => f.id === 'DB-GF1-Y1')).toEqual(sampleProject.feeders.find((f) => f.id === 'DB-GF1-Y1'));
  });

  it('WATT / UNIT edits re-size every circuit using that point type', () => {
    const { project } = applySheetEdits(sampleProject, sheet, [{ y: 0, x: col(sheet, 'pt:ltg'), value: '150' }]);
    expect(project.boards.find((b) => b.id === 'DB-GF1')!.pointWatts!.ltg).toBe(150);
    expect(project.feeders.find((f) => f.id === 'DB-GF1-R1')!.loadKw).toBeCloseTo(1.8, 9); // 12 × 150 W
  });

  it('typing into an empty way with no content does not create a circuit', () => {
    const y = rowOf(sheet, 'B10');
    const { project } = applySheetEdits(sampleProject, sheet, [{ y, x: col(sheet, 'room'), value: '  ' }]);
    expect(scheduleCircuits(project, 'DB-GF1')).toHaveLength(21);
  });

  it('adds rows for another ELCB section once the spare way is used', () => {
    const p: Project = applySheetEdits(sampleProject, sheet, [{ y: rowOf(sheet, 'R10'), x: col(sheet, 'room'), value: 'Majlis 2' }]).project;
    const next = buildDbSheet(p, 'DB-GF1');
    expect(next.rows.length - 1).toBe(36);
    expect(next.shape).not.toBe(sheet.shape);
  });
});
