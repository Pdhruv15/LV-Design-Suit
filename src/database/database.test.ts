import { afterEach, describe, expect, it } from 'vitest';
import { applyDatabase, applyParameters, databaseSeeds, EMPTY_DATABASE, parseDatabase, syncLibrary, type RawDatabase } from './database';
import { cables, getCable } from '../calc/cableTable';
import { breakerRatings, recommend } from '../calc/sizing';
import { breakerRateAed, cableRatePerM } from '../data/rates';
import { sampleProject } from '../data/sampleProject';

const raw = (books: RawDatabase['books']): RawDatabase => ({ folder: 'X', books, readAt: 0 });

afterEach(() => applyDatabase(EMPTY_DATABASE)); // calculations are global; reset to built-in

describe('parsing the workbooks', () => {
  it('reads valid load rows and reports bad ones with their Excel row', () => {
    const db = parseDatabase(raw({
      loads: {
        file: 'Loads.xlsx',
        rows: [
          { _row: 2, name: 'LED downlight 10 W', category: 'Lighting', column: 'LTG', watts: 10, pf: 0.9, phases: '1' },
          { _row: 3, name: 'Split A/C 2 TR', column: "'S' A/C", watts: '2,500', pf: 0.85, phases: 1, demandFactor: 1 },
          { _row: 4, name: '', watts: 5 },
          { _row: 5, name: 'Broken', watts: 'abc' },
          { _row: 6, name: 'led downlight 10 w', watts: 12 }
        ]
      }
    }));
    expect(db.loads.map((l) => [l.name, l.column, l.watts])).toEqual([
      ['LED downlight 10 W', 'ltg', 10],
      ['Split A/C 2 TR', 'sac', 2500]
    ]);
    expect(db.issues).toEqual([
      'Loads.xlsx row 4: no name — skipped',
      'Loads.xlsx row 5: "Broken" needs Power (W) as a number — skipped',
      'Loads.xlsx row 6: duplicate name "led downlight 10 w" — skipped'
    ]);
  });

  it('reports unreadable files and missing columns', () => {
    const db = parseDatabase(raw({
      cables: { file: 'Cables.xlsx', rows: [], error: 'File not found' },
      breakers: { file: 'Breakers.xlsx', rows: [], missingColumns: ['Rating (A)'] }
    }));
    expect(db.issues).toEqual(['Cables.xlsx: File not found', 'Breakers.xlsx: missing column(s) Rating (A)']);
  });

  it('reads parameters by key and ignores blanks', () => {
    const db = parseDatabase(raw({
      parameters: {
        file: 'Parameters.xlsx',
        rows: [
          { _row: 2, parameter: 'Voltage drop limit', value: 3, key: 'vdLimitPct' },
          { _row: 3, parameter: 'Power circuits - min wire', value: 6, key: 'minWirePowerMm2' },
          { _row: 4, parameter: 'Ambient', value: '', key: 'ambientC' }
        ]
      }
    }));
    expect(db.parameters).toEqual({ vdLimitPct: 3, minWirePowerMm2: 6 });
    const p = applyParameters(sampleProject, db);
    expect([p.vdLimitPct, p.ambientC, p.studySettings?.minWirePowerMm2]).toEqual([3, sampleProject.ambientC, 6]);
  });
});

describe('database drives the calculations', () => {
  it('cable data from Cables.xlsx replaces the reference values; unknown sizes fall back', () => {
    const db = parseDatabase(raw({
      cables: { file: 'Cables.xlsx', rows: [{ _row: 2, csaMm2: 2.5, rOhmPerKm20C: 7.41, xOhmPerKm: 0.1, ampacityA: 30, ratePerM: 99 }] }
    }));
    applyDatabase(db);
    expect(cables().map((c) => c.csaMm2)).toEqual([2.5]);
    expect(getCable(2.5).ampacityA).toBe(30);
    expect(cableRatePerM(2.5)).toBe(99);
    expect(getCable(95).ampacityA).toBe(306); // not in the sheet → reference value
  });

  it('breaker ratings and prices from Breakers.xlsx', () => {
    applyDatabase(parseDatabase(raw({
      breakers: { file: 'Breakers.xlsx', rows: [{ _row: 2, ratingA: 20, price: 55 }, { _row: 3, ratingA: 32, icuKa: 10 }, { _row: 4, ratingA: 100, price: 400 }] }
    })));
    expect(breakerRatings()).toEqual([20, 32, 100]);
    expect(breakerRateAed(16)).toBe(55);
    expect(breakerRateAed(80)).toBe(400);
    const f = sampleProject.feeders.find((x) => x.id === 'GF-SKT')!; // Ib ≈ 27 A
    expect(recommend(sampleProject, f, 'optimise').breakerRatingA).toBe(100); // 32 A < 27/0.85, next stocked is 100
  });

  it('seeds: loads empty, cables and breakers pre-filled, parameters listed blank', () => {
    const s = databaseSeeds();
    expect(s.loads).toEqual([]);
    expect(s.cables.length).toBeGreaterThan(10);
    expect(s.breakers[0][0]).toBe(6);
    expect(s.parameters.every((r) => r[1] === '')).toBe(true);
  });
});

describe('library sync', () => {
  it('updates linked WATT/UNIT values when the library changes', () => {
    const p = {
      ...sampleProject,
      boards: sampleProject.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, pointItems: { ltg: 'LED downlight', sac: 'Old unit' } } : b))
    };
    const db = parseDatabase(raw({ loads: { file: 'Loads.xlsx', rows: [{ _row: 2, name: 'LED downlight', column: 'LTG', watts: 12 }] } }));
    const r = syncLibrary(p, db);
    expect(r.changedBoards).toEqual(['DB-GF1']);
    expect(r.project.boards.find((b) => b.id === 'DB-GF1')!.pointWatts!.ltg).toBe(12);
    expect(r.changes).toEqual(['DB-GF1 LTG: LED downlight 100 → 12 W']);
    expect(r.missing).toEqual(['DB-GF1 sac: "Old unit"']);
    expect(syncLibrary(r.project, db).changedBoards).toEqual([]); // already in sync
  });
});
