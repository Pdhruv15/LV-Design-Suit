import { describe, expect, it } from 'vitest';
import { dxfExportProject } from '../../tests/fixtures/dxfExport';
import { buildSldSheetHtml } from '../docs/sldSheet';
import {
  cloudPoints, dragHandle, markupBounds, markupDxf, markupFromDrag, markupHandles, markupLayerHtml, markupSvg, MARKUP_LAYERS, moveMarkup, type SheetMarkup
} from './sheetMarkup';
import { sheetHash, type DrawingSet, type DrawingSheet } from './drawingSet';

const cloud: SheetMarkup = { id: 'c1', kind: 'cloud', x: 20, y: 30, w: 60, h: 40, rev: 'B' };
const callout: SheetMarkup = { id: 'k1', kind: 'callout', x: 100, y: 50, x2: 60, y2: 60, text: 'Add 2 no. pits\nRefer E-ERT-001' };

describe('sheet markups', () => {
  it('draws a closed scalloped cloud that stays outside the box, with its revision triangle', () => {
    const pts = cloudPoints(20, 30, 60, 40);
    expect(pts.length).toBeGreaterThan(40);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(20 - 3); expect(Math.max(...xs)).toBeLessThanOrEqual(80 + 3);
    expect(Math.min(...ys)).toBeLessThan(30); expect(Math.max(...ys)).toBeGreaterThan(70); // bumps go outward
    expect(markupSvg(cloud)).toContain('>B</text>');
    expect(markupSvg({ ...cloud, rev: undefined })).not.toContain('<text');
  });

  it('escapes text and keeps every line of a note', () => {
    const svg = markupSvg({ id: 't', kind: 'text', x: 10, y: 10, text: 'A < B & "C"\nsecond line', color: 'blue' });
    expect(svg).toContain('A &lt; B &amp; &quot;C&quot;');
    expect(svg).toContain('second line');
    expect(svg).toContain('#0050c8');
  });

  it('draws a callout as a boxed note with a leader and arrowhead to its target', () => {
    const b = markupBounds(callout);
    expect(b.x).toBeLessThanOrEqual(60); expect(b.x + b.w).toBeGreaterThanOrEqual(100); // spans text and target
    expect((markupSvg(callout).match(/<polyline/g) ?? []).length).toBe(3); // box, leader, arrowhead
  });

  it('creates markups from drags and ignores accidental clicks', () => {
    expect(markupFromDrag('cloud', [10, 10], [12, 12])).toBeUndefined();
    expect(markupFromDrag('line', [10, 10], [10.5, 10])).toBeUndefined();
    const m = markupFromDrag('cloud', [80, 70], [20, 30], { rev: 'A' })!;
    expect(m).toMatchObject({ x: 20, y: 30, w: 60, h: 40, rev: 'A' });
    const c = markupFromDrag('callout', [60, 60], [100, 50])!; // pressed on the target, released at the text
    expect(c).toMatchObject({ x: 100, y: 50, x2: 60, y2: 60 });
  });

  it('moves and resizes: a callout pointer stays on its target, a line moves whole', () => {
    expect(moveMarkup(callout, 5, -5)).toMatchObject({ x: 105, y: 45, x2: 60, y2: 60 });
    expect(moveMarkup({ id: 'l', kind: 'line', x: 0, y: 0, x2: 10, y2: 5 }, 3, 3)).toMatchObject({ x: 3, y: 3, x2: 13, y2: 8 });
    expect(markupHandles(cloud)).toEqual([{ id: 'se', x: 80, y: 70 }]);
    expect(dragHandle(cloud, 'se', 100, 90)).toMatchObject({ w: 80, h: 60 });
    expect(dragHandle(cloud, 'se', 21, 31)).toMatchObject({ w: 4, h: 4 }); // never collapses
    expect(dragHandle(callout, 'target', 10, 20)).toMatchObject({ x2: 10, y2: 20, x: 100 });
  });

  it('exports to DXF on markup layers in paper mm, y up, inside the sheet', () => {
    const items = markupDxf([cloud, callout, { id: 'a', kind: 'arrow', x: 5, y: 5, x2: 40, y2: 5, color: 'black' }], 297);
    const layers = new Set(items.map((i) => i.layer));
    expect(layers).toEqual(new Set(['E-MARKUP', 'E-MARKUP-BLACK']));
    for (const l of layers) expect(Object.keys(MARKUP_LAYERS)).toContain(l);
    const texts = items.filter((i) => i.type === 'text');
    expect(texts.map((t) => t.type === 'text' && t.text)).toEqual(expect.arrayContaining(['B', 'Add 2 no. pits', 'Refer E-ERT-001']));
    const t = texts.find((x) => x.type === 'text' && x.text === 'Add 2 no. pits');
    expect(t && t.type === 'text' && t.y).toBeCloseTo(297 - 50, 5); // y flipped to CAD
    for (const i of items) if (i.type === 'polyline') for (const [x, y] of i.points) { expect(x).toBeGreaterThan(0); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(297); }
  });

  it('prints on the sheet PDF only when there are markups', () => {
    const svg = '<svg viewBox="0 0 400 160"><line x1="0" y1="0" x2="10" y2="10"/></svg>';
    const base = { no: 'E-SLD-001', title: 'SLD', count: 1, index: 1 };
    const without = buildSldSheetHtml(dxfExportProject, svg, 'A3', base);
    const withIt = buildSldSheetHtml(dxfExportProject, svg, 'A3', { ...base, markups: [cloud] });
    expect(without).not.toContain('class="markup"');
    expect(withIt).toContain('class="markup"');
    expect(withIt).toContain('viewBox="0 0 420 297"');
    expect(markupLayerHtml([], 420, 297)).toBe('');
  });

  it('counts as a change since the sheet was issued', () => {
    const s: DrawingSheet = { id: 's1', number: 'E-SLD-001', title: 'SLD', kind: 'system', boards: [dxfExportProject.boards[0].id], size: 'auto' };
    const set: DrawingSet = { prefix: 'E-SLD-', sheets: [s] };
    expect(sheetHash(dxfExportProject, set, s)).not.toBe(sheetHash(dxfExportProject, set, { ...s, markups: [cloud] }));
  });
});
