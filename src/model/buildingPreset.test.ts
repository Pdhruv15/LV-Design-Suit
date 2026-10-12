import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildingInfo, UnitType } from '../types';
import { DEFAULT_ROOM_TYPES, newBuilding, roomTypesOf } from '../calc/building';
import {
  BUILDING_PRESETS_KEY, bundleFrom, bundleLines, dbLinksOf, exportBuildingPresets, importBuildingPresets, libraryWith, loadBuildingPresets, mergeBundle,
  missingRoomTypes, presetFromBuilding, presetNameIssue, saveBuildingPresets, unitTypeRows, withLibraryUnits
} from './buildingPreset';

const twoBr: UnitType = { id: 'U1', name: '2BR apartment', meter: '1-PH', rooms: [{ name: 'Living', type: 'living', areaM2: 35 }, { name: 'Bed 1', type: 'bedroom', areaM2: 16 }] };
const office: UnitType = { id: 'U2', name: 'Office suite', rooms: [{ name: 'Open', type: 'office', areaM2: 120 }] };

/** A tower: G + 10 typical (4 × 2BR per floor) + R, with a lobby and a car park room, plot/GFA typed, riser fed from MDB-1. */
function source(): BuildingInfo {
  const b = newBuilding('BLD1', 'Tower A');
  b.plotAreaM2 = 2000; b.gfaM2 = 15000;
  b.riser = { fromBoardId: 'MDB-1', horizontalM: 20, perDbM: 8 };
  b.levels[1].units = [{ unitTypeId: 'U1', count: 4 }];
  const other = newBuilding('BLD2', 'Podium');
  return {
    buildings: [b, other],
    rooms: [
      { id: 'R1', buildingId: 'BLD1', levelId: 'BLD1-G', name: 'Lobby', type: 'lobby', areaM2: 300, boardId: 'SMDB-GF' },
      { id: 'R2', buildingId: 'BLD1', levelId: 'BLD1-G', name: 'Car park', type: 'parking', areaM2: 900 },
      { id: 'R3', buildingId: 'BLD2', levelId: 'BLD2-G', name: 'Shop', type: 'retail', areaM2: 200 }
    ],
    unitTypes: [twoBr, office],
    roomTypes: DEFAULT_ROOM_TYPES.map((t) => (t.id === 'lobby' ? { ...t, wPerM2: 55 } : t))
  };
}

describe('bundleFrom', () => {
  it('takes the building, its rooms, the layouts on its levels and the room types used — without DB links or the riser board', () => {
    const x = bundleFrom(source(), ['BLD1'], { rooms: true, areas: false });
    expect(x.buildings.map((b) => b.name)).toEqual(['Tower A']);
    expect(x.rooms.map((r) => r.name)).toEqual(['Lobby', 'Car park']);
    expect(x.rooms.every((r) => r.boardId === undefined)).toBe(true);
    expect(x.unitTypes.map((u) => u.name)).toEqual(['2BR apartment']);
    expect(x.roomTypes.map((t) => t.id).sort()).toEqual(['bedroom', 'living', 'lobby', 'parking']);
    expect(x.roomTypes.find((t) => t.id === 'lobby')?.wPerM2).toBe(55);
    expect(x.buildings[0].riser).toEqual({ horizontalM: 20, perDbM: 8 });
    expect(x.buildings[0].plotAreaM2).toBeUndefined();
    expect(x.buildings[0].gfaM2).toBeUndefined();
    expect(dbLinksOf(source(), ['BLD1'])).toBe(1);
  });
  it('keeps the areas when asked, and leaves rooms out when asked', () => {
    const x = bundleFrom(source(), ['BLD1'], { rooms: false, areas: true });
    expect(x.rooms).toEqual([]);
    expect(x.buildings[0].gfaM2).toBe(15000);
    expect(x.roomTypes.map((t) => t.id).sort()).toEqual(['bedroom', 'living']); // still the flats' types
  });
  it('does not change the project it was taken from', () => {
    const s = source();
    const before = JSON.stringify(s);
    const x = bundleFrom(s, ['BLD1']);
    x.buildings[0].levels[0].name = 'changed';
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('mergeBundle', () => {
  it('adds the building with new ids and remapped levels, rooms and flats', () => {
    const target: BuildingInfo = { buildings: [newBuilding('BLD1', 'Villa')], rooms: [{ id: 'R1', buildingId: 'BLD1', levelId: 'BLD1-G', name: 'Majlis', type: 'living', areaM2: 40 }] };
    const r = mergeBundle(target, bundleFrom(source(), ['BLD1']));
    expect(r.buildingIds).toEqual(['BLD2']);
    expect(r.buildingNames).toEqual(['Tower A']);
    const b = r.info.buildings[1];
    expect(b.levels.map((l) => l.id)).toEqual(['BLD2-L1', 'BLD2-L2', 'BLD2-L3']);
    expect(r.rooms).toBe(2);
    const added = r.info.rooms.filter((x) => x.buildingId === 'BLD2');
    expect(added.map((x) => x.levelId)).toEqual(['BLD2-L1', 'BLD2-L1']);
    expect(new Set(r.info.rooms.map((x) => x.id)).size).toBe(r.info.rooms.length);
    const unitId = b.levels[1].units?.[0].unitTypeId;
    expect(r.info.unitTypes?.find((u) => u.id === unitId)?.name).toBe('2BR apartment');
    expect(r.unitTypesAdded).toEqual(['2BR apartment']);
  });
  it('reuses a layout the project already has and renames a building whose name is taken', () => {
    const target: BuildingInfo = { buildings: [newBuilding('BLD1', 'Tower A')], rooms: [], unitTypes: [{ ...twoBr, id: 'U7' }] };
    const r = mergeBundle(target, bundleFrom(source(), ['BLD1']));
    expect(r.unitTypesReused).toEqual(['2BR apartment']);
    expect(r.info.unitTypes).toHaveLength(1);
    expect(r.info.buildings[1].levels[1].units?.[0].unitTypeId).toBe('U7');
    expect(r.buildingNames).toEqual(['Tower A (copy)']);
  });
  it('adds a same-named layout with other rooms as a copy', () => {
    const target: BuildingInfo = { buildings: [], rooms: [], unitTypes: [{ ...twoBr, id: 'U1', rooms: [{ name: 'Studio', type: 'living', areaM2: 30 }] }] };
    const r = mergeBundle(target, bundleFrom(source(), ['BLD1']));
    expect(r.unitTypesAdded).toEqual(['2BR apartment (copy)']);
    expect(r.info.buildings[0].levels[1].units?.[0].unitTypeId).toBe('U2');
  });
  it("keeps this project's room type figures and reports the difference, or replaces them", () => {
    const target: BuildingInfo = { buildings: [], rooms: [] }; // placeholders: lobby 40 W/m²
    const keep = mergeBundle(target, bundleFrom(source(), ['BLD1']));
    expect(keep.roomTypesDiffer).toEqual([{ id: 'lobby', label: 'Lobby / corridor', diff: '40 → 55 W/m²' }]);
    expect(keep.info.roomTypes).toBeUndefined(); // nothing added, nothing replaced
    const replace = mergeBundle(target, bundleFrom(source(), ['BLD1']), { roomTypes: 'replace' });
    expect(roomTypesOf(replace.info).find((t) => t.id === 'lobby')?.wPerM2).toBe(55);
  });
  it('adds room types the project does not have', () => {
    const src = source();
    src.roomTypes = [...src.roomTypes!, { id: 'cinema', label: 'Cinema', wPerM2: 60, demandFactor: 0.9 }];
    src.rooms.push({ id: 'R9', buildingId: 'BLD1', levelId: 'BLD1-R', name: 'Cinema', type: 'cinema', areaM2: 80 });
    const r = mergeBundle({ buildings: [], rooms: [] }, bundleFrom(src, ['BLD1']));
    expect(r.roomTypesAdded).toEqual(['Cinema']);
    expect(roomTypesOf(r.info).some((t) => t.id === 'cinema')).toBe(true);
    expect(roomTypesOf(r.info)).toHaveLength(DEFAULT_ROOM_TYPES.length + 1);
  });
  it('copies several buildings at once', () => {
    const r = mergeBundle({ buildings: [], rooms: [] }, bundleFrom(source(), ['BLD1', 'BLD2']));
    expect(r.buildingNames).toEqual(['Tower A', 'Podium']);
    expect(r.rooms).toBe(3);
    expect(r.info.rooms.find((x) => x.name === 'Shop')?.buildingId).toBe(r.buildingIds[1]);
  });
});

describe('bundleLines', () => {
  it('describes each building: floors, rooms and flats', () => {
    expect(bundleLines(bundleFrom(source(), ['BLD1']))).toEqual([{ id: 'BLD1', name: 'Tower A', description: 'G + 10 + R', rooms: 2, flats: 40 }]);
  });
});

describe('building presets library', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('saves and loads presets, checking names', () => {
    const p = presetFromBuilding(source(), 'BLD1', ' Typical tower ', { rooms: true, areas: false, note: 'G+10' });
    expect(p.name).toBe('Typical tower');
    expect(p.note).toBe('G+10');
    expect(saveBuildingPresets([p])).toBe(true);
    expect(loadBuildingPresets()[0].bundle.buildings[0].name).toBe('Tower A');
    expect(presetNameIssue('typical TOWER', [p])).toMatch(/already/);
    expect(presetNameIssue('typical tower', [p], p.id)).toBeUndefined();
    expect(presetNameIssue(' ', [])).toMatch(/name/);
  });
  it('ignores a damaged library', () => {
    localStorage.setItem(BUILDING_PRESETS_KEY, '{oops');
    expect(loadBuildingPresets()).toEqual([]);
    localStorage.setItem(BUILDING_PRESETS_KEY, JSON.stringify([{ name: 'x' }, { name: 'y', bundle: { buildings: 'no' } }]));
    expect(loadBuildingPresets()).toEqual([]);
  });
  it('exports and imports, renaming a preset whose name is taken', () => {
    const p = presetFromBuilding(source(), 'BLD1', 'Tower', { rooms: true, areas: false });
    const r = importBuildingPresets(exportBuildingPresets([p]), [p]);
    expect(r.added).toHaveLength(1);
    expect(r.added[0].name).toBe('Tower (imported)');
    expect(r.added[0].id).not.toBe(p.id);
    expect(importBuildingPresets('nope', []).error).toMatch(/JSON/);
    expect(importBuildingPresets('{"presets":[]}', []).error).toMatch(/No building presets/);
  });
});

describe('flat layout library', () => {
  it('writes layouts in by name: new ones added, changed ones updated, same ones left', () => {
    const lib: UnitType[] = [{ id: 'lib-2br-apartment', name: '2BR Apartment', rooms: [{ name: 'Living', type: 'living', areaM2: 30 }] }, { id: 'lib-studio', name: 'Studio', rooms: [{ name: 'Room', type: 'living', areaM2: 28 }] }];
    const r = libraryWith(lib, [twoBr, office, { ...lib[1], id: 'U9' }]);
    expect(r.added).toEqual(['Office suite']);
    expect(r.updated).toEqual(['2BR apartment']);
    expect(r.same).toEqual(['Studio']);
    expect(r.list).toHaveLength(3);
    expect(r.list[0].id).toBe('lib-2br-apartment');
    expect(r.list[0].rooms).toHaveLength(2);
  });
  it('makes one UnitTypes.xlsx row per room, the meter on the first', () => {
    expect(unitTypeRows([twoBr])).toEqual([
      { unitType: '2BR apartment', room: 'Living', roomType: 'living', areaM2: 35, meter: '1-PH' },
      { unitType: '2BR apartment', room: 'Bed 1', roomType: 'bedroom', areaM2: 16, meter: '' }
    ]);
  });
  it('adds library layouts to a project, updating a same-named one in place', () => {
    const project: UnitType[] = [{ id: 'U1', name: '2br apartment', rooms: [{ name: 'Old', type: 'living', areaM2: 10 }] }];
    const r = withLibraryUnits(project, [{ ...twoBr, id: 'lib-2br' }, { ...office, id: 'lib-office' }]);
    expect(r.updated).toEqual(['2BR apartment']);
    expect(r.added).toEqual(['Office suite']);
    expect(r.list.map((u) => u.id)).toEqual(['U1', 'U2']);
    expect(r.list[0].rooms).toHaveLength(2);
    expect(r.list[0].meter).toBe('1-PH');
  });
  it('lists the room types a layout needs that the project lacks', () => {
    expect(missingRoomTypes({ buildings: [], rooms: [] }, [{ id: 'x', name: 'Clinic', rooms: [{ name: 'Exam', type: 'clinic', areaM2: 12 }, { name: 'WC', type: 'bathroom', areaM2: 4 }] }])).toEqual(['clinic']);
  });
});
