import { describe, expect, it } from 'vitest';
import { applyBoardPlaces, inside, pullBoardPlaces, roomAt, type CadPlan } from './cadPlaces';
import type { Project } from '../types';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const plan = (extra: Partial<CadPlan> = {}): CadPlan => ({
  units: 4,
  places: [],
  symbols: [{ name: 'smdb-gf', x: 22000, y: 6000 }, { name: 'DB-GF1', x: 22000, y: 1500 }, { name: 'DB-XX', x: 1, y: 1 }],
  outlines: [
    { layer: 'A-WALL', points: box(0, 0, 24000, 16000) },
    { layer: 'A-ROOM', points: box(20000, 4000, 24000, 8000) },
    { layer: 'A-ROOM', points: box(20000, 0, 24000, 4000) },
    { layer: 'A-ROOM', points: box(0, 0, 24000, 16000) } // a whole-floor outline: the smallest room wins
  ],
  texts: [
    { layer: 'A-ROOM-NAME', x: 22000, y: 7300, text: 'ELECTRICAL ROOM' },
    { layer: 'NOTES', x: 22000, y: 5000, text: 'Note' },
    { layer: 'A-ROOM-NAME', x: 22000, y: 3300, text: 'Store room' },
    { layer: 'A-ROOM-NAME', x: 12000, y: 15000, text: 'GROUND FLOOR' }
  ],
  ...extra
});

function project(): Project {
  return {
    name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
    boards: [
      { id: 'MDB-1', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 },
      { id: 'SMDB-GF', name: 'S', upstreamId: 'MDB-1', location: 'Ground floor electrical room' },
      { id: 'DB-GF1', name: 'D', upstreamId: 'SMDB-GF', location: 'Store room', planPoint: { x: 22, y: 1.5 } }
    ],
    feeders: [],
    building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground floor', kind: 'ground', heightM: 4 }] }], rooms: [] }
  };
}

describe('board locations from the CAD floor plan', () => {
  it('finds a point inside an outline', () => {
    expect(inside([5, 5], box(0, 0, 10, 10))).toBe(true);
    expect(inside([15, 5], box(0, 0, 10, 10))).toBe(false);
  });

  it('names the smallest room outline around a point by the room-name text inside it', () => {
    const p = plan();
    expect(roomAt(p, [22000, 6000])).toBe('Electrical room'); // ALL CAPS tidied; the note on NOTES loses to the name layer
    expect(roomAt(p, [22000, 1500])).toBe('Store room');
    expect(roomAt(p, [5000, 5000])).toBe('Ground floor'); // only the whole-floor outline is around it
    expect(roomAt(p, [30000, 1])).toBeUndefined();
    // A chosen layer: only outlines on it count (the wall outline, named by the name text nearest its centre).
    expect(roomAt(p, [22000, 6000], 'wall')).toBe('Ground floor');
  });

  it('proposes room, level and position for boards found by attribute or linked by hand', () => {
    const p = project();
    const floor = { building: 'V', level: 'GF' };
    const pull = pullBoardPlaces(p, plan({ places: [{ boardId: 'MDB-1', x: 23000, y: 7000 }] }), floor);
    expect(pull.unknown).toEqual(['DB-XX']);
    expect(pull.units).toBe('drawing in mm');
    expect(pull.proposals.map((x) => [x.boardId, x.how, x.room, x.x, x.y, x.currentLevel, x.newLevel])).toEqual([
      ['MDB-1', 'linked', 'Electrical room', 23, 7, '—', 'Ground floor'],
      ['SMDB-GF', 'attribute', 'Electrical room', 22, 6, '—', 'Ground floor'],
      ['DB-GF1', 'attribute', 'Store room', 22, 1.5, '—', 'Ground floor']
    ]);
    const next = applyBoardPlaces(p, pull.proposals.filter((x) => x.boardId !== 'MDB-1'), floor);
    expect(next.boards.map((b) => [b.id, b.location, b.level, b.planPoint])).toEqual([
      ['MDB-1', undefined, undefined, undefined],
      ['SMDB-GF', 'Electrical room', floor, { x: 22, y: 6 }],
      ['DB-GF1', 'Store room', floor, { x: 22, y: 1.5 }]
    ]);
    // Pulling again with the same level finds nothing more to change for the applied boards.
    expect(pullBoardPlaces(next, plan(), floor)).toMatchObject({ proposals: [], matching: 2 });
  });

  it('keeps the location of a board outside every room, and keeps levels when no level is chosen', () => {
    const p = project();
    const pull = pullBoardPlaces(p, plan({ symbols: [{ name: 'DB-GF1', x: 30000, y: 1 }] }), undefined);
    expect(pull.noRoom).toEqual(['DB-GF1']);
    expect(pull.proposals[0]).toMatchObject({ boardId: 'DB-GF1', room: undefined, x: 30, y: 0 });
    const next = applyBoardPlaces(p, pull.proposals, undefined);
    expect(next.boards[2]).toMatchObject({ location: 'Store room', planPoint: { x: 30, y: 0 } });
    expect(next.boards[2].level).toBeUndefined();
  });
});
