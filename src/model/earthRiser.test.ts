import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Board, Feeder, Project } from '../types';
import { DEFAULT_RISER_TAPE, earthRiserLayout } from './earthRiser';
import { earthRiserDrawing } from '../diagram/earthRiserDrawing';
import { addEarthRiserSheet, drawable, renumber, setOf, sheetType } from './drawingSet';
import { cpcOf } from '../calc/cableTable';

/** G+3 tower: one SMDB per floor fed from MDB-1 of the sample project. */
const FLOORS = 4;
function tower() {
  const buildingId = 'BLD-T';
  const panelIds: string[] = [];
  const boards: Board[] = [], feeders: Feeder[] = [];
  for (let floor = 0; floor < FLOORS; floor++) {
    const id = `SMDB-${floor}`;
    panelIds.push(id);
    boards.push({ id, name: `Floor ${floor} SMDB`, kind: 'SMDB', upstreamId: 'MDB-1', ratedCurrentA: 250,
      level: { building: buildingId, level: floor === 0 ? 'G' : 'T', ...(floor > 1 ? { index: floor - 1 } : {}) } });
    feeders.push({ id: `F-${id}`, boardId: 'MDB-1', feedsBoardId: id, name: `To ${id}`, loadKw: 0, demandFactor: 1, powerFactor: 0.9,
      lengthM: 8, cableCsaMm2: floor === 0 ? 120 : 70, cores: 4, breakerRatingA: 160, breakerIcuKa: 36, breakerType: 'MCCB' });
  }
  const project: Project = {
    ...sampleProject,
    building: { buildings: [{ id: buildingId, name: 'Tower', levels: [
      { id: 'G', name: 'Ground floor', kind: 'ground', heightM: 4.5 },
      { id: 'T', name: 'Typical floors', kind: 'typical', heightM: 3.6, count: FLOORS - 1 }
    ] }], rooms: [] },
    boards: [...sampleProject.boards, ...boards],
    feeders: [...sampleProject.feeders, ...feeders]
  };
  return { project, buildingId, panelIds };
}

describe('earthing riser', () => {
  it('gives every floor a floor earth bar and earths each SMDB to it with its incoming CPC', () => {
    const r = tower();
    const L = earthRiserLayout(r.project, r.buildingId);
    expect(L.empty).toBe(false);
    expect(L.tape).toBe(DEFAULT_RISER_TAPE);
    expect(L.floors).toHaveLength(FLOORS);
    expect(new Set(L.floors.map((f) => f.feb)).size).toBe(FLOORS);
    const all = L.floors.flatMap((f) => f.boards);
    expect(all.map((b) => b.board.id).sort()).toEqual([...r.panelIds].sort());
    for (const b of all) {
      expect(b.toBoard).toBeUndefined();
      expect(b.cpcMm2).toBe(cpcOf(b.feeder!));
    }
    expect(L.mains.map((m) => m.board.id)).toEqual(['MDB-1']);
    expect(L.mains[0].pits.length).toBeGreaterThan(0);
  });

  it('earths a DB fed from a panel on the same floor to that panel', () => {
    const r = tower();
    const smdb = r.project.boards.find((b) => b.id === r.panelIds[3])!;
    const p: Project = {
      ...r.project,
      boards: [...r.project.boards, { id: 'DB-L03-A', name: 'Flat DB', kind: 'DB', upstreamId: smdb.id, level: smdb.level }],
      feeders: [...r.project.feeders, { id: 'F-DB-L03-A', boardId: smdb.id, feedsBoardId: 'DB-L03-A', name: 'To DB-L03-A', loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 10, cableCsaMm2: 10, cores: 4, breakerRatingA: 63, breakerIcuKa: 10 }],
      earthingPlan: { riserTape: '50×6 mm Cu tape' }
    };
    const L = earthRiserLayout(p, r.buildingId);
    const floor = L.floors.find((f) => f.boards.some((b) => b.board.id === 'DB-L03-A'))!;
    expect(floor.boards.map((b) => b.board.id)).toEqual([smdb.id, 'DB-L03-A']);
    expect(floor.boards[1]).toMatchObject({ toBoard: smdb.id, cpcMm2: 10 });
    expect(L.tape).toBe('50×6 mm Cu tape');
    const { svg } = earthRiserDrawing(p, r.buildingId, { mono: true });
    expect(svg).toContain('PE 10 mm² → ' + smdb.id);
    expect(svg).toContain('EARTH RISER 50×6 MM CU TAPE');
    expect(svg).not.toMatch(/#1a7f37|#b86b2b/i); // printed sheet is black and white
  });

  it('lists a sub-board without a level instead of drawing it', () => {
    const r = tower();
    const p: Project = { ...r.project, boards: [...r.project.boards, { id: 'DB-X', name: 'No level', kind: 'DB', upstreamId: r.panelIds[0] }] };
    expect(earthRiserLayout(p, r.buildingId).notOnLevel).toEqual(['DB-X']);
    expect(earthRiserDrawing(p, r.buildingId).svg).toContain('NOT SHOWN — NO LEVEL IN THIS BUILDING: DB-X');
  });

  it('is a drawing sheet numbered with the earthing sheets', () => {
    const r = tower();
    const set = renumber({ ...setOf(r.project), earthPrefix: 'E-ERT-' });
    const { set: next, id } = addEarthRiserSheet(set, r.buildingId, 'Tower');
    const s = next.sheets.find((x) => x.id === id)!;
    expect(s).toMatchObject({ kind: 'earthRiser', buildingId: r.buildingId });
    expect(s.number.startsWith('E-ERT-')).toBe(true);
    expect(drawable(s)).toBe(true);
    expect(sheetType(s)).toBe('earthing');
  });
});
