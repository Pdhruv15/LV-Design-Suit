// @vitest-environment node
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Board, Project } from '../types';
import { defaultServices } from './buildingDesign';
import { decide, readPackage } from '../exchange/inbox';
import { estimateElv } from '../elv/estimate';
import { elvLoadsPackage } from '../elv/package';
import { addElvCircuits, onEssentialSide, planElvPlacement } from './elvPlacement';

const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const AT = '2026-10-26T12:00:00Z';
const lv = (id: string, level: string, extra: Partial<Board> = {}, index?: number): Board =>
  ({ id, name: id, kind: 'DB', upstreamId: 'MDB', level: { building: 'T', level, ...(index ? { index } : {}) }, ...extra });

/** The SP3 test tower with boards: MDB and EMDB on the ground floor, a DB on every floor (one per typical floor). */
function tower(): Project {
  return {
    name: 'Tower', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', feeders: [],
    boards: [
      { id: 'MDB', name: 'MDB', kind: 'MDB', sourceKva: 1000, level: { building: 'T', level: 'GF' } },
      lv('EMDB', 'GF', { kind: 'EMDB' }),
      lv('DB-B1', 'B1'), lv('DB-GF', 'GF'), lv('DB-L1-1', 'L1', {}, 1), lv('DB-L1-2', 'L1', {}, 2)
    ],
    building: {
      buildings: [{ id: 'T', name: 'Tower', levels: [
        { id: 'B1', name: 'Basement', kind: 'basement', heightM: 3.5 }, { id: 'GF', name: 'Ground', kind: 'ground', heightM: 4.5 },
        { id: 'L1', name: 'Typical', kind: 'typical', heightM: 3.5, count: 2 }
      ] }],
      rooms: [
        { id: 'R1', buildingId: 'T', levelId: 'B1', name: 'Car park', type: 'parking', areaM2: 2000 },
        { id: 'R2', buildingId: 'T', levelId: 'GF', name: 'Lobby', type: 'lobby', areaM2: 200, boardId: 'DB-GF' },
        { id: 'R3', buildingId: 'T', levelId: 'GF', name: 'Shop', type: 'retail', areaM2: 120 },
        { id: 'R4', buildingId: 'T', levelId: 'GF', name: 'LV room', type: 'plant', areaM2: 30 },
        { id: 'R5', buildingId: 'T', levelId: 'GF', name: 'WC', type: 'toilet', areaM2: 10 },
        { id: 'R6', buildingId: 'T', levelId: 'L1', name: 'Office', type: 'office', areaM2: 300 },
        { id: 'R7', buildingId: 'T', levelId: 'L1', name: 'WC', type: 'toilet', areaM2: 20 }
      ]
    }
  };
}

/** The tower with its ELV estimate exported, checked and accepted in the inbox. */
function accepted(p = tower()): Project {
  const read = readPackage(elvLoadsPackage(p, estimateElv(p), AT, sha256), sha256);
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return decide(p, read.pkg, read.hash, { accept: 'all', by: 'A. Engineer', at: AT }).project;
}

describe('ELV placement', () => {
  it('knows the essential side: an essential board kind, or below a board with a standby generator', () => {
    const p = tower();
    expect(onEssentialSide(p, p.boards[1])).toBe(true);
    expect(onEssentialSide(p, p.boards[3])).toBe(false);
    const withGen = { ...p, boards: p.boards.map((b) => (b.id === 'MDB' ? { ...b, standby: { kva: 500 } } : b)) };
    expect(onEssentialSide(withGen, withGen.boards[3])).toBe(true);
  });

  it('puts floor supplies on their floor’s DB, building supplies on the main board, essential loads on the essential side', () => {
    const plan = planElvPlacement(accepted());
    expect(plan.add.map((c) => [c.load.id, c.boardId, c.why])).toEqual([
      ['CCTV-T-B1', 'DB-B1', 'a board on its floor'],
      ['CCTV-T-GF', 'DB-GF', 'serves 1 of its rooms'],
      ['ACS-T-GF', 'EMDB', 'a board on its floor, essential side'],
      ['ICT-T-GF', 'DB-GF', 'serves 1 of its rooms'],
      ['ACS-T-L1-F1', 'EMDB', "no board on its floor; the building's main board, essential side"],
      ['ICT-T-L1-F1', 'DB-L1-1', 'a board on its floor'],
      ['ACS-T-L1-F2', 'EMDB', "no board on its floor; the building's main board, essential side"],
      ['ICT-T-L1-F2', 'DB-L1-2', 'a board on its floor'],
      ['FA-T', 'EMDB', "the building's main board, essential side"],
      ['CCTV-NVR-T', 'MDB', "the building's main board"],
      ['ICT-CORE-T', 'MDB', "the building's main board"],
      ['PA-T', 'EMDB', "the building's main board, essential side"]
    ]);
    expect(plan.unplaced).toEqual([]);
  });

  it('marks essential loads essential when the building has no essential side', () => {
    const p = { ...tower(), boards: tower().boards.filter((b) => b.id !== 'EMDB') };
    const plan = planElvPlacement(accepted(p));
    expect(plan.add.find((c) => c.load.id === 'FA-T')!.boardId).toBe('MDB');
    const { project } = addElvCircuits(accepted(p), plan);
    expect(project.feeders.find((f) => f.elvLoad?.endsWith('#FA-T'))).toMatchObject({ boardId: 'MDB', essential: true });
  });

  it('says when a floor has no board, or an essential load has no essential board; nothing when the rules fit', () => {
    expect(planElvPlacement(accepted()).notices).toEqual([]);
    const noEss = planElvPlacement(accepted({ ...tower(), boards: tower().boards.filter((b) => b.id !== 'EMDB') }));
    expect(noEss.notices).toEqual(['5 essential loads go on a normal board: the building has no essential (generator) board (ACS-T-GF, ACS-T-L1-F1, ACS-T-L1-F2, FA-T, PA-T). Their circuits are marked essential; add an essential board, or choose the board.']);
    const noB1 = planElvPlacement(accepted({ ...tower(), boards: tower().boards.filter((b) => b.id !== 'DB-B1') }));
    expect(noB1.add.find((c) => c.load.id === 'CCTV-T-B1')!.boardId).toBe('MDB');
    expect(noB1.notices).toEqual(["1 floor supply goes to the building's main board because its floor has no board (CCTV-T-B1). Set the DB that serves the rooms, or choose the board."]);
  });

  it('adds sized circuits linked to their loads, single-phase for small loads', () => {
    const p = accepted();
    const { project, added } = addElvCircuits(p, planElvPlacement(p));
    expect(added).toHaveLength(12);
    const pa = project.feeders.find((f) => f.id === 'EMDB-PA-T')!;
    expect(pa).toMatchObject({ boardId: 'EMDB', name: expect.stringMatching(/^Public address amplifiers/), loadKw: 0.551, demandFactor: 1, cores: 2, loadType: 'it', essential: true, elvLoad: 'elv:Tower — ELV estimate#PA-T' });
    expect(['R', 'Y', 'B']).toContain(pa.phase);
    expect(pa.breakerRatingA).toBeGreaterThan(0);
    expect(project.feeders.find((f) => f.id === 'MDB-ICT-CORE-T')).not.toHaveProperty('essential');
    // Placed again: nothing more to add.
    const again = planElvPlacement(project);
    expect([again.add.length, again.kwChanges.length, again.same.length]).toEqual([0, 0, 12]);
  });

  it('on the next package: adds new loads, lists changed kW and removed loads, never deletes', () => {
    let p = accepted();
    p = addElvCircuits(p, planElvPlacement(p)).project;
    const est = estimateElv(p);
    est.supplies = est.supplies.filter((s) => s.id !== 'CCTV-NVR-T').map((s) => (s.id === 'PA-T' ? { ...s, kW: 0.8 } : s));
    est.supplies.push({ ...est.supplies[0], id: 'BMS-T-GF', equipment: 'BMS controller', kW: 0.2 });
    const read = readPackage(elvLoadsPackage(p, est, '2026-10-27T09:00:00Z', sha256), sha256);
    if (!read.ok) throw new Error('package');
    p = decide(p, read.pkg, read.hash, { accept: 'all', by: 'A. Engineer', at: AT }).project;
    const plan = planElvPlacement(p);
    expect(plan.add.map((c) => c.load.id)).toEqual(['BMS-T-GF']);
    expect(plan.kwChanges).toEqual([{ feederId: 'EMDB-PA-T', link: 'elv:Tower — ELV estimate#PA-T', fromKw: 0.551, toKw: 0.8 }]);
    expect(plan.removed).toEqual([{ feederId: 'MDB-CCTV-NVR-T', link: 'elv:Tower — ELV estimate#CCTV-NVR-T', name: expect.stringMatching(/CCTV recorders/) }]);
    expect(addElvCircuits(p, plan).project.feeders.find((f) => f.id === 'EMDB-PA-T')!.loadKw).toBe(0.551); // proposed, not changed
  });

  it('takes the engineer’s board for a load, and refuses an unknown board', () => {
    const p = accepted();
    expect(planElvPlacement(p, { 'FA-T': 'MDB' }).add.find((c) => c.load.id === 'FA-T')).toMatchObject({ boardId: 'MDB', why: 'board given by the engineer' });
    expect(() => planElvPlacement(p, { 'FA-T': 'NOPE' })).toThrow(/No board "NOPE"/);
  });

  it('cannot place loads in a building without boards', () => {
    const p = { ...accepted(), boards: [] };
    const plan = planElvPlacement(p);
    expect(plan.add).toEqual([]);
    expect(plan.unplaced.map((u) => u.why)).toEqual(Array(12).fill('no board in its building'));
  });

  it('lists the ELV placeholder circuit, and stops suggesting it once ELV circuits are placed', () => {
    let p = accepted();
    p = { ...p, feeders: [{ id: 'MDB-ELV1', boardId: 'MDB', name: 'ELV / BMS / security', loadKw: 3, demandFactor: 1, powerFactor: 0.85, lengthM: 40, cableCsaMm2: 6, cores: 4, breakerRatingA: 32, breakerIcuKa: 25 }] };
    expect(defaultServices(p, 'T').find((s) => s.id === 'elv')!.qty).toBe(1);
    const plan = planElvPlacement(p);
    expect(plan.placeholders).toEqual([{ feederId: 'MDB-ELV1', name: 'ELV / BMS / security' }]);
    p = addElvCircuits(p, plan).project;
    expect(defaultServices(p, 'T').find((s) => s.id === 'elv')!.qty).toBe(0);
    expect(p.feeders.some((f) => f.id === 'MDB-ELV1')).toBe(true); // listed, not deleted
  });
});
