import { describe, expect, it } from 'vitest';
import { sampleProject } from '../../data/sampleProject';
import { network } from '../../../tests/fixtures/networks';
import { evaluateFeeder } from '../electrical';
import { evaluateEarthing } from '../earthing';
import { selectivityPair } from '../protection';
import { boardTotals } from '../summary';
import { boardPhasePQ } from '../loadSchedule';
import { runCalculations } from '../runs';
import { networkOf, withNetwork } from '.';
import type { Project } from '../../types';

/** The original code path: no run in progress, so no index and no reuse. */
function original(p: Project) {
  const results = p.feeders.map((f) => evaluateFeeder(p, f));
  const earthing = p.feeders.map((f) => evaluateEarthing(p, f));
  const selectivity = p.feeders.filter((f) => f.feedsBoardId).flatMap((up) => p.feeders.filter((f) => f.boardId === up.feedsBoardId).map((down) => selectivityPair(p, up, down)));
  return { results, earthing, selectivity };
}
/** Field-by-field equality, NaN = NaN, numbers to 1e-12 relative (the same arithmetic in the same order should match exactly). */
function same(a: unknown, b: unknown, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) { expect(Number.isNaN(a), path).toBe(Number.isNaN(b)); return; }
    expect(Math.abs(a - b), path).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(a)));
    return;
  }
  if (a && b && typeof a === 'object') {
    expect(Object.keys(b as object).sort(), path).toEqual(Object.keys(a as object).sort());
    for (const k of Object.keys(a as object)) same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    return;
  }
  expect(b, path).toEqual(a);
}
const parity = (p: Project) => {
  const before = original(p);
  const run = runCalculations(p);
  same(before.results, run.results, 'results');
  same(before.earthing, run.earthing, 'earthing');
  same(before.selectivity, run.selectivity, 'selectivity');
};

describe('network index: same results as the original walks', () => {
  it('sample project', () => parity(sampleProject));
  it('generated networks (shallow and deep, capacitor banks, PV, parallel runs, single-phase)', () => {
    parity(network(60, 'shallow'));
    parity(network(60, 'deep'));
  });
  it('a board fed twice and a loop in the board tree: no reuse, original behaviour', () => {
    const p = network(20, 'shallow');
    const twice: Project = { ...p, feeders: [...p.feeders, { ...p.feeders.find((f) => f.feedsBoardId === 'B12')!, id: 'DUP', boardId: 'B3' }] };
    withNetwork(twice, () => expect(networkOf(twice)!.tree).toBe(false));
    parity(twice);
    const loop: Project = { ...p, boards: p.boards.map((b) => (b.id === 'B1' ? { ...b, upstreamId: 'B11' } : b)), feeders: [...p.feeders, { ...p.feeders[0], id: 'LOOP', boardId: 'B11', feedsBoardId: 'B1' }] };
    withNetwork(loop, () => expect(networkOf(loop)!.tree).toBe(false));
    parity(loop);
  });
  it('the index lives only for one run and one project object', () => {
    const p = network(10, 'shallow');
    expect(networkOf(p)).toBeUndefined();
    const totals = boardTotals(p, 'MDB'), pq = boardPhasePQ(p, 'B1'); // original path, outside a run
    withNetwork(p, () => {
      expect(networkOf(p)?.tree).toBe(true);
      expect(networkOf({ ...p })).toBeUndefined(); // an edited copy never sees this run's results
      same(totals, boardTotals(p, 'MDB'));
      same(pq, boardPhasePQ(p, 'B1'));
      expect(boardTotals(p, 'MDB')).toBe(boardTotals(p, 'MDB')); // reused within the run
    });
    expect(networkOf(p)).toBeUndefined();
  });
});
