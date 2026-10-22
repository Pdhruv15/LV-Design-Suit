import { describe, expect, it } from 'vitest';
import { unbalancedFlow, VOLTAGE_UNBALANCE_LIMIT_PCT } from './unbalancedFlow';
import { evaluateProject, rOperatingOhmPerKm, upstreamVoltageDropPct } from './electrical';
import { phaseBalance } from './phaseBalance';
import { sampleProject } from '../data/sampleProject';
import { buildSection, scopeOf, type CalcData } from '../docs/studyReport';
import { runCalculations } from './runs';
import { unresolvedChecks } from '../docs/issuePackage';
import type { Feeder, Phase, Project } from '../types';

const load = (id: string, phase: Phase | undefined, kw: number, pf = 1, cores: 2 | 4 = 2): Feeder => ({
  id, boardId: 'DB', name: id, loadKw: kw, demandFactor: 1, powerFactor: pf, lengthM: 20, cableCsaMm2: 4, cores, breakerRatingA: 32, breakerIcuKa: 10, ...(phase ? { phase } : {})
});
/** MDB on a 1000 kVA transformer; DB 100 m away on a 4-core 50 mm² cable. */
const net = (loads: Feeder[], csa = 50): Project => ({
  name: 'T', voltageV: 400, frequencyHz: 50, ambientC: 30, vdLimitPct: 4, updatedAt: '',
  boards: [{ id: 'MDB', name: 'MDB', sourceKva: 1000, sourceImpedancePct: 5 }, { id: 'DB', name: 'DB', upstreamId: 'MDB' }],
  feeders: [{ id: 'INC', boardId: 'MDB', feedsBoardId: 'DB', name: 'DB', loadKw: 0, demandFactor: 1, powerFactor: 1, lengthM: 100, cableCsaMm2: csa, cores: 4, breakerRatingA: 125, breakerIcuKa: 36 }, ...loads]
});
const U0 = 400 / Math.sqrt(3);
const board = (f: ReturnType<typeof unbalancedFlow>, id: string) => f.boards.find((b) => b.boardId === id)!;

describe('unbalanced load flow', () => {
  it('balanced loads: no neutral current or shift, and the drop agrees with the balanced study', () => {
    const p = net([load('a', 'R', 10), load('b', 'Y', 10), load('d', 'B', 10)]);
    const f = unbalancedFlow(p);
    expect(f.converged).toBe(true);
    const db = board(f, 'DB');
    expect(db.neutralA).toBeLessThan(1e-6);
    expect(db.neutralShiftV).toBeLessThan(1e-6);
    expect(db.unbalancePct).toBeLessThan(1e-6);
    expect(db.vdPct.R).toBeCloseTo(db.vdPct.Y, 6);
    expect(db.vdPct.R).toBeCloseTo(upstreamVoltageDropPct(p, 'DB'), 1); // exact phasors vs the R cosφ + X sinφ approximation
    // The main busbar sits below nominal by the transformer's drop.
    expect(board(f, 'MDB').voltageV.R).toBeLessThan(U0);
  });

  it('one phase loaded: the neutral carries the phase current, the loaded phase drops twice, the others rise', () => {
    const p = net([load('a', 'R', 20)]);
    const f = unbalancedFlow(p);
    const db = board(f, 'DB');
    const i = 20000 / U0; // ≈ 86.6 A at PF 1
    expect(db.neutralA).toBeCloseTo(i, -1);
    const r = (rOperatingOhmPerKm(50, p.vdTempC) * 100) / 1000;
    expect(db.neutralShiftV).toBeCloseTo(db.neutralA * Math.hypot(r, (0.08 * 100) / 1000), 0);
    // Phase and neutral both drop I·R on the loaded phase: ≈ 2 × the balanced per-phase figure.
    expect(db.vdPct.R).toBeCloseTo(((2 * db.neutralA * r) / U0) * 100, 0);
    expect(db.worstPhase).toBe('R');
    expect(db.vdPct.Y).toBeLessThan(0);
    expect(db.vdPct.B).toBeLessThan(0);
    expect(db.unbalancePct).toBeGreaterThan(0);
    // Neutral current at nominal voltage, as the demand-based phase balance.
    expect(db.neutralA).toBeCloseTo(phaseBalance(p, 'DB').neutralA, -1);
  });

  it('flags voltage unbalance above the IEC 61000-2-2 level and a neutral above the cable rating', () => {
    const f = unbalancedFlow(net([load('a', 'R', 40)], 16));
    const db = board(f, 'DB');
    expect(db.unbalancePct).toBeGreaterThan(VOLTAGE_UNBALANCE_LIMIT_PCT);
    expect(db.neutralIz).toBeDefined();
    expect(db.neutralA).toBeGreaterThan(db.neutralIz!);
    expect(db.status).toBe('bad');
  });

  it('final circuits: worst phase at the far end; a single-phase circuit without a phase is taken on the lowest phase', () => {
    const p = net([load('a', 'R', 20), load('s', undefined, 3), load('m', 'RYB', 9, 0.85, 4)]);
    const f = unbalancedFlow(p);
    const s = f.circuits.find((x) => x.feeder.id === 's')!;
    const a = f.circuits.find((x) => x.feeder.id === 'a')!;
    expect(s.phase).toBe('RYB');
    expect(s.vdPct).toBeGreaterThan(board(f, 'DB').vdPct.R); // on R, the low phase, plus its own cable
    expect(a.phase).toBe('R');
    expect(a.vdPct).toBeGreaterThan(evaluateProject(p).find((r) => r.feeder.id === 'a')!.vdTotalPct); // the neutral shift adds to it
    expect(f.circuits.find((x) => x.feeder.id === 'm')!.endV).toBeLessThan(U0);
  });

  it('boards without a source or an incomer are listed as not energised', () => {
    const p = net([load('a', 'R', 5)]);
    const cut = { ...p, feeders: p.feeders.filter((x) => x.id !== 'INC') };
    const f = unbalancedFlow(cut);
    expect(f.notEnergised).toEqual(['DB']);
    expect(f.circuits).toEqual([]);
  });

  it('runs on the sample project: every board energised, finite results, converged', () => {
    const f = unbalancedFlow(sampleProject);
    expect(f.converged).toBe(true);
    expect(f.notEnergised).toEqual([]);
    expect(f.boards.length).toBe(sampleProject.boards.length);
    for (const b of f.boards) for (const v of Object.values(b.voltageV)) expect(Number.isFinite(v)).toBe(true);
    expect(f.circuits.every((c) => Number.isFinite(c.vdPct))).toBe(true);
  });

  it('the phase balance study reports it, and its failures reach the unresolved checks', () => {
    const p = net([load('a', 'R', 40)], 16);
    const r = runCalculations(p);
    const data: CalcData = { project: p, results: r.results, earthing: r.earthing, selectivity: r.selectivity };
    const s = buildSection('phase', data, scopeOf(p, { boards: [], downstream: true }));
    expect(s.tables.map((t) => t.title)).toContain('Unbalanced load flow — busbars');
    const db = s.tables.find((t) => t.title === 'Unbalanced load flow — busbars')!.rows.find((x) => x[0] === 'DB')!;
    expect(db[db.length - 1]).toMatchObject({ s: 'bad' });
    expect(s.method.some((l) => /backward \/ forward sweep/.test(l))).toBe(true);
    expect(unresolvedChecks([s]).some((u) => u.item === 'DB' && u.check === 'Neutral (A)' && u.status === 'bad')).toBe(true);
  });
});
