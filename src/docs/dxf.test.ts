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

  it('gives a busbar physical drawing width using an R12 two-vertex polyline', () => {
    const dxf = toDxf([
      { type: 'line', layer: 'BUSBAR', x1: 0, y1: 0, x2: 100, y2: 0, width: 4 },
      { type: 'line', layer: 'CABLE', x1: 20, y1: 0, x2: 20, y2: 1 }
    ]);
    const entities = records(dxf, 'ENTITIES');
    expect(entities.map((record) => value(record, 0))).toEqual(['POLYLINE', 'VERTEX', 'VERTEX', 'SEQEND', 'LINE']);
    expect(value(entities[0], 8)).toBe('BUSBAR');
    expect(number(entities[0], 40)).toBe(4);
    expect(number(entities[0], 41)).toBe(4);
    expect(number(entities[0], 70)).toBe(0);
    expect([number(entities[1], 10), number(entities[1], 20)]).toEqual([0, 0]);
    expect([number(entities[2], 10), number(entities[2], 20)]).toEqual([100, 0]);
    expect([number(entities[4], 11), number(entities[4], 21)]).toEqual([20, 1]);
    expect(extents(dxf, '$EXTMIN')).toEqual([-2, -2]);
    expect(extents(dxf, '$EXTMAX')).toEqual([102, 2]);
    const input = tags(dxf);
    const fill = input.findIndex((tag) => tag.value === '$FILLMODE');
    expect(input[fill + 1]).toEqual({ code: 70, value: '1' });
  });

  it('keeps width and closure on an existing multi-segment polyline', () => {
    const dxf = toDxf([{ type: 'polyline', layer: 'BUSBAR', width: 2, closed: true, points: [[0, 0], [10, 0], [10, 5]] }]);
    const entities = records(dxf, 'ENTITIES');
    expect(number(entities[0], 70)).toBe(1);
    expect(number(entities[0], 40)).toBe(2);
    expect(number(entities[0], 41)).toBe(2);
    expect(entities.filter((record) => value(record, 0) === 'VERTEX').map((record) => [number(record, 10), number(record, 20)])).toEqual([[0, 0], [10, 0], [10, 5]]);
    const min = extents(dxf, '$EXTMIN'), max = extents(dxf, '$EXTMAX');
    expect(min[0]).toBeLessThanOrEqual(-1);
    expect(min[1]).toBeLessThanOrEqual(-1);
    expect(max[0]).toBeGreaterThanOrEqual(11);
    expect(max[1]).toBeGreaterThanOrEqual(6);
  });

  it('includes the projecting miter of an acute wide polyline join in its extents', () => {
    const dxf = toDxf([{ type: 'polyline', layer: 'BUSBAR', width: 2, points: [[0, 0], [10, 0], [0, 2]] }]);
    // A half-width-only envelope ends at x=11; the acute join projects farther.
    expect(extents(dxf, '$EXTMAX')[0]).toBeCloseTo(20.099, 3);
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
