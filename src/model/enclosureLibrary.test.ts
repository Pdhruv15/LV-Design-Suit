import { beforeEach, describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { BUILTIN_CATALOGUES, sizeEnclosure } from '../calc/enclosure';
import { BRAND_DEVICES } from '../data/brandDevices';
import { allCatalogues, catalogueWorkbook, duplicateCatalogue, exportLibrary, importLibrary, loadDevices, matchDevice, neededDevices, TYPICAL_DEVICES, isTypical, isBrand, readCatalogueWorkbook, saveDevices, saveUserCatalogues, scheduleModules, userCatalogues, validateCatalogue, type DeviceDim } from './enclosureLibrary';

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
    expect(back.configs[4]).toMatchObject({ ref: '5 × 16', rows: 5, modulesPerRow: 16, grossModules: 80, dims: { surface: { h: 905, w: 445, d: 115 }, flush: { h: 925, w: 465, d: 115 } }, usable: { elcb12: 72, elcb15: 68 } });
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

  it('ELCB groups on a three-phase board are 4-pole RCCBs; typical widths fill in when no record matches', () => {
    const db = 'DB-GF1';
    const rccb = neededDevices(sampleProject, db).filter((d) => d.kind === 'RCCB');
    expect(rccb.length).toBeGreaterThan(0);
    // Manufacturer data first: ABB F200 4P, 70 mm = 4 modules
    expect(rccb.every((d) => d.poles === 4 && d.device?.modules === 4 && isBrand(d.device) && d.device.widthMm === 70)).toBe(true);
    // Without manufacturer data, the typical width
    expect(neededDevices(sampleProject, db, TYPICAL_DEVICES).filter((d) => d.kind === 'RCCB').every((d) => isTypical(d.device))).toBe(true);
    // Your own record beats the typical width
    const mine: DeviceDim = { id: 'm', manufacturer: 'X', model: 'RCCB 4P wide', kind: 'RCCB', poles: 4, modules: 5 };
    expect(neededDevices(sampleProject, db, [mine, ...TYPICAL_DEVICES]).find((d) => d.kind === 'RCCB')!.device!.id).toBe('m');
    // MCCBs have no typical width
    expect(matchDevice(TYPICAL_DEVICES, 'MCCB', 4, 100)).toBeUndefined();
  });

  it('from schedule: more circuits → more modules and ELCBs; above 12 ELCB the 12-module case applies', () => {
    const db = 'DB-GF1';
    const base = sampleProject.feeders.find((f) => f.boardId === db && f.way && f.phase && f.phase !== 'RYB')!;
    const big = { ...sampleProject, feeders: [...sampleProject.feeders.filter((f) => !(f.boardId === db && f.way)),
      ...Array.from({ length: 28 }, (_, w) => (['R', 'Y', 'B'] as const).map((ph) => ({ ...base, id: `T-${w + 1}${ph}`, way: w + 1, phase: ph }))).flat()] };
    const small = scheduleModules(neededDevices(sampleProject, db));
    const s = scheduleModules(neededDevices(big, db));
    expect(s.elcb).toBe(14); // 28 ways, one ELCB per two ways
    expect(s.modules).toBeGreaterThan(small.modules);
    const mod = BUILTIN_CATALOGUES.find((c) => c.family === 'modular')!;
    const r = sizeEnclosure(mod, { equipmentModules: s.modules, spareModules: 0, elcbCount: s.elcb });
    expect(r.rules.map((x) => x.deductModules)).toEqual([12]);
  });

  it('manufacturer data: DIN widths in modules, chassis devices without, ratings respected', () => {
    const by = (id: string) => BRAND_DEVICES.find((d) => d.id === `brand-${id}`)!;
    expect([by('mcb_1p').modules, by('mcb_4p').modules, by('rccb_2p').modules, by('rcbo_1pn').modules, by('spd_3pn').modules]).toEqual([1, 4, 2, 1, 4]);
    expect(by('mccb_250a_3p').modules).toBe(0);
    expect(by('acb_3200a_3p_drawout')).toMatchObject({ kind: 'ACB', widthMm: 317, heightMm: 425, depthMm: 383 });
    expect(matchDevice(BRAND_DEVICES, 'RCBO', 1, 40)).toBeUndefined(); // Siemens 5SV1 is 6–32 A
    expect(matchDevice(BRAND_DEVICES, 'MCB', 1, 20)?.manufacturer).toBe('Schneider Electric');
  });
});
