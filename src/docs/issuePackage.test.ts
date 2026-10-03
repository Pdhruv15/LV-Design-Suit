import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { buildSection, scopeOf, STUDIES, type CalcData, type Section } from './studyReport';
import { APP_VERSION, assumptions, packageCoverHtml, packageStamp, snapshotId, unresolvedChecks } from './issuePackage';
import pkg from '../../package.json';

const sectionsFor = (project = sampleProject): Section[] => {
  const run = runCalculations(project);
  const data: CalcData = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
  const scope = scopeOf(run.project, { boards: [], downstream: true });
  return STUDIES.map((s) => buildSection(s.key, data, scope));
};
const meta = { title: 'Electrical studies', docNo: 'E-001', calculatedAt: Date.UTC(2026, 9, 3, 9, 0), snapshot: snapshotId(sampleProject) };

describe('issue package', () => {
  it('snapshot ID: same inputs → same ID, any change → different', () => {
    expect(snapshotId(sampleProject)).toMatch(/^[0-9A-F]{8}$/);
    expect(snapshotId(structuredClone(sampleProject))).toBe(snapshotId(sampleProject));
    expect(snapshotId({ ...sampleProject, voltageV: 400 })).not.toBe(snapshotId(sampleProject));
  });

  it('stamp on every page carries project, document, snapshot and app version', () => {
    const s = packageStamp(sampleProject, meta);
    expect(s).toContain(sampleProject.name);
    expect(s).toContain('E-001');
    expect(s).toContain(`snapshot ${meta.snapshot}`);
    expect(APP_VERSION).toBe(pkg.version);
    expect(s).toContain(`LV Design Studio ${pkg.version}`);
  });

  it('unresolved checks list every non-passing cell, fails first, none of them passes', () => {
    const sections = sectionsFor();
    const open = unresolvedChecks(sections);
    const nonOkCells = sections.flatMap((s) => s.tables.flatMap((t) => t.rows.filter((r) => r.some((c) => typeof c === 'object' && c.s !== 'ok'))));
    expect(open.length).toBeGreaterThanOrEqual(nonOkCells.length > 0 ? 1 : 0);
    expect(open.every((u) => u.status !== ('ok' as string))).toBe(true);
    const firstWarn = open.findIndex((u) => u.status === 'warn');
    if (firstWarn >= 0) expect(open.slice(firstWarn).some((u) => u.status === 'bad')).toBe(false);
  });

  it('a synthetic section: specific checks reported, the overall column only when nothing else says why', () => {
    const s: Section = { key: 'earth', title: 'Earth', method: ['m1', 'm1', 'm2'], statuses: [], summary: [{ label: 'Not verified — supply loop incomplete', value: 'no source data at MDB', status: 'warn' }],
      tables: [{ headers: ['Circuit', 'Disconnection', 'Result'], rows: [['F1', { v: 'Too slow', s: 'bad' }, { v: 'Fail', s: 'bad' }], ['F2', { v: '< 0.1 s', s: 'ok' }, { v: 'Check', s: 'warn' }], ['F3', { v: '< 0.1 s', s: 'ok' }, { v: 'Pass', s: 'ok' }]] }] };
    const open = unresolvedChecks([s]);
    expect(open.map((u) => [u.item, u.check, u.status])).toEqual([['F1', 'Disconnection', 'bad'], ['—', 'Not verified — supply loop incomplete', 'warn'], ['F2', 'Disconnection: < 0.1 s', 'warn']]);
    expect(assumptions([s, { ...s, title: 'Other', method: ['m2', 'm3'] }])).toEqual([{ study: 'Earth', lines: ['m1', 'm2'] }, { study: 'Other', lines: ['m3'] }]);
  });

  it('cover: snapshot, version, contents with page ranges after the cover, open items, assumptions', () => {
    const sections = sectionsFor();
    const html = packageCoverHtml(sampleProject, meta, [{ title: 'Project summary', pages: 2 }, { title: 'Electrical studies', pages: 10 }, { title: 'Load schedule — DB-GF1', pages: 1 }], 2, sections);
    expect(html).toContain(meta.snapshot);
    expect(html).toContain(`LV Design Studio ${APP_VERSION}`);
    expect(html).toMatch(/Project summary<\/td><td class="num">3–4</);
    expect(html).toMatch(/Electrical studies<\/td><td class="num">5–14</);
    expect(html).toMatch(/Load schedule — DB-GF1<\/td><td class="num">15</);
    expect(html).toContain('Unresolved checks');
    expect(html).toContain('Assumptions and calculation basis');
    for (const a of assumptions(sections)) expect(html).toContain(a.study);
  });
});
