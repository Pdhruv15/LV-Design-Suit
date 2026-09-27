import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { issueRevision } from '../model/revisions';
import { dxfText, titleBlockDxf, toDxf } from './dxf';
import { buildSldSheetHtml, DEFAULT_DRAWING_TITLE, titleBlockOf } from './sldSheet';
import { parseTransform, pathPoints } from '../diagram/exportSvg';

describe('SLD drawing export', () => {
  it('title block: project, owner, drawing data and the current revision', () => {
    const p = issueRevision({ ...sampleProject, drawing: { number: 'E-SLD-001', drawnBy: 'PG', checkedBy: 'AK' } }, { description: 'Issued for approval', date: '2026-09-28' });
    const t = titleBlockOf(p);
    expect(t).toMatchObject({ project: 'Villa Complex 415V LV Network', owner: 'Mr. Ahmed Al Mansoori', title: DEFAULT_DRAWING_TITLE, number: 'E-SLD-001', revision: 'A', date: '2026-09-28', drawnBy: 'PG', checkedBy: 'AK', scale: 'NTS' });
    expect(t.company).toBe('ABC Engineering Consultants'); // falls back to the consultant
    expect(t.history).toEqual([{ id: 'A', date: '2026-09-28', description: 'Issued for approval' }]);
    expect(titleBlockOf(sampleProject, '2026-01-01')).toMatchObject({ revision: '—', date: '2026-01-01' });
  });

  it('sheet HTML: page size, the diagram and an escaped title block', () => {
    const p = { ...sampleProject, drawing: { number: 'E<01>' } };
    const html = buildSldSheetHtml(p, '<svg id="d"></svg>', 'A1');
    expect(html).toContain('@page { size: 841mm 594mm');
    expect(html).toContain('<svg id="d"></svg>');
    expect(html).toContain('E&lt;01&gt;');
    expect(html).toContain('Not issued');
  });

  it('DXF: R12 with layers and each entity type', () => {
    const dxf = toDxf([
      { type: 'line', layer: 'BUSBAR', x1: 0, y1: 0, x2: 100, y2: 0 },
      { type: 'circle', layer: 'SYMBOL', x: 50, y: 20, r: 14 },
      { type: 'polyline', layer: 'SYMBOL', closed: true, points: [[0, 0], [10, 0], [10, 10]] },
      { type: 'text', layer: 'TEXT', x: 50, y: 40, height: 8, text: '4C × 95mm² · 55m', align: 'center' }
    ]);
    const lines = dxf.split('\r\n');
    expect(lines.slice(0, 6)).toEqual(['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER']);
    expect(lines).toContain('AC1009');
    for (const e of ['LINE', 'CIRCLE', 'POLYLINE', 'VERTEX', 'SEQEND', 'TEXT', 'LAYER']) expect(lines).toContain(e);
    expect(lines).toContain('4C x 95mm2 - 55m');
    expect(lines[lines.length - 2]).toBe('EOF');
    // Extents cover the drawing.
    const i = lines.indexOf('$EXTMAX');
    expect([lines[i + 2], lines[i + 4]]).toEqual(['100', '40']);
  });

  it('DXF text keeps to printable ASCII', () => {
    expect(dxfText('Ik″ 25 kA ≥ 20 — ΔV 1.2%\nnext')).toBe('Ik" 25 kA >= 20 - dV 1.2% next');
  });

  it('title block as DXF: a closed frame and label/value text per cell', () => {
    const tb = titleBlockDxf(500, 0, 240, [[['Project', 'Villa'], ['Rev', 'A']], [['Title', 'SLD']]]);
    expect(tb.filter((e) => e.type === 'polyline')).toHaveLength(1);
    expect(tb.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)).toEqual(['PROJECT', 'Villa', 'REV', 'A', 'TITLE', 'SLD']);
  });

  it('reads SVG transforms and straight-line paths', () => {
    const m = parseTransform('translate(10 20)');
    expect([m[4], m[5]]).toEqual([10, 20]);
    const r = parseTransform('rotate(90)');
    expect(r.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, -1, 0, 0, 0]);
    expect(pathPoints('M-9 5 L-6 -6 H6 L9 5 Z')).toEqual([[[-9, 5], [-6, -6], [6, -6], [9, 5], [-9, 5]]]);
    expect(pathPoints('M0 0 l10 0 v5')).toEqual([[[0, 0], [10, 0], [10, 5]]]);
    expect(pathPoints('M10 22 q2.5 -6 5 0 t5 0')).toEqual([[[10, 22], [15, 22], [20, 22]]]);
  });
});
