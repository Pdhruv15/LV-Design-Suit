import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { newBuilding } from './building';
import { addServices, applyRiserLengths, defaultServices, floorLoads, floorsOf, generateBuildingDbs, plannedDbs, roomDensities, unitLoads } from './buildingDesign';
import { scheduleCircuits } from './loadSchedule';
import type { Project } from '../types';

const b = { ...newBuilding('T1', 'Tower'), riser: { horizontalM: 20, perDbM: 10 } };
b.levels = [
  { id: 'B1', name: 'Basement', kind: 'basement', heightM: 3.5 },
  { id: 'G', name: 'Ground', kind: 'ground', heightM: 4.5 },
  { id: 'T', name: 'Typical', kind: 'typical', heightM: 3.5, count: 3, units: [{ unitTypeId: '2br', count: 2 }] },
  { id: 'R', name: 'Roof', kind: 'roof', heightM: 3 }
];
const p: Project = {
  ...sampleProject,
  building: {
    buildings: [b],
    rooms: [
      { id: 'R1', buildingId: 'T1', levelId: 'G', name: 'Lobby', type: 'lobby', areaM2: 200 },
      { id: 'R2', buildingId: 'T1', levelId: 'B1', name: 'Car park', type: 'parking', areaM2: 1200 },
      { id: 'R3', buildingId: 'T1', levelId: 'T', name: 'Corridor', type: 'lobby', areaM2: 60 }
    ],
    unitTypes: [{ id: '2br', name: '2BR', rooms: [{ name: 'Living', type: 'apartment', areaM2: 40 }, { name: 'Bedroom 1', type: 'apartment', areaM2: 16 }, { name: 'Kitchen', type: 'apartment', areaM2: 10 }] }]
  }
};

describe('building → design', () => {
  it('lists every floor with tags', () => {
    expect(floorsOf(p.building!, b).map((f) => f.tag)).toEqual(['B1', 'G', 'L01', 'L02', 'L03', 'R']);
  });
  it('plans a common DB per floor with rooms and a DB per flat', () => {
    const ids = plannedDbs(p, 'T1').map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['DB-B1', 'DB-G', 'DB-L01', 'DB-L01-01', 'DB-L01-02', 'DB-L03-02']));
    expect(ids.filter((x) => x.includes('-L0') && x.split('-').length === 3).length).toBe(6);
  });
  it('generates DBs with circuits, incomers from the riser, meters for flats', () => {
    const r = generateBuildingDbs(p, 'T1', 'MDB-1');
    expect(r.dbs.length).toBe(plannedDbs(p, 'T1').length);
    const flat = scheduleCircuits(r.project, 'DB-L02-01');
    expect(flat.length).toBeGreaterThan(4);
    expect(flat.every((f) => f.fromRoom)).toBe(true);
    const inc = r.project.feeders.find((f) => f.feedsBoardId === 'DB-L02-01')!;
    expect(inc.boardId).toBe('MDB-1');
    expect(inc.kwhMeter).toBeTruthy();
    expect(inc.lengthM).toBe(Math.round(20 + (4.5 + 3.5) + 10));
    // Regenerating replaces its own circuits, not duplicates them.
    const again = generateBuildingDbs(r.project, 'T1', 'MDB-1');
    expect(scheduleCircuits(again.project, 'DB-L02-01').length).toBe(flat.length);
    expect(again.replaced).toBeGreaterThan(0);
  });
  it('applies riser lengths after the route changes', () => {
    const r = generateBuildingDbs(p, 'T1', 'MDB-1').project;
    const moved = { ...r, building: { ...r.building!, buildings: [{ ...b, riser: { horizontalM: 50, perDbM: 10 } }] } };
    expect(applyRiserLengths(moved, 'T1').changed).toBeGreaterThan(0);
  });
  it('checks load density and totals floors and units', () => {
    const r = generateBuildingDbs(p, 'T1', 'MDB-1').project;
    const dens = roomDensities(r, 'T1');
    expect(dens.length).toBeGreaterThan(0);
    expect(dens.every((d) => d.lpd >= 0 && d.wPerM2 > 0)).toBe(true);
    const fl = floorLoads(r, 'T1');
    expect(fl.find((f) => f.floor.tag === 'L02')!.connectedKw).toBeGreaterThan(0);
    expect(unitLoads(r, 'T1').length).toBe(6);
  });
  it('adds common services, standby units marked', () => {
    const items = defaultServices(p, 'T1');
    const r = addServices(p, 'MDB-1', items.filter((x) => x.id === 'booster'));
    const added = r.project.feeders.filter((f) => f.id.startsWith('MDB-1-BOOSTER'));
    expect(added.length).toBe(2);
    expect(added.filter((f) => f.standbyUnit).length).toBe(1);
  });
});

describe('building summary sheet', async () => {
  const { buildingSheet, buildingSummaryHtml, buildingSummaryWorkbook } = await import('../docs/buildingSummary');
  it('totals floors, flats and meters', () => {
    const r = generateBuildingDbs(p, 'T1', 'MDB-1').project;
    const s = buildingSheet(r, 'T1')!;
    expect(s.rows.length).toBe(6);
    expect(s.tclKw).toBeCloseTo(s.rows.reduce((a, x) => a + x.connectedKw, 0), 6);
    expect(s.units[0].count).toBe(6);
    expect(Object.values(s.meters).reduce((a, n) => a + n, 0)).toBe(6);
    expect(buildingSummaryHtml(r, ['T1'])).toContain('building load summary');
    expect(buildingSummaryWorkbook(r, ['T1']).worksheets.length).toBe(1);
  });
});
