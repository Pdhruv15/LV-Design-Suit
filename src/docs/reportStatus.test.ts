import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { buildSection, buildStudyReportHtml, scopeOf, type CalcData } from './studyReport';
import { validateReport } from './reportValidation';
import { unresolvedChecks } from './issuePackage';
import type { FeederResult } from '../calc/electrical';

/** Status traceability: calculation result → row → section → contents → pre-export check → issue package. */
const run = runCalculations(sampleProject);
const base: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
const scope = scopeOf(run.project, { boards: [], downstream: true });
const pass = (r: FeederResult): FeederResult => ({ ...r, protectionStatus: 'ok', ampacityStatus: 'ok', vdStatus: 'ok', icuStatus: 'ok' });
const withResults = (f: (r: FeederResult) => FeederResult): CalcData => ({ ...base, results: base.results.map(f) });

describe('report statuses follow every check', () => {
  it('an Icu failure fails the cable section everywhere (H1)', () => {
    const target = scope.feeders[0].id;
    const data = withResults((r) => (r.feeder.id === target ? { ...pass(r), icuStatus: 'bad' } : pass(r)));
    const s = buildSection('cable', data, scope);
    expect(s.statuses).toContain('bad');
    expect(s.summary[0].status).toBe('bad');
    expect(s.verification!.rows.some((r) => r.some((c) => typeof c === 'object' && c.s === 'bad'))).toBe(true);
    const html = buildStudyReportHtml(run.project, scope, [s], { title: 'T' });
    expect(html).toMatch(/<td class="bad">\d+ pass · \d+ warning · 1 fail<\/td>/);
    const v = validateReport({ project: run.project, meta: { title: 'T' }, scope, sections: [s], data, stale: [], designBasis: false, resultsSummary: false });
    expect(v.some((x) => x.level === 'error' && /Cable and breaker sizing: 1 check/.test(x.message))).toBe(true);
    expect(unresolvedChecks([s]).some((u) => u.item.startsWith(target) && u.status === 'bad')).toBe(true);
  });

  it('the short-circuit section checks final circuits too (H2)', () => {
    expect(scope.finals.length).toBeGreaterThan(0);
    const target = scope.finals[0].id;
    const data = withResults((r) => (r.feeder.id === target ? { ...pass(r), icuStatus: 'bad' } : pass(r)));
    const s = buildSection('sc', data, scope);
    expect(s.statuses.filter((x) => x === 'bad')).toHaveLength(1);
    const table = s.tables.find((t) => t.title === 'Breaker breaking capacity')!;
    expect(table.rows.some((r) => r[0] === target)).toBe(true);
    expect(unresolvedChecks([s]).some((u) => u.item.startsWith(target))).toBe(true);
  });

  it('the busbar verification shows one real governing breaker (M1)', () => {
    const board = scope.boards.find((b) => [...scope.feeders, ...scope.finals].filter((f) => f.boardId === b.id).length >= 2)!;
    const [a, b] = base.results.filter((r) => r.feeder.boardId === board.id);
    // a: lowest Icu but small fault; b: highest fault but large Icu. The governing one has the smaller Icu ÷ Ik″.
    const data = withResults((r) => r.feeder.id === a.feeder.id ? { ...r, breakerFaultKA: 5, feeder: { ...r.feeder, breakerIcuKa: 10 } }
      : r.feeder.id === b.feeder.id ? { ...r, breakerFaultKA: 40, feeder: { ...r.feeder, breakerIcuKa: 50 } } : r.feeder.boardId === board.id ? { ...r, breakerFaultKA: 1, feeder: { ...r.feeder, breakerIcuKa: 100 } } : r);
    const row = buildSection('sc', data, scope).verification!.rows.find((r) => r[0] === board.id)!;
    expect(row.slice(2, 6)).toEqual([b.feeder.id, 40, 50, 10]);
  });
});
