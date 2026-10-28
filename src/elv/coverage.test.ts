import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { levelCoverage, reachM } from './coverage';
import { copyDevices, fillPoints, placeDevices } from './placed';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const L: [number, number][] = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]]; // L-shaped, 256 m²

const project = (): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: {
    buildings: [{ id: 'B', name: 'Tower', levels: [{ id: 'L1', name: 'Level 1', kind: 'typical', heightM: 4 }, { id: 'L2', name: 'Level 2', kind: 'typical', heightM: 4 }] }],
    rooms: [
      { id: 'R1', buildingId: 'B', levelId: 'L1', name: 'Office', type: 'office', areaM2: 100, outline: box(0, 0, 10, 10) },
      { id: 'R2', buildingId: 'B', levelId: 'L1', name: 'WC', type: 'toilet', areaM2: 20, outline: box(10, 0, 14, 5) },
      { id: 'R3', buildingId: 'B', levelId: 'L1', name: 'Hall', type: 'lobby', areaM2: 256, outline: L.map(([x, y]) => [x + 30, y] as [number, number]) },
      { id: 'R4', buildingId: 'B', levelId: 'L1', name: 'Typed', type: 'office', areaM2: 50 }, // no outline
      { id: 'R5', buildingId: 'B', levelId: 'L2', name: 'office', type: 'office', areaM2: 100, outline: box(0, 0, 10, 10) }
    ]
  }
});

describe('ELV coverage over the room outline', () => {
  it('reaches: detector radius, half the speaker spacing diagonal, nothing for devices without area coverage', () => {
    expect(reachM('smoke-detector')).toBe(7.5);
    expect(reachM('heat-detector')).toBe(5.3);
    expect(reachM('ceiling-speaker')).toBeCloseTo(4.24, 2);
    expect(reachM('call-point')).toBe(0);
  });

  it('finds the uncovered part of a room, skips rooms that need none, and says when there is no outline', () => {
    // One smoke detector in a corner of the 10 × 10 m office reaches 7.5 m: the far corner is not covered.
    const { project: p } = placeDevices(project(), 'B', 'L1', [{ type: 'smoke-detector', x: 1, y: 1 }]);
    const c = levelCoverage(p, 'B', 'L1', 'fire-alarm');
    const office = c.find((x) => x.roomId === 'R1')!;
    expect(office.pct).toBeGreaterThan(0.5);
    expect(office.pct).toBeLessThan(0.8);
    expect(office.gaps.every(([x, y]) => Math.hypot(x - 1, y - 1) > 7.5)).toBe(true);
    expect(c.find((x) => x.roomId === 'R2')).toMatchObject({ needed: false, gaps: [] }); // toilets: no detector rule
    expect(c.find((x) => x.roomId === 'R3')!.pct).toBe(0); // the hall has none yet
    expect(c.find((x) => x.roomId === 'R4')).toEqual({ roomId: 'R4', needed: true, gaps: [], step: 0 }); // no outline to check: no pct
    // A detector in the middle covers the whole office (corners at 7.07 m).
    const mid = placeDevices(project(), 'B', 'L1', [{ type: 'smoke-detector', x: 5, y: 5 }]).project;
    expect(levelCoverage(mid, 'B', 'L1', 'fire-alarm').find((x) => x.roomId === 'R1')!.pct).toBe(1);
  });

  it('lets Wi-Fi reach through walls, but not detectors', () => {
    const { project: p } = placeDevices(project(), 'B', 'L1', [{ type: 'access-point', x: 5, y: 5 }, { type: 'smoke-detector', x: 5, y: 5 }]);
    expect(levelCoverage(p, 'B', 'L1', 'ict').find((x) => x.roomId === 'R1')!.pct).toBe(1);
    expect(levelCoverage(p, 'B', 'L1', 'fire-alarm').find((x) => x.roomId === 'R3')!.pct).toBe(0);
    expect(levelCoverage(p, 'B', 'L1', 'cctv')).toEqual([]);
  });

  it('fills a room so that it is fully covered, leaving out points outside an L-shaped outline', () => {
    const office = fillPoints(box(0, 0, 10, 10), 'smoke-detector'); // step 10.6 m: one in the middle
    expect(office).toEqual([{ type: 'smoke-detector', x: 5, y: 5 }]);
    const hall = fillPoints(L, 'smoke-detector'); // 2 × 2 grid over 20 × 20 m, the corner outside the L left out
    expect(hall.map((d) => [d.x, d.y])).toEqual([[5, 5], [5, 15], [15, 5]]);
    const p = placeDevices(project(), 'B', 'L1', fillPoints(L.map(([x, y]) => [x + 30, y] as [number, number]), 'smoke-detector')).project;
    expect(levelCoverage(p, 'B', 'L1', 'fire-alarm').find((x) => x.roomId === 'R3')!.pct).toBe(1);
    expect(fillPoints(box(0, 0, 10, 10), 'call-point')).toEqual([]); // no area coverage: nothing to fill by
  });

  it('copies a level to another at the same positions, into the room of the same name', () => {
    const { project: p } = placeDevices(project(), 'B', 'L1', [{ type: 'smoke-detector', x: 5, y: 5 }, { type: 'camera', x: 2, y: 2, rotationDeg: 90 }, { type: 'smoke-detector', x: 40, y: 2 }]);
    const r = copyDevices(p, { buildingId: 'B', levelId: 'L1' }, { buildingId: 'B', levelId: 'L2' });
    expect(r.ids).toEqual(['E4', 'E5', 'E6']);
    expect(r.sameRoom).toBe(2); // Office → office; the hall has no room on Level 2
    expect(r.project.elvDevices!.find((d) => d.id === 'E5')).toMatchObject({ levelId: 'L2', roomId: 'R5', rotationDeg: 90 });
    expect(copyDevices(p, { buildingId: 'B', levelId: 'L1' }, { buildingId: 'B', levelId: 'L2' }, ['camera']).ids).toHaveLength(1);
  });
});
