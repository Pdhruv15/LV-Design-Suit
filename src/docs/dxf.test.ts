import { describe, expect, it } from 'vitest';
import { titleBlockDxf, toDxf, type DxfPrimitive } from './dxf';

type Tag = { code: number; value: string };
const tags = (dxf: string): Tag[] => {
  const lines = dxf.split(/\r?\n/);
  const out: Tag[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push({ code: Number(lines[i]), value: lines[i + 1] });
  return out;
};
const records = (dxf: string, section?: string): Tag[][] => {
  let input = tags(dxf);
  if (section) {
    const start = input.findIndex((tag, i) => tag.code === 0 && tag.value === 'SECTION' && input[i + 1]?.value === section);
    const end = input.findIndex((tag, i) => i > start && tag.code === 0 && tag.value === 'ENDSEC');
    input = input.slice(start + 2, end);
  }
  const out: Tag[][] = [];
  for (const tag of input) {
    if (tag.code === 0) out.push([]);
    if (out.length) out[out.length - 1].push(tag);
  }
  return out;
};
const value = (record: Tag[], code: number) => record.find((tag) => tag.code === code)?.value;
const number = (record: Tag[], code: number) => Number(value(record, code));
const solidCorners = (record: Tag[]) => [0, 1, 2, 3].map((j) => [number(record, 10 + j), number(record, 20 + j)]);
const extents = (dxf: string, name: '$EXTMIN' | '$EXTMAX') => {
  const headerEnd = dxf.indexOf('\r\n0\r\nENDSEC');
  const input = tags(headerEnd < 0 ? dxf : dxf.slice(0, headerEnd));
  const start = input.findIndex((tag) => tag.code === 9 && tag.value === name);
  return [Number(input[start + 1].value), Number(input[start + 2].value)];
};

describe('R12 DXF geometry and text widths', () => {
  it('defines the standard SHX font and keeps the R12 format', () => {
    const dxf = toDxf([{ type: 'text', layer: 'TEXT', x: 0, y: 0, height: 4, text: 'MDB' }]);
    const input = tags(dxf);
    const version = input.findIndex((tag) => tag.value === '$ACADVER');
    expect(input[version + 1]).toEqual({ code: 1, value: 'AC1009' });
    const style = records(dxf, 'TABLES').find((record) => value(record, 0) === 'STYLE');
    expect(style).toBeDefined();
    expect(value(style!, 2)).toBe('STANDARD');
    expect(value(style!, 3)).toBe('txt.shx');
    expect(number(style!, 40)).toBe(0); // variable text height
    expect(number(style!, 41)).toBe(1);
    const text = records(dxf, 'ENTITIES')[0];
    expect(value(text, 7)).toBe('STANDARD');
    expect(input.some((tag) => tag.code === 370 || tag.value === 'LWPOLYLINE')).toBe(false);
  });

  it('gives a busbar physical drawing width using an R12 filled SOLID', () => {
    const dxf = toDxf([
      { type: 'line', layer: 'BUSBAR', x1: 0, y1: 0, x2: 100, y2: 0, width: 4 },
      { type: 'line', layer: 'CABLE', x1: 20, y1: 0, x2: 20, y2: 1 }
    ]);
    const entities = records(dxf, 'ENTITIES');
    expect(entities.map((record) => value(record, 0))).toEqual(['SOLID', 'LINE']);
    expect(value(entities[0], 8)).toBe('BUSBAR');
    expect(solidCorners(entities[0])).toEqual([[0, 2], [100, 2], [0, -2], [100, -2]]);
    expect([number(entities[1], 11), number(entities[1], 21)]).toEqual([20, 1]);
    expect(extents(dxf, '$EXTMIN')).toEqual([0, -2]);
    expect(extents(dxf, '$EXTMAX')).toEqual([100, 2]);
    const layer = records(dxf, 'TABLES').find((record) => value(record, 0) === 'LAYER' && value(record, 2) === 'BUSBAR');
    expect(number(layer!, 62)).toBe(1); // red remains assigned by layer
    const input = tags(dxf);
    const fill = input.findIndex((tag) => tag.value === '$FILLMODE');
    expect(input[fill + 1]).toEqual({ code: 70, value: '1' });
  });

  it('uses the correct SOLID corner ordering for a vertical busbar', () => {
    const dxf = toDxf([{ type: 'line', layer: 'BUSBAR', x1: 0, y1: 0, x2: 0, y2: 10, width: 4 }]);
    expect(solidCorners(records(dxf, 'ENTITIES')[0])).toEqual([[-2, 0], [-2, 10], [2, 0], [2, 10]]);
    expect(extents(dxf, '$EXTMIN')).toEqual([-2, 0]);
    expect(extents(dxf, '$EXTMAX')).toEqual([2, 10]);
  });

  it('preserves uniform perpendicular width on a diagonal busbar', () => {
    const dxf = toDxf([{ type: 'line', layer: 'BUSBAR', x1: 0, y1: 0, x2: 10, y2: 10, width: 2 }]);
    const corners = solidCorners(records(dxf, 'ENTITIES')[0]);
    expect(corners).toEqual([[-0.7071, 0.7071], [9.2929, 10.7071], [0.7071, -0.7071], [10.7071, 9.2929]]);
    expect(Math.hypot(corners[0][0] - corners[2][0], corners[0][1] - corners[2][1])).toBeCloseTo(2, 3);
    expect(extents(dxf, '$EXTMIN')).toEqual([-0.7071, -0.7071]);
    expect(extents(dxf, '$EXTMAX')).toEqual([10.7071, 10.7071]);
  });

  it('joins two wide segments using shared miter corners without duplicate centre lines', () => {
    const dxf = toDxf([{ type: 'polyline', layer: 'BUSBAR', width: 2, points: [[0, 0], [10, 0], [10, 10]] }]);
    const entities = records(dxf, 'ENTITIES');
    expect(entities.map((record) => value(record, 0))).toEqual(['SOLID', 'SOLID']);
    expect(solidCorners(entities[0])).toEqual([[0, 1], [9, 1], [0, -1], [11, -1]]);
    expect(solidCorners(entities[1])).toEqual([[9, 1], [9, 10], [11, -1], [11, 10]]);
    expect(extents(dxf, '$EXTMIN')).toEqual([0, -1]);
    expect(extents(dxf, '$EXTMAX')).toEqual([11, 10]);
  });

  it('closes a wide rectangular path with shared first and last miter corners', () => {
    const dxf = toDxf([{ type: 'polyline', layer: 'BUSBAR', width: 2, closed: true, points: [[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]] }]);
    const entities = records(dxf, 'ENTITIES');
    expect(entities.map((record) => value(record, 0))).toEqual(['SOLID', 'SOLID', 'SOLID', 'SOLID']);
    expect(solidCorners(entities[0])).toEqual([[1, 1], [9, 1], [-1, -1], [11, -1]]);
    expect(solidCorners(entities[3])).toEqual([[1, 4], [1, 1], [-1, 6], [-1, -1]]);
    expect(extents(dxf, '$EXTMIN')).toEqual([-1, -1]);
    expect(extents(dxf, '$EXTMAX')).toEqual([11, 6]);
  });

  it('bevels a sharp turn instead of creating an unbounded projecting miter', () => {
    const dxf = toDxf([{ type: 'polyline', layer: 'BUSBAR', width: 2, points: [[0, 0], [10, 0], [0, 2]] }]);
    const entities = records(dxf, 'ENTITIES');
    expect(entities.map((record) => value(record, 0))).toEqual(['SOLID', 'SOLID', 'SOLID']);
    const bevel = solidCorners(entities[2]);
    expect(bevel[0]).toEqual([10, 0]);
    expect(bevel[1]).toEqual([10, -1]);
    expect(bevel[2]).toEqual(bevel[3]); // valid three-point SOLID
    expect(extents(dxf, '$EXTMAX')).toEqual([10.1961, 2.9806]);
    expect(dxf).not.toMatch(/NaN|Infinity/);
  });

  it('omits zero-length wide geometry and safely removes repeated vertices', () => {
    const empty = toDxf([
      { type: 'line', layer: 'BUSBAR', x1: 3, y1: 4, x2: 3, y2: 4, width: 2 },
      { type: 'polyline', layer: 'BUSBAR', width: 2, points: [[3, 4], [3, 4]] }
    ]);
    expect(records(empty, 'ENTITIES')).toHaveLength(0);
    expect(extents(empty, '$EXTMIN')).toEqual([0, 0]);
    expect(extents(empty, '$EXTMAX')).toEqual([0, 0]);
    const dxf = toDxf([{ type: 'polyline', layer: 'BUSBAR', width: 2, points: [[0, 0], [0, 0], [10, 0], [10, 0], [10, 10]] }]);
    expect(records(dxf, 'ENTITIES')).toHaveLength(2);
    expect(dxf).not.toMatch(/NaN|Infinity/);
  });

  it('handles a nearly reversing path and a two-point closed path without invalid strips', () => {
    const reverse = toDxf([{ type: 'polyline', layer: 'BUSBAR', width: 2, points: [[0, 0], [10, 0], [0, 1e-10]] }]);
    expect(records(reverse, 'ENTITIES')).toHaveLength(2);
    expect(extents(reverse, '$EXTMAX')).toEqual([10, 1]);
    expect(reverse).not.toMatch(/NaN|Infinity/);
    const two = toDxf([{ type: 'polyline', layer: 'BUSBAR', width: 2, closed: true, points: [[0, 0], [10, 0]] }]);
    expect(records(two, 'ENTITIES')).toHaveLength(1);
  });

  it('keeps a zero-width closed polyline as an editable polyline', () => {
    const dxf = toDxf([{ type: 'polyline', layer: 'FRAME', width: 0, closed: true, points: [[0, 0], [10, 0], [10, 5]] }]);
    const entities = records(dxf, 'ENTITIES');
    expect(entities.map((record) => value(record, 0))).toEqual(['POLYLINE', 'VERTEX', 'VERTEX', 'VERTEX', 'SEQEND']);
    expect(number(entities[0], 70)).toBe(1);
  });

  it.each([
    ['left', 100, 140], ['center', 80, 120], ['right', 60, 100]
  ] as const)('fits %s-anchored cable text to the target width without altering height', (align, start, end) => {
    const dxf = toDxf([{ type: 'text', layer: 'TEXT', x: 100, y: 20, height: 7, width: 40, align, text: '4C x 10mm2' }]);
    const text = records(dxf, 'ENTITIES')[0];
    expect(number(text, 72)).toBe(5);
    expect(number(text, 73)).toBe(0);
    expect(number(text, 40)).toBe(7);
    expect(number(text, 10)).toBe(start);
    expect(number(text, 11)).toBe(end);
    expect([number(text, 20), number(text, 21)]).toEqual([20, 20]);
    expect(value(text, 1)).toBe('4C x 10mm2');
    expect(extents(dxf, '$EXTMIN')).toEqual([start, 18.25]);
    expect(extents(dxf, '$EXTMAX')).toEqual([end, 27]);
  });

  it('rotates both fitted baseline endpoints about the original right anchor', () => {
    const dxf = toDxf([{ type: 'text', layer: 'TEXT', x: 30, y: 70, height: 4, width: 20, rotation: 90, align: 'right', text: 'Cable' }]);
    const text = records(dxf, 'ENTITIES')[0];
    expect([number(text, 10), number(text, 20)]).toEqual([30, 50]);
    expect([number(text, 11), number(text, 21)]).toEqual([30, 70]);
    expect(number(text, 50)).toBe(90);
    expect(number(text, 40)).toBe(4);
    expect(extents(dxf, '$EXTMIN')).toEqual([26, 50]);
    expect(extents(dxf, '$EXTMAX')).toEqual([31, 70]);
  });

  it('keeps the centre anchor and true drawing-unit width at an oblique rotation', () => {
    const dxf = toDxf([{ type: 'text', layer: 'TEXT', x: 0, y: 0, height: 3, width: 12, rotation: 30, align: 'center', text: 'Feeder' }]);
    const text = records(dxf, 'ENTITIES')[0];
    const start = [number(text, 10), number(text, 20)], end = [number(text, 11), number(text, 21)];
    expect(start[0] + end[0]).toBeCloseTo(0, 4);
    expect(start[1] + end[1]).toBeCloseTo(0, 4);
    expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeCloseTo(12, 3);
    expect(start[1]).toBe(-3);
    expect(end[1]).toBe(3);
    expect(number(text, 50)).toBe(30);
  });

  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('retains legacy alignment when width is %s', (width) => {
    const dxf = toDxf([
      { type: 'line', layer: 'CABLE', x1: 0, y1: 0, x2: 40, y2: 0, width },
      { type: 'text', layer: 'TEXT', x: 20, y: 10, height: 4, width, align: 'center', text: 'DB' }
    ]);
    const [line, text] = records(dxf, 'ENTITIES');
    expect(value(line, 0)).toBe('LINE');
    expect(number(text, 72)).toBe(1);
    expect(value(text, 73)).toBeUndefined();
    expect([number(text, 10), number(text, 20), number(text, 11), number(text, 21)]).toEqual([20, 10, 20, 10]);
    expect(extents(dxf, '$EXTMIN')).toEqual([0, 0]);
    expect(extents(dxf, '$EXTMAX')).toEqual([40, 10]);
    expect(dxf).not.toMatch(/NaN|Infinity/);
  });

  it('caps overflowing manual title cells while keeping short labels unstretched', () => {
    const title = 'Distribution board installation and electrical single line diagram'.repeat(2);
    const items = titleBlockDxf(240, 0, 240, [[['Project', title], ['Rev', 'A']], [['Title', 'SLD']]]);
    const texts = items.filter((item): item is Extract<DxfPrimitive, { type: 'text' }> => item.type === 'text');
    const long = texts.find((item) => item.text === title)!;
    expect(long.width).toBeCloseTo(115.2);
    expect(long.x + long.width!).toBeLessThanOrEqual(120);
    expect(long.text).toBe(title); // no lost project information
    for (const text of texts.filter((item) => item !== long)) expect(text.width).toBeUndefined();
    const output = records(toDxf(items), 'ENTITIES');
    const fitted = output.find((record) => value(record, 1) === title)!;
    expect(number(fitted, 72)).toBe(5);
    expect(number(fitted, 11) - number(fitted, 10)).toBeCloseTo(115.2);
  });

  it('exports many fitted labels without exceeding the JavaScript argument limit', () => {
    // Each fitted label contributes four bounds points. The resulting 160,000
    // coordinates exceed V8's spread-argument limit on supported runtimes.
    const items: DxfPrimitive[] = Array.from({ length: 40_000 }, (_, j) => ({
      type: 'text', layer: 'TEXT', x: j * 10, y: j % 2 ? 100 : -100,
      height: 4, width: 6, align: 'center', text: `DB-${j + 1}`
    }));
    const dxf = toDxf(items);
    expect(extents(dxf, '$EXTMIN')).toEqual([-3, -101]);
    expect(extents(dxf, '$EXTMAX')).toEqual([399_993, 104]);
    expect(dxf).toContain('DB-40000');
    expect(dxf.endsWith('0\r\nEOF\r\n')).toBe(true);
  });

  it('exports a polyline with more vertices than a function can receive as arguments', () => {
    const points: [number, number][] = Array.from({ length: 160_000 }, (_, j) => [j - 50, j % 3 - 1]);
    const dxf = toDxf([{ type: 'polyline', layer: 'SYMBOL', points }]);
    expect(extents(dxf, '$EXTMIN')).toEqual([-50, -1]);
    expect(extents(dxf, '$EXTMAX')).toEqual([159_949, 1]);
    expect(dxf).toContain('10\r\n159949\r\n20\r\n-1\r\n30\r\n0\r\n0\r\nSEQEND');
  });
});
