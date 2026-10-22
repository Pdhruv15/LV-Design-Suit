import { describe, expect, it } from 'vitest';
import { existingLoad, othersKva } from '../model/existing';
import { existingChecks } from './existing';
import { boardTotals } from './summary';
import { evaluateProject, faultCurrentKA, impedanceToBoard } from './electrical';
import { fingerprint, runCalculations } from './runs';
import { buildDashboard } from './dashboard';
import { buildSection, scopeOf } from '../docs/studyReport';
import { unresolvedChecks } from '../docs/issuePackage';
import type { Board, Feeder, Project } from '../types';

const kvaOf = (t: { demandKw: number; demandKvar: number }) => Math.hypot(t.demandKw, t.demandKvar);
const feeder = (id: string, boardId: string, kw: number, extra: Partial<Feeder> = {}): Feeder => ({
  id, boardId, name: id, loadKw: kw, demandFactor: 1, powerFactor: 0.9, lengthM: 30, cableCsaMm2: 240, parallel: 2, cores: 4, breakerRatingA: 630, breakerIcuKa: 50, ...extra
});
/** An existing substation LV panel (1500 kVA) supplying two other buildings, and the new building's MDB on a new outgoing way. */
function shared(existing: Board['existing'], extraFeeders: Feeder[] = []): Project {
  return {
    name: 'Shared', voltageV: 400, frequencyHz: 50, ambientC: 40, vdLimitPct: 4, updatedAt: '',
    boards: [
      { id: 'SS-LV', name: 'Substation LV panel', kind: 'MDB', sourceKva: 1500, sourceImpedancePct: 6, ratedCurrentA: 2500, rmu: 'RMU-1', existing },
      { id: 'MDB-N', name: 'New building MDB', kind: 'MDB', upstreamId: 'SS-LV', ratedCurrentA: 630 }
    ],
    feeders: [feeder('F-N', 'SS-LV', 0, { feedsBoardId: 'MDB-N', lengthM: 120 }), feeder('N-1', 'MDB-N', 270, { cableCsaMm2: 4, parallel: 1, breakerRatingA: 32 }), ...extraFeeders]
  };
}
const others = [{ name: 'Building A', allocatedKva: 500, recordedKva: 300, ref: 'DEWA NOC 123' }, { name: 'Building B', allocatedKva: 400, recordedKva: 450 }];

describe('new building on a shared existing supply', () => {
  it('keeps the higher of allocated and recorded load for each other building', () => {
    const p = shared({ others });
    expect(othersKva(p.boards[0])).toBe(950); // 500 + 450
    expect(existingLoad(p, p.boards[0])).toEqual({ kva: 950, covers: false });
    // The substation carries what is kept for the others plus the new building (≈ 300 kVA at PF 0.9).
    const total = kvaOf(boardTotals(p, 'SS-LV'));
    expect(total).toBeGreaterThan(950 + 290);
    expect(total).toBeLessThan(950 + 310);
  });

  it('with a recorded MD: the higher of the MD and (drawn existing load + what is kept for the others)', () => {
    const low = shared({ recordedKva: 600, others });
    expect(existingLoad(low, low.boards[0])).toEqual({ kva: 950, covers: true }); // allocations above today's reading
    const high = shared({ recordedKva: 1200, others });
    expect(existingLoad(high, high.boards[0])!.kva).toBe(1200);
    // Existing load drawn on the panel adds to what is kept for the others (the MD covers it, so it isn't added twice).
    const drawn = shared({ recordedKva: 600, others }, [feeder('X-1', 'SS-LV', 90, { existing: true, powerFactor: 1 })]);
    expect(existingLoad(drawn, drawn.boards[0])!.kva).toBeCloseTo(950 + 90, 6);
    expect(kvaOf(boardTotals(drawn, 'SS-LV'))).toBeLessThan(950 + 90 + 310); // X-1 is inside the existing load, not on top
  });

  it('without a reading, the existing circuits drawn here still count on top of what is kept', () => {
    const p = shared({ others }, [feeder('X-1', 'SS-LV', 90, { existing: true, powerFactor: 1 })]);
    expect(kvaOf(boardTotals(p, 'SS-LV'))).toBeGreaterThan(950 + 90 + 290);
  });

  it('checks: one row per other building, and the transformer with existing + new', () => {
    const p = shared({ recordedKva: 600, others: [...others, { name: 'Building C' }] });
    const c = existingChecks(p, evaluateProject(p));
    const rows = c.filter((x) => x.kind === 'shared');
    expect(rows.map((x) => [x.item, x.result, x.status])).toEqual([
      ['SS-LV → Building A (other building), DEWA NOC 123', '500 kVA kept', 'ok'],
      ['SS-LV → Building B (other building)', '450 kVA kept', 'ok'],
      ['SS-LV → Building C (other building)', 'Enter its allocated or recorded load', 'warn']
    ]);
    const tx = c.find((x) => x.kind === 'transformer')!;
    expect(tx.value).toMatch(/^950 \+ 30\d = 12\d\d kVA$/);
    expect(tx.status).toBe('bad'); // 80 % of 1500 = 1200 kVA
  });

  it('a new transformer on the existing substation\'s RMU needs a spare T-off way; a third is too many', () => {
    const p = shared({ recordedKva: 600 });
    const withTx = (n: number): Project => ({ ...p, boards: [...p.boards, ...Array.from({ length: n }, (_, i): Board => ({ id: `MDB-T${i + 1}`, name: `New TX ${i + 1}`, kind: 'MDB', sourceKva: 1000, sourceImpedancePct: 6, rmu: 'RMU-1' }))] });
    const one = existingChecks(withTx(1), []).find((x) => x.kind === 'rmu')!;
    expect(one).toMatchObject({ id: 'RMU-1', status: 'warn' });
    expect(one.result).toMatch(/spare T-off way/);
    expect(existingChecks(withTx(2), []).find((x) => x.kind === 'rmu')!.status).toBe('bad');
    expect(existingChecks(p, []).some((x) => x.kind === 'rmu')).toBe(false); // nothing new on the RMU
  });

  it('fed from a neighbouring building\'s main board: its stated fault level sets the fault, not a placeholder', () => {
    const p: Project = {
      name: 'Neighbour', voltageV: 400, frequencyHz: 50, ambientC: 40, vdLimitPct: 4, updatedAt: '',
      boards: [{ id: 'MDB-OLD', name: 'Neighbour MDB', kind: 'MDB', supply: { fedFrom: 'Building A MDB', ratingA: 1600, faultKa: 25 }, existing: { recordedKva: 400, others: [{ name: 'Building A', allocatedKva: 700 }] } },
        { id: 'MDB-N', name: 'New MDB', kind: 'MDB', upstreamId: 'MDB-OLD' }],
      feeders: [feeder('F-N', 'MDB-OLD', 0, { feedsBoardId: 'MDB-N' }), feeder('N-1', 'MDB-N', 100, { cableCsaMm2: 4, parallel: 1, breakerRatingA: 32 })]
    };
    expect(faultCurrentKA(impedanceToBoard(p, 'MDB-OLD'), 400)).toBeCloseTo(25, 6);
    expect(faultCurrentKA(impedanceToBoard(p, 'MDB-N'), 400)).toBeLessThan(25);
    expect(buildDashboard(p, runCalculations(p)).todo.some((t) => /placeholder source impedance/.test(t.text))).toBe(false);
    // The incomer check counts what is kept for Building A.
    const inc = existingChecks(p, evaluateProject(p)).find((x) => x.kind === 'incomer')!;
    expect(inc.value).toMatch(/700 \+ 1\d\d = \d+ kVA/);
  });

  it('editing the shared supply marks the results out of date', () => {
    const a = shared({ others }), b = shared({ others: [{ name: 'Building A', allocatedKva: 800 }] });
    for (const k of ['vd', 'fault', 'checks', 'sizing'] as const) expect(fingerprint(a, k)).not.toBe(fingerprint(b, k));
  });

  it('the Transformer & generator study reports it, and the overload reaches the unresolved checks', () => {
    const p = shared({ recordedKva: 600, others });
    const r = runCalculations(p);
    const s = buildSection('sizing', { project: p, results: r.results, earthing: r.earthing, selectivity: r.selectivity }, scopeOf(p, { boards: [], downstream: true }));
    const t = s.tables.find((x) => x.title === 'Existing installation and shared supply')!;
    expect(t.rows.map((row) => row[0])).toContain('SS-LV → Building B (other building)');
    expect(s.method.some((l) => /shared supply/.test(l))).toBe(true);
    expect(unresolvedChecks([s]).some((u) => /SS-LV transformer/.test(u.item) && u.status === 'bad')).toBe(true);
    const none = shared(undefined);
    const r2 = runCalculations(none);
    expect(buildSection('sizing', { project: none, results: r2.results, earthing: r2.earthing, selectivity: r2.selectivity }, scopeOf(none, { boards: [], downstream: true })).tables.some((x) => x.title === 'Existing installation and shared supply')).toBe(false);
  });
});
