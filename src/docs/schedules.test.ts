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
    expect(inc[4]).toBe('4C × 240 mm²');
    expect(inc[5]).toBe(120); // 240 / 2
  });

  it('equipment schedule includes the transformer and every board', () => {
    const s = equipmentSchedule(sampleProject);
    expect(s.rows.map((r) => r[0])).toEqual(['TX-MDB-1', 'MDB-1', 'SMDB-GF', 'SMDB-FF', 'MCC-1']);
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
