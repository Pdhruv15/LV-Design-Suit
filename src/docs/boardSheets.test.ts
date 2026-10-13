import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { boardsInSupplyOrder } from '../calc/summary';
import { boardSheetSvg } from '../diagram/boardSheet';
import { earthSheetNo } from '../model/boardEarth';
import { boardSheetHtml, boardSheetPages } from './boardSheets';
import { buildSheetDxfPages } from './sheetDxf';

const run = runCalculations(sampleProject);
const board = (id: string) => run.project.boards.find((b) => b.id === id)!;

describe('board sheet drawing', () => {
  it('is black and white: no colour anywhere in the drawing', () => {
    for (const b of run.project.boards) {
      const { svg } = boardSheetSvg(run.project, b, run.results);
      const colours = new Set([...svg.matchAll(/(?:stroke|fill)="([^"]+)"/g)].map((m) => m[1]));
      expect([...colours].every((c) => c === '#000' || c === 'none')).toBe(true);
    }
  });
  it('shows the supply, every circuit with its reference and phase, and the panel summary', () => {
    const { svg } = boardSheetSvg(run.project, board('DB-GF1'), run.results, { fromSheet: 'E-SLD-02' });
    expect(svg).toContain('FROM SMDB-GF (SHEET E-SLD-02)');
    for (const f of run.project.feeders.filter((x) => x.boardId === 'DB-GF1')) expect(svg).toContain(`>${f.id.replace('DB-GF1-', '')}<`);
    expect(svg).toContain('PH R');
    for (const t of ['PANEL SUMMARY', 'TCL / DF / MDL', 'R / Y / B LOAD', 'NEUTRAL CURRENT', 'CURRENT UNBALANCE', 'EARTH', 'CIRCUITS', 'TOTAL']) expect(svg).toContain(t);
  });
  it('wraps a long busbar onto more rows instead of one very wide drawing', () => {
    const many = run.project.feeders.filter((x) => x.boardId === 'DB-GF1').length;
    expect(many).toBeGreaterThan(12);
    const { svg, w } = boardSheetSvg(run.project, board('DB-GF1'), run.results);
    expect(svg).toContain('BUSBAR (CONTINUED)');
    expect(w).toBeLessThan(2200);
  });
  it('a main board starts at its transformer', () => {
    const { svg } = boardSheetSvg(run.project, board('MDB-1'), run.results);
    expect(svg).toMatch(/TRANSFORMER \d+ kVA/);
    expect(svg).toContain('MDB-1 MET → pits');
    expect(svg).toContain(`Earthing schematic: sheet ${earthSheetNo(run.project)}`);
  });
});

describe('board sheet set', () => {
  const pages = boardSheetPages(run.project, run.results);
  it('has one sheet per board in supply order, numbered from the SLD drawing number, each pointing to its supply', () => {
    expect(pages.map((p) => p.boardId)).toEqual(boardsInSupplyOrder(run.project).map((b) => b.id));
    expect(pages[0].info.no).toBe('E-SLD-01');
    expect(pages.every((p, i) => p.info.index === i + 1 && p.info.count === pages.length)).toBe(true);
    const gf1 = pages.find((p) => p.boardId === 'DB-GF1')!, up = pages.find((p) => p.boardId === 'SMDB-GF')!;
    expect(gf1.svg).toContain(`SHEET ${up.info.no}`);
    const numbered = boardSheetPages({ ...run.project, drawing: { ...run.project.drawing, number: 'E-100' } }, run.results, ['MCC-1']);
    expect(numbered).toHaveLength(1);
    expect(numbered[0].info.no).toMatch(/^E-100-\d\d$/);
  });
  it('prints on the drawing sheet with the title block', () => {
    const html = boardSheetHtml(run.project, pages[1]);
    expect(html).toContain(pages[1].info.no);
    expect(html).toContain(`${pages[1].boardId} SINGLE LINE DIAGRAM`);
    expect(html).toContain('class="tb"');
  });
  describe('DXF', () => {
    beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));
    afterAll(() => vi.unstubAllGlobals());
    it('every board sheet converts to an A3 DXF with its text', () => {
      for (const p of pages) {
        const dxf = buildSheetDxfPages(run.project, p.svg, 'A3', p.info);
        expect(dxf.length).toBeGreaterThan(0);
        expect(dxf[0].data).toContain('PANEL SUMMARY');
        expect(dxf[0].data).toContain(p.boardId);
      }
    });
  });
});
