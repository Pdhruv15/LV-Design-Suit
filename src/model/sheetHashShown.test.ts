import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { sampleProject } from '../data/sampleProject';
import { addEarthingSheet, addRiserSheet, issueSheets, sheetChecks, sheetHash, SHEET_HASH_V, type DrawingSet, type DrawingSheet } from './drawingSet';
import { earthingLayout } from './earthingPlan';

const empty: DrawingSet = { prefix: 'E-SLD-', sheets: [], register: true };
const sheetOf = (r: { set: DrawingSet; id: string }) => r.set.sheets.find((s) => s.id === r.id)!;
const dbSheet: DrawingSheet = { id: 'db', number: 'E-DB-001', title: 'DB-GF1', kind: 'board', boards: ['DB-GF1'], size: 'auto' };
const withFeeder = (p: Project, id: string, patch: object): Project => ({ ...p, feeders: p.feeders.map((f) => (f.id === id ? { ...f, ...patch } : f)) });
const moreLoad = withFeeder(sampleProject, 'DB-GF1-R3', { loadKw: 8 }); // a final circuit: TCL up the chain changes

describe('sheet fingerprints cover the calculated values a sheet prints', () => {
  it('riser: a final-circuit load changes the TCL shown, so the riser is changed', () => {
    for (const style of [undefined, 'feeders'] as const) {
      const r = addRiserSheet(empty, 'A', 'Tower A', style);
      expect(sheetHash(moreLoad, r.set, sheetOf(r))).not.toBe(sheetHash(sampleProject, r.set, sheetOf(r)));
    }
  });

  it('earthing: substation grouping, standby generator and pit tests change the sheet', () => {
    const r = addEarthingSheet(empty), s = sheetOf(r);
    const h = sheetHash(sampleProject, r.set, s);
    const sub = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'MDB-1' ? { ...b, substation: 'SS-2' } : b)) };
    const gen = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'MDB-1' ? { ...b, standby: { kva: 500 } } : b)) };
    expect(sheetHash(sub, r.set, s)).not.toBe(h);
    expect(sheetHash(gen, r.set, s)).not.toBe(h);
    const pit = earthingLayout(sampleProject).pits[0].id;
    const tested = { ...sampleProject, earthingPlan: { ...sampleProject.earthingPlan, measured: { [pit]: 0.8 } } };
    expect(sheetHash(tested, r.set, s)).not.toBe(h);
  });

  it('DB sheet: the upstream incomer CPC and the pit tests it prints change the sheet', () => {
    const set = { ...empty, sheets: [dbSheet] };
    const h = sheetHash(sampleProject, set, dbSheet);
    expect(sheetHash(withFeeder(sampleProject, 'INC-DBGF1', { cpcMm2: 25 }), set, dbSheet)).not.toBe(h);
    // DB-GF1's sheet prints the result of the MDB's LV pit group: it changes once the group is tested.
    const pits = earthingLayout(sampleProject).pits.filter((x) => x.itemKey === 'lv:MDB-1').map((x) => x.id);
    const one = { ...sampleProject, earthingPlan: { ...sampleProject.earthingPlan, measured: { [pits[0]]: 0.8 } } };
    const all = { ...sampleProject, earthingPlan: { ...sampleProject.earthingPlan, measured: Object.fromEntries(pits.map((i) => [i, 0.8])) } };
    expect(sheetHash(one, set, dbSheet)).toBe(h); // still "not tested" on the sheet
    expect(sheetHash(all, set, dbSheet)).not.toBe(h);
  });

  it('a sheet issued before version 2 keeps its fingerprint (not flagged by the new fields)', () => {
    const r = addRiserSheet(empty, 'A', 'Tower A');
    const legacy = { ...sheetOf(r), issuedHash: 'x' }; // issued, no version recorded
    expect(sheetHash(moreLoad, r.set, legacy)).toBe(sheetHash(sampleProject, r.set, legacy));
  });

  it('issuing records version 2, then a load change flags the riser', () => {
    const r = addRiserSheet(empty, 'A', 'Tower A', 'feeders');
    const issued = issueSheets(r.set, [r.id], { date: '2026-10-20', purpose: 'FOR APPROVAL', description: '', bump: true }, undefined, (s) => sheetHash(sampleProject, r.set, s)).set;
    expect(issued.sheets[0].issuedHashV).toBe(SHEET_HASH_V);
    expect(sheetChecks(sampleProject, issued).some((x) => x.text.includes('changed since'))).toBe(false);
    expect(sheetChecks(moreLoad, issued).some((x) => x.text.includes('changed since'))).toBe(true);
  });
});
