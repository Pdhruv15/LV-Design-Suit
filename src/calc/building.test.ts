import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { builtUpAreaOf, dbChecks, newBuilding, roomLoad, roomsFromTable, spaceAreasFromRooms, summarizeBuilding } from './building';
import { riserFromBuilding } from './busbar';
import { emptyPlan } from './spacePlan';
import type { BuildingInfo, Project } from '../types';

const tower = { ...newBuilding('T', 'Tower A'), plotAreaM2: 3000, levels: [
  { id: 'B1', name: 'B1', kind: 'basement' as const, heightM: 3.5, grossM2: 2500 },
  { id: 'B2', name: 'B2', kind: 'basement' as const, heightM: 3.5, grossM2: 2500 },
  { id: 'G', name: 'Ground', kind: 'ground' as const, heightM: 5, grossM2: 1800 },
  { id: 'TYP', name: 'L1–L20', kind: 'typical' as const, heightM: 3.6, grossM2: 1500, count: 20 },
  { id: 'R', name: 'Roof', kind: 'roof' as const, heightM: 3, grossM2: 400 }
] };
// Basements are listed bottom to top: B2 would normally come first — the order given is the order used.
const info: BuildingInfo = {
  buildings: [tower],
  rooms: [
    { id: 'r1', buildingId: 'T', levelId: 'TYP', name: '2BR apartment', type: 'apartment', areaM2: 120, count: 8, boardId: 'SMDB-FF' },
    { id: 'r2', buildingId: 'T', levelId: 'TYP', name: 'Corridor', type: 'lobby', areaM2: 150 },
    { id: 'r3', buildingId: 'T', levelId: 'G', name: 'Lobby', type: 'lobby', areaM2: 400, boardId: 'SMDB-GF' },
    { id: 'r4', buildingId: 'T', levelId: 'B1', name: 'Parking', type: 'parking', areaM2: 2300 }
  ]
};

describe('building information', () => {
  it('floors, GFA, description and elevations with typical floors repeated', () => {
    const s = summarizeBuilding(info, tower);
    expect(s.floors).toBe(24);
    expect(s.basements).toBe(2);
    expect(s.description).toBe('2B + G + 20 + R');
    expect(s.gfaM2).toBe(2500 * 2 + 1800 + 1500 * 20 + 400);
    expect(s.levels.find((l) => l.level.id === 'G')!.elevationM).toBe(0);
    expect(s.levels.find((l) => l.level.id === 'TYP')!.elevationM).toBe(5);
    expect(s.levels.find((l) => l.level.id === 'B2')!.elevationM).toBe(-3.5);
    expect(s.heightM).toBeCloseTo(5 + 72 + 3);
    expect(summarizeBuilding(info, { ...tower, gfaM2: 40000 }).gfaM2).toBe(40000);
  });

  it('room loads: area × W/m² × identical rooms × identical floors', () => {
    const r = roomLoad(info, info.rooms[0]);
    expect(r.total).toBe(160);
    expect(r.areaM2).toBe(120 * 160);
    expect(r.connectedKw).toBeCloseTo((120 * 160 * 80) / 1000);
    expect(r.demandKw).toBeCloseTo(r.connectedKw * 0.7);
  });

  it('feeds the DEWA built-up area, space planning and the busbar riser', () => {
    const p: Project = { ...sampleProject, info: { ...sampleProject.info, builtUpAreaM2: undefined }, building: info };
    expect(builtUpAreaOf(p)).toBe(summarizeBuilding(info, tower).gfaM2);
    expect(builtUpAreaOf({ ...p, info: { builtUpAreaM2: 999 } })).toBe(999);
    const plan = spaceAreasFromRooms(info, emptyPlan());
    expect(plan.areas).toHaveLength(4);
    expect(plan.areas[0]).toMatchObject({ building: 'Tower A', floor: 'L1–L20 (×20)', use: 'apartment', areaM2: 19200 });
    expect(plan.uses!.some((u) => u.id === 'lobby')).toBe(true);
    const f = riserFromBuilding(p, 'T')!;
    expect(f.floors.map((x) => x.id)).toEqual(['B1', 'G', 'TYP']);
    expect(f.floors[2].count).toBe(20);
    expect(f.floorHeightM).toBe(3.6);
    expect(f.offsetFloors).toBe(0);
  });

  it('each DB against the rooms it serves', () => {
    const p: Project = { ...sampleProject, building: info };
    const c = dbChecks(p);
    expect(c.map((x) => x.boardId).sort()).toEqual(['SMDB-FF', 'SMDB-GF']);
    const gf = c.find((x) => x.boardId === 'SMDB-GF')!;
    expect(gf.areaM2).toBe(400);
    expect(gf.status).toBe('warn'); // a 400 m² lobby doesn't need the SMDB's 200 kW
  });

  it('pastes an area schedule from Excel, adding levels and types', () => {
    const text = 'Level\tRoom\tType\tArea\tCount\tDB\nL1–L20\tStudio\tApartment\t45\t4\tDB-TYP\nMezzanine\tGym\tGym\t300\t\t\nRoof\tWater tank\tTank room\t80\t\t';
    const r = roomsFromTable(info, 'T', text);
    expect(r.added).toBe(3);
    expect(r.newLevels).toEqual(['Mezzanine']);
    expect(r.newTypes).toEqual(['Tank room']);
    const studio = r.info.rooms.find((x) => x.name === 'Studio')!;
    expect([studio.levelId, studio.type, studio.count, studio.boardId]).toEqual(['TYP', 'apartment', 4, 'DB-TYP']);
    expect(r.info.rooms.find((x) => x.name === 'Gym')!.type).toBe('gym');
  });
});

describe('level order', () => {
  it('a pasted basement goes to the bottom and sits below ground', () => {
    const b = newBuilding('X');
    const r = roomsFromTable({ buildings: [b], rooms: [] }, 'X', 'Basement 1\tParking\tCar park\t2000');
    const nb = r.info.buildings[0];
    expect(nb.levels[0].name).toBe('Basement 1');
    const s = summarizeBuilding(r.info, nb);
    expect(s.levels[0].elevationM).toBeLessThan(0);
  });
});
