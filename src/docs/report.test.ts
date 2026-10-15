import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { buildReportHtml, calcReportSections, CALC_REPORT_STUDIES } from './calcReport';
import { runCalculations } from '../calc/runs';
import { buildSection, scopeOf, tableHtml } from './studyReport';

describe('calculation report page 1', () => {
  it('is black and white: no coloured text or fills', () => {
    const html = buildReportHtml(sampleProject);
    const colours = [...new Set(html.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi) ?? [])];
    const grey = (h: string) => { const x = h.length === 4 ? h.slice(1).split('').map((c) => c + c) : [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)]; return x.every((c) => c.toLowerCase() === x[0].toLowerCase()); };
    expect(colours.filter((c) => !grey(c))).toEqual([]);
  });

  it('leaves unset document fields blank for signing and fills set ones', () => {
    const blank = buildReportHtml({ ...sampleProject, params: undefined, calcReportDocNo: undefined });
    expect(blank.match(/class="sig"/g)?.length).toBeGreaterThanOrEqual(4);
    const set = buildReportHtml({ ...sampleProject, calcReportDocNo: 'CR-001', params: { designedBy: 'A. Engineer', checkedBy: 'B. Checker', approvedBy: 'C. Approver' } });
    for (const v of ['CR-001', 'A. Engineer', 'B. Checker', 'C. Approver']) expect(set).toContain(v);
  });

  it('shows 10 items needing attention on page 1 and lists every one after the summary', () => {
    const p = { ...sampleProject, vdLimitPct: 0.01 };
    const html = buildReportHtml(p);
    const n = Number(html.match(/Needs attention \((\d+)\)/)?.[1]);
    expect(n).toBeGreaterThan(10);
    expect(html).toContain(`…and ${n - 10} more`);
    // Nothing left out: the full list has one row per unresolved check, each with its status.
    const all = html.match(/<h2>Items needing attention \(all (\d+)\)<\/h2>\s*<table[\s\S]*?<\/table>/);
    expect(Number(all?.[1])).toBe(n);
    expect(all![0].match(/<tr><td class="(bad|warn)">/g)).toHaveLength(n);
    expect(all![0].match(/<tbody>[\s\S]*<\/tbody>/)![0]).not.toMatch(/>PASS</);
  });

  it('has a page-numbered running header and footer', () => {
    const html = buildReportHtml(sampleProject);
    expect(html).toContain('counter(pages)');
    expect(html).toContain('Calculation report');
  });
});

describe('calculation report and study report: one source', () => {
  // Phase 2 exit criterion: the same inputs give the same figures in every report route.
  const p = { ...sampleProject, vdLimitPct: 1 }; // some fails, so statuses are compared too
  const run = runCalculations(p);
  const data = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
  const scope = scopeOf(run.project, { boards: [], downstream: true });

  it('builds each section exactly as the study report does', () => {
    expect(calcReportSections(p)).toEqual(CALC_REPORT_STUDIES.map((k) => buildSection(k, data, scope)));
  });

  it('prints every study-report table unchanged', () => {
    const html = buildReportHtml(p);
    for (const k of CALC_REPORT_STUDIES) for (const t of buildSection(k, data, scope).tables) expect(html).toContain(tableHtml(t));
  });
});
