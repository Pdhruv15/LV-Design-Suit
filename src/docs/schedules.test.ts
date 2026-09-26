import { describe, expect, it } from 'vitest';
import { cableSchedule, dbSchedule, equipmentSchedule } from './schedules';
import { buildReportHtml } from './report';
import { toCsv } from '../util/files';
import { sampleProject } from '../data/sampleProject';

describe('schedules', () => {
  it('DB schedule lists every circuit once plus one total row per board', () => {
    const s = dbSchedule(sampleProject);
    expect(s.rows).toHaveLength(sampleProject.feeders.length + sampleProject.boards.length);
    expect(s.totalRows).toHaveLength(sampleProject.boards.length);
    for (const i of s.totalRows!) expect(s.rows[i][2]).toBe('TOTAL');
    expect(s.rows.every((r) => r.length === s.headers.length)).toBe(true);
  });

  it('DB schedule can be limited to one board', () => {
    const s = dbSchedule(sampleProject, ['MCC-1']);
    expect(s.rows.map((r) => r[2])).toEqual(['MCC-WP', 'MCC-FP', 'TOTAL']);
  });

  it('cable schedule has one row per cable and the default CPC sizes', () => {
    const s = cableSchedule(sampleProject);
    expect(s.rows).toHaveLength(sampleProject.feeders.length);
    const inc = s.rows.find((r) => r[0] === 'C-INC-GF')!;
    expect(inc[4]).toBe('4C × 300 mm²');
    expect(inc[5]).toBe(150); // 300 / 2
  });

  it('equipment schedule includes the transformer and every board', () => {
    const s = equipmentSchedule(sampleProject);
    expect(s.rows.map((r) => r[0])).toEqual(['TX-MDB-1', 'MDB-1', 'SMDB-GF', 'DB-GF1', 'SMDB-FF', 'MCC-1']);
  });
});

describe('CSV', () => {
  it('quotes cells with commas, quotes and newlines', () => {
    const csv = toCsv(['a', 'b'], [['x, y', 'say "hi"'], ['line\nbreak', 3]]);
    expect(csv).toBe('﻿a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",3');
  });
});

describe('calculation report', () => {
  it('is a complete HTML document with every section and escapes user text', () => {
    const html = buildReportHtml({ ...sampleProject, name: 'Tower <A&B>' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('Tower &lt;A&amp;B&gt;');
    expect(html).not.toContain('Tower <A&B>');
    for (const h of ['Design basis', 'System summary', 'Feeder calculations', 'Earthing', 'Protection coordination', 'Cable schedule', 'Assumptions']) {
      expect(html).toContain(h);
    }
  });
});

describe('DEWA load distribution schedule', () => {
  it('lists every circuit of the villa DB with R/Y/B watts and ELCB groups', async () => {
    const { loadScheduleRows, buildLoadScheduleHtml, loadScheduleCsv } = await import('./loadScheduleDoc');
    const d = loadScheduleRows(sampleProject, 'DB-GF1');
    expect(d.rows).toHaveLength(21);
    expect(d.rows.map((r) => r.ref).slice(0, 4)).toEqual(['R1', 'Y1', 'B1', 'R2']);
    expect(d.groups.map((g) => g.ways)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
    expect(d.imbalance).toBeLessThan(5);
    for (const r of d.rows) expect([r.ph.R, r.ph.Y, r.ph.B].filter((x) => x !== '')).toHaveLength(1);
    const html = buildLoadScheduleHtml(sampleProject, 'DB-GF1');
    expect(html).toContain('LOAD DISTRIBUTION SCHEDULE');
    expect(html).toContain('WATT / UNIT');
    expect(html).toContain('ELCB-1');
    const csv = loadScheduleCsv(sampleProject, 'DB-GF1');
    expect(csv.rows).toHaveLength(21 + 2); // watt/unit row + circuits + total
  });
});
