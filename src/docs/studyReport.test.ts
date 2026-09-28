import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { boardSummary } from '../calc/summary';
import { buildSection, buildStudyReportHtml, buildStudyWorkbook, drawingProject, scopeOf, scopeText, STUDIES, type CalcData } from './studyReport';

const run = runCalculations(sampleProject);
const data: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
const sub = sampleProject.boards.find((b) => b.upstreamId && sampleProject.boards.some((c) => c.upstreamId === b.id))!; // a board with sub-boards

describe('study reports for part of the network', () => {
  it('scope: nothing ticked = whole installation; a board with or without what is below it', () => {
    expect(scopeOf(sampleProject, { boards: [], downstream: true }).all).toBe(true);
    const down = scopeOf(sampleProject, { boards: [sub.id], downstream: true });
    const below = sampleProject.boards.filter((b) => b.upstreamId === sub.id).map((b) => b.id);
    expect([...down.ids].sort()).toEqual([sub.id, ...below].sort());
    expect(down.roots.map((b) => b.id)).toEqual([sub.id]);
    expect(down.incomers.map((f) => f.feedsBoardId)).toEqual([sub.id]);
    const only = scopeOf(sampleProject, { boards: [sub.id], downstream: false });
    expect([...only.ids]).toEqual([sub.id]);
    expect(scopeText(sampleProject, down)).toContain(`${sub.id} and downstream`);
    expect(only.feeders.every((f) => f.boardId === sub.id && !f.phase)).toBe(true);
  });

  it('results come from the whole network: a sub-board keeps its real fault level and voltage', () => {
    const scope = scopeOf(sampleProject, { boards: [sub.id], downstream: false });
    const sc = buildSection('sc', data, scope);
    const busbars = sc.tables[0];
    expect(busbars.rows.map((r) => r[0])).toEqual([sub.id]);
    expect(busbars.rows[0][4]).toBe(Number(boardSummary(sampleProject, sub).faultKA.toFixed(1)));
    // Breakers: the incomer and the board's own circuits.
    const breakers = sc.tables[1].rows.map((r) => String(r[0]));
    expect(breakers[0]).toContain('(incomer)');
    expect(breakers.length).toBe(1 + scope.feeders.length);
    const lf = buildSection('lf', data, scope);
    expect(lf.tables[0].rows[0][9]).toBe(Number(boardSummary(sampleProject, sub).voltagePct.toFixed(2)));
  });

  it('every study builds for any scope', () => {
    for (const boards of [[], [sub.id]]) {
      const scope = scopeOf(sampleProject, { boards, downstream: true });
      for (const s of STUDIES) {
        const sec = buildSection(s.key, data, scope);
        expect(sec.title).toBe(s.title);
        expect(sec.tables.length).toBeGreaterThan(0);
      }
    }
    const whole = buildSection('earth', data, scopeOf(sampleProject, { boards: [], downstream: true }));
    expect(whole.tables[0].rows.length).toBe(run.earthing.length); // final circuits included
  });

  it('the drawing holds only the scope; its top board still names its supply', () => {
    const scope = scopeOf(sampleProject, { boards: [sub.id], downstream: true });
    const d = drawingProject(sampleProject, scope);
    expect(d.boards.map((b) => b.id).sort()).toEqual([...scope.ids].sort());
    expect(d.feeders.every((f) => scope.ids.has(f.boardId))).toBe(true);
    expect(d.boards.find((b) => b.id === sub.id)!.upstreamId).toBe(sub.upstreamId);
  });

  it('PDF: cover, a section per study, an A3 SLD page when drawn; Excel: a sheet per study', () => {
    const scope = scopeOf(sampleProject, { boards: [sub.id], downstream: true });
    const sections = [buildSection('sc', data, scope), buildSection('lf', data, scope)];
    const html = buildStudyReportHtml(sampleProject, scope, sections, { title: 'Short circuit and load flow', docNo: 'E-CALC-003' }, { sc: '<svg id="x"></svg>' });
    expect(html).toContain('Short circuit and load flow');
    expect(html).toContain('E-CALC-003');
    expect(html).toContain('1. Short circuit study');
    expect(html).toContain('2. Load flow and voltage drop study');
    expect(html.match(/class="sld"/g)).toHaveLength(1);
    expect(html).toContain('@page sld { size: A3 landscape');
    const wb = buildStudyWorkbook(sampleProject, scope, sections, { title: 'x' });
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Cover', 'Short circuit', 'Load flow & voltage drop']);
  });
});
