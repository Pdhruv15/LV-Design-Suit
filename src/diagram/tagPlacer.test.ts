import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { sampleProject } from '../data/sampleProject';
import { applyTransformers, planTransformers, setRmu } from '../model/transformers';
import { earthingDrawing } from './earthingDrawing';
import { obstaclesFromSvg, placeTags, type Box } from './tagPlacer';

const hit = (a: Box, b: Box) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

describe('cable tags placed clear of the drawing', () => {
  it('reads lines, outlines, filled boxes and text as obstacles', () => {
    const o = obstaclesFromSvg('<path d="M10 10 V50 H40"/><rect x="100" y="0" width="20" height="10" fill="none"/><rect x="0" y="100" width="20" height="10" fill="#fff"/><text x="200" y="20" font-size="10">ABC</text>');
    expect(o.some((b) => hit(b, { x1: 9, y1: 30, x2: 11, y2: 31 }))).toBe(true); // on the vertical run
    expect(o.some((b) => hit(b, { x1: 109, y1: 4, x2: 111, y2: 6 }))).toBe(false); // inside an outline is free
    expect(o.some((b) => hit(b, { x1: 9, y1: 104, x2: 11, y2: 106 }))).toBe(true); // inside a filled box is not
    expect(o.some((b) => hit(b, { x1: 205, y1: 14, x2: 207, y2: 16 }))).toBe(true); // over the text
  });

  it('moves a tag off a blocked spot, and two tags never overlap', () => {
    const blocked: Box[] = [{ x1: 0, y1: 0, x2: 400, y2: 95 }]; // everything above y 95
    const [a, b] = placeTags([{ x: 50, y0: 60, y1: 200, text: '1C 70 mm² Cu/PVC G/Y' }, { x: 52, y0: 60, y1: 200, text: '1C 70 mm² Cu/PVC G/Y' }], blocked);
    for (const t of [a, b]) { expect(t.clear).toBe(true); expect(t.box.y1).toBeGreaterThan(95); }
    expect(hit(a.box, b.box)).toBe(false);
  });

  it('earthing schematics: no tag box touches a line, symbol, text or another tag', () => {
    const empty: Project = { ...sampleProject, boards: [], feeders: [], ties: [] };
    let big = applyTransformers(sampleProject, planTransformers(sampleProject, Array.from({ length: 9 }, () => ({ kva: 1500 })), false, 2));
    big = setRmu(big, 'MDB-1', 'RMU-5');
    const cases = [sampleProject, applyTransformers(empty, planTransformers(empty, [{ kva: 1500 }, { kva: 1500 }, { kva: 1000 }, { kva: 1000 }], false, 2)), big];
    for (const p of cases) {
      // The working view: the schematic only (no legend or schedule, which are drawn in their own groups).
      const svg = earthingDrawing(p, undefined, false, { working: true }).svg;
      const tagSvg = [...svg.matchAll(/<g class="ctag">.*?<\/g>/g)].map((m) => m[0]);
      expect(tagSvg.length).toBeGreaterThan(0);
      const rest = obstaclesFromSvg(svg.replace(/<g class="ctag">.*?<\/g>/g, ''));
      const boxes = tagSvg.map((t) => { const r = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/.exec(t)!.slice(1).map(Number); return { x1: r[0], y1: r[1], x2: r[0] + r[2], y2: r[1] + r[3] }; });
      boxes.forEach((b, i) => {
        // The page background rect (from the sheet's corner) covers everything; skip it.
        expect(rest.filter((o) => !(o.x1 < 0 && o.y1 < 0) && hit(b, o))).toEqual([]);
        boxes.forEach((c, j) => { if (j !== i) expect(hit(b, c)).toBe(false); });
      });
    }
  });
});
