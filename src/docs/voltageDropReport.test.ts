import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { vdCandidates, vdRows } from '../calc/voltageDrop';
import { parseNumber } from '../components/EditCell';
import { buildVdReportHtml, VD_HEADERS, vdCells } from './voltageDropReport';

describe('voltage drop report', () => {
  const rows = vdRows(sampleProject, vdCandidates(sampleProject).map((f) => f.id));

  it('has one section per panel, with from / to and no final circuits', () => {
    const html = buildVdReportHtml(sampleProject, rows, 'Entire system');
    for (const id of ['MDB-1', 'SMDB-GF', 'SMDB-FF', 'MCC-1']) expect(html).toMatch(new RegExp(`<h2[^>]*>(?:<a class="dest"[^>]*></a>)?${id} – `));
    expect(html).not.toMatch(/<h2[^>]*>(?:<a class="dest"[^>]*><\/a>)?DB-GF1/);
    expect(html).not.toContain('DB-GF1-R1');
    expect(html).toContain('<td>Water pump</td>');
  });

  it('gives every row a value for every column', () => {
    for (const r of rows) expect(vdCells(r)).toHaveLength(VD_HEADERS.length);
  });

  it('escapes names typed into the table', () => {
    const p = { ...sampleProject, feeders: sampleProject.feeders.map((f) => (f.id === 'MCC-WP' ? { ...f, name: 'AHU <1> & "2"' } : f)) };
    const html = buildVdReportHtml(p, vdRows(p, ['MCC-WP']), 'x');
    expect(html).toContain('AHU &lt;1&gt; &amp; &quot;2&quot;');
  });
});

describe('voltage drop report page 1', () => {
  const rows = vdRows(sampleProject, vdCandidates(sampleProject).map((f) => f.id));
  const html = buildVdReportHtml({ ...sampleProject, vdReportDocNo: 'VD-001' }, rows, 'Entire system');

  it('is black and white with page numbers and its own document number', () => {
    const colours = [...new Set(html.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi) ?? [])];
    const grey = (h: string) => { const x = h.length === 4 ? h.slice(1).split('').map((c) => c + c) : [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)]; return x.every((c) => c.toLowerCase() === x[0].toLowerCase()); };
    expect(colours.filter((c) => !grey(c))).toEqual([]);
    expect(html).toContain('counter(pages)');
    expect(html).toContain('VD-001');
  });

  it('leaves out From panel, a single limit and empty columns', () => {
    const tables = html.split('<table class="grid vd">').slice(1).map((t) => t.slice(0, t.indexOf('</thead>')));
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t).not.toContain('From panel');
      if (new Set(rows.map((r) => r.limitPct)).size === 1) expect(t).not.toContain('Limit (%)');
      expect(t).toContain('Total Vd (%)');
    }
  });

  it('shows 10 cables needing attention on page 1 and lists every one after the summary', () => {
    const p = { ...sampleProject, vdLimitPct: 0.01 };
    const rows = vdRows(p, vdCandidates(p).map((f) => f.id));
    const tight = buildVdReportHtml(p, rows, 'x');
    const n = Number(tight.match(/Needs attention \((\d+)\)/)?.[1]);
    expect(n).toBeGreaterThan(10);
    expect(tight).toContain(`…and ${n - 10} more`);
    const all = tight.match(/<h2>Items needing attention \(all (\d+)\)<\/h2>[\s\S]*?<\/table>/);
    expect(Number(all?.[1])).toBe(n);
    for (const r of rows.filter((x) => x.status !== 'ok')) expect(all![0]).toContain(`<td>${r.feeder.id}</td>`);
  });
});

describe('typed numbers', () => {
  it('accepts plain numbers, a decimal point or comma', () => {
    expect([parseNumber('45'), parseNumber('0.85'), parseNumber('.5'), parseNumber('2,5'), parseNumber(' 12 '), parseNumber('12.')]).toEqual([45, 0.85, 0.5, 2.5, 12, 12]);
  });
  it('rejects anything else', () => {
    expect([parseNumber(''), parseNumber('abc'), parseNumber('1.2.3'), parseNumber('-4'), parseNumber('1e3')]).toEqual([null, null, null, null, null]);
  });
});
