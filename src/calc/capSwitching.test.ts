import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';
import { switchedKvar, switchedOnBoard } from './capSwitching';
import { boardTotals } from './summary';
import { incomerBasis } from './electrical';
import { capacitorFeeder } from './pfc';
import { calcPfc, PFC_CALC_DEFAULT } from './pfcCalc';

const load = (id: string, kw: number, pf: number, board = 'DB'): Feeder => ({ id, boardId: board, name: id, loadKw: kw, demandFactor: 1, powerFactor: pf, lengthM: 10, cableCsaMm2: 16, cores: 4, breakerRatingA: 63, breakerIcuKa: 25 });
const cap = (id: string, kvar: number, capSteps?: number, board = 'DB'): Feeder => ({ ...load(id, 0, 1, board), kvar, loadType: 'capacitor', ...(capSteps ? { capSteps } : {}) });
const project = (feeders: Feeder[]): Project => ({
  ...sampleProject, voltageV: 400, studySettings: { ...sampleProject.studySettings, pfTarget: 0.95 },
  boards: [{ id: 'MDB', name: 'MDB', sourceKva: 1000 }, { id: 'DB', name: 'DB', upstreamId: 'MDB' }],
  feeders: [{ ...load('INC', 0, 1, 'MDB'), feedsBoardId: 'DB' }, ...feeders], ties: undefined, trays: undefined
} as Project);

describe('capacitor banks on the SLD switch by steps (automatic) or stay on (fixed)', () => {
  it('switchedKvar: fewest steps to the target without leading, else the most non-leading', () => {
    expect(switchedKvar(100, 75, 100, 4, 0.95)).toBe(50); // 2 × 25 → Q 25, PF 0.970
    expect(switchedKvar(10, 7.5, 25, 1, 0.95)).toBe(0); // the only step would go leading
    expect(switchedKvar(10, 7.5, 10, 4, 1)).toBe(7.5); // 3 × 2.5 → Q 0
  });

  it('an automatic bank bigger than the load never makes the board leading', () => {
    const p = project([load('L', 10, 0.8), cap('C', 25, 1)]);
    const t = boardTotals(p, 'DB');
    expect(t.demandKvar).toBeCloseTo(7.5, 9); // step left off
    const b = incomerBasis(p.feeders[0], p);
    expect(b.totalQ).toBeCloseTo(7.5, 9); // the incomer (ENG-005) agrees
  });

  it('a 4-step 100 kvar bank on 100 kW + 75 kvar switches 50 kvar', () => {
    const p = project([load('L', 100, 0.8), cap('C', 100, 4)]);
    expect(boardTotals(p, 'DB').demandKvar).toBeCloseTo(25, 9);
  });

  it('a fixed capacitor (no steps) is always on at full kvar, and can make the board leading', () => {
    const p = project([load('L', 10, 0.8), cap('C', 25)]);
    expect(boardTotals(p, 'DB').demandKvar).toBeCloseTo(-17.5, 9);
  });

  it('fixed banks count first, then automatic banks switch on what is left', () => {
    const m = switchedOnBoard([cap('A', 50, 2), cap('F', 20)], 100, 75, 0.95);
    expect(m.get('F')).toBe(20); // fixed: full
    expect(m.get('A')).toBe(25); // 75 − 20 = 55 → one 25 kvar step gives 30 kvar, PF 0.958
  });

  it('banks from the PFC calculator and PFC study are automatic', () => {
    const r = calcPfc({ ...PFC_CALC_DEFAULT, mode: 'kw-pf', kw: 10, pf: 0.8, targetPf: 0.95, stepKvar: 25 });
    const f = capacitorFeeder(project([load('L', 10, 0.8)]), 'DB', 'DB-PFC1', 'Bank', r.bankKvar, r.steps);
    expect(f.capSteps).toBe(1);
    const p = project([load('L', 10, 0.8), f]);
    expect(boardTotals(p, 'DB').demandKvar).toBeCloseTo(7.5, 9); // same as the calculator: the step stays off
  });
});
