import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyDrop, canDrop } from './sldEdit';
import { evaluateEarthing, instantaneousTripA, rcdOf } from '../calc/earthing';
import { isScheduleCircuit } from '../calc/loadSchedule';
import { accessoriesText, dbSchedule, equipmentSchedule } from '../docs/schedules';
import { runCalculations, staleStudies } from '../calc/runs';
import type { Project } from '../types';

const small = sampleProject.feeders.find((f) => !f.phase && !f.feedsBoardId && f.breakerRatingA <= 32)!;
const big = sampleProject.feeders.find((f) => f.feedsBoardId)!;
const acc = (a: 'meter' | 'ct-meter' | 'rcd' | 'isolator' | 'spd') => ({ kind: 'accessory' as const, accessory: a });

describe('SLD accessories: metering, earth leakage, isolator, surge protection', () => {
  it('feeder accessories drop on feeders, the SPD on a busbar', () => {
    expect(canDrop(sampleProject, acc('rcd'), { type: 'feeder', feederId: small.id })).toBe(true);
    expect(canDrop(sampleProject, acc('rcd'), { type: 'bus', boardId: 'MDB-1' })).toBe(false);
    expect(canDrop(sampleProject, acc('spd'), { type: 'bus', boardId: 'MDB-1' })).toBe(true);
    expect(canDrop(sampleProject, acc('spd'), { type: 'feeder', feederId: small.id })).toBe(false);
  });

  it('drops set sensible defaults', () => {
    const get = (p: Project, id: string) => p.feeders.find((f) => f.id === id)!;
    expect(get(applyDrop(sampleProject, acc('rcd'), { type: 'feeder', feederId: small.id }).project, small.id).rcdMa).toBe(30);
    expect(get(applyDrop(sampleProject, acc('rcd'), { type: 'feeder', feederId: big.id }).project, big.id).rcdMa).toBe(300);
    expect(get(applyDrop(sampleProject, acc('meter'), { type: 'feeder', feederId: big.id }).project, big.id).kwhMeter).toBe(big.cores >= 3 ? '3-PH' : '1-PH');
    expect(get(applyDrop(sampleProject, acc('ct-meter'), { type: 'feeder', feederId: big.id }).project, big.id).kwhMeter).toBe('CT');
    expect(get(applyDrop(sampleProject, acc('isolator'), { type: 'feeder', feederId: small.id }).project, small.id).localIsolator).toBe(true);
    const spd = applyDrop(sampleProject, acc('spd'), { type: 'bus', boardId: 'MDB-1' }).project;
    expect(spd.boards.find((b) => b.id === 'MDB-1')!.spd).toBe('T1+2');
    const sub = sampleProject.boards.find((b) => b.upstreamId)!;
    expect(applyDrop(sampleProject, acc('spd'), { type: 'bus', boardId: sub.id }).project.boards.find((b) => b.id === sub.id)!.spd).toBe('T2');
  });

  it('an RCD trips at 5 × IΔn: the earth fault loop limit rises and a failing circuit can pass', () => {
    const f = { ...small, lengthM: 400 }; // long enough that the breaker alone is too slow
    const p: Project = { ...sampleProject, feeders: sampleProject.feeders.map((x) => (x.id === f.id ? f : x)) };
    const without = evaluateEarthing(p, f);
    expect(without.tripA).toBe(instantaneousTripA(f));
    const withRcd = evaluateEarthing(p, { ...f, rcdMa: 30 });
    expect(withRcd.tripA).toBeCloseTo(0.15, 6);
    expect(withRcd.rcdMa).toBe(30);
    expect(withRcd.maxZsOhm).toBeGreaterThan(without.maxZsOhm * 100);
    expect(withRcd.disconnection).toBe('ok');
  });

  it("final circuits of a DB are covered by its ELCB group; the ELCB can be switched off", () => {
    const c = sampleProject.feeders.find(isScheduleCircuit)!;
    expect(rcdOf(sampleProject, c)).toBeGreaterThan(0);
    const noElcb: Project = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === c.boardId ? { ...b, elcbGroupSize: 0 as const } : b)) };
    expect(rcdOf(noElcb, c)).toBeUndefined();
  });

  it('an RCD change makes the earthing study out of date — a meter or isolator does not', () => {
    const run = runCalculations(sampleProject);
    const with_ = (patch: object) => ({ ...sampleProject, feeders: sampleProject.feeders.map((x) => (x.id === small.id ? { ...x, ...patch } : x)) });
    expect(staleStudies(run, with_({ rcdMa: 30 }))).toEqual(['earthing']);
    expect(staleStudies(run, with_({ kwhMeter: '3-PH', localIsolator: true }))).toEqual([]);
  });

  it('schedules list the accessories and the SPD', () => {
    expect(accessoriesText({ ...small, rcdMa: 30, kwhMeter: 'CT', localIsolator: true })).toBe('RCD 30 mA · CT kWh meter · local isolator');
    expect(accessoriesText({ ...small, kvar: 300, capSteps: 6, detunedPct: 7 })).toBe('6 steps · 7% detuned');
    const p: Project = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'MDB-1' ? { ...b, spd: 'T1+2' as const } : b)), feeders: sampleProject.feeders.map((x) => (x.id === small.id ? { ...x, rcdMa: 30 } : x)) };
    const db = dbSchedule(p);
    expect(db.headers[db.headers.length - 1]).toBe('Accessories');
    const row = db.rows.find((r) => r[2] === small.id)!;
    expect(row[row.length - 1]).toBe('RCD 30 mA');
    const eq = equipmentSchedule(p).rows.find((r) => r[0] === 'MDB-1')!;
    expect(eq[eq.length - 1]).toBe('SPD T1+2');
  });
});
