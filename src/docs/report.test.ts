import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { buildReportHtml } from './report';

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

  it('lists at most 10 items needing attention and counts the rest', () => {
    const p = { ...sampleProject, vdLimitPct: 0.01 };
    const html = buildReportHtml(p);
    const n = Number(html.match(/Needs attention \((\d+)\)/)?.[1]);
    expect(n).toBeGreaterThan(10);
    expect(html).toContain(`…and ${n - 10} more`);
  });

  it('has a page-numbered running header and footer', () => {
    const html = buildReportHtml(sampleProject);
    expect(html).toContain('counter(pages)');
    expect(html).toContain('Calculation report');
  });
});
