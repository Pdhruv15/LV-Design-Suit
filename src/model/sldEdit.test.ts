import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { evaluateFeeder } from '../calc/electrical';
import { layoutSystem } from '../diagram/layout';
import { newProject, type Project } from '../types';
import { applyDrop, applyMove, canDrop, canMove, dropHint, type PaletteItem } from './sldEdit';

const bus = (boardId: string) => ({ type: 'bus' as const, boardId });
const canvas = { type: 'canvas' as const };

describe('drag and drop SLD', () => {
  it('dropping a DB on a busbar adds the board with its breaker and incomer cable, connected', () => {
    const r = applyDrop(sampleProject, { kind: 'board', board: 'DB' }, bus('SMDB-FF'));
    const db = r.project.boards.find((b) => b.id === 'DB-1')!;
    expect(db).toMatchObject({ kind: 'DB', upstreamId: 'SMDB-FF', ratedCurrentA: 63 });
    const inc = r.project.feeders.find((f) => f.feedsBoardId === 'DB-1')!;
    expect(inc).toMatchObject({ boardId: 'SMDB-FF', breakerRatingA: 63, cores: 4 });
    expect(evaluateFeeder(r.project, inc).ampacity).toBeGreaterThanOrEqual(63); // cable rated for its breaker
    expect(r.select).toEqual({ type: 'board', id: 'DB-1' });
    expect(r.message).toMatch(/load schedule/);
    expect(layoutSystem(r.project).boards.some((b) => b.board.id === 'DB-1')).toBe(true);
  });

  it('dropping a load on a busbar adds a feeder sized by the app', () => {
    const r = applyDrop(sampleProject, { kind: 'load', preset: 'chiller' }, bus('MDB-1'));
    const f = r.project.feeders.find((x) => x.id === r.select!.id)!;
    expect(f).toMatchObject({ boardId: 'MDB-1', name: 'Chiller 1', loadKw: 150, loadType: 'hvac' });
    expect(evaluateFeeder(r.project, f).status).not.toBe('bad');
    expect(f.breakerRatingA).toBeGreaterThanOrEqual(250);
  });

  it('numbers repeated drops', () => {
    const a = applyDrop(sampleProject, { kind: 'load', preset: 'motor' }, bus('MCC-1'));
    const b = applyDrop(a.project, { kind: 'load', preset: 'motor' }, bus('MCC-1'));
    expect([a.select!.id, b.select!.id]).toEqual(['MCC-1-MOTOR-1', 'MCC-1-MOTOR-2']);
    const s1 = applyDrop(sampleProject, { kind: 'board', board: 'SMDB' }, bus('MDB-1'));
    const s2 = applyDrop(s1.project, { kind: 'board', board: 'SMDB' }, bus('MDB-1'));
    expect(s2.select!.id).toBe('SMDB-2');
  });

  it('starts a new project from the empty canvas: meter cabinet → MDB → SMDB → DB', () => {
    let p: Project = { ...newProject('Blank'), boards: [], feeders: [] };
    p = applyDrop(p, { kind: 'board', board: 'MC' }, canvas).project;
    expect(p.boards[0]).toMatchObject({ id: 'MC-1', kind: 'MC', supply: { fedFrom: 'DEWA' } });
    p = applyDrop(p, { kind: 'board', board: 'MDB' }, bus('MC-1')).project;
    p = applyDrop(p, { kind: 'board', board: 'SMDB' }, bus('MDB-1')).project;
    p = applyDrop(p, { kind: 'board', board: 'DB' }, bus('SMDB-1')).project;
    expect(p.boards.map((b) => `${b.id}<${b.upstreamId ?? ''}`)).toEqual(['MC-1<', 'MDB-1<MC-1', 'SMDB-1<MDB-1', 'DB-1<SMDB-1']);
    expect(p.feeders.map((f) => f.id)).toEqual(['INC-MDB-1', 'INC-SMDB-1', 'INC-DB-1']);
  });

  it('a transformer makes a new supply on the canvas, or powers a main board', () => {
    const r = applyDrop(sampleProject, { kind: 'transformer' }, canvas);
    expect(r.project.boards.find((b) => b.id === r.select!.id)).toMatchObject({ kind: 'MDB', sourceKva: 1000 });
    const p = { ...newProject('x') };
    const bare = { ...p, boards: [{ ...p.boards[0], sourceKva: undefined, sourceImpedancePct: undefined }] };
    const t = applyDrop(bare, { kind: 'transformer' }, bus('MDB-1'));
    expect(t.project.boards[0]).toMatchObject({ sourceKva: 1000, sourceImpedancePct: 6 });
    const again = applyDrop(sampleProject, { kind: 'transformer' }, bus('MDB-1'));
    expect(again.project).toBe(sampleProject);
    expect(again.message).toMatch(/already has a 1000 kVA transformer/);
  });

  it('protection devices change the feeder they are dropped on', () => {
    const iso = applyDrop(sampleProject, { kind: 'device', device: 'ISOL' }, { type: 'feeder', feederId: 'INC-DBGF1' });
    expect(iso.project.feeders.find((f) => f.id === 'INC-DBGF1')!.device).toBe('ISOL');
    const acb = applyDrop(sampleProject, { kind: 'device', device: 'ACB' }, { type: 'feeder', feederId: 'INC-GF' });
    expect(acb.project.feeders.find((f) => f.id === 'INC-GF')).toMatchObject({ breakerType: 'ACB', device: 'ACB' });
    const mcb = applyDrop(sampleProject, { kind: 'device', device: 'MCB' }, { type: 'feeder', feederId: 'INC-GF' });
    expect(mcb.project.feeders.find((f) => f.id === 'INC-GF')!.breakerType).toBe('MCCB');
    expect(mcb.message).toMatch(/MCBs go up to 63 A/);
  });

  it('refuses drops that make no sense, with a hint', () => {
    const cases: [PaletteItem, Parameters<typeof canDrop>[2]][] = [
      [{ kind: 'load', preset: 'ahu' }, canvas],
      [{ kind: 'board', board: 'DB' }, canvas],
      [{ kind: 'board', board: 'MC' }, bus('MDB-1')],
      [{ kind: 'board', board: 'MDB' }, bus('SMDB-GF')],
      [{ kind: 'transformer' }, bus('SMDB-GF')],
      [{ kind: 'device', device: 'MCCB' }, bus('MDB-1')],
      [{ kind: 'cable' }, canvas]
    ];
    for (const [item, target] of cases) {
      expect(canDrop(sampleProject, item, target)).toBe(false);
      const r = applyDrop(sampleProject, item, target);
      expect(r.project).toBe(sampleProject);
      expect(r.message).toBe(dropHint(item));
    }
  });
});

describe('moving on the diagram', () => {
  const fd = (feederId: string) => ({ type: 'feeder' as const, feederId });
  const order = (p: Project, board: string) => p.feeders.filter((f) => f.boardId === board).map((f) => f.id);

  it('moves a load to another busbar, re-checking its sizes', () => {
    const r = applyMove(sampleProject, { kind: 'feeder', id: 'GF-HVAC' }, bus('SMDB-FF'));
    const f = r.project.feeders.find((x) => x.id === 'GF-HVAC')!;
    expect(f.boardId).toBe('SMDB-FF');
    expect(order(r.project, 'SMDB-FF').slice(-1)).toEqual(['GF-HVAC']);
    expect(r.message).toBe('Moved HVAC from SMDB-GF to SMDB-FF');
    expect(evaluateFeeder(r.project, f).ampacityStatus).toBe('ok');
  });

  it('reorders along a busbar by dropping before another feeder', () => {
    const r = applyMove(sampleProject, { kind: 'feeder', id: 'GF-HVAC' }, fd('GF-LTG'));
    expect(order(r.project, 'SMDB-GF')).toEqual(['GF-HVAC', 'GF-LTG', 'GF-SKT', 'INC-DBGF1']);
    expect(r.message).toBe('Moved HVAC before Lighting');
  });

  it('moves a board with its incomer and everything below it', () => {
    const r = applyMove(sampleProject, { kind: 'board', id: 'DB-GF1' }, bus('SMDB-FF'));
    expect(r.project.boards.find((b) => b.id === 'DB-GF1')!.upstreamId).toBe('SMDB-FF');
    expect(r.project.feeders.find((f) => f.id === 'INC-DBGF1')!.boardId).toBe('SMDB-FF');
    expect(r.project.feeders.filter((f) => f.boardId === 'DB-GF1')).toHaveLength(21);
    expect(layoutSystem(r.project).boards.find((b) => b.board.id === 'DB-GF1')!.depth).toBe(2);
  });

  it('never moves a board under itself, and main boards have nothing to move', () => {
    expect(canMove(sampleProject, { kind: 'board', id: 'SMDB-GF' }, bus('DB-GF1'))).toBe(false);
    expect(canMove(sampleProject, { kind: 'board', id: 'SMDB-GF' }, bus('SMDB-GF'))).toBe(false);
    expect(canMove(sampleProject, { kind: 'board', id: 'MDB-1' }, bus('SMDB-GF'))).toBe(false);
    expect(canMove(sampleProject, { kind: 'feeder', id: 'GF-HVAC' }, fd('GF-HVAC'))).toBe(false);
    expect(canMove(sampleProject, { kind: 'feeder', id: 'GF-HVAC' }, canvas)).toBe(false);
    const r = applyMove(sampleProject, { kind: 'board', id: 'SMDB-GF' }, bus('DB-GF1'));
    expect(r.project).toBe(sampleProject);
  });
});
