import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM script without type declarations
import { advisoriesOf, allowlistProblems, evaluate, MAX_DAYS_AHEAD } from '../../scripts/check-audit.mjs';

type Entry = { id: string; package: string; scope: 'prod' | 'dev'; reason: string; expires: string };
const TODAY = '2026-10-19';
const REASON = 'Not reachable: only v4() is called, without a buffer.';
const advisory = (id: string, pkg: string, severity = 'moderate') => ({ source: 1, name: pkg, title: `${pkg} issue`, url: `https://github.com/advisories/${id}`, severity, range: '*' });
/** An npm audit --json (v2) report with the given advisories, each under its package (and a dependent naming it). */
const report = (...advs: ReturnType<typeof advisory>[]) => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries(advs.flatMap((a) => [[a.name, { name: a.name, severity: a.severity, via: [a] }], [`uses-${a.name}`, { name: `uses-${a.name}`, severity: a.severity, via: [a.name] }]])),
  metadata: {}
});
const entry = (e: Partial<Entry> & { id: string }): Entry => ({ package: 'pkg', scope: 'prod', reason: REASON, expires: '2026-11-30', ...e });
const UUID = 'GHSA-w5hq-g745-h8pq', SPRINTF = 'GHSA-hp3w-g68c-fv3c', OTHER = 'GHSA-xxxx-xxxx-xxxx'.replace(/x/g, 'c');

describe('dependency audit allowlist', () => {
  it('reads each advisory once from an npm audit report', () => {
    expect(advisoriesOf(report(advisory(UUID, 'uuid')))).toEqual([{ id: UUID, package: 'uuid', severity: 'moderate', title: 'uuid issue', url: `https://github.com/advisories/${UUID}` }]);
    expect(() => advisoriesOf({ error: { summary: 'offline' } })).toThrow(/not an npm audit/);
  });

  it('passes a clean audit and when every advisory is allowlisted in time', () => {
    expect(evaluate({ prod: report(), full: report(), allowlist: { advisories: [] }, today: TODAY })).toEqual({ errors: [], warnings: [], found: 0 });
    const r = evaluate({ prod: report(advisory(UUID, 'uuid')), full: report(advisory(UUID, 'uuid'), advisory(SPRINTF, 'sprintf-js')), allowlist: { advisories: [entry({ id: UUID, package: 'uuid' }), entry({ id: SPRINTF, package: 'sprintf-js', scope: 'dev' })] }, today: TODAY });
    expect(r).toEqual({ errors: [], warnings: [], found: 2 });
  });

  it('fails on an advisory that is not allowlisted, at any severity', () => {
    for (const sev of ['low', 'moderate', 'high', 'critical']) {
      const r = evaluate({ prod: report(), full: report(advisory(OTHER, 'left-pad', sev)), allowlist: { advisories: [] }, today: TODAY });
      expect(r.errors, sev).toEqual([expect.stringMatching(new RegExp(`^Not in the allowlist: ${OTHER} \\(left-pad, ${sev}\\) in build / test tooling`))]);
    }
  });

  it('fails when a tooling-only entry turns up in the shipped packages', () => {
    const r = evaluate({ prod: report(advisory(SPRINTF, 'sprintf-js')), full: report(advisory(SPRINTF, 'sprintf-js')), allowlist: { advisories: [entry({ id: SPRINTF, package: 'sprintf-js', scope: 'dev' })] }, today: TODAY });
    expect(r.errors).toEqual([expect.stringMatching(/^Allowlisted for tooling only, but in the shipped packages/)]);
  });

  it('fails after an entry expires, and warns about entries that match nothing', () => {
    const allowlist = { advisories: [entry({ id: UUID, package: 'uuid', expires: '2026-11-30' })] };
    expect(evaluate({ prod: report(advisory(UUID, 'uuid')), full: report(advisory(UUID, 'uuid')), allowlist, today: '2026-11-30' }).errors).toEqual([]);
    expect(evaluate({ prod: report(advisory(UUID, 'uuid')), full: report(advisory(UUID, 'uuid')), allowlist, today: '2026-12-01' }).errors).toEqual([expect.stringMatching(/^Allowlist entry expired on 2026-11-30/)]);
    expect(evaluate({ prod: report(), full: report(), allowlist, today: TODAY })).toEqual({ errors: [], warnings: [`Allowlist entry ${UUID} (uuid) matches nothing any more — remove it.`], found: 0 });
  });

  it('refuses malformed entries and expiries too far ahead', () => {
    const limit = new Date(Date.parse(TODAY) + MAX_DAYS_AHEAD * 86400000).toISOString().slice(0, 10);
    expect(allowlistProblems({ advisories: [entry({ id: UUID, expires: limit })] }, TODAY)).toEqual([]);
    const problems = allowlistProblems({ advisories: [
      entry({ id: 'CVE-2026-1' }),
      entry({ id: UUID, scope: 'everywhere' as 'prod' }),
      entry({ id: SPRINTF, reason: 'ok' }),
      entry({ id: OTHER, expires: '2027-06-01' }),
      entry({ id: OTHER })
    ] }, TODAY);
    expect(problems).toEqual([
      expect.stringMatching(/"id" must be a GHSA id/),
      expect.stringMatching(/"scope" must be/),
      expect.stringMatching(/"reason" must explain/),
      expect.stringMatching(/more than 92 days ahead/),
      expect.stringMatching(/listed twice/)
    ]);
    expect(allowlistProblems({}, TODAY)).toEqual(['the allowlist has no "advisories" list']);
  });

  it('keeps the checked-in allowlist valid', () => {
    const allowlist = JSON.parse(readFileSync(new URL('../../security/audit-allowlist.json', import.meta.url), 'utf8'));
    expect(allowlistProblems(allowlist, TODAY)).toEqual([]);
  });
});
