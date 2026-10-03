import { describe, expect, it } from 'vitest';
import { disconnectionLabel, earthLoopPath, evaluateEarthing, loopFigures } from './earthing';
import { buildReportHtml } from '../docs/report';
import type { Board, Feeder, Project } from '../types';

const F = (over: Partial<Feeder> = {}): Feeder => ({
  id: 'F', boardId: 'MDB', name: 'F', loadKw: 5, demandFactor: 1, powerFactor: 0.9, lengthM: 50, cableCsaMm2: 4, cores: 4, breakerRatingA: 32, breakerIcuKa: 36, ...over
});
const P = (boards: Board[], feeders: Feeder[]): Project => ({ name: 'T', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards, feeders });

describe('ENG-019 earthing: missing source loop is unknown, not zero', () => {
  it('missing source: Ze unknown, If only an upper bound, not ok', () => {
    const f = F();
    const r = evaluateEarthing(P([{ id: 'MDB', name: 'M' }], [f]), f);
    expect(r.sourceMissing).toMatch(/no source data at MDB/);
    expect(r.zsOhm).toBeCloseTo(0.553218302, 6); // cable only (a minimum)
    expect(r.faultA).toBeCloseTo(396.576002, 4); // a maximum
    expect(r.disconnection).toBe('warn'); // was ok
    expect(r.adiabatic).toBe('warn');
    expect(r.status).not.toBe('ok');
    expect(disconnectionLabel(r)).toMatch(/Not verified/);
    expect(loopFigures(r)).toEqual({ ze: 'unknown', zs: '≥ 0.5532', fault: '≤ 397' });
    // why: 0.5 Ω more in the source would already drop If below the 320 A magnetic trip
    expect((0.95 * (400 / Math.sqrt(3))) / Math.hypot(0.5 + 0.5532, 0.0045)).toBeLessThan(320);
  });

  it('known source unchanged: 1,000 kVA / 5 %', () => {
    const f = F();
    const r = evaluateEarthing(P([{ id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 }], [f]), f);
    expect(r.sourceMissing).toBeUndefined();
    expect(r.zeOhm).toBeCloseTo(0.008, 6);
    expect(r.zsOhm).toBeCloseTo(0.554906258, 6);
    expect(r.faultA).toBeCloseTo(395.369667, 4);
    expect(r.disconnection).toBe('ok');
  });

  it('missing board, missing incomer and a cyclic path are all incomplete', () => {
    const src = { id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 };
    expect(earthLoopPath(P([src], []), 'NOPE').missing).toMatch(/not found/);
    const broken = P([src, { id: 'SUB', name: 'S', upstreamId: 'MDB' }], []);
    const pb = earthLoopPath(broken, 'SUB');
    expect(pb.missing).toMatch(/no incomer feeder from MDB to SUB/);
    expect(pb.z.r).toBeGreaterThan(0); // the transformer part is kept, not dropped
    const cyc = P([{ id: 'A', name: 'A', upstreamId: 'B' }, { id: 'B', name: 'B', upstreamId: 'A' }],
      [F({ id: 'AB', boardId: 'B', feedsBoardId: 'A' }), F({ id: 'BA', boardId: 'A', feedsBoardId: 'B' })]);
    expect(earthLoopPath(cyc, 'A').missing).toMatch(/loops back/);
    const f = F({ boardId: 'SUB' });
    expect(evaluateEarthing({ ...broken, feeders: [f] }, f).status).not.toBe('ok');
  });

  it('zero-length cable with no source: no Infinity, no pass', () => {
    const f = F({ lengthM: 0 });
    const r = evaluateEarthing(P([{ id: 'MDB', name: 'M' }], [f]), f);
    expect(r.faultA).toBeNaN();
    expect(r.disconnection).toBe('warn');
    expect(loopFigures(r).fault).toBe('—');
  });

  it('incomplete loop can still prove a failure (more impedance only lowers If)', () => {
    const f = F({ lengthM: 200 }); // cable alone already below 320 A on a 0.4 s circuit
    const r = evaluateEarthing(P([{ id: 'MDB', name: 'M' }], [f]), f);
    expect(r.faultA).toBeLessThan(320);
    expect(r.disconnection).toBe('bad');
  });

  it('report shows the missing-data warning and does not count it as a pass', () => {
    const f = F();
    const html = buildReportHtml(P([{ id: 'MDB', name: 'M' }], [f]));
    expect(html).toContain('Not verified — no source data at MDB');
    expect(html).toContain('≤ 397');
  });
});
