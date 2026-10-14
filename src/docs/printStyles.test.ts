import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { buildReportHtml, PLAIN_CSS, REPORT_CSS } from './report';
import { REPORT_DOC_CSS } from './reportFrame';
import { printDoc } from './printDoc';
import { buildSection, buildStudyReportHtml, scopeOf, STUDIES, type CalcData } from './studyReport';
import { buildReviewDoc, defaultSetup, reviewHtml } from './reviewReport';
import { buildClarificationDoc } from './clarificationReport';
import { PRINT_BASE_CSS, statusSpan } from './printStyles';

const colours = (html: string) => [...new Set(html.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi) ?? [])];
const grey = (h: string) => {
  const x = h.length === 4 ? h.slice(1).split('').map((c) => c + c) : [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)];
  return x.every((c) => c.toLowerCase() === x[0].toLowerCase());
};

describe('shared print styles', () => {
  it('are black and white, with every token filled in', () => {
    for (const css of [PRINT_BASE_CSS, REPORT_CSS, REPORT_DOC_CSS, PLAIN_CSS]) {
      expect(colours(css).filter((c) => !grey(c))).toEqual([]);
      expect(css).not.toContain('${');
    }
  });

  it('boxes a FAIL round the word, not the whole cell', () => {
    expect(statusSpan('FAIL')).toBe('<span class="st">FAIL</span>');
    expect(PRINT_BASE_CSS).toMatch(/\.bad > \.st \{ border:/);
  });
});

describe('reports on the shared print styles', () => {
  const run = runCalculations(sampleProject);
  const data: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
  const scope = scopeOf(run.project, { boards: [], downstream: true });
  const now = new Date('2026-10-15T10:00:00Z');
  const docs: Record<string, string> = {
    'calculation report': buildReportHtml(run.project),
    'study report': buildStudyReportHtml(run.project, scope, STUDIES.map((s) => buildSection(s.key, data, scope)), { title: 'Design report' }, {}, { designBasis: true, results: true, data }),
    'technical review': reviewHtml(buildReviewDoc(run.project, defaultSetup(), { ran: true, stale: [], findings: [] }, now)),
    'clarification': reviewHtml(buildClarificationDoc(run.project, { title: 'Clarification' }, now)),
    'print document': printDoc(run.project, { title: 'T', headRight: 'H', footer: 'F', body: '' })
  };
  for (const [name, html] of Object.entries(docs)) {
    it(`${name}: no colour and no unfilled tokens`, () => {
      expect(colours(html).filter((c) => !grey(c))).toEqual([]);
      expect(html).not.toContain('${');
    });
  }

  it('prints the running header / footer in the report font', () => {
    expect(docs['print document']).toMatch(/@top-right \{ content: [^}]*font: 7\.5pt Arial/);
  });
});
