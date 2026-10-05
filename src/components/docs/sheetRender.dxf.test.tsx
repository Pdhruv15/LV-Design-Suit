import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { dxfExportProject } from '../../../tests/fixtures/dxfExport';
import { dxfText } from '../../docs/dxf';
import { SHEET_MM } from '../../docs/sldSheet';
import { cableRefsUsed } from '../../model/cableRefs';
import type { DrawingSet, DrawingSheet, SheetSize } from '../../model/drawingSet';
import { dxfOf, type PreparedSheet } from './sheetRender';

type Entity = { type: string; values: Map<number, string> };
function entities(data: string): Entity[] {
  const lines = data.trimEnd().split(/\r?\n/), result: Entity[] = [];
  let inside = false, current: Entity | undefined;
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]), value = lines[i + 1];
    if (code === 2 && value === 'ENTITIES') { inside = true; continue; }
    if (!inside) continue;
    if (code === 0 && value === 'ENDSEC') break;
    if (code === 0) { current = { type: value, values: new Map() }; result.push(current); }
    else current?.values.set(code, value);
  }
  return result;
}

const textOf = (data: string, layer?: string) => entities(data)
  .filter((e) => e.type === 'TEXT' && (!layer || e.values.get(8) === layer))
  .map((e) => e.values.get(1)).join(' ').replace(/\s+/g, ' ');

const svg = '<svg viewBox="0 0 400 160"><line class="bus" x1="10" y1="40" x2="390" y2="40"/><text x="20" y="70">Diagram label</text></svg>';
const sheet = (id: string, patch: Partial<DrawingSheet> = {}): DrawingSheet => ({
  id, number: `E-SLD-${id}`, title: `Distribution drawing ${id}`, kind: 'system',
  boards: [dxfExportProject.boards[0].id], size: 'A3', ...patch
});
const prepared = (s: DrawingSheet, size: SheetSize, refs = false): PreparedSheet => ({
  s, size, refs, svg, html: '', fits: true, legendSvg: ''
});
const longNotes = (prefix: string) => Array.from({ length: 70 }, (_, i) => `${prefix}${i + 1}: verify all feeder connections before energising the equipment and retain this requirement.`);

function expectPaper(data: string, size: SheetSize) {
  const { w, h } = SHEET_MM[size];
  const edge = entities(data).filter((e) => e.type === 'VERTEX' && e.values.get(8) === 'E-FRAME').slice(0, 4);
  expect(edge.map((e) => [Number(e.values.get(10)), Number(e.values.get(20))])).toEqual([[0, 0], [w, 0], [w, h], [0, h]]);
}

describe('drawing-set DXF export integration', () => {
  beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));
  afterAll(() => vi.unstubAllGlobals());

  it('exports each continuation separately at its source paper size with sheet title and revision overrides', () => {
    const a = sheet('001', { size: 'A4', rev: 'B', date: '2026-09-12', drawnBy: 'Designer A', title: 'A4 main distribution', notes: longNotes('Requirement') });
    const b = sheet('002', { kind: 'board', size: 'A2', rev: 'C', date: '2026-09-14', title: 'A2 board circuit drawing', notes: ['Board sheet requirement.'] });
    const set: DrawingSet = { prefix: 'E-SLD-', sheets: [a, b] };
    const files = dxfOf(dxfExportProject, set, [prepared(a, 'A4'), prepared(b, 'A2')]);
    const aFiles = files.filter((f) => f.name.startsWith('E-SLD-001-RevB'));
    const bFiles = files.filter((f) => f.name.startsWith('E-SLD-002-RevC'));
    expect(aFiles.length).toBeGreaterThan(1);
    expect(bFiles).toHaveLength(1);
    expect(files).toHaveLength(aFiles.length + bFiles.length);
    expect(aFiles.map((f) => f.name)).toEqual(['E-SLD-001-RevB.dxf', ...aFiles.slice(1).map((_, i) => `E-SLD-001-RevB_continuation_${i + 1}.dxf`)]);
    expect(aFiles.map((f) => f.continuation)).toEqual([false, ...aFiles.slice(1).map(() => true)]);
    for (const f of aFiles) {
      expectPaper(f.data, 'A4');
      expect(textOf(f.data, 'E-TITLE')).toContain(a.title);
      expect(textOf(f.data, 'E-TITLE')).toContain('2026-09-12');
      expect(textOf(f.data, 'E-TITLE')).toContain('Designer A');
      expect(entities(f.data).some((e) => e.type === 'TEXT' && e.values.get(8) === 'E-TITLE' && e.values.get(1) === 'B')).toBe(true);
    }
    expectPaper(bFiles[0].data, 'A2');
    expect(textOf(bFiles[0].data, 'E-TITLE')).toContain(b.title);
    expect(textOf(bFiles[0].data, 'E-TITLE')).toContain('2026-09-14');
    const notes = aFiles.map((f) => textOf(f.data, 'E-NOTES')).join(' ');
    for (const note of a.notes!) expect(notes).toContain(note);
    expect(textOf(bFiles[0].data, 'E-NOTES')).toContain('Board sheet requirement.');
  });

  it('includes the shared cable-reference schedule on every system sheet when one uses references', () => {
    const a = sheet('001'), b = sheet('002'), c = sheet('003', { kind: 'board' });
    const set: DrawingSet = { prefix: 'E-SLD-', sheets: [a, b, c] };
    const project = { ...dxfExportProject, feeders: [...dxfExportProject.feeders, { ...dxfExportProject.feeders[0], id: 'off-sheet', boardId: 'unselected-board', cableCsaMm2: 1.5 }] };
    const expected = cableRefsUsed(project, dxfExportProject.feeders);
    const files = dxfOf(project, set, [prepared(a, 'A3', true), prepared(b, 'A3'), prepared(c, 'A3')]);
    for (const s of [a, b]) {
      const content = files.filter((f) => f.name.startsWith(s.number)).map((f) => textOf(f.data, 'E-LEGEND')).join(' ');
      expect(content).toContain('CABLE SCHEDULE');
      expect([...content.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]))).toEqual(expected.map((r) => r.ref));
      for (const r of expected) expect(content).toContain(dxfText(r.text).replace(/\s+/g, ' '));
      expect(content).not.toContain('1.5mm');
    }
    expect(textOf(files.find((f) => f.name.startsWith(c.number))!.data, 'E-LEGEND')).not.toContain('CABLE SCHEDULE');
    const fullOnly = dxfOf(project, set, [prepared(b, 'A3')]);
    expect(fullOnly.map((f) => textOf(f.data, 'E-LEGEND')).join(' ')).not.toContain('CABLE SCHEDULE');
  });

  it('keeps duplicate drawing numbers and all their continuation contents distinct in a ZIP', async () => {
    const a = sheet('first', { number: 'E-SLD-001', rev: 'A', title: 'First duplicated drawing', notes: longNotes('First') });
    const b = sheet('second', { number: 'e-sld-001', rev: 'A', title: 'Second duplicated drawing', notes: longNotes('Second') });
    const set: DrawingSet = { prefix: 'E-SLD-', sheets: [a, b] };
    const files = dxfOf(dxfExportProject, set, [prepared(a, 'A4'), prepared(b, 'A4')]);
    expect(files.filter((f) => f.continuation).length).toBeGreaterThanOrEqual(2);
    expect(new Set(files.map((f) => f.name.toLowerCase())).size).toBe(files.length);
    const zip = new JSZip();
    for (const f of files) zip.file(f.name, f.data);
    const archive = await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' }));
    expect(Object.keys(archive.files)).toHaveLength(files.length);
    for (const f of files) expect(await archive.file(f.name)!.async('string')).toBe(f.data);
    const first = files.filter((f) => textOf(f.data, 'E-TITLE').includes(a.title));
    const second = files.filter((f) => textOf(f.data, 'E-TITLE').includes(b.title));
    expect(first.length).toBeGreaterThan(1);
    expect(second.length).toBeGreaterThan(1);
    expect(first.length + second.length).toBe(files.length);
    expect(first.map((f) => textOf(f.data, 'E-NOTES')).join(' ')).toContain(a.notes![69]);
    expect(second.map((f) => textOf(f.data, 'E-NOTES')).join(' ')).toContain(b.notes![69]);
  });
});
