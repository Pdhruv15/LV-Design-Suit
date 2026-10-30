import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addSheet, issueSheets, setOf, sheetHash, type DrawingSet } from './drawingSet';
import { removeDanglingReferences } from './integrity';
import { changeText, cloudChanges, sheetChanges, sheetItems } from './sheetChanges';
import type { Project } from '../types';

/** The sample project's SLD on one sheet, issued at Rev A. */
function issued(): { p: Project; set: DrawingSet; id: string } {
  const p = sampleProject;
  const { set, id } = addSheet(setOf(p), p.boards.map((b) => b.id), 'SLD');
  const r = issueSheets(set, [id], { date: '2026-10-30', purpose: 'FOR APPROVAL', description: '', bump: true }, undefined, (s) => sheetHash(p, set, s), (s) => sheetItems(p, set, s));
  return { p: { ...p, drawingSet: r.set }, set: r.set, id };
}
const sheet = (set: DrawingSet, id: string) => set.sheets.find((s) => s.id === id)!;
const edit = (p: Project, id: string, f: object): Project => ({ ...p, feeders: p.feeders.map((x) => (x.id === id ? { ...x, ...f } : x)) });

describe('Cloud the changes (SLD sheets)', () => {
  it('keeps each panel and circuit drawn when the sheet is issued', () => {
    const { set, id } = issued();
    const s = sheet(set, id);
    expect(s.rev).toBe('A');
    expect(Object.keys(s.issuedItems!)).toEqual(expect.arrayContaining(['b:MDB-1', 'b:DB-GF1', 'f:INC-GF', 'f:GF-LTG']));
    expect(s.issuedItems!['b:DB-GF1']).toMatchObject({ ratedCurrentA: 100, circuits: 21 });
    expect(s.issuedItems!['b:SMDB-GF']).not.toHaveProperty('connectedKw'); // a sub-main's load is what is downstream
    expect(sheetChanges(sampleProject, set, s)).toEqual([]);
  });

  it('lists the changed panels and circuits with what changed, and only what the SLD prints', () => {
    const { p, set, id } = issued();
    let q = edit(p, 'INC-DBGF1', { cableCsaMm2: 50, breakerRatingA: 160 });
    q = edit(q, 'GF-LTG', { remarks: 'moved', room: 'Lobby' }); // not printed on the SLD
    q = { ...q, boards: q.boards.map((b) => (b.id === 'MCC-1' ? { ...b, ratedCurrentA: 630 } : b)) };
    const c = sheetChanges(q, set, sheet(set, id))!;
    expect(c.map((x) => [x.key, x.label, changeText(x)])).toEqual([
      ['b:MCC-1', 'MCC-1', `Rating (A) ${sampleProject.boards.find((b) => b.id === 'MCC-1')!.ratedCurrentA} → 630`],
      ['f:INC-DBGF1', 'SMDB-GF → DB-GF1', `Breaker (A) ${sampleProject.feeders.find((f) => f.id === 'INC-DBGF1')!.breakerRatingA} → 160; Cable (mm²) 35 → 50`]
    ]);
  });

  it('flags a DB box when its circuits change, and a circuit taken off as not cloudable', () => {
    const { p, set, id } = issued();
    const gone = p.feeders.find((f) => f.boardId === 'SMDB-FF' && !f.feedsBoardId)!;
    const dbCircuit = p.feeders.find((f) => f.boardId === 'DB-GF1')!;
    const q = { ...p, feeders: p.feeders.filter((f) => f.id !== gone.id && f.id !== dbCircuit.id) };
    const c = sheetChanges(q, set, sheet(set, id))!;
    expect(c.find((x) => x.key === 'b:DB-GF1')!.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['Circuits']));
    expect(c.find((x) => x.key === `f:${gone.id}`)).toMatchObject({ change: 'removed', cloudable: false });
  });

  it('says nothing can be compared for a sheet issued before items were kept, or another kind of sheet', () => {
    const { set, id } = issued();
    const { issuedItems: _x, ...old } = sheet(set, id);
    expect(sheetChanges(sampleProject, set, old)).toBeUndefined();
    expect(sheetItems(sampleProject, set, { ...old, kind: 'riser', buildingId: 'B1' })).toBeUndefined();
  });

  it('clouds each ticked panel and circuit once at the revision', () => {
    const { set, id } = issued();
    const s = cloudChanges(sheet(set, id), ['b:MCC-1', 'f:INC-DBGF1'], 'B');
    expect(s.clouds).toEqual([{ boards: ['MCC-1'], rev: 'B' }, { boards: [], feeders: ['INC-DBGF1'], rev: 'B' }]);
    expect(cloudChanges(s, ['f:INC-DBGF1'], 'B')).toBe(s);
    expect(cloudChanges(s, ['f:INC-DBGF1'], 'C').clouds).toHaveLength(3);
  });

  it('drops a circuit cloud when its circuit is deleted', () => {
    const { p, set, id } = issued();
    const s = cloudChanges(sheet(set, id), ['b:MCC-1', 'f:INC-DBGF1'], 'B');
    const q = removeDanglingReferences({ ...p, feeders: p.feeders.filter((f) => f.id !== 'INC-DBGF1'), drawingSet: { ...set, sheets: set.sheets.map((x) => (x.id === id ? s : x)) } });
    expect(sheet(q.drawingSet!, id).clouds).toEqual([{ boards: ['MCC-1'], rev: 'B' }]);
  });
});
