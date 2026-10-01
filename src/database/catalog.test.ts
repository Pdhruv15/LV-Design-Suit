// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { applyDatabase, databaseSeeds, EMPTY_DATABASE, parseDatabase, type RawDatabase } from './database';
import { catalog, rule } from './catalog';
import { STANDARD_TRANSFORMER_KVA } from '../calc/sizing';
import { typicalImpedancePct } from '../calc/txGen';
import { fallbackRate, loadPriceLists } from '../model/priceList';
import { roomTypesOf } from '../calc/building';

const raw = (books: Record<string, Record<string, string | number>[]>): RawDatabase => ({
  folder: '/x', readAt: 0, books: Object.fromEntries(Object.entries(books).map(([id, rows]) => [id, { file: `${id}.xlsx`, rows: rows.map((r, i) => ({ _row: i + 2, ...r })) }]))
});

afterEach(() => applyDatabase(EMPTY_DATABASE));

describe('database catalogue', () => {
  it('reads transformers, generators, busbar, equipment, room / unit types, prices and rules', () => {
    const db = parseDatabase(raw({
      transformers: [{ kva: 1000, zPct: 6, price: 120000 }, { kva: 1500, zPct: 6.5 }, { kva: 'x' }],
      generators: [{ kva: 500, xdPct: 14, price: 90000 }],
      busbar: [{ material: 'Cu', ratingA: 1600, rMohmPerM: 0.03, xMohmPerM: 0.01, ratePerM: 950 }],
      equipment: [{ category: 'SPD', description: 'SPD T2', price: 1800, boqKey: 'spd:T2' }],
      roomTypes: [{ id: 'Office Open', label: 'Open office', wPerM2: 120, ltgM2PerPoint: 8 }],
      unitTypes: [{ unitType: '1BR', room: 'Living', roomType: 'living', areaM2: 30 }, { unitType: '1BR', room: 'Bed', roomType: 'bedroom', areaM2: 14, meter: '1-PH' }],
      prices: [{ list: 'Schneider', key: 'mccb:250:TP+N:36', rate: 2400, install: 150 }],
      rules: [{ key: 'pfMinimum', value: 0.95 }, { key: 'maxLtgPerCircuit', value: 8 }]
    }));
    expect(db.issues.some((i) => i.includes('transformers.xlsx row 4'))).toBe(true);
    applyDatabase(db);
    expect(STANDARD_TRANSFORMER_KVA).toEqual([1000, 1500]);
    expect(typicalImpedancePct(1000)).toBe(6);
    expect(catalog().busbar[0].material).toBe('cu');
    expect(rule('pfMinimum')).toBe(0.95);
    expect(rule('meter1PhMaxKw')).toBe(13); // default kept
    expect(fallbackRate('spd:T2')).toBe(1800);
    expect(fallbackRate('tx:1000:6')).toBe(120000);
    expect(loadPriceLists()[0].name).toBe('Schneider (Excel)');
    expect(catalog().unitTypes[0].rooms.length).toBe(2);
    expect(roomTypesOf({ buildings: [], rooms: [] })[0].id).toBe('office-open');
  });
  it('goes back to the built-in values when a workbook is emptied', () => {
    applyDatabase(parseDatabase(raw({ transformers: [{ kva: 1000 }] })));
    applyDatabase(parseDatabase(raw({})));
    expect(STANDARD_TRANSFORMER_KVA.length).toBeGreaterThan(10);
  });
});

describe('Excel workbooks (desktop side)', () => {
  const require = createRequire(import.meta.url);
  const database = require('../../electron/database.cjs');
  it('creates the new workbooks with a Read me, saves from the app with a backup, keeps the dropdowns', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lvdb-'));
    const { created } = await database.ensureDatabase(dir, databaseSeeds());
    expect(created).toEqual(expect.arrayContaining(['Transformers.xlsx', 'RoomTypes.xlsx', 'Rules.xlsx', 'Prices.xlsx']));
    const read1 = await database.readDatabase(dir);
    expect(read1.books.transformers.rows.length).toBeGreaterThan(10);
    expect(read1.books.roomTypes.rows.length).toBeGreaterThan(10);
    await database.writeBook(dir, 'busbar', [{ material: 'Cu', ratingA: 800, rMohmPerM: 0.08, xMohmPerM: 0.02 }]);
    const read2 = await database.readDatabase(dir);
    expect(read2.books.busbar.rows).toHaveLength(1);
    expect(read2.books.busbar.rows[0].ratingA).toBe(800);
    expect(fs.readdirSync(path.join(dir, 'LV Database', 'Backups')).some((f) => f.startsWith('Busbar '))).toBe(true);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync(path.join(dir, 'LV Database', 'Busbar.xlsx')) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Read me')).toBeTruthy();
    expect(wb.getWorksheet('Busbar')!.getCell('A2').dataValidation?.type).toBe('list');
    database.writeLibrary(dir, { 'lvds.sldNotes': ['a'] });
    expect(database.readLibrary(dir)['lvds.sldNotes']).toEqual(['a']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
