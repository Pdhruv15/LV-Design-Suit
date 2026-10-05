import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { UPS_DEFAULTS } from '../calc/ups';
import { sheetsByCount } from './drawingSet';
import { deleteBoard } from './edit';
import { renamePanels } from './renamePanels';
import { pasteBoard } from './copyBoard';
import { applyMove } from './sldEdit';
import { checkReferences } from './integrity';
import { earthingLayout, withEarthPitIds } from './earthingPlan';
import type { Project } from '../types';

/** A project in which every kind of reference is used: sheets, clouds, callouts, UPS, bus coupler, riser, study report, plans, selections. */
function connected(): Project {
  const set = sheetsByCount(sampleProject, 10);
  const s0 = set.sheets[0];
  return {
    ...sampleProject,
    drawingSet: { ...set, sheets: [{ ...s0, clouds: [{ boards: ['DB-GF1'], rev: 'A' }], arrows: [{ target: 'DB-GF1', text: 'new', dir: 'ne' }, { target: 'f:DB-GF1-R1', text: 'check', dir: 'se' }] }, ...set.sheets.slice(1)] },
    upsSystems: [{ ...UPS_DEFAULTS, id: 'u1', name: 'UPS-1', boardId: 'DB-GF1', loads: [] }],
    ties: [{ id: 'tie1', a: 'SMDB-GF', b: 'DB-GF1', ratingA: 400 }],
    busRisers: [{ id: 'br1', name: 'Riser 1', sourceBoardId: 'DB-GF1' } as never],
    studyReport: { boards: ['DB-GF1', 'SMDB-FF'], downstream: true, studies: [], sld: true, separate: false },
    pfc: { boards: ['DB-GF1'] } as never,
    txGen: { txBoards: ['MDB-1'], n1: ['MDB-1'] } as never,
    vdSelection: ['DB-GF1-R1', 'DB-GF1-R3']
  };
}

describe('reference integrity', () => {
  it('finds nothing wrong in a consistent project', () => {
    expect(checkReferences(sampleProject)).toEqual([]);
    expect(checkReferences(connected())).toEqual([]);
  });

  it('reports every kind of dangling reference, loops and repeated ids', () => {
    const p = connected();
    const bad: Project = {
      ...p,
      boards: [...p.boards.map((b) => (b.id === 'SMDB-FF' ? { ...b, upstreamId: 'GHOST' } : b)), { ...p.boards[0], id: 'DB-GF1' }],
      feeders: [...p.feeders, { ...p.feeders[0], id: p.feeders[0].id, boardId: 'GHOST', feedsBoardId: 'GHOST2' }],
      ties: [{ id: 't', a: 'NOPE', b: 'DB-GF1', ratingA: 1 }],
      vdSelection: ['missing-circuit'],
      upsSystems: [{ ...UPS_DEFAULTS, id: 'u', name: 'U', boardId: 'NOPE', loads: [] }]
    };
    const text = checkReferences(bad).map((i) => `${i.where}: ${i.problem}`).join('\n');
    for (const part of ['Panel SMDB-FF: Panel it is fed from does not exist', 'same name as another panel', 'same id as another circuit', 'Panel it is on does not exist', 'Panel it feeds does not exist',
      'Bus coupler t: Panel A does not exist', 'Voltage drop selection: Circuit does not exist', 'UPS U: UPS panel does not exist']) expect(text).toContain(part);
    const loop: Project = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'MDB-1' ? { ...b, upstreamId: 'DB-GF1' } : b)) };
    expect(checkReferences(loop).some((i) => i.problem === 'is fed in a loop')).toBe(true);
  });

  it('renaming a panel updates every reference to it', () => {
    const r = renamePanels(connected(), [{ from: 'DB-GF1', to: 'DB-L1-01' }]);
    expect(checkReferences(r)).toEqual([]);
    expect(r.drawingSet!.sheets[0].clouds![0].boards).toEqual(['DB-L1-01']);
    expect(r.upsSystems![0].boardId).toBe('DB-L1-01');
    expect(r.vdSelection).toEqual(['DB-L1-01-R1', 'DB-L1-01-R3']);
  });

  it('copying a panel gives the copy its own identities and breaks nothing', () => {
    const p = connected();
    const r = pasteBoard(p, 'DB-GF1', 'SMDB-FF', { idFind: 'GF1', idReplace: 'FF9', nameFind: '', nameReplace: '' });
    expect(checkReferences(r.project)).toEqual([]);
    expect(r.project.boards.filter((b) => b.id === 'DB-GF1')).toHaveLength(1);
    expect(r.rootId).not.toBe('DB-GF1');
    expect(new Set(r.project.feeders.map((f) => f.id)).size).toBe(r.project.feeders.length);
    expect(r.project.drawingSet).toBe(p.drawingSet); // the copy is not placed on sheets or in selections by itself
  });

  it('moving a branch keeps the supply chain valid', () => {
    const p = connected();
    const moved = applyMove(p, { kind: 'board', id: 'DB-GF1' }, { type: 'bus', boardId: 'SMDB-FF' });
    expect(checkReferences(moved.project)).toEqual([]);
    expect(moved.project.boards.find((b) => b.id === 'DB-GF1')!.upstreamId).toBe('SMDB-FF');
  });

  it('deleting a panel removes it from sheets, clouds, callouts, couplers and report scopes — but never silently re-sources a study', () => {
    const r = deleteBoard(connected(), 'DB-GF1');
    expect(r.boards.some((b) => b.id === 'DB-GF1')).toBe(false);
    expect(r.drawingSet!.sheets[0].clouds ?? []).toEqual([]);
    expect(r.drawingSet!.sheets[0].arrows ?? []).toEqual([]);
    expect(r.ties ?? []).toEqual([]);
    expect(r.studyReport!.boards).toEqual(['SMDB-FF']);
    // What a study is sized from or scoped to stays as it was — unresolved, and reported.
    expect(r.upsSystems![0].boardId).toBe('DB-GF1');
    expect(r.busRisers![0].sourceBoardId).toBe('DB-GF1');
    expect(r.pfc!.boards).toEqual(['DB-GF1']);
    expect(r.vdSelection).toEqual(['DB-GF1-R1', 'DB-GF1-R3']);
    const where = checkReferences(r).map((i) => i.where).sort();
    expect(where).toEqual(['Busbar riser Riser 1', 'Power factor plan', 'UPS UPS-1', 'Voltage drop selection', 'Voltage drop selection']);
  });

  it('renaming a main board keeps its earth pit settings, pit IDs and measured values', () => {
    const p = withEarthPitIds({ ...sampleProject, earthingPlan: { pits: { 'lv:MDB-1': 3, 'txn:MDB-1': 2 }, unlinked: ['lv:MDB-1'], measured: { E1: 0.8, E2: 1.1 } } });
    const ids = (q: Project, key: string) => q.earthPitIds![key];
    const r = renamePanels(p, [{ from: 'MDB-1', to: 'MDB-MAIN' }]);
    expect(checkReferences(r)).toEqual([]);
    expect(r.earthingPlan!.pits).toMatchObject({ 'lv:MDB-MAIN': 3, 'txn:MDB-MAIN': 2 });
    expect(r.earthingPlan!.pits).not.toHaveProperty('lv:MDB-1');
    expect(r.earthingPlan!.unlinked).toEqual(['lv:MDB-MAIN']);
    expect(ids(r, 'lv:MDB-MAIN')).toEqual(ids(p, 'lv:MDB-1'));
    expect(ids(r, 'txn:MDB-MAIN')).toEqual(ids(p, 'txn:MDB-1'));
    const before = earthingLayout(p).pits.map((x) => [x.id, x.measured]);
    const after = earthingLayout(r).pits.map((x) => [x.id, x.measured]);
    expect(after).toEqual(before); // the same pits, the same readings
  });

  it('deleting a panel drops the earthing settings it had, but keeps its retired pit IDs reserved', () => {
    const p = withEarthPitIds({ ...connected(), boards: connected().boards, earthingPlan: { pits: { 'sub:SMDB-FF': 1, 'lv:MDB-1': 2 } } });
    const r = deleteBoard({ ...p, earthPitIds: { ...p.earthPitIds, 'sub:SMDB-FF': ['E40'] } }, 'SMDB-FF');
    expect(r.earthingPlan!.pits).toEqual({ 'lv:MDB-1': 2 });
    expect(r.earthPitIds!['sub:SMDB-FF']).toEqual(['E40']);
  });
});
