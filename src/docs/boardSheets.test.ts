import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { boardsInSupplyOrder } from '../calc/summary';
import { boardSheetSvg } from '../diagram/boardSheet';
import { earthSheetNo } from '../model/boardEarth';
import { onSld } from '../model/sldScope';
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
  it('stops at final circuits: one box refers to the schedule, the circuit table still lists every way', () => {
    const own = run.project.feeders.filter((x) => x.boardId === 'DB-GF1');
    const { svg } = boardSheetSvg(run.project, board('DB-GF1'), run.results);
    expect(svg).toContain('FINAL CIRCUITS');
    expect(svg).toContain('REFER DB LOAD');
    expect(svg).toContain(`${own.filter((f) => !onSld(f)).length} WAYS`);
    expect(svg.match(/data-dxf-layer="BUSBAR"/g)).toHaveLength(1);
  });
  it('wraps a long busbar onto more rows instead of one very wide drawing', () => {
    // Every way a dedicated equipment feeder, so each is drawn.
    const project = { ...run.project, feeders: run.project.feeders.map((f) => (f.boardId === 'DB-GF1' ? { ...f, breakerRatingA: 32 } : f)) };
    const many = project.feeders.filter((x) => x.boardId === 'DB-GF1').length;
    expect(many).toBeGreaterThan(12);
    const { svg, w } = boardSheetSvg(project, board('DB-GF1'), run.results);
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
    expect(pages[0].info.no).toBe('E-DB-001');
    expect(pages[1].info.no).toBe('E-DB-002');
    expect(pages.every((p, i) => p.info.index === i + 1 && p.info.count === pages.length)).toBe(true);
    const gf1 = pages.find((p) => p.boardId === 'DB-GF1')!, up = pages.find((p) => p.boardId === 'SMDB-GF')!;
    expect(gf1.svg).toContain(`SHEET ${up.info.no}`);
    // Own prefix from the drawing set, with its digits and suffix.
    const set = { prefix: 'E-SLD-', sheets: [], register: true, dbPrefix: 'DB-', digits: 2, suffix: '-EL' };
    const numbered = boardSheetPages({ ...run.project, drawingSet: set }, run.results, ['MCC-1']);
    expect(numbered).toHaveLength(1);
    expect(numbered[0].info.no).toMatch(/^DB-\d\d-EL$/);
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
