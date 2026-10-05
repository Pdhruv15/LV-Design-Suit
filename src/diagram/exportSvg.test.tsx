import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { renderToStaticMarkup } from 'react-dom/server';
import SystemDiagram from '../components/SystemDiagram';
import { svgToDxf } from './exportSvg';
import { toDxf, type DxfPrimitive } from '../docs/dxf';
import { buildSheetDxf } from '../docs/sheetDxf';
import { dxfExportProject } from '../../tests/fixtures/dxfExport';
import { earthingDrawing } from './earthingDrawing';

type Text = Extract<DxfPrimitive, { type: 'text' }>;
const noop = () => {};
const entities = (dxf: string) => {
  const lines = dxf.trimEnd().split(/\r?\n/);
  const records: { type: string; values: Map<number, string> }[] = [];
  let current: typeof records[number] | undefined;
  let section = false;
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]), value = lines[i + 1];
    if (code === 2 && value === 'ENTITIES') section = true;
    if (!section) continue;
    if (code === 0) {
      if (value === 'ENDSEC') break;
      current = { type: value, values: new Map() }; records.push(current);
    } else current?.values.set(code, value);
  }
  return records;
};

describe('SVG to CAD export geometry', () => {
  // Real XML parser provided by the locked electron-builder dependency.
  beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));
  afterAll(() => vi.unstubAllGlobals());

  it('preserves dash attributes, inheritance, inline overrides and transform scale as visible CAD gaps', () => {
    const out = svgToDxf('<svg><g stroke-dasharray="3 2" transform="scale(2)"><path d="M0 0 H10"/><line x1="0" y1="10" x2="10" y2="10" style="stroke-dasharray:2px,3px"/><line x1="0" y1="20" x2="10" y2="20" stroke-dasharray="none"/></g></svg>', 100);
    expect(out.slice(0, 4)).toEqual([
      { type: 'polyline', layer: 'SYMBOL', points: [[0, 100], [6, 100]] },
      { type: 'polyline', layer: 'SYMBOL', points: [[10, 100], [16, 100]] },
      { type: 'polyline', layer: 'SYMBOL', points: [[0, 80], [4, 80]] },
      { type: 'polyline', layer: 'SYMBOL', points: [[10, 80], [14, 80]] }
    ]);
    expect(out[4]).toEqual({ type: 'line', layer: 'SYMBOL', x1: 0, y1: 60, x2: 20, y2: 60 });
    const dxf = entities(toDxf(out));
    const vertices = dxf.filter((p) => p.type === 'VERTEX');
    expect(vertices.map((p) => Number(p.values.get(10)))).toEqual([0, 6, 10, 16, 0, 4, 10, 14]);
  });

  it('dashes the closing edge of an enclosure while ordinary circles stay editable circles', () => {
    const out = svgToDxf('<svg><rect x="0" y="0" width="10" height="10" stroke-dasharray="3 2"/><circle cx="20" cy="20" r="4"/></svg>', 100);
    const lastDash = out[out.length - 2];
    expect(lastDash).toEqual({ type: 'polyline', layer: 'SYMBOL', points: [[0, 95], [0, 98]] });
    expect(out[out.length - 1].type).toBe('circle');
  });

  it('keeps dash spacing in SVG user space under nonuniform scaling', () => {
    const out = svgToDxf('<svg><path transform="scale(2 3)" stroke-dasharray="3 2" d="M0 0 V10"/></svg>', 100);
    expect(out).toEqual([
      { type: 'polyline', layer: 'SYMBOL', points: [[0, 100], [0, 91]] },
      { type: 'polyline', layer: 'SYMBOL', points: [[0, 85], [0, 76]] }
    ]);
  });

  it('preserves busbar widths through transforms, while wires remain centrelines', () => {
    const out = svgToDxf('<svg><g transform="translate(10 20) scale(2)"><line class="bus" style="stroke-width:4px" x1="0" y1="0" x2="100" y2="0"/><line class="ln" style="stroke-width:1.5px" x1="0" y1="0" x2="0" y2="20"/></g></svg>', 200);
    expect(out[0]).toEqual({ type: 'line', layer: 'BUSBAR', x1: 10, y1: 180, x2: 210, y2: 180, width: 8 });
    expect(out[1]).not.toHaveProperty('width');
    const bus = entities(toDxf(out))[0];
    expect(bus.type).toBe('SOLID');
    expect(Number(bus.values.get(20)) - Number(bus.values.get(22))).toBe(8);
  });

  it('keeps rotated measured text dimensions, caps long labels and leaves short labels short', () => {
    const out = svgToDxf('<svg><g transform="translate(20 10) rotate(90) scale(2)"><text x="5" y="7" text-anchor="middle" style="font-size:10px" data-dxf-width="120" data-dxf-max-width="90">Long cable</text><text x="5" y="7" data-dxf-width="24" data-dxf-max-width="90">25m</text></g></svg>', 100) as Text[];
    expect(out[0]).toMatchObject({ width: 180, rotation: -90, align: 'center', x: 6, y: 80 });
    expect(out[0].height).toBeCloseTo(14.4);
    expect(out[1].width).toBe(48);
  });

  it('honours SVG font-size attributes and inheritance with inline styles taking precedence', () => {
    const out = svgToDxf('<svg font-size="10"><text>Root size</text><g font-size="9"><text>Group size</text><text font-size="8">Attribute size</text><text font-size="14" style="font-size:12px">Inline size</text><g style="font-size:7.5px" transform="scale(2)"><text>Scaled inherited size</text></g></g></svg>', 100) as Text[];
    expect(out.map((p) => p.text)).toEqual(['Root size', 'Group size', 'Attribute size', 'Inline size', 'Scaled inherited size']);
    [7.2, 6.48, 5.76, 8.64, 10.8].forEach((height, i) => expect(out[i].height).toBeCloseTo(height));
    const fallback = svgToDxf('<svg><text>No size</text><g font-size="invalid"><text font-size="0">Invalid size</text></g></svg>', 100) as Text[];
    fallback.forEach((p) => expect(p.height).toBeCloseTo(7.92));
  });

  it('preserves the distinct heading, equipment, note and conductor sizes in raw earthing SVG', () => {
    const drawing = earthingDrawing(dxfExportProject);
    const texts = svgToDxf(drawing.svg, drawing.h).filter((p): p is Text => p.type === 'text');
    expect(texts.find((p) => p.text === 'EARTHING SCHEMATIC DIAGRAM')!.height).toBeCloseTo(14 * 0.72);
    expect(texts.find((p) => p.text.endsWith('EARTH BAR'))!.height).toBeCloseTo(10 * 0.72);
    expect(texts.find((p) => p.text.startsWith('1. RMU'))!.height).toBeCloseTo(9 * 0.72);
    expect(texts.find((p) => p.rotation === 90)!.height).toBeCloseTo(8 * 0.72);
  });

  it('exports curved glands, socket arcs and the RCD oval instead of flattening/losing symbols', () => {
    const out = svgToDxf('<svg><path class="ln" d="M95 43 q3 4 0 8 M105 43 q-3 4 0 8"/><path d="M0 0 a11 11 0 0 0 22 0"/><ellipse cx="100" cy="39" rx="7" ry="3.2"/></svg>', 100);
    const gland = out[0];
    expect(gland.type).toBe('polyline');
    if (gland.type !== 'polyline') return;
    expect(Math.max(...gland.points.map(([x]) => x))).toBeCloseTo(96.5);
    expect(out[2].type === 'polyline' && out[2].points.length).toBeGreaterThan(2);
    const rcd = out[3];
    expect(rcd).toMatchObject({ type: 'polyline', closed: true });
    if (rcd.type === 'polyline') {
      expect(Math.max(...rcd.points.map(([x]) => x))).toBeCloseTo(107);
      expect(Math.max(...rcd.points.map(([, y]) => y))).toBeCloseTo(64.2);
    }
  });

  it.each([false, true])('constrains adjacent feeder labels and clears glands/CT meters (references %s)', (refs) => {
    const markup = renderToStaticMarkup(<SystemDiagram project={dxfExportProject} results={[]} selectedFeederId={null} selectedBoardId={null} onSelectFeeder={noop} onSelectBoard={noop} cableRefs={refs} />);
    const doc = new DOMParser().parseFromString(markup, 'text/xml');
    const groups = Array.from(doc.getElementsByTagName('g')).filter((g) => /^fd:/.test(g.getAttribute('data-drop') ?? ''));
    const svg = doc.getElementsByTagName('svg')[0];
    const height = Number(svg.getAttribute('data-h'));
    expect(groups).toHaveLength(3);
    groups.forEach((g, i) => {
      const drop = g.getElementsByTagName('line')[0];
      const x = Number(drop.getAttribute('x1')), busY = Number(drop.getAttribute('y1'));
      const ts = Array.from(g.getElementsByTagName('text')).filter((t) => t.hasAttribute('data-dxf-max-width'));
      expect(ts.length).toBeGreaterThanOrEqual(3);
      const converted = svgToDxf(g.toString(), height).filter((p): p is Text => p.type === 'text' && p.width !== undefined);
      const right = i < 2 ? Number(groups[i + 1].getElementsByTagName('line')[0].getAttribute('x1')) : x + 132;
      for (const t of converted) expect(t.x + t.width!).toBeLessThanOrEqual(right - 12);
      const cable = converted.find((t) => /4C/.test(t.text))!;
      // Gland bottom is +51; text cap top is baseline-height in SVG y.
      expect(height - cable.y - cable.height).toBeGreaterThan(busY + 53);
      if (i === 1) {
        expect(cable.x).toBe(x + 57); // beyond both kWh box and CT label
        const length = converted.find((t) => /25m/.test(t.text))!;
        expect(length.x).toBe(x + 57);
      }
    });
    // Metadata leaves live/printable SVG baselines unchanged.
    const first = Array.from(groups[0].getElementsByTagName('text')).find((t) => /4C/.test(t.textContent ?? ''))!;
    expect(Number(first.getAttribute('y'))).toBe(Number(groups[0].getElementsByTagName('line')[0].getAttribute('y1')) + 57);
  });

  it.each(['A4', 'A3', 'A2', 'A1'] as const)('scales busbar widths and fitted text together on %s sheets', (size) => {
    const svg = '<svg viewBox="0 0 400 100"><line class="bus" style="stroke-width:4px" x1="0" y1="40" x2="200" y2="40"/><text x="10" y="60" style="font-size:9px" data-dxf-width="90">Long cable label</text></svg>';
    const out = entities(buildSheetDxf(dxfExportProject, svg, size, { no: 'CAD-1', title: 'CAD check', index: 1, count: 1 }));
    const bus = out.find((e) => e.type === 'SOLID' && e.values.get(8) === 'E-BUSBAR')!;
    const width = Number(bus.values.get(20)) - Number(bus.values.get(22));
    const dx = Number(bus.values.get(11)) - Number(bus.values.get(10));
    expect(width).toBeGreaterThan(0);
    expect(dx / width).toBeCloseTo(50, 1);
    const label = out.find((e) => e.type === 'TEXT' && e.values.get(1) === 'Long cable label')!;
    expect(label.values.get(72)).toBe('5');
    const fitWidth = Number(label.values.get(11)) - Number(label.values.get(10));
    expect(fitWidth / dx).toBeCloseTo(90 / 200, 3);
  });
});
