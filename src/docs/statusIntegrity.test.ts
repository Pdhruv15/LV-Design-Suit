import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { printDocs } from '../../tests/fixtures/printDocs';
import { calcReportData } from './calcReport';
import { validateReport } from './reportValidation';

/** No failed or unverified result is shown as PASS or left out (PDF plan, Phase 4 exit criterion).
 * DB-EV gets installation method C, for which the built-in cable data has no rating: Iz is unknown,
 * so every check that needs Iz is DATA REQUIRED and the circuit cannot pass overall. */
const ID = 'DB-EV';
const p = { ...sampleProject, feeders: sampleProject.feeders.map((f) => (f.id === ID ? { ...f, installMethod: 'C' as const } : f)) };
const docs = printDocs(p);

/** Each printed row of a table whose first cell is the circuit (or its cable tag), with the table's headings. */
function rowsOf(html: string, id: string): { head: string[]; cells: string[] }[] {
  const out: { head: string[]; cells: string[] }[] = [];
  for (const [t] of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const head = [...(t.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    for (const [r] of t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
      if (cells.some((c) => c === id || c === `C-${id}`) && head.length) out.push({ head, cells });
    }
  }
  return out;
}

describe('status integrity: a circuit without a cable rating', () => {
  for (const name of ['calculation-report', 'study-report', 'cable-schedule']) {
    it(`${name}: never PASS where the result needs the rating`, () => {
      const rows = rowsOf(docs[name], ID).filter((r) => r.head.some((h) => /^Iz/.test(h)));
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const at = (re: RegExp) => r.cells[r.head.findIndex((h) => re.test(h))];
        if (r.head.some((h) => /Ib ≤ In ≤ Iz/.test(h))) expect(at(/Ib ≤ In ≤ Iz/)).toBe('DATA REQUIRED');
        const overall = at(/^(Result|Status)$/);
        expect(overall).toBeDefined();
        expect(overall).not.toBe('PASS');
      }
    });
  }

  it('is listed as needing attention in the calculation report and the issue package', () => {
    expect(docs['calculation-report']).toMatch(new RegExp(`${ID}[\\s\\S]{0,400}?DATA REQUIRED|DATA REQUIRED[\\s\\S]{0,400}?${ID}`));
    expect(rowsOf(docs['issue-package-cover'], ID).some((r) => r.cells.includes('DATA REQUIRED'))).toBe(true);
  });

  it('is an error in the pre-export check', () => {
    const { data, scope, sections } = calcReportData(p);
    const issues = validateReport({ project: p, meta: { title: 'T' }, scope, sections, data, stale: [], designBasis: false, resultsSummary: false });
    expect(issues.some((x) => x.level === 'error' && x.area === 'Cable data required' && x.message.includes(ID))).toBe(true);
  });
});
