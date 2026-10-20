import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { renderToStaticMarkup } from 'react-dom/server';
import SystemDiagram from '../components/SystemDiagram';
import { lvTag, svgToDxf } from '../diagram/exportSvg';
import { DXF_APP, toDxf, type DxfPrimitive } from './dxf';
import { buildSheetDxf } from './sheetDxf';
import { dxfExportProject } from '../../tests/fixtures/dxfExport';

type Pair = { code: number; value: string };
const pairs = (dxf: string): Pair[] => {
  const lines = dxf.trimEnd().split(/\r?\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push({ code: Number(lines[i]), value: lines[i + 1] });
  return out;
};
/** Entities of the ENTITIES section, each with its group codes in order. */
const entities = (dxf: string) => {
  const all = pairs(dxf);
  const start = all.findIndex((p, i) => p.code === 2 && p.value === 'ENTITIES' && all[i - 1]?.value === 'SECTION');
  const out: Pair[][] = [];
  for (const p of all.slice(start + 1)) {
    if (p.code === 0 && p.value === 'ENDSEC') break;
    if (p.code === 0) out.push([p]); else out[out.length - 1]?.push(p);
  }
  return out;
};
const tagOf = (e: Pair[]) => {
  const i = e.findIndex((p) => p.code === 1001 && p.value === DXF_APP);
  return i < 0 ? undefined : e[i + 1]?.value;
};
const noop = () => {};

describe('equipment tags in DXF', () => {
  beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));
  afterAll(() => vi.unstubAllGlobals());

  it('accepts only feeder/board tags of printable ASCII', () => {
    expect(lvTag('feeder:F1')).toBe('feeder:F1');
    expect(lvTag('board:MDB-1')).toBe('board:MDB-1');
    expect(lvTag('panel:X')).toBe('');
    expect(lvTag('feeder:')).toBe('');
    expect(lvTag('feeder:a b')).toBe('');
    expect(lvTag(`feeder:${'x'.repeat(194)}`)).toBe('');
    expect(lvTag(null)).toBe('');
  });

  it('gives every element the tag of its nearest tagged group', () => {
    const out = svgToDxf('<svg><g data-lv-id="board:MDB-1"><line x1="0" y1="0" x2="10" y2="0"/><g data-lv-id="feeder:F1"><circle cx="5" cy="5" r="2"/><text x="0" y="0">F1</text></g></g><line x1="0" y1="9" x2="1" y2="9"/></svg>', 100);
    expect(out.map((p) => [p.type, p.tag])).toEqual([['line', 'board:MDB-1'], ['circle', 'feeder:F1'], ['text', 'feeder:F1'], ['line', undefined]]);
  });

  it('writes the tag as extended data last in each entity, with the application registered', () => {
    const items: DxfPrimitive[] = [
      { type: 'line', layer: 'A', x1: 0, y1: 0, x2: 1, y2: 1, tag: 'feeder:F1' },
      { type: 'line', layer: 'A', x1: 0, y1: 0, x2: 1, y2: 0, width: 0.5, tag: 'board:MDB-1' },
      { type: 'polyline', layer: 'A', points: [[0, 0], [1, 1]], tag: 'feeder:F2' },
      { type: 'circle', layer: 'A', x: 0, y: 0, r: 1, tag: 'feeder:F3' },
      { type: 'text', layer: 'A', x: 0, y: 0, height: 1, text: 'T', align: 'center', tag: 'feeder:F4' },
      { type: 'line', layer: 'A', x1: 0, y1: 0, x2: 1, y2: 1 }
    ];
    const dxf = toDxf(items);
    const p = pairs(dxf);
    const appids = p.filter((x, i) => x.code === 2 && p[i - 1]?.value === 'APPID').map((x) => x.value);
    expect(appids).toEqual(['ACAD', DXF_APP]);

    const ents = entities(dxf);
    const byType = (t: string) => ents.filter((e) => e[0].value === t);
    expect(tagOf(byType('LINE')[0])).toBe('feeder:F1');
    expect(byType('SOLID').length).toBeGreaterThan(0);
    for (const s of byType('SOLID')) expect(tagOf(s)).toBe('board:MDB-1');
    // R12: a polyline's extended data sits on its POLYLINE header, before the vertices.
    expect(tagOf(byType('POLYLINE')[0])).toBe('feeder:F2');
    expect(byType('VERTEX').every((v) => tagOf(v) === undefined)).toBe(true);
    expect(tagOf(byType('CIRCLE')[0])).toBe('feeder:F3');
    expect(tagOf(byType('TEXT')[0])).toBe('feeder:F4');
    expect(tagOf(byType('LINE')[1])).toBeUndefined();
    for (const e of ents.filter((e) => tagOf(e))) {
      const at = e.findIndex((x) => x.code === 1001);
      expect(e.slice(at).map((x) => x.code)).toEqual([1001, 1000]);
    }
  });

  it('leaves untagged drawings unchanged (no APPID table, no extended data)', () => {
    const dxf = toDxf([{ type: 'line', layer: 'A', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    expect(dxf).not.toContain('APPID');
    expect(pairs(dxf).some((x) => x.code === 1001)).toBe(false);
  });

  it('tags every board and feeder of the exported SLD sheet', () => {
    const markup = renderToStaticMarkup(<SystemDiagram project={dxfExportProject} results={[]} selectedFeederId={null} selectedBoardId={null} onSelectFeeder={noop} onSelectBoard={noop} />);
    const dxf = buildSheetDxf(dxfExportProject, markup, 'A3');
    const found = new Set(entities(dxf).map(tagOf).filter(Boolean));
    for (const f of dxfExportProject.feeders) expect(found).toContain(`feeder:${f.id}`);
    for (const b of dxfExportProject.boards) expect(found).toContain(`board:${b.id}`);
    // Sheet furniture (frame, title block, notes) belongs to no equipment, only to its sheet.
    const titleText = entities(dxf).filter((e) => e[0].value === 'TEXT' && e.some((x) => x.code === 8 && x.value === 'E-TITLE'));
    expect(titleText.length).toBeGreaterThan(0);
    expect(titleText.every((e) => tagOf(e) === 'sheet:1')).toBe(true);
    // Every object of the sheet is tagged, so an update can account for all of it.
    expect(entities(dxf).filter((e) => ['LINE', 'POLYLINE', 'CIRCLE', 'TEXT', 'SOLID'].includes(e[0].value)).every((e) => tagOf(e))).toBe(true);
  });
});
