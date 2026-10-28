import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { estimateElv } from './estimate';
import { moveDevice, placeDevices, placedOnLevel, removeDevices, roomAt } from './placed';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

// One office floor: an open office 20 × 10 m with a 4 × 5 m meeting room drawn inside it, and a lobby.
const project = (): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: {
    buildings: [{ id: 'B', name: 'Tower', levels: [{ id: 'L1', name: 'Level 1', kind: 'typical', heightM: 4, count: 3 }] }],
    rooms: [
      { id: 'R1', buildingId: 'B', levelId: 'L1', name: 'Open office', type: 'office', areaM2: 200, outline: box(0, 0, 20, 10) },
      { id: 'R2', buildingId: 'B', levelId: 'L1', name: 'Meeting', type: 'office', areaM2: 20, outline: box(16, 5, 20, 10) },
      { id: 'R3', buildingId: 'B', levelId: 'L1', name: 'Lobby', type: 'lobby', areaM2: 30 } // no outline (entered by hand)
    ]
  }
});

describe('placed ELV devices', () => {
  it('finds the room under a point: the smallest outline around it', () => {
    const p = project();
    expect(roomAt(p, 'B', 'L1', 5, 5)?.id).toBe('R1');
    expect(roomAt(p, 'B', 'L1', 18, 8)?.id).toBe('R2'); // inside both; the meeting room is smaller
    expect(roomAt(p, 'B', 'L1', 30, 5)).toBeUndefined();
  });

  it('places, moves and removes devices; IDs are never given out again', () => {
    let { project: p, ids } = placeDevices(project(), 'B', 'L1', [
      { type: 'smoke-detector', x: 5, y: 5 }, { type: 'smoke-detector', x: 18, y: 8 }, { type: 'camera', x: 1, y: 1, rotationDeg: 45 }
    ]);
    expect(ids).toEqual(['E1', 'E2', 'E3']);
    expect(p.elvDevices!.map((d) => d.roomId)).toEqual(['R1', 'R2', 'R1']);
    expect(p.elvDevices![2].rotationDeg).toBe(45);
    p = moveDevice(p, 'E2', 30, 5);
    expect(p.elvDevices![1]).toEqual({ id: 'E2', type: 'smoke-detector', buildingId: 'B', levelId: 'L1', x: 30, y: 5 }); // outside every room now
    p = removeDevices(p, ['E3']);
    ({ project: p, ids } = placeDevices(p, 'B', 'L1', [{ type: 'sounder', x: 2, y: 2 }]));
    expect(ids).toEqual(['E4']);
    expect(() => removeDevices(p, ['E9'])).toThrow('No ELV device E9');
    expect(() => placeDevices(p, 'B', 'L9', [])).toThrow('No level L9');
  });

  it('counts placed devices instead of the area rules, only for the systems placed on that level', () => {
    const before = estimateElv(project());
    const { project: p } = placeDevices(project(), 'B', 'L1', [
      { type: 'smoke-detector', x: 5, y: 5 }, { type: 'smoke-detector', x: 12, y: 5 }, { type: 'multi-detector', x: 18, y: 8 },
      { type: 'call-point', x: 0.5, y: 0.5 }, { type: 'sounder-beacon', x: 10, y: 9 },
      { type: 'card-reader', x: 16, y: 6 }, { type: 'card-reader', x: 15.8, y: 6 }, { type: 'maglock', x: 16, y: 6.5 },
      { type: 'smoke-detector', x: 30, y: 5 } // outside every outline: counted on the level
    ]);
    const after = estimateElv(p);
    const row = (id: string) => after.rooms.find((r) => r.roomId === id)!;
    expect(row('R1').placed).toEqual(['fire-alarm', 'access-control']);
    expect(row('R1').devices).toMatchObject({ smokeDetector: 2, callPoint: 1, sounderBeacon: 1, cardReader: 1 });
    expect(row('R1').devices.sounder).toBeUndefined(); // the area rule's sounders are replaced
    expect(row('R2').devices).toMatchObject({ multiDetector: 1, cardReader: 1, maglock: 1 });
    expect(row('R2').devices.door).toBeUndefined(); // the area rule's door is replaced
    expect(row('R3').devices.smokeDetector).toBeUndefined(); // lobby: designed level, nothing placed there
    // Systems not placed keep the area rules.
    expect(row('R1').devices.dataPort).toBe(before.rooms.find((r) => r.roomId === 'R1')!.devices.dataPort);
    expect(after.warnings).toContain('Tower, Level 1: 1 placed ELV device outside every room outline, counted on the level.');

    // Fire alarm: (3 smoke + 1 multi + 1 call point + 1 sounder beacon) × 3 floors = 18 loop devices, one loop.
    const fa = after.supplies.find((s) => s.system === 'fire-alarm')!;
    expect(fa.equipment).toBe('Fire alarm control panel, Tower (1 panel, 1 loop, 18 devices)');
    // Alarm: 0.5 A panel + 3 × (4 × 5 + 3 + 25) mA = 0.644 A.
    expect(fa.demandBasis).toMatch(/^alarm 0\.64 A at 24 V/);

    // Access control per floor: 2 readers and a lock → 1 door each in two rooms = 2 doors, 1 controller.
    const acs = after.supplies.find((s) => s.system === 'access-control' && s.floor === 1)!;
    expect(acs.equipment).toBe('Access control door controllers and PSUs, Level 1 (floor 1) (1 controller, 2 doors)');
    expect(acs.demandBasis).toMatch(/^2 × 1\.8 W reader \+ 1 × 6 W lock \+ 1 × 5 W/);
  });

  it('keeps per-level results apart', () => {
    const { project: p } = placeDevices(project(), 'B', 'L1', [{ type: 'camera', x: 5, y: 5 }]);
    const on = placedOnLevel(p, 'B', 'L1');
    expect([...on.systems]).toEqual(['cctv']);
    expect(on.byRoom.get('R1')).toEqual({ camera: 1 });
    expect(placedOnLevel(p, 'B', 'L2').systems.size).toBe(0);
  });
});
