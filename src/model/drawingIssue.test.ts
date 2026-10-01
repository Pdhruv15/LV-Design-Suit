// @vitest-environment node
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { filterSheets, issueSheets, moveSheet, nextRev, registerHtml, sheetRev, transmittalHtml, type DrawingSet } from './drawingSet';
import { buildRegisterWorkbook, buildTransmittalWorkbook } from '../docs/registerWorkbook';
import type { Project } from '../types';

const set = (): DrawingSet => ({
  prefix: 'E-SLD-', register: true,
  sheets: [
    { id: 'a', number: 'E-SLD-001', title: 'SLD — MDB-1', kind: 'system', boards: ['MDB-1', 'SMDB-1'], size: 'auto' },
    { id: 'b', number: 'E-SLD-002', title: 'SLD — SMDB-2', kind: 'system', boards: ['SMDB-2'], size: 'auto', status: 'FOR TENDER' },
    { id: 'c', number: 'E-SLD-003', title: 'DB-1 — circuit diagram', kind: 'board', boards: ['DB-1'], size: 'A3' }
  ]
});
const project = { name: 'Villa', info: { owner: 'Owner', plotNo: '123' }, boards: [], feeders: [] } as unknown as Project;

describe('revisions and issues', () => {
  it('steps revisions', () => {
    expect(nextRev('')).toBe('A');
    expect(nextRev('A')).toBe('B');
    expect(nextRev('Z')).toBe('AA');
    expect(nextRev('0')).toBe('1');
    expect(nextRev('P1')).toBe('P2');
    expect(nextRev('C09')).toBe('C10');
  });
  it('issues sheets: first issue keeps the revision, later ones move on', () => {
    const one = issueSheets(set(), ['a', 'b'], { date: '2026-10-01', purpose: 'FOR APPROVAL', description: 'First issue', bump: true });
    expect(one.issue.id).toBe('T-001');
    expect(one.set.sheets[0].rev).toBe('A');
    expect(one.set.sheets[0].status).toBe('FOR APPROVAL');
    expect(one.set.sheets[2].history).toBeUndefined();
    const two = issueSheets(one.set, ['a'], { date: '2026-10-09', purpose: 'FOR CONSTRUCTION', description: 'DEWA comments', to: 'DEWA', bump: true });
    expect(two.issue.id).toBe('T-002');
    expect(two.set.sheets[0].rev).toBe('B');
    expect(two.set.sheets[0].history?.map((h) => h.rev)).toEqual(['A', 'B']);
    expect(sheetRev(two.set.sheets[1])).toBe('A');
    expect(two.set.issues).toHaveLength(2);
    expect(transmittalHtml(project, two.issue)).toContain('DEWA comments');
  });
  it('filters, sorts and reorders', () => {
    const s = set();
    expect(filterSheets(s, { type: 'db' }).map((x) => x.id)).toEqual(['c']);
    expect(filterSheets(s, { q: 'smdb-1' }).map((x) => x.id)).toEqual(['a']);
    expect(filterSheets(s, { status: 'FOR TENDER' }).map((x) => x.id)).toEqual(['b']);
    expect(filterSheets(s, {}, { key: 'title', desc: true })[0].id).toBe('b');
    const m = moveSheet(s, 2, 0);
    expect(m.sheets.map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(m.sheets[0].number).toBe('E-SLD-001');
  });
  it('writes the register cover and Excel workbooks', async () => {
    const issued = issueSheets(set(), ['a'], { date: '2026-10-01', purpose: 'FOR APPROVAL', description: 'First', bump: true });
    const html = registerHtml(project, [{ number: 'E-SLD-001', title: 'SLD', size: 'A3' }], 'A', '2026-10-01', issued.set.issues);
    expect(html).toContain('Issue history');
    const wb = buildRegisterWorkbook(project, issued.set);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Drawing register', 'Issue history']);
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await wb.xlsx.writeBuffer());
    const ws = back.getWorksheet('Drawing register')!;
    const vals: string[] = [];
    ws.eachRow((r) => vals.push(String(r.getCell(2).value ?? '')));
    expect(vals).toContain('E-SLD-003');
    expect(buildTransmittalWorkbook(project, issued.issue).worksheets[0].name).toBe('T-001');
  });
});
