import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { evaluateFeeder } from './electrical';
import { failReasons, quickFixes } from './quickFix';

describe('quick fixes', () => {
  it('offers nothing for a passing circuit', () => {
    const f = sampleProject.feeders.find((x) => evaluateFeeder(sampleProject, x).status === 'ok')!;
    expect(quickFixes(sampleProject, f)).toEqual([]);
  });
  it('fixes an undersized cable, and every fix is checked', () => {
    const base = sampleProject.feeders.find((x) => !x.feedsBoardId && evaluateFeeder(sampleProject, x).status === 'ok')!;
    const f = { ...base, cableCsaMm2: 1.5, lengthM: 120 };
    const r = evaluateFeeder(sampleProject, f);
    expect(r.status).not.toBe('ok');
    expect(failReasons(sampleProject, r).length).toBeGreaterThan(0);
    const fixes = quickFixes(sampleProject, f);
    expect(fixes.length).toBeGreaterThan(0);
    for (const x of fixes) expect(evaluateFeeder(sampleProject, { ...f, ...x.patch }).status).not.toBe('bad');
  });
});

describe('quick fixes: unprotected cable', () => {
  it('offers a smaller breaker between Ib and Iz', () => {
    const base = sampleProject.feeders.find((x) => !x.feedsBoardId && evaluateFeeder(sampleProject, x).status === 'ok' && x.breakerRatingA >= 63)!;
    const r0 = evaluateFeeder(sampleProject, base);
    const f = { ...base, breakerRatingA: 1000 };
    const fixes = quickFixes(sampleProject, f);
    const brk = fixes.find((x) => x.label.startsWith('Breaker') && !x.label.includes('cable'));
    expect(brk).toBeDefined();
    expect(brk!.patch.breakerRatingA!).toBeGreaterThanOrEqual(r0.ib);
  });
});
