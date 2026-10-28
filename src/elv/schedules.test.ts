import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { elvSettings } from './estimate';
import { placeDevices, type NewElvDevice } from './placed';
import { elvSchedules, routeOrder } from './schedules';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

// Ground floor 60 × 50 m in two rooms (1,500 + 1,500 m²), and a typical floor used twice.
const base = (): Project => ({
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: {
    buildings: [{ id: 'B', name: 'Tower', levels: [
      { id: 'GF', name: 'Ground', kind: 'ground', heightM: 4.5 },
      { id: 'L1', name: 'Typical', kind: 'typical', heightM: 3.5, count: 2 }
    ] }],
    rooms: [
      { id: 'R1', buildingId: 'B', levelId: 'GF', name: 'Hall A', type: 'retail', areaM2: 1500, outline: box(0, 0, 30, 50) },
      { id: 'R2', buildingId: 'B', levelId: 'GF', name: 'Hall B', type: 'retail', areaM2: 1500, outline: box(30, 0, 60, 50) },
      { id: 'R3', buildingId: 'B', levelId: 'L1', name: 'Office', type: 'office', areaM2: 400, outline: box(0, 0, 20, 20) }
    ]
  }
});
const grid = (type: NewElvDevice['type'], x0: number, y0: number, nx: number, ny: number, step: number): NewElvDevice[] =>
  Array.from({ length: nx * ny }, (_, i) => ({ type, x: x0 + (i % nx) * step, y: y0 + Math.floor(i / nx) * step }));
const place = (p: Project, level: string, items: NewElvDevice[]) => placeDevices(p, 'B', level, items).project;

describe('ELV schedules', () => {
  it('walks a floor in route order from the corner nearest the origin', () => {
    expect(routeOrder([{ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 1, y: 0 }]).map((d) => d.x)).toEqual([0, 1, 10, 20]);
  });

  it('makes detection zones of one floor and at most 2,000 m², and fills loops to 80 % of 125 devices', () => {
    // Ground: 60 smoke detectors in each hall (120); typical floor: 30 detectors, used twice → 180 loop devices.
    let p = place(base(), 'GF', [...grid('smoke-detector', 2, 2, 6, 10, 4.5), ...grid('smoke-detector', 32, 2, 6, 10, 4.5)]);
    p = place(p, 'L1', grid('smoke-detector', 1, 1, 6, 5, 3.5));
    const b = elvSchedules(p).buildings[0];
    // Halls of 1,500 m² cannot share a 2,000 m² zone; each typical floor is a zone of its own.
    expect(b.zones.map((z) => [z.id, z.levelId, z.floor, z.rooms, z.areaM2])).toEqual([
      ['Z1', 'GF', undefined, ['R1'], 1500], ['Z2', 'GF', undefined, ['R2'], 1500], ['Z3', 'L1', 1, ['R3'], 400], ['Z4', 'L1', 2, ['R3'], 400]
    ]);
    // 180 devices, 100 per loop (125 less 20 % spare) → 2 loops on panel 1.
    expect(b.loops.map((l) => [l.id, l.devices.length, l.isolators])).toEqual([['P1-L1', 100, 4], ['P1-L2', 80, 3]]);
    expect(b.loops[0].devices.map((d) => d.address).slice(0, 3)).toEqual([1, 2, 3]);
    expect(b.loops[0].alarmMa).toBe(53.5); // 100 × 0.3 mA quiescent + 5 detectors in alarm × 4.7 mA rise
    expect(b.loops[1].devices.filter((d) => d.levelId === 'L1').map((d) => d.zone)).toEqual([...Array(30).fill('Z3'), ...Array(30).fill('Z4')]);
  });

  it('keeps each floor whole on one loop: a floor that does not fit starts a new loop', () => {
    // Typical level × 2 and a second typical level × 2, 30 detectors per floor: 30 + 30 + 30 fit 100, the 4th starts a loop.
    const twoLevels: Project = { ...base(), building: { ...base().building!, buildings: [{ ...base().building!.buildings[0], levels: [
      { id: 'L1', name: 'Typical', kind: 'typical', heightM: 3.5, count: 2 }, { id: 'L2', name: 'Typical 2', kind: 'typical', heightM: 3.5, count: 2 }] }],
      rooms: [{ id: 'R3', buildingId: 'B', levelId: 'L1', name: 'Office', type: 'office', areaM2: 400, outline: box(0, 0, 20, 20) }, { id: 'R4', buildingId: 'B', levelId: 'L2', name: 'Office', type: 'office', areaM2: 400, outline: box(0, 0, 20, 20) }] } };
    let p = place(twoLevels, 'L1', grid('smoke-detector', 1, 1, 6, 5, 3.5));
    p = place(p, 'L2', grid('smoke-detector', 1, 1, 6, 5, 3.5));
    const s = elvSchedules(p);
    expect(s.buildings[0].loops.map((l) => l.devices.length)).toEqual([90, 30]);
    expect(new Set(s.buildings[0].loops[1].devices.map((d) => `${d.levelId}/${d.floor}`))).toEqual(new Set(['L2/2']));
    expect(s.warnings).toEqual([]);
  });

  it('splits only a floor larger than a loop, and says so', () => {
    const s = elvSchedules(place(base(), 'GF', [...grid('smoke-detector', 2, 2, 6, 10, 4.5), ...grid('smoke-detector', 32, 2, 6, 10, 4.5)])); // 120 on one floor
    expect(s.buildings[0].loops.map((l) => l.devices.length)).toEqual([100, 20]);
    expect(s.warnings).toContain('Tower, Ground: 120 fire alarm devices are more than one loop takes, so the floor is split over loops.');
  });

  it('starts a new loop when the alarm current passes the limit, and warns of a room too big for one zone', () => {
    const p = place(base(), 'GF', grid('sounder-beacon', 2, 2, 5, 4, 5)); // 20 × 25 mA = 500 mA in alarm
    const b = elvSchedules(p).buildings[0];
    expect(b.loops.map((l) => [l.devices.length, l.alarmMa])).toEqual([[16, 400], [4, 100]]); // 400 mA usable
    const big = { ...base(), building: { ...base().building!, rooms: [{ ...base().building!.rooms[0], areaM2: 2500 }] } };
    expect(elvSchedules(place(big, 'GF', [{ type: 'smoke-detector', x: 5, y: 5 }])).warnings)
      .toEqual(['Tower, Ground: Hall A (2500 m²) is larger than a 2000 m² detection zone: split it into zones.']);
  });

  it('puts cameras and access points on switch ports within the port count and PoE budget, per floor', () => {
    // 25 cameras on the ground floor: 20 ports per switch → 20 + 5.
    let p = place(base(), 'GF', grid('camera', 2, 2, 5, 5, 6));
    // 10 access points per typical floor at 25.5 W: 740 W budget, 40 ports → one switch per floor.
    p = place(p, 'L1', grid('access-point', 2, 2, 5, 2, 4));
    const sw = elvSchedules(p).buildings[0].switches;
    expect(sw.map((s) => [s.id, s.ports, s.poeW])).toEqual([
      ['CCTV-SW-GF-1', 20, 259], ['CCTV-SW-GF-2', 5, 64.75], ['ICT-SW-L1-F1-1', 10, 255], ['ICT-SW-L1-F2-1', 10, 255]
    ]);
    // A tighter PoE budget splits the switch.
    const tight = elvSchedules(p, elvSettings.parse({ catalogue: { ict: { switchBudgetW: 200 } } })).buildings[0].switches.filter((s) => s.system === 'ict');
    expect(tight.map((s) => s.ports)).toEqual([7, 3, 7, 3]);
  });

  it('counts a door per lock (in and out readers on one door), 4 doors per controller', () => {
    // Hall A: 3 doors with a lock and 2 readers each; Hall B: 2 doors with a lock and a reader.
    const door = (x: number, readers: number): NewElvDevice[] => [{ type: 'maglock', x, y: 1 }, ...Array.from({ length: readers }, () => ({ type: 'card-reader' as const, x, y: 1.2 }))];
    const p = place(base(), 'GF', [...door(5, 2), ...door(10, 2), ...door(15, 2), ...door(35, 1), ...door(40, 1)]);
    const c = elvSchedules(p).buildings[0].controllers;
    expect(c.map((x) => [x.id, x.doors])).toEqual([['ACS-GF-1', 3], ['ACS-GF-2', 2]]); // a room's doors stay on one controller
  });

  it('makes a PA zone per floor and puts zones on amplifiers within 480 W ÷ 1.25 headroom', () => {
    let p = place(base(), 'GF', grid('ceiling-speaker', 2, 2, 10, 5, 5)); // 50 × 6 W = 300 W
    p = place(p, 'L1', grid('ceiling-speaker', 2, 2, 5, 3, 4)); // 15 × 6 W = 90 W per floor
    const b = elvSchedules(p).buildings[0];
    expect(b.paZones.map((z) => [z.id, z.speakers, z.watts, z.amplifier])).toEqual([['PA-GF', 50, 300, 'AMP-1'], ['PA-L1-F1', 15, 90, 'AMP-2'], ['PA-L1-F2', 15, 90, 'AMP-2']]);
    expect(b.amplifiers).toEqual([{ id: 'AMP-1', ratedW: 480, loadW: 300, zones: ['PA-GF'] }, { id: 'AMP-2', ratedW: 480, loadW: 180, zones: ['PA-L1-F1', 'PA-L1-F2'] }]);
  });

  it('has nothing to group before devices are placed', () => {
    expect(elvSchedules(base())).toEqual({ buildings: [], warnings: [] });
  });
});
