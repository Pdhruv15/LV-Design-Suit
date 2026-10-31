import { describe, expect, it } from 'vitest';
import { sampleProject } from '../../data/sampleProject';
import { network } from '../../../tests/fixtures/networks';
import { evaluateFeeder, upstreamVoltageDropPct } from '../electrical';
import { evaluateEarthing } from '../earthing';
import { selectivityPair } from '../protection';
import { boardSummary, boardsInSupplyOrder, boardTotals } from '../summary';
import { REFERENCE_CABLE_TABLE, setCables } from '../cableTable';
import { setBreakerLists } from '../sizing';
import { subtree } from '../pfc';
import { runCalculations } from '../runs';
import { setCatalog, EMPTY_CATALOG } from '../../database/catalog';
import { applyDatabase, EMPTY_DATABASE } from '../../database/database';
import { panelSummary } from '../../docs/mdSheet';
import { cableSchedule } from '../../docs/schedules';
import { cableRefOf, withCableRefs } from '../../model/cableRefs';
import { needsFireRated } from '../../model/cableTypes';
import { withEarthPitIds } from '../../model/earthingPlan';
import { roleOf } from '../../model/emergency';
import { networkOf, withNetwork, withoutNetwork } from '.';
import type { Project } from '../../types';

/** The original code path: no index and no reuse. */
const original = (p: Project) => withoutNetwork(() => {
  const results = p.feeders.map((f) => evaluateFeeder(p, f));
  const earthing = p.feeders.map((f) => evaluateEarthing(p, f));
  const selectivity = p.feeders.filter((f) => f.feedsBoardId).flatMap((up) => p.feeders.filter((f) => f.boardId === up.feedsBoardId).map((down) => selectivityPair(p, up, down)));
  return { results, earthing, selectivity };
});
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
/** What screens and reports read, worked out from the project. */
const outputs = (p: Project) => ({
  order: boardsInSupplyOrder(p).map((b) => b.id),
  summaries: p.boards.map((b) => boardSummary(p, b)),
  panels: p.boards.map((b) => panelSummary(p, b)),
  roles: p.boards.map((b) => roleOf(p, b)),
  fireRated: p.feeders.map((f) => needsFireRated(p, f)),
  refs: p.feeders.map((f) => cableRefOf(p, f)),
  numbered: withCableRefs(withEarthPitIds(p)),
  schedule: cableSchedule(p)
});
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
    for (const q of [twice, loop]) same(withoutNetwork(() => outputs(q)), outputs(q), 'outputs');
  });
  it('what screens and reports read', () => {
    for (const q of [sampleProject, network(20, 'shallow'), network(20, 'deep')]) same(withoutNetwork(() => outputs(q)), outputs(q), 'outputs');
  });
  it('the boards below a board: the same boards as growing the set over every circuit', () => {
    const grown = (p: Project, id: string) => {
      const out = new Set([id]);
      for (let grew = true; grew;) {
        grew = false;
        for (const f of p.feeders) if (f.feedsBoardId && out.has(f.boardId) && !out.has(f.feedsBoardId)) { out.add(f.feedsBoardId); grew = true; }
      }
      return [...out].sort();
    };
    const p = network(20, 'deep');
    const looped: Project = { ...p, feeders: [...p.feeders, { ...p.feeders[0], id: 'LOOP', boardId: 'B3', feedsBoardId: 'MDB' }] };
    for (const q of [sampleProject, p, looped]) for (const b of q.boards) expect([...subtree(q, b.id)].sort()).toEqual(grown(q, b.id));
  });
});

describe('network index: kept per project object', () => {
  it('reuses results for the same object; an edited copy never sees them', () => {
    const p = network(10, 'shallow');
    expect(networkOf(p)?.tree).toBe(true);
    expect(networkOf(p)).toBe(networkOf(p));
    expect(boardTotals(p, 'MDB')).toBe(boardTotals(p, 'MDB'));
    const edited: Project = { ...p, feeders: p.feeders.map((f) => (f.id === 'MDB-C1' ? { ...f, loadKw: f.loadKw + 10 } : f)) };
    expect(networkOf(edited)).not.toBe(networkOf(p));
    expect(boardTotals(edited, 'MDB').connectedKw).toBeCloseTo(boardTotals(p, 'MDB').connectedKw + 10);
  });
  it('keeps only the last four objects; reading one keeps it', () => {
    const p = network(5, 'shallow');
    const ix = networkOf(p);
    for (let i = 0; i < 3; i++) networkOf({ ...p });
    expect(networkOf(p)).toBe(ix);
    for (let i = 0; i < 3; i++) networkOf({ ...p });
    expect(networkOf(p)).toBe(ix);
    for (let i = 0; i < 4; i++) networkOf({ ...p });
    expect(networkOf(p)).not.toBe(ix);
  });
  it('a run holds on to its index while it reads other objects', () => {
    const p = network(5, 'shallow');
    withNetwork(p, () => {
      const ix = networkOf(p);
      for (let i = 0; i < 8; i++) networkOf({ ...p });
      expect(networkOf(p)).toBe(ix);
    });
  });
  it('withoutNetwork runs the original walks and leaves the index alone', () => {
    const p = network(5, 'shallow');
    const ix = networkOf(p);
    withoutNetwork(() => expect(networkOf(p)).toBeUndefined());
    expect(networkOf(p)).toBe(ix);
  });
  it('new cable data recalculates the same project object', () => {
    const p = network(10, 'shallow');
    const before = upstreamVoltageDropPct(p, 'B1');
    try {
      setCables(REFERENCE_CABLE_TABLE.map((c) => ({ ...c, rOhmPerKm20C: c.rOhmPerKm20C * 2 })));
      expect(upstreamVoltageDropPct(p, 'B1')).toBeGreaterThan(before);
    } finally { setCables(null); }
    expect(upstreamVoltageDropPct(p, 'B1')).toBe(before);
  });
  it('new breakers, catalogue or database forget every index', () => {
    const p = network(5, 'shallow');
    for (const change of [() => setBreakerLists(null, null), () => setCatalog(EMPTY_CATALOG), () => applyDatabase(EMPTY_DATABASE)]) {
      const ix = networkOf(p);
      change();
      expect(networkOf(p)).not.toBe(ix);
    }
  });
});
