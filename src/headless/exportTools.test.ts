// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import ExcelJS from 'exceljs';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';
import { callTool, offeredTools, toolByName, type ToolContext } from './tools';
import { parseProject } from './project';
import { agentDir } from './write';

let root: string, folder: string;
let ctx: ToolContext;
const villa: Project = { ...sampleProject, id: 'proj-villa' };
const failing: Project = { ...sampleProject, id: 'proj-failing', name: 'Failing copy', feeders: sampleProject.feeders.map((f) => (f.id === 'GF-SKT' ? { ...f, cableCsaMm2: 1.5 } : f)) };
const file = (n: string) => path.join(folder, `${n}.json`);
const read = (n: string) => fs.readFileSync(file(n), 'utf-8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results are checked field by field
const run = async (name: string, args: Record<string, unknown>): Promise<Record<string, any>> => (await callTool(toolByName(name)!, args, ctx)) as Record<string, any>;
const exportsDir = () => path.join(folder, 'Exports');
const exported = () => (fs.existsSync(exportsDir()) ? fs.readdirSync(exportsDir(), { recursive: true }).map(String).filter((f) => /\.\w+$/.test(f)) : []);

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-export-'));
  process.env.LVDS_APP_DATA = path.join(root, 'app');
  process.env.LVDS_ELECTRON = path.join(root, 'no-electron'); // no renderer lookup: requiring electron downloads its binary on CI
  vi.stubGlobal('DOMParser', DOMParser); // as the lvds entry does (src/headless/main.ts)
});
afterAll(() => { delete process.env.LVDS_APP_DATA; delete process.env.LVDS_ELECTRON; vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(root, 'projects-'));
  fs.writeFileSync(file('Villa'), JSON.stringify(villa, null, 2));
  fs.writeFileSync(file('Failing'), JSON.stringify(failing, null, 2));
  ctx = { folder, anywhere: false, write: true };
});

describe('exports', () => {
  it('fills your own Excel template, one sheet per DB, and reads templates only inside the projects folder', async () => {
    const t = new ExcelJS.Workbook();
    const ws = t.addWorksheet('DB');
    ws.getCell('A1').value = '{{board.id}}';
    ws.getCell('A2').value = '{{row.ref}}';
    ws.getCell('B2').value = '{{row.mcb}}';
    fs.writeFileSync(path.join(folder, 'Company schedule.xlsx'), new Uint8Array(await t.xlsx.writeBuffer()));
    const pre = await run('export_schedule_template', { project: 'Villa', template: 'Company schedule.xlsx' });
    expect(pre.files[0].file).toMatch(/Company-schedule\.xlsx$/);
    expect(exported()).toEqual([]);
    const done = await run('export_schedule_template', { project: 'Villa', template: 'Company schedule.xlsx', mode: 'export', approvedBy: 'A. Engineer' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync(done.files[0]) as unknown as ArrayBuffer);
    expect(wb.worksheets.length).toBeGreaterThan(0);
    expect(wb.worksheets[0].getCell('A1').value).toBe(wb.worksheets[0].name);
    expect(typeof wb.worksheets[0].getCell('B2').value).toBe('number');
    const outside = path.join(root, 'outside.xlsx');
    fs.writeFileSync(outside, new Uint8Array(await t.xlsx.writeBuffer()));
    await expect(run('export_schedule_template', { project: 'Villa', template: outside })).rejects.toThrow(/inside the projects folder/);
    await expect(run('export_schedule_template', { project: 'Villa', template: 'x.docx' })).rejects.toThrow(/\.xlsx/);
  });
  it('lists what can be exported and why not', async () => {
    const l = await run('list_exports', { project: 'Villa' });
    expect(l.reports.find((r: { report: string }) => r.report === 'calc-report').unavailable).toBeUndefined();
    expect(l.reports.find((r: { report: string }) => r.report === 'ups').unavailable).toMatch(/No UPS/);
    expect(l.readiness).toMatchObject({ fail: 0, proposalsWaiting: [] });
  });
  it('preview writes nothing; exporting needs the approving engineer', async () => {
    const p = await run('export_forms_xlsx', { project: 'Villa' });
    expect(p).toMatchObject({ mode: 'preview', written: false });
    expect(p.files[0].file).toMatch(/\.xlsx$/);
    expect(exported()).toEqual([]);
    await expect(run('export_forms_xlsx', { project: 'Villa', mode: 'export' })).rejects.toThrow(/approvedBy/);
    expect(exported()).toEqual([]);
  });
  it('refuses while checks fail or proposals wait, unless the engineer says export anyway', async () => {
    await expect(run('export_boq_xlsx', { project: 'Failing', mode: 'export', approvedBy: 'A. Engineer' })).rejects.toThrow(/fail the checks/);
    await run('size_circuits', { project: 'Villa', scope: 'all', mode: 'preview' }).catch(() => undefined);
    await run('propose_changes', { project: 'Villa', title: 'Longer run', reason: 'Route', changes: [{ target: 'feeder', id: 'GF-LTG', field: 'lengthM', value: 31 }], mode: 'propose' });
    await expect(run('export_boq_xlsx', { project: 'Villa', mode: 'export', approvedBy: 'A. Engineer' })).rejects.toThrow(/proposals waiting.*MOD-001/);
    const anyway = await run('export_boq_xlsx', { project: 'Failing', mode: 'export', approvedBy: 'A. Engineer', exportAnyway: true });
    expect(anyway.written).toBe(true);
    expect(anyway.exportedAnyway[0]).toMatch(/fail the checks/);
  });
  it('writes real files, never over an existing one, and logs who approved', async () => {
    const a = await run('export_forms_xlsx', { project: 'Villa', mode: 'export', approvedBy: 'A. Engineer' });
    const b = await run('export_forms_xlsx', { project: 'Villa', mode: 'export', approvedBy: 'A. Engineer' });
    expect(b.files[0]).toMatch(/ \(2\)\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fs.readFileSync(a.files[0]) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(['TCL SUMMARY', 'DB-GF1 SCHEDULE']));
    const log = fs.readFileSync(path.join(agentDir(folder), 'exports.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ file: 'Villa.json', tool: 'export_forms_xlsx', approvedBy: 'A. Engineer', exportedAnyway: false });
    expect(read('Villa')).toBe(JSON.stringify(villa, null, 2)); // the project itself is untouched
  });
  it('reports come from the app catalogue as HTML', async () => {
    const r = await run('export_report', { project: 'Villa', report: 'calc-report', mode: 'export', approvedBy: 'A. Engineer' });
    const html = fs.readFileSync(r.files[0], 'utf-8');
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain(sampleProject.name);
    await expect(run('export_report', { project: 'Villa', report: 'ups' })).rejects.toThrow(/No UPS/);
  });
  it('BOQ workbook and earthing DXF', async () => {
    const q = await run('export_boq_xlsx', { project: 'Villa', mode: 'export', approvedBy: 'A. Engineer' });
    expect(fs.readFileSync(q.files[0]).subarray(0, 2).toString()).toBe('PK'); // a zip: .xlsx
    const d = await run('export_dxf', { project: 'Villa', mode: 'export', approvedBy: 'A. Engineer' });
    const dxf = fs.readFileSync(d.files[0], 'utf-8');
    expect(dxf).toContain('ENTITIES');
    expect(dxf.match(/\n\s*TEXT\s*\n/g)?.length ?? 0).toBeGreaterThan(10);
  });
});

describe('delete', () => {
  it('delete_panel previews, needs approvedBy, and can be undone', async () => {
    const before = read('Villa');
    const p = await run('delete_panel', { project: 'Villa', panel: 'SMDB-GF' });
    expect(p.details.panels).toEqual(expect.arrayContaining(['SMDB-GF', 'DB-GF1']));
    expect(read('Villa')).toBe(before);
    await expect(run('delete_panel', { project: 'Villa', panel: 'SMDB-GF', mode: 'apply' })).rejects.toThrow(/approvedBy/);
    const d = await run('delete_panel', { project: 'Villa', panel: 'SMDB-GF', mode: 'apply', approvedBy: 'A. Engineer' });
    expect(d.summary).toMatch(/approved by A\. Engineer/);
    const after = parseProject(read('Villa'), 'Villa.json');
    expect(after.boards.some((b) => b.id === 'SMDB-GF' || b.id === 'DB-GF1')).toBe(false);
    expect(after.feeders.some((f) => f.feedsBoardId === 'SMDB-GF' || f.boardId === 'DB-GF1')).toBe(false);
    await run('undo_change', { project: 'Villa', mode: 'apply' });
    expect(read('Villa')).toBe(before);
  });
  it('delete_circuit deletes a load circuit, not an incomer, and never the last main board', async () => {
    await expect(run('delete_circuit', { project: 'Villa', circuit: 'INC-GF', mode: 'apply', approvedBy: 'A. Engineer' })).rejects.toThrow(/incomer of SMDB-GF/);
    await run('delete_circuit', { project: 'Villa', circuit: 'DB-EV', mode: 'apply', approvedBy: 'A. Engineer' });
    expect(parseProject(read('Villa'), 'Villa.json').feeders.some((f) => f.id === 'DB-EV')).toBe(false);
    await expect(run('delete_panel', { project: 'Villa', panel: 'MDB-1' })).rejects.toThrow(/at least one main board/);
  });
});

it('servers offer exports and deletes only with --write', () => {
  const ro = offeredTools({ folder: '.', anywhere: false }).map((t) => t.name);
  expect(ro).toContain('list_exports');
  expect(ro.filter((n) => n.startsWith('export_') || n.startsWith('delete_'))).toEqual([]);
  expect(offeredTools({ folder: '.', anywhere: false, write: true }).map((t) => t.name)).toEqual(expect.arrayContaining(['export_report', 'export_forms_xlsx', 'export_boq_xlsx', 'export_dxf', 'delete_panel', 'delete_circuit']));
});
