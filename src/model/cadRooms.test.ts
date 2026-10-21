import { describe, expect, it } from 'vitest';
import { applyRooms, guessRole, guessRoomType, layerMapFor, outlineArea, proposeRooms, roomsFromPlan } from './cadRooms';
import { DEFAULT_ROOM_TYPES } from '../calc/building';
import type { CadPlan } from './cadPlaces';
import type { CadLayerMap, Project } from '../types';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const stats = (name: string, extra: Partial<{ outlines: number; curves: number; texts: number; blocks: number; hatches: number }> = {}) =>
  ({ name, outlines: 0, curves: 0, texts: 0, blocks: 0, hatches: 0, ...extra });
const map: CadLayerMap[] = [{ layer: 'A-AREA', role: 'room' }, { layer: 'A-AREA-IDEN', role: 'room-name' }, { layer: 'A-WALL', role: 'wall' }];

function plan(extra: Partial<CadPlan> = {}): CadPlan {
  return {
    units: 4, places: [], symbols: [],
    outlines: [
      { layer: 'A-AREA', points: box(0, 0, 4000, 5000) }, // 20 m²
      { layer: 'A-AREA', points: box(0, 0, 4000, 5000) }, // the same room drawn again (hatch)
      { layer: 'A-AREA', points: box(4000, 0, 10000, 5000) }, // 30 m²
      { layer: 'A-AREA', points: box(-100, -100, 10100, 5100) }, // a zone around both rooms
      { layer: 'A-AREA', points: box(20000, 0, 23000, 2000) }, // 6 m², no name
      { layer: 'A-WALL', points: box(0, 0, 50000, 50000) }
    ],
    texts: [
      { layer: 'A-AREA-IDEN', x: 2000, y: 2500, text: 'MASTER BEDROOM' },
      { layer: 'A-AREA-IDEN', x: 2000, y: 2000, text: '20.00 m²' }, // an area label, not a name
      { layer: 'NOTES', x: 7000, y: 2500, text: 'Note' }
    ],
    tags: [{ layer: 'A-AREA-IDEN', x: 7000, y: 3000, name: 'Kitchen', number: 'G.03' }],
    ...extra
  };
}

describe('layer mapping', () => {
  it('guesses roles from AIA-style and common layer names', () => {
    expect(guessRole(stats('A-AREA', { outlines: 3 }))).toBe('room');
    expect(guessRole(stats('A-AREA-IDEN', { texts: 3 }))).toBe('room-name');
    expect(guessRole(stats('ROOM NAMES', { texts: 3 }))).toBe('room-name');
    expect(guessRole(stats('RM-NAMES', { texts: 3 }))).toBe('room-name'); // RM = room
    expect(guessRole(stats('A-RM-TAG', { blocks: 3 }))).toBe('room-name');
    expect(guessRole(stats('RM-OUTLINE', { outlines: 3 }))).toBe('room');
    expect(guessRole(stats('FIRM-LOGO', { outlines: 3 }))).toBe('ignore'); // "RM" inside a word is not a room
    expect(guessRole(stats('A-WALL'))).toBe('wall');
    expect(guessRole(stats('E-TRAY'))).toBe('tray');
    expect(guessRole(stats('E-CABLE'))).toBe('route');
    expect(guessRole(stats('E-LIGHT'))).toBe('fixture');
    expect(guessRole(stats('E-BOARD'))).toBe('board');
    expect(guessRole(stats('A-AREA'))).toBe('ignore'); // named like rooms but holds no outline
    expect(guessRole(stats('DEFPOINTS'))).toBe('ignore');
  });

  it('keeps the project’s saved roles over a guess', () => {
    const p = { cadLayers: [{ layer: 'a-wall', role: 'room' }] } as unknown as Project;
    expect(layerMapFor(p, [stats('A-WALL'), stats('E-TRAY')])).toEqual([{ layer: 'A-WALL', role: 'room' }, { layer: 'E-TRAY', role: 'tray' }]);
  });
});

describe('room areas from the CAD floor plan', () => {
  it('measures outlines, arc segments included', () => {
    expect(outlineArea(box(0, 0, 4, 5))).toBe(20);
    // A 2 × 1 rectangle whose top edge bulges out into a half circle of radius 1: 2 + π/2.
    const pts: [number, number][] = [[0, 0], [2, 0], [2, 1], [0, 1]];
    expect(outlineArea(pts, [0, 0, 1, 0])).toBeCloseTo(2 + Math.PI / 2, 6);
    // Drawn the other way round: the top edge is now the first segment, and its bulge changes sign.
    expect(outlineArea([...pts].reverse(), [-1, 0, 0, 0])).toBeCloseTo(2 + Math.PI / 2, 6);
    // Bulging inward instead takes the half circle away.
    expect(outlineArea(pts, [0, 0, -1, 0])).toBeCloseTo(2 - Math.PI / 2, 6);
  });

  it('reads rooms with names from tags and name texts, skipping zones, twins and other layers', () => {
    const { rooms, zones, units } = roomsFromPlan(plan(), map);
    expect(units).toBe('drawing in mm');
    expect(zones).toBe(1);
    expect(rooms).toEqual([
      { name: 'Kitchen', number: 'G.03', areaM2: 30, layer: 'A-AREA', named: true },
      { name: 'Master bedroom', areaM2: 20, layer: 'A-AREA', named: true },
      { name: 'Room 1', areaM2: 6, layer: 'A-AREA', named: false }
    ]);
  });

  it('guesses room types from names, and remembers the engineer’s choice', () => {
    expect(guessRoomType('Master bedroom', DEFAULT_ROOM_TYPES, undefined)).toBe('bedroom');
    expect(guessRoomType('Guest WC', DEFAULT_ROOM_TYPES, undefined)).toBe('bathroom');
    expect(guessRoomType('Electrical room', DEFAULT_ROOM_TYPES, undefined)).toBe('plant');
    expect(guessRoomType('Majlis', DEFAULT_ROOM_TYPES, undefined)).toBe('living');
    expect(guessRoomType('Majlis', DEFAULT_ROOM_TYPES, [{ name: 'majlis', type: 'office' }])).toBe('office');
    expect(guessRoomType('Atrium', DEFAULT_ROOM_TYPES, undefined)).toBeUndefined();
  });

  it('updates rooms of the same name on the level, adds the rest, and lists rooms not on the plan', () => {
    const p: Project = {
      name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
      building: {
        buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }],
        rooms: [
          { id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Kitchen', type: 'kitchen', areaM2: 25 },
          { id: 'R2', buildingId: 'V', levelId: 'GF', name: 'Master bedroom', type: 'bedroom', areaM2: 20 },
          { id: 'R3', buildingId: 'V', levelId: 'GF', name: 'Garage', type: 'parking', areaM2: 40 }
        ]
      }
    };
    const { rooms } = roomsFromPlan(plan(), map);
    const { proposals, notOnPlan } = proposeRooms(p, rooms, 'V', 'GF');
    expect(proposals.map((x) => [x.name, x.status, x.currentAreaM2, x.areaM2, x.type])).toEqual([
      ['Kitchen', 'changed', 25, 30, 'kitchen'], ['Master bedroom', 'same', 20, 20, 'bedroom'], ['Room 1', 'new', undefined, 6, undefined]
    ]);
    expect(notOnPlan.map((r) => r.name)).toEqual(['Garage']);
    const accepted = proposals.filter((x) => x.status !== 'same').map((x) => (x.name === 'Room 1' ? { ...x, name: 'Store', type: 'store' } : x));
    const next = applyRooms(p, accepted, 'V', 'GF', map);
    expect(next.building!.rooms.map((r) => [r.id, r.name, r.type, r.areaM2])).toEqual([
      ['R1', 'Kitchen', 'kitchen', 30], ['R2', 'Master bedroom', 'bedroom', 20], ['R3', 'Garage', 'parking', 40], ['R4', 'Store', 'store', 6]
    ]);
    expect(next.cadLayers).toEqual(map);
    expect(next.cadRoomTypes).toEqual([{ name: 'Kitchen', type: 'kitchen' }, { name: 'Store', type: 'store' }]);
  });
});
