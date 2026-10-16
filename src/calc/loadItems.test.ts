import { describe, expect, it } from 'vitest';
import { circuitWatts, dominantLoadType, itemizedTypes, loadItemsText, missingWatts, normalizeLoadItems, pointsWithItems, wattUnitText } from './loadSchedule';
import { buildBom } from './bom';
import { addCircuit, updateCircuit } from '../model/schedule';
import { migrateProject } from '../model/projectMigrate';
import { projectInputIssues } from '../model/projectValidate';
import { applySheetEdits, buildDbSheet, isEditable } from '../docs/dbSheet';
import { loadScheduleCsv } from '../docs/loadScheduleDoc';
import { findLibraryLoad, parseDatabase, syncLibrary, type RawDatabase } from '../database/database';
import type { CircuitLoadItem, Project } from '../types';

const L1: CircuitLoadItem = { reference: 'L1', name: 'Downlight 10 W', pointType: 'ltg', quantity: 6, unitWatts: 10 };
const L2: CircuitLoadItem = { reference: 'L2', name: 'Panel 20 W', pointType: 'ltg', quantity: 4, unitWatts: 20 };

function base(): Project {
  return {
    name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
    boards: [
      { id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 },
      { id: 'DB', name: 'Villa DB', upstreamId: 'MDB', ratedCurrentA: 100, pointWatts: { ltg: 100, s13: 250, exfan: 40 } }
    ],
    feeders: [
      { id: 'INC', boardId: 'MDB', name: 'Incomer', loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 30, cableCsaMm2: 35, cores: 4, breakerRatingA: 100, breakerIcuKa: 36, feedsBoardId: 'DB' }
    ]
  };
}

const mixed = (extra: Partial<Parameters<typeof updateCircuit>[2]> = {}) => {
  const r = addCircuit(base(), 'DB');
  const p = updateCircuit(r.project, r.id, { loadItems: [L1, L2], ...extra });
  return { p, f: p.feeders.find((x) => x.id === r.id)! };
};

const raw = (rows: Record<string, string | number>[]): RawDatabase => ({ folder: '/db', readAt: 0, books: { loads: { file: 'Loads.xlsx', rows } } });

describe('mixed-wattage load items', () => {
  it('6 × L1 10 W + 4 × L2 20 W = 140 W exactly, and LTG shows 10 points', () => {
    const { f } = mixed();
    expect(f.points?.ltg).toBe(10);
    expect(circuitWatts(f, base().boards[1])).toBe(140);
    expect(f.loadKw).toBeCloseTo(0.14, 9);
    expect(f.loadType).toBe('lighting');
    expect(loadItemsText(f)).toBe('6×L1 10 W + 4×L2 20 W');
  });

  it('other point types on the circuit still use the DB WATT / UNIT', () => {
    const { f } = mixed({ points: { s13: 2 } });
    expect(f.points).toEqual({ s13: 2, ltg: 10 });
    expect(circuitWatts(f, base().boards[1])).toBe(140 + 2 * 250);
    expect(dominantLoadType(f, base().boards[1])).toBe('sockets');
  });

  it('a circuit without items behaves as before', () => {
    const r = addCircuit(base(), 'DB');
    const p = updateCircuit(r.project, r.id, { points: { ltg: 10 } });
    const f = p.feeders.find((x) => x.id === r.id)!;
    expect(f.loadItems).toBeUndefined();
    expect(circuitWatts(f, p.boards[1])).toBe(1000);
  });

  it('typing a different count for an itemized type replaces its items (WATT / UNIT again)', () => {
    const { p, f } = mixed();
    const same = updateCircuit(p, f.id, { points: { ...f.points } });
    expect(same.feeders.find((x) => x.id === f.id)!.loadItems).toHaveLength(2);
    const typed = updateCircuit(p, f.id, { points: { ...f.points, ltg: 3 } }).feeders.find((x) => x.id === f.id)!;
    expect(typed.loadItems).toBeUndefined();
    expect(typed.loadKw).toBeCloseTo(0.3, 9);
  });

  it('normalises items: trimmed text, whole positive quantities, bad rows dropped', () => {
    expect(normalizeLoadItems([
      { reference: ' L1 ', name: ' Downlight ', pointType: 'ltg', quantity: 2.4, unitWatts: 10 },
      { name: 'x', pointType: 'ltg', quantity: 0, unitWatts: 10 },
      { name: 'y', pointType: 'nope' as never, quantity: 1, unitWatts: 10 },
      { name: 'z', pointType: 'ltg', quantity: 1, unitWatts: -5 }
    ])).toEqual([{ reference: 'L1', name: 'Downlight', pointType: 'ltg', quantity: 2, unitWatts: 10 }]);
    expect(pointsWithItems({ ltg: 99, s13: 1 }, [L1])).toEqual({ ltg: 6, s13: 1 });
    expect([...itemizedTypes({ loadItems: [L1] })]).toEqual(['ltg']);
  });

  it('WATT / UNIT: itemized types need no DB value; the printed row lists the wattages used', () => {
    const { p } = mixed();
    const board = { ...p.boards[1], pointWatts: {} };
    const q = { ...p, boards: [p.boards[0], board] };
    expect(missingWatts(q, board)).toEqual([]);
    expect(wattUnitText(q, board, 'ltg')).toBe('10 / 20');
    const csv = loadScheduleCsv(q, 'DB');
    const ltg = csv.headers.indexOf('LTG');
    expect(csv.rows[0][ltg]).toBe('10 / 20');
    expect(csv.rows[1][csv.headers.indexOf('Remarks')]).toBe('6×L1 10 W + 4×L2 20 W');
    expect(csv.rows[1][csv.headers.indexOf('R (W)')]).toBe(140);
  });

  it('DB sheet: itemized counts are locked and a typed change is reported, not applied', () => {
    const { p, f } = mixed();
    const sheet = buildDbSheet(p, 'DB');
    const y = sheet.rows.findIndex((r) => r.type === 'circuit' && r.feeder.id === f.id);
    const x = sheet.sheetCols.findIndex((c) => c.key === 'pt:ltg');
    expect(isEditable(sheet, y, x)).toBe(false);
    expect(sheet.data[y][sheet.sheetCols.findIndex((c) => c.key === 'wpu')]).toBe('10 / 20');
    const r = applySheetEdits(p, sheet, [{ y, x, value: '3' }]);
    expect(r.project).toBe(p);
    expect(r.rejected[0]).toMatch(/mixed load items/);
    expect(applySheetEdits(p, sheet, [{ y, x, value: '10' }]).rejected).toEqual([]); // same value (fill / paste): no complaint
  });

  it('BOM lists each item by itself', () => {
    const { p } = mixed();
    const points = buildBom({ ...p, boq: { includeSchedulePoints: true } }).filter((x) => x.section === 'J');
    expect(points.map((x) => [x.description.split(' — ')[0], x.qty])).toEqual([['L1 Downlight 10 W', 6], ['L2 Panel 20 W', 4]]);
  });

  it('opening a file brings itemized counts in line; files without items are untouched', () => {
    const { p, f } = mixed();
    const stale = { ...p, id: 'x', schemaVersion: 1, createdAt: 'now', feeders: p.feeders.map((x) => (x.id === f.id ? { ...x, points: { ltg: 3 } } : x)) };
    expect(migrateProject(stale).feeders.find((x) => x.id === f.id)!.points?.ltg).toBe(10);
    const plain = { ...base(), id: 'y', schemaVersion: 1, createdAt: 'now' };
    expect(migrateProject(plain)).toBe(plain);
  });

  it('reports bad load items as input problems', () => {
    const { p, f } = mixed();
    const bad = { ...p, feeders: p.feeders.map((x) => (x.id === f.id ? { ...x, loadItems: [{ ...L1, quantity: 1.5 }, { ...L2, unitWatts: NaN }] } : x)) };
    const issue = projectInputIssues(bad).find((i) => i.text.includes(f.id))!;
    expect(issue.text).toMatch(/load item 1 \(L1\) quantity 1.5/);
    expect(issue.text).toMatch(/load item 2 \(L2\) watts/);
  });
});

describe('load references in Loads.xlsx', () => {
  it('trims references, matches them case-insensitively and reports duplicates without dropping the row', () => {
    const db = parseDatabase(raw([
      { _row: 2, name: 'Downlight', reference: ' L1 ', column: 'LTG', watts: 10 },
      { _row: 3, name: 'Panel', reference: 'l1', column: 'LTG', watts: 20 },
      { _row: 4, name: 'Old fitting', column: 'LTG', watts: 36 }
    ]));
    expect(db.loads.map((l) => [l.name, l.reference])).toEqual([['Downlight', 'L1'], ['Panel', undefined], ['Old fitting', undefined]]);
    expect(db.issues).toEqual(['Loads.xlsx row 3: duplicate reference "l1" (also row 2) — reference ignored, "Panel" kept']);
    expect(findLibraryLoad(db.loads, { reference: 'l1' })?.name).toBe('Downlight');
    expect(findLibraryLoad(db.loads, { name: 'old FITTING' })?.watts).toBe(36); // legacy row: by name
    expect(findLibraryLoad(db.loads, { reference: 'L9', name: 'Downlight' })).toBeUndefined(); // a reference never falls back to a name
  });

  it('library changes reach circuit items by reference; legacy name links adopt the reference', () => {
    const { p, f } = mixed();
    const legacy = { ...p, feeders: p.feeders.map((x) => (x.id === f.id ? { ...x, loadItems: [L1, { ...L2, reference: undefined }] } : x)) };
    const db = parseDatabase(raw([
      { _row: 2, name: 'Downlight 10 W', reference: 'l1', watts: 12 },
      { _row: 3, name: 'Panel 20 W', reference: 'L2', watts: 20 }
    ]));
    const s = syncLibrary(legacy, db);
    expect(s.changedBoards).toEqual(['DB']);
    expect(s.changes).toEqual([`${f.id} L1: 10 → 12 W`]);
    expect(s.project.feeders.find((x) => x.id === f.id)!.loadItems).toEqual([{ ...L1, unitWatts: 12 }, L2]);
    expect(syncLibrary(s.project, db).project).toBe(s.project); // in sync
  });
});
