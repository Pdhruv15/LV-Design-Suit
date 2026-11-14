import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { LIBRARY_KEYS } from '../database/librarySync';
import { addPlanSheets, drawingAreaMm, layoutViewports } from '../docs/planLayout';
import { placeLvPoint } from './cadDevices';
import { viewportScaleN } from './drawingLayouts';
import { arrangementOf, arrangeViewports } from './planViewports';
import { newDrawingLayout } from './drawingLayouts';
import { setOf, type DrawingSheet } from './drawingSet';
import {
  drawingLayoutFromTemplate, LAYOUT_TEMPLATES_KEY, loadLayoutTemplates, parseLayoutTemplate, saveLayoutTemplates, sheetWithTemplate, sizeOfPaper, templateFromPaper, templateFromSheet, withLayoutTemplate, type LayoutTemplate
} from './layoutTemplates';
import { withSetup } from './plotSetup';
import type { Project } from '../types';

const gf = { building: 'V', level: 'GF' };
const villa: Project = {
  ...sampleProject, lvPoints: undefined, cadWiring: undefined, cadSketch: undefined, elvDevices: undefined, drawingSet: undefined, plot: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground floor', kind: 'ground', heightM: 4 }] }], rooms: [{ id: 'r1', buildingId: 'V', levelId: 'GF', name: 'Hall', type: 'lobby', areaM2: 120, outline: [[0, 0], [12, 0], [12, 10], [0, 10]] }] }
};
const plan = () => {
  const p = placeLvPoint(villa, gf, 'ltg', 'DB-GF1-Y1', 6, 5).project;
  const { set, ids } = addPlanSheets(setOf(p), p, 'lighting');
  return { p: { ...p, drawingSet: set }, s: set.sheets.find((x) => x.id === ids[0])! };
};

describe('layout templates', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a plan sheet saved and applied to another sheet gives back its frames, scales and tables', () => {
    const { p, s } = plan();
    const area = drawingAreaMm(p, 'A2');
    const arranged = arrangeViewports([], arrangementOf('KEY')!, [4, 4, area.w - 8, area.h - 22], { at: [6, 5], scale: 100 }, [6, 5]);
    const src: DrawingSheet = { ...s, size: 'A2', scale: '1:100', viewports: arranged, tables: [{ id: 'tb1', kind: 'legend', at: [area.w * 0.8, area.h * 0.4], widthMm: 92, cols: 2, title: 'KEY' }, { id: 'tb2', kind: 'notes', at: [10, 10], widthMm: 120, textMm: 3.5, hidden: ['x'] }] };
    const t = templateFromSheet(p, src, ' Key plan A2 ');
    expect(t).toMatchObject({ name: 'Key plan A2', size: 'A2', paper: [594, 420] });
    expect(t.tables?.[1]).toEqual({ kind: 'notes', at: expect.any(Array), widthMm: 120, textMm: 3.5 });
    const out = sheetWithTemplate(p, { ...s, size: 'auto', viewports: undefined, tables: undefined }, t);
    expect(out.size).toBe('A2');
    expect(out.viewports).toHaveLength(2);
    out.viewports!.forEach((v, i) => {
      v.box.forEach((n, k) => expect(Math.abs(n - arranged[i].box[k])).toBeLessThanOrEqual(0.11));
      expect(v.scale).toBe(arranged[i].scale);
    });
    expect(out.scale).toBe('1:100');
    expect(out.tables?.map((x) => [x.id, x.kind, x.widthMm, x.cols, x.title])).toEqual([['tb1', 'legend', 92, 2, 'KEY'], ['tb2', 'notes', 120, undefined, undefined]]);
    expect(out.tables?.[0].at[0]).toBeCloseTo(area.w * 0.8, 0);
    expect(out.viewports![0].at).toEqual([6, 5]); // centred on the level
  });

  it('keeps the sheet\'s own paper when it has one, and follows a page setup of the template\'s name', () => {
    const { p, s } = plan();
    const t = { ...templateFromSheet(p, s, 'T'), size: 'A1' as const };
    expect(sheetWithTemplate(p, { ...s, size: 'A3' }, t).size).toBe('A3');
    const withPs = withSetup(p, { id: 'ps1', name: 'a2 setup', size: 'A2', scale: 50, plot: {} });
    const r = sheetWithTemplate(withPs, { ...s, size: 'A3' }, { ...t, setup: 'A2 SETUP' });
    expect([r.size, r.plot?.named]).toEqual(['A2', 'ps1']);
    expect(templateFromSheet({ ...withPs, drawingSet: { ...setOf(withPs), sheets: [{ ...s, plot: { named: 'ps1' } }] } }, { ...s, plot: { named: 'ps1' } }, 'U').setup).toBe('a2 setup');
    expect(layoutViewports(p, s)).toHaveLength(1);
  });

  it('a layout of the drawing saved and made again keeps its paper, frames and scales', () => {
    const ext: [number, number, number, number] = [0, 0, 30000, 20000];
    const l = newDrawingLayout('Layout2', ext, 1);
    const t = templateFromPaper('Std', l.paper, l.viewports.map((v) => ({ ...v, scale: viewportScaleN(v, 1) })));
    expect(t.size).toBe('A3');
    const n = drawingLayoutFromTemplate(t, 'Layout5', [0, 0, 60000, 40000], 1);
    expect(n.name).toBe('Layout5');
    expect(n.paper).toEqual(l.paper);
    expect(n.viewports[0]).toMatchObject({ x: 10, y: 10, w: 400, h: 277, cx: 30000, cy: 20000 });
    expect(viewportScaleN(n.viewports[0], 1)).toBe(viewportScaleN(l.viewports[0], 1));
    const fit = drawingLayoutFromTemplate({ ...t, viewports: [{ box: t.viewports[0].box }] }, 'L', [0, 0, 60000, 40000], 1);
    expect(viewportScaleN(fit.viewports[0], 1)).toBe(150);
  });

  it('a plan sheet template on a layout of the drawing stays inside the margin', () => {
    const { p, s } = plan();
    const t = templateFromSheet(p, { ...s, size: 'A3', viewports: arrangeViewports([], arrangementOf('3L')!, [4, 4, 200, 200], { at: [0, 0], scale: 100 }) }, 'T');
    const l = drawingLayoutFromTemplate(t, 'L', [0, 0, 12, 10], 1000);
    for (const v of l.viewports) { expect(v.x).toBeGreaterThanOrEqual(10 - 0.1); expect(v.y).toBeGreaterThanOrEqual(10 - 0.1); expect(v.x + v.w).toBeLessThanOrEqual(410.1); expect(v.y + v.h).toBeLessThanOrEqual(287.1); }
  });

  it('reads a template from a file: refuses junk, repairs a missing id and size, drops bad viewports and tables', () => {
    expect([null, 5, {}, { name: ' ', paper: [1, 1], viewports: [] }, { name: 'x', paper: [0, 1], viewports: [] }, { name: 'x', paper: [1, 1] }].map(parseLayoutTemplate)).toEqual(Array(6).fill(undefined));
    const t = parseLayoutTemplate({ name: ' T ', paper: [841, 594], viewports: [{ box: [0, 0, 1, 1], scale: 100, frame: true }, { box: [0, 0, 0, 1] }, { box: 'x' }, null], tables: [{ kind: 'legend', at: [0.1, 0.2], widthMm: 92 }, { kind: 'x', at: [0, 0], widthMm: 1 }] })!;
    expect(t.name).toBe('T');
    expect(t.id).toMatch(/^lt-/);
    expect(t.size).toBe('A1');
    expect(t.viewports).toEqual([{ box: [0, 0, 1, 1], scale: 100, frame: true }]);
    expect(t.tables).toHaveLength(1);
    expect(sizeOfPaper([420, 297])).toBe('A3');
    expect(sizeOfPaper([297, 420])).toBe('A3 portrait');
    expect(sizeOfPaper([594, 841])).toBe('A1'); // other portrait papers: the landscape size
    expect(sizeOfPaper([500, 300])).toBe('A2');
  });

  it('a saved name replaces the same name in any case, keeps the id, and the list stays sorted', () => {
    const mk = (id: string, name: string): LayoutTemplate => ({ id, name, savedAt: 'x', paper: [420, 297], size: 'A3', viewports: [] });
    const list = withLayoutTemplate([mk('a', 'Zed'), mk('b', 'Alpha')], { ...mk('new', ' zed '), size: 'A1' });
    expect(list.map((t) => [t.id, t.name, t.size])).toEqual([['b', 'Alpha', 'A3'], ['a', 'zed', 'A1']]);
  });

  it('is kept in the library and loaded back from this computer\'s copy', () => {
    expect(LIBRARY_KEYS).toContain('lvds.layoutTemplates');
    expect(LIBRARY_KEYS).toContain('lvds.pageSetups');
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(loadLayoutTemplates()).toEqual([]);
    const t = templateFromPaper('B', [420, 297], [{ x: 10, y: 10, w: 400, h: 277 }]);
    expect(saveLayoutTemplates([t, templateFromPaper('A', [841, 594], [])])).toBe(true);
    expect(store.has(LAYOUT_TEMPLATES_KEY)).toBe(true);
    expect(loadLayoutTemplates().map((x) => x.name)).toEqual(['A', 'B']);
    store.set(LAYOUT_TEMPLATES_KEY, '{bad');
    expect(loadLayoutTemplates()).toEqual([]);
  });
});
