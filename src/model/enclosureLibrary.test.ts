import { beforeEach, describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { BUILTIN_CATALOGUES, sizeEnclosure } from '../calc/enclosure';
import { allCatalogues, catalogueWorkbook, duplicateCatalogue, exportLibrary, importLibrary, loadDevices, matchDevice, neededDevices, readCatalogueWorkbook, saveDevices, saveUserCatalogues, scheduleModules, userCatalogues, validateCatalogue, type DeviceDim } from './enclosureLibrary';

// localStorage for node
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 } as Storage;
beforeEach(() => store.clear());

const [MOD] = BUILTIN_CATALOGUES;

describe('enclosure library', () => {
  it('built-in chart validates clean; duplicate is editable, the built-in stays as it is', () => {
    for (const c of BUILTIN_CATALOGUES) expect(validateCatalogue(c).filter((x) => x.level === 'bad')).toEqual([]);
    const copy = duplicateCatalogue(MOD, 'Brand B');
    copy.configs[4].usable.elcb12 = 70;
    saveUserCatalogues([copy]);
    expect(allCatalogues().map((c) => c.supplier)).toEqual(['Supplier chart', 'Supplier chart', 'Brand B']);
    expect(MOD.configs[4].usable.elcb12).toBe(72);
    expect(validateCatalogue(copy).some((x) => x.level === 'warn' && /≠ 80 − 8/.test(x.text))).toBe(true);
    saveUserCatalogues([...userCatalogues(), MOD]); // built-ins are never stored
    expect(userCatalogues()).toHaveLength(1);
  });

  it('validation stops impossible data', () => {
    const bad = duplicateCatalogue(MOD);
    bad.configs[0].usable.elcb12 = 999;
    bad.configs[1].dims = {};
    bad.rules.push({ ...bad.rules[0] });
    const v = validateCatalogue(bad).filter((x) => x.level === 'bad').map((x) => x.text).join(' | ');
    expect(v).toMatch(/more than gross/);
    expect(v).toMatch(/dimensions missing/);
    expect(v).toMatch(/used twice/);
  });

  it('JSON backup round trip; Excel template round trip gives the same sizing', async () => {
    saveUserCatalogues([duplicateCatalogue(MOD, 'Brand B')]);
    saveDevices([{ id: 'd1', manufacturer: 'X', model: 'MCB 1P', kind: 'MCB', poles: 1, modules: 1 }]);
    const file = JSON.stringify(exportLibrary());
    store.clear();
    expect(importLibrary(file)).toEqual({ catalogues: 1, devices: 1 });
    expect(userCatalogues()[0].supplier).toBe('Brand B');
    expect(() => importLibrary('{"kind":"other"}')).toThrow();
    const wb = catalogueWorkbook(MOD);
    const bytes = await wb.xlsx.writeBuffer();
    const back = await readCatalogueWorkbook(bytes as ArrayBuffer);
    expect(back.configs).toHaveLength(MOD.configs.length);
    expect(back.configs[4]).toMatchObject({ ref: '5 × 16', rows: 5, modulesPerRow: 16, grossModules: 80, dims: { surface: { h: 905, w: 445, d: 115 }, flush: { h: 925, w: 465, d: 115 } }, usable: { elcb12: 72, elcb15: null } });
    const input = { equipmentModules: 64, spareModules: 8, elcbCount: 10 };
    expect(sizeEnclosure(back, input).candidates.map((c) => [c.config.ref, c.usable, c.result])).toEqual(sizeEnclosure(MOD, input).candidates.map((c) => [c.config.ref, c.usable, c.result]));
    expect(validateCatalogue(back).filter((x) => x.level === 'bad')).toEqual([]);
  });

  it('from schedule: devices listed, widths only from records, unmapped devices reported', () => {
    const db = sampleProject.boards.find((b) => b.id === 'DB-GF1')!.id;
    const none = scheduleModules(neededDevices(sampleProject, db, []));
    expect(none.modules).toBe(0);
    expect(none.unmapped.length).toBeGreaterThan(0); // nothing guessed from poles
    const recs: DeviceDim[] = [
      { id: 'a', manufacturer: 'X', model: 'MCB 1P', kind: 'MCB', poles: 1, modules: 1 },
      { id: 'b', manufacturer: 'X', model: 'MCB 3P', kind: 'MCB', poles: 3, modules: 3 },
      { id: 'c', manufacturer: 'X', model: 'RCCB 2P', kind: 'RCCB', poles: 2, modules: 2 },
      { id: 'e', manufacturer: 'X', model: 'RCCB 4P', kind: 'RCCB', poles: 4, modules: 4 },
      { id: 'f', manufacturer: 'X', model: 'Isolator 4P', kind: 'Isolator', poles: 4, modules: 4 },
      { id: 'g', manufacturer: 'X', model: 'MCCB 4P', kind: 'MCCB', poles: 4, modules: 0 }
    ];
    const needed = neededDevices(sampleProject, db, recs);
    const s = scheduleModules(needed);
    expect(s.modules).toBe(needed.reduce((n, d) => n + (d.device ? d.device.modules * d.count : 0), 0));
    expect(needed.every((d) => d.device === matchDevice(recs, d.kind, d.poles, d.ratingA))).toBe(true);
    expect(matchDevice([{ id: 'r', manufacturer: 'X', model: 'm', kind: 'MCB', poles: 1, ratingMinA: 6, ratingMaxA: 32, modules: 1 }], 'MCB', 1, 40)).toBeUndefined();
    expect(loadDevices()).toEqual([]);
  });
});
