import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from './runs';
import { buildDashboard, sizesText } from './dashboard';
import { buildDashboardHtml } from '../docs/dashboardPdf';
import type { Project } from '../types';

describe('project dashboard', () => {
  const run = runCalculations(sampleProject);
  const d = buildDashboard(sampleProject, run);

  it('headline numbers from the design', () => {
    expect(d.connectedKw).toBeGreaterThan(d.demandKw);
    expect(d.transformers).toHaveLength(1);
    expect(d.transformers[0]).toMatchObject({ boardId: 'MDB-1', kva: 1000 });
    expect(d.panels.total).toBe(sampleProject.boards.length);
    expect(d.panels.byKind.reduce((a, k) => a + k.n, 0)).toBe(sampleProject.boards.length);
    expect(d.cableRuns).toBeGreaterThan(0);
    expect(d.studies.map((s) => s.key)).toEqual(['checks', 'earthing', 'protection']);
    expect(d.byType[0].kw).toBeGreaterThanOrEqual(d.byType[d.byType.length - 1].kw);
    expect(Math.round(d.byType.reduce((a, b) => a + b.pct, 0))).toBe(100);
    expect(sizesText([1500, 1000, 1500])).toBe('2 × 1500 kVA + 1 × 1000 kVA');
  });

  it('area and power density from Building information, else the forms', () => {
    expect(buildDashboard({ ...sampleProject, info: { ...sampleProject.info, builtUpAreaM2: 2000 } }).density!.connected).toBeCloseTo((d.connectedKw * 1000) / 2000);
    const p: Project = { ...sampleProject, building: { buildings: [{ id: 'T', name: 'Tower', levels: [{ id: 'G', name: 'G', kind: 'ground', heightM: 4, grossM2: 1000 }, { id: 'L', name: 'Typ', kind: 'typical', heightM: 3.5, grossM2: 800, count: 10 }] }], rooms: [{ id: 'r', buildingId: 'T', levelId: 'L', name: 'Flat', type: 'apartment', areaM2: 100, count: 6 }] } };
    const b = buildDashboard(p);
    expect(b.area).toMatchObject({ gfaM2: 9000, floors: 11, source: 'building' });
    expect(b.perArea.title).toMatch(/level/);
    expect(b.perArea.bars[0].label).toBe('Typ (×10)');
  });

  it('to do: problems first, each says where to go', () => {
    const bad: Project = { ...sampleProject, info: {}, feeders: sampleProject.feeders.map((f) => (f.loadType === 'fire-pump' ? { ...f, cableType: 'XLPE/PVC/SWA' } : f)) };
    const t = buildDashboard(bad, runCalculations(bad)).todo;
    expect(t[0].status).toBe('bad');
    expect(t.some((x) => /fire-rated/.test(x.text) && x.go?.feederId)).toBe(true);
    expect(t.some((x) => /Submission forms/.test(x.text))).toBe(true);
  });

  it('one-page PDF summary', () => {
    const html = buildDashboardHtml(sampleProject, d);
    expect(html).toContain('A4 landscape');
    expect(html).toContain('Connected load (TCL)');
    expect(html).toContain('MDB-1');
  });
});
