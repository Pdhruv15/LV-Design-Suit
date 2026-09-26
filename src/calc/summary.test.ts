import { describe, expect, it } from 'vitest';
import { boardSummary, boardTotals, boardsInSupplyOrder, systemSummary } from './summary';
import { upstreamVoltageDropPct } from './electrical';
import type { Feeder, Project } from '../types';

const SQRT3 = Math.sqrt(3);

function feeder(over: Partial<Feeder>): Feeder {
  return {
    id: 'F', boardId: 'MDB', name: 'Feeder', loadKw: 10, demandFactor: 1, powerFactor: 1,
    lengthM: 30, cableCsaMm2: 95, cores: 4, breakerRatingA: 250, breakerIcuKa: 50, ...over
  };
}

// MDB ── SMDB ── two loads with different power factors
//    └── PV (generation) and a direct load
const project: Project = {
  name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
  boards: [
    { id: 'MDB', name: 'Main', sourceKva: 1000, sourceImpedancePct: 5, ratedCurrentA: 1600 },
    { id: 'SMDB', name: 'Sub', upstreamId: 'MDB', ratedCurrentA: 250 }
  ],
  feeders: [
    feeder({ id: 'INC', feedsBoardId: 'SMDB', lengthM: 60 }),
    feeder({ id: 'A', boardId: 'SMDB', loadKw: 100, demandFactor: 0.8, powerFactor: 0.8 }), // 80 kW, 60 kvar
    feeder({ id: 'B', boardId: 'SMDB', loadKw: 40, demandFactor: 1, powerFactor: 1 }), // 40 kW, 0 kvar
    feeder({ id: 'PV', loadKw: 50, demandFactor: 1, generation: true }),
    feeder({ id: 'C', loadKw: 30, demandFactor: 0.5, powerFactor: 1 }) // 15 kW
  ]
};

describe('board totals', () => {
  it('sums P and Q separately and keeps generation apart', () => {
    const t = boardTotals(project, 'SMDB');
    expect(t.connectedKw).toBe(140);
    expect(t.demandKw).toBeCloseTo(120, 9);
    expect(t.demandKvar).toBeCloseTo(60, 9);
    expect(t.generationKw).toBe(0);

    const m = boardTotals(project, 'MDB');
    expect(m.demandKw).toBeCloseTo(135, 9);
    expect(m.generationKw).toBe(50);
  });
});

describe('board summary', () => {
  it('kVA, power factor, current and loading from P and Q', () => {
    const s = boardSummary(project, project.boards[1]);
    const kva = Math.hypot(120, 60); // 134.16 kVA
    expect(s.demandKva).toBeCloseTo(kva, 9);
    expect(s.powerFactor).toBeCloseTo(120 / kva, 9); // 0.894
    expect(s.currentA).toBeCloseTo((kva * 1000) / (SQRT3 * 415), 9); // 186.6 A
    expect(s.loadingPct).toBeCloseTo((s.currentA / 250) * 100, 9); // 74.7 %
    expect(s.loadingStatus).toBe('ok');
    expect(s.depth).toBe(1);
    expect(s.incomer?.id).toBe('INC');
  });

  it('busbar voltage = 100 % minus the incomer drops above it', () => {
    const main = boardSummary(project, project.boards[0]);
    const sub = boardSummary(project, project.boards[1]);
    expect(main.voltagePct).toBe(100);
    expect(sub.voltagePct).toBeCloseTo(100 - upstreamVoltageDropPct(project, 'SMDB'), 12);
    expect(sub.voltageV).toBeCloseTo(415 * (sub.voltagePct / 100), 9);
    expect(sub.faultKA).toBeLessThan(main.faultKA);
  });
});

describe('system summary', () => {
  it('totals across the network and loads the transformer', () => {
    const s = systemSummary(project);
    const kva = Math.hypot(135, 60);
    expect(s.demandKva).toBeCloseTo(kva, 9);
    expect(s.transformerKva).toBe(1000);
    expect(s.transformerLoadingPct).toBeCloseTo(kva / 10, 9);
    expect(s.generationKw).toBe(50);
  });

  it('orders boards the way they are supplied', () => {
    expect(boardsInSupplyOrder(project).map((b) => b.id)).toEqual(['MDB', 'SMDB']);
  });
});
