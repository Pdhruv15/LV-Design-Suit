import { describe, expect, it } from 'vitest';
import { sizeForm4 } from '../calc/form4';
import { form4Drawing, form4DrawingSvg, form4Dxf } from './form4Drawing';

const counts = { D: 1, I: 2, O: 1, Q: 1, T: 2, U: 4, V: 6, X: 4 };
const r = sizeForm4(counts);

describe('Form-4 front and plan drawing', () => {
  const items = form4Drawing(counts, r, 'Test MDB');
  const rects = items.filter((p) => p.type === 'polyline' && p.layer === 'F4-OUTLINE');

  it('draws every line-up part in the front view and the plan view, plus the plinth', () => {
    expect(rects).toHaveLength(r.parts.length * 2 + 1);
    const plan = rects.filter((p) => p.type === 'polyline' && p.points[0][1] < 0);
    expect(plan).toHaveLength(r.parts.length);
    for (const p of plan) if (p.type === 'polyline') expect(p.points[2][1] - p.points[0][1]).toBe(800);
  });

  it('dimensions the full size, and the plan chain dimensions add up to the width', () => {
    const texts = items.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : ''));
    expect(texts).toEqual(expect.arrayContaining(['W 5200', 'H 2100', 'D 800', '100 PLINTH', 'FRONT VIEW', 'PLAN VIEW', 'FRONT']));
    const chain = items.filter((p) => p.type === 'text' && p.layer === 'F4-DIM' && /^\d+$/.test(p.text)).map((p) => (p.type === 'text' ? Number(p.text) : 0));
    expect(chain.reduce((a, b) => a + b, 0)).toBe(5200);
  });

  it('writes an R12 DXF in millimetres with the Form-4 layers', () => {
    const dxf = form4Dxf(counts, r, 'Test MDB');
    expect(dxf).toContain('AC1009');
    for (const l of ['F4-OUTLINE', 'F4-DEVICE', 'F4-CHAMBER', 'F4-DIM', 'F4-TEXT']) expect(dxf).toContain(`\r\n${l}\r\n`);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).toContain('W 5200');
  });

  it('nothing to draw for an empty board', () => {
    expect(form4Drawing({}, sizeForm4({}))).toEqual([]);
    expect(form4DrawingSvg({}, sizeForm4({}))).toBe('');
  });

  it('the PDF version is black and white', () => {
    const svg = form4DrawingSvg(counts, r, true);
    expect(svg).not.toContain('var(--acc)');
    expect(svg).toContain('PLAN VIEW');
  });
});
