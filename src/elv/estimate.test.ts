// @vitest-environment node
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { decide, readPackage, reviewPackage } from '../exchange/inbox';
import { elvSettings, estimateElv } from './estimate';
import { elvLoadsPackage } from './package';

const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/** A small tower: car park basement, ground floor with lobby, shop, plant room and toilet, two typical office floors. */
function tower(): Project {
  return {
    name: 'Tower', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
    building: {
      buildings: [{ id: 'T', name: 'Tower', levels: [
        { id: 'B1', name: 'Basement', kind: 'basement', heightM: 3.5 },
        { id: 'GF', name: 'Ground', kind: 'ground', heightM: 4.5 },
        { id: 'L1', name: 'Typical', kind: 'typical', heightM: 3.5, count: 2 }
      ] }],
      rooms: [
        { id: 'R1', buildingId: 'T', levelId: 'B1', name: 'Car park', type: 'parking', areaM2: 2000 },
        { id: 'R2', buildingId: 'T', levelId: 'GF', name: 'Lobby', type: 'lobby', areaM2: 200 },
        { id: 'R3', buildingId: 'T', levelId: 'GF', name: 'Shop', type: 'retail', areaM2: 120 },
        { id: 'R4', buildingId: 'T', levelId: 'GF', name: 'LV room', type: 'plant', areaM2: 30 },
        { id: 'R5', buildingId: 'T', levelId: 'GF', name: 'WC', type: 'toilet', areaM2: 10 },
        { id: 'R6', buildingId: 'T', levelId: 'L1', name: 'Office', type: 'office', areaM2: 300 },
        { id: 'R7', buildingId: 'T', levelId: 'L1', name: 'WC', type: 'toilet', areaM2: 20 }
      ]
    }
  };
}

describe('ELV estimate', () => {
  it('counts devices per room from type and area, with the minimum per room', () => {
    const e = estimateElv(tower());
    const dev = (id: string) => e.rooms.find((r) => r.roomId === id)!.devices;
    expect(dev('R1')).toEqual({ heatDetector: 56, sounder: 7, camera: 8, hornSpeaker: 10 });
    expect(dev('R2')).toEqual({ smokeDetector: 3, sounder: 2, camera: 2, door: 1, accessPoint: 1, ceilingSpeaker: 7 });
    expect(dev('R4')).toEqual({ smokeDetector: 1, sounder: 1, camera: 1, door: 1, dataPort: 2, hornSpeaker: 1 });
    expect(dev('R5')).toEqual({});
    expect(dev('R6')).toEqual({ smokeDetector: 4, sounder: 3, door: 1, dataPort: 50, accessPoint: 2, ceilingSpeaker: 10 });
    expect(e.rooms.find((r) => r.roomId === 'R6')!.count).toBe(2); // two typical floors
  });

  it('groups devices onto their supplies, per floor and per building, with the upstream kW', () => {
    const e = estimateElv(tower());
    expect(e.supplies.map((s) => [s.id, s.units, s.kW, s.supply])).toEqual([
      ['CCTV-T-B1', 1, 0.186, 'normal'],
      ['CCTV-T-GF', 1, 0.15, 'normal'],
      ['ACS-T-GF', 1, 0.049, 'essential'],
      ['ICT-T-GF', 1, 0.293, 'normal'],
      ['ACS-T-L1-F1', 1, 0.022, 'essential'],
      ['ICT-T-L1-F1', 2, 0.376, 'normal'],
      ['ACS-T-L1-F2', 1, 0.022, 'essential'],
      ['ICT-T-L1-F2', 2, 0.376, 'normal'],
      ['FA-T', 1, 0.042, 'essential'],
      ['CCTV-NVR-T', 1, 0.208, 'normal'],
      ['ICT-CORE-T', 1, 0.833, 'normal'],
      ['PA-T', 1, 0.551, 'essential']
    ]);
    const fa = e.supplies.find((s) => s.id === 'FA-T')!;
    expect(fa.devices).toEqual({ smokeDetector: 14, heatDetector: 56, sounder: 17 });
    expect(fa.backup).toBe('8 Ah batteries: 24 h standby + 30 min alarm');
    expect(e.supplies.find((s) => s.id === 'ICT-T-L1-F1')!.rooms).toEqual(['R6', 'R7']);
    expect(e.totals).toEqual({
      'fire-alarm': { kW: 0.042, supplies: 1 }, cctv: { kW: 0.544, supplies: 3 }, 'access-control': { kW: 0.093, supplies: 3 },
      ict: { kW: 1.878, supplies: 4 }, 'public-address': { kW: 0.551, supplies: 1 }
    });
    expect(e.warnings).toEqual([]);
    expect(e.assumptions.length).toBeGreaterThan(5);
  });

  it('names the equipment with plural units in plain English', () => {
    const e = estimateElv(tower());
    expect(e.supplies.find((s) => s.id === 'ICT-T-L1-F1')!.equipment).toBe('Floor rack and access switches, Typical (floor 1) (2 switches, 50 data ports, 2 access points)');
    expect(e.supplies.find((s) => s.id === 'CCTV-T-B1')!.equipment).toBe('CCTV PoE switches, Basement (1 switch, 8 cameras)');
  });

  it('takes the project’s changes to rules and device data, and the systems chosen', () => {
    const p = { ...tower(), elv: elvSettings.parse({ systems: ['ict', 'cctv'], rules: { office: { dataPort: { m2: 10, min: 2 } } }, catalogue: { cctv: { cameraW: 6 } } }) };
    const e = estimateElv(p);
    expect(e.systems).toEqual(['ict', 'cctv']);
    expect(Object.keys(e.totals)).toEqual(['ict', 'cctv']);
    expect(e.supplies.some((s) => s.system === 'fire-alarm')).toBe(false);
    expect(e.rooms.find((r) => r.roomId === 'R6')!.devices.dataPort).toBe(30);
    expect(e.supplies.find((s) => s.id === 'CCTV-T-GF')!.kW).toBe(0.092); // (6 cameras × 6 W + 30 W) × 1.25 ÷ 0.9
    expect(() => elvSettings.parse({ catalogue: { cctv: { upsEfficiency: 1.5 } } })).toThrow();
  });

  it('says when a room type has no rule, and when there are no rooms', () => {
    const p = tower();
    p.building!.rooms.push({ id: 'R8', buildingId: 'T', levelId: 'GF', name: 'Prayer room', type: 'prayer', areaM2: 40 });
    expect(estimateElv(p).warnings).toEqual(['No ELV rule for room type prayer: the default rule is used.']);
    expect(estimateElv({ ...p, building: undefined }).warnings).toEqual([expect.stringMatching(/No rooms in Building information/)]);
  });

  it('warns when one building needs more than one fire alarm panel', () => {
    const p = tower();
    p.building!.rooms[0] = { ...p.building!.rooms[0], areaM2: 20000 }; // 556 heat detectors + sounders: 5 loops
    const e = estimateElv(p);
    expect(e.supplies.find((s) => s.id === 'FA-T')!.units).toBe(2);
    expect(e.warnings).toEqual([expect.stringMatching(/networked panels/)]);
  });
});

describe('ELV loads package', () => {
  it('is a valid loads package that LV can review and accept, with the rooms each supply serves', () => {
    const p = tower();
    const pkg = elvLoadsPackage(p, estimateElv(p), '2026-10-26T12:00:00Z', sha256);
    const read = readPackage(pkg, sha256);
    expect(read).toMatchObject({ ok: true, hash: pkg.sha256 });
    if (!read.ok) return;
    const review = reviewPackage(p, read.pkg, read.hash);
    expect(review.problems).toEqual([]);
    expect(review.counts.added).toBe(12);
    const done = decide(p, read.pkg, read.hash, { accept: 'all', by: 'A. Engineer', at: '2026-10-26T12:00:00Z' }).project;
    expect(done.exchange!.packages[0].loads!.find((l) => l.id === 'PA-T')).toMatchObject({ kW: 0.551, supply: 'essential', system: 'public-address', rooms: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'] });
    expect(() => elvLoadsPackage({ ...p, building: undefined }, estimateElv({ ...p, building: undefined }), '2026-10-26T12:00:00Z', sha256)).toThrow(/no supplies/);
  });
});
