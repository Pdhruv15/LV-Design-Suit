import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { vdCandidates, vdRows } from '../calc/voltageDrop';
import { parseNumber } from '../components/EditCell';
import { buildVdReportHtml, VD_HEADERS, vdCells } from './voltageDropReport';

describe('voltage drop report', () => {
  const rows = vdRows(sampleProject, vdCandidates(sampleProject).map((f) => f.id));

  it('has one section per panel, with from / to and no final circuits', () => {
    const html = buildVdReportHtml(sampleProject, rows, 'Entire system');
    for (const id of ['MDB-1', 'SMDB-GF', 'SMDB-FF', 'MCC-1']) expect(html).toContain(`<h2>${id} – `);
    expect(html).not.toContain('<h2>DB-GF1');
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

describe('typed numbers', () => {
  it('accepts plain numbers, a decimal point or comma', () => {
    expect([parseNumber('45'), parseNumber('0.85'), parseNumber('.5'), parseNumber('2,5'), parseNumber(' 12 '), parseNumber('12.')]).toEqual([45, 0.85, 0.5, 2.5, 12, 12]);
  });
  it('rejects anything else', () => {
    expect([parseNumber(''), parseNumber('abc'), parseNumber('1.2.3'), parseNumber('-4'), parseNumber('1e3')]).toEqual([null, null, null, null, null]);
  });
});
