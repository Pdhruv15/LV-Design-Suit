// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { sampleProject } from '../data/sampleProject';
import { autoSheets } from '../model/drawingSet';
import type { Project } from '../types';
import { callTool, toolByName, type ToolContext } from './tools';
import { main } from './cli';
import { agentDir } from './write';
import { asarHasHeadlessExport, findRenderer, runInRenderer } from './electronExport';

/** The approval gate of the exports made in Electron (PDF reports, drawing sheets as DXF), with Electron
 * stood in for: it is only started once the export is approved. The real run: tests/pdf/headlessExport.pdf.ts. */

vi.mock('./electronExport', async (orig) => ({
  ...(await orig<typeof import('./electronExport')>()),
  findRenderer: vi.fn(),
  runInRenderer: vi.fn()
}));
const found = { command: '/x/electron', args: ['headlessExport.cjs', '--lvds-headless-export'], where: 'Electron in /x' };

let root: string, folder: string;
let ctx: ToolContext;
const villa: Project = { ...sampleProject, id: 'proj-villa', drawingSet: autoSheets(sampleProject, 'perMdb', true) };
const failing: Project = { ...villa, id: 'proj-failing', feeders: villa.feeders.map((f) => (f.id === 'GF-SKT' ? { ...f, cableCsaMm2: 1.5 } : f)) };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool results are checked field by field
const run = async (name: string, args: Record<string, unknown>): Promise<Record<string, any>> => (await callTool(toolByName(name)!, args, ctx)) as Record<string, any>;
const exported = () => (fs.existsSync(path.join(folder, 'Exports')) ? fs.readdirSync(path.join(folder, 'Exports'), { recursive: true }).map(String).filter((f) => /\.\w+$/.test(f)) : []);
const pdf = new TextEncoder().encode('%PDF-1.7 test');

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-electron-'));
  process.env.LVDS_APP_DATA = path.join(root, 'app');
  vi.stubGlobal('DOMParser', DOMParser);
});
afterAll(() => { delete process.env.LVDS_APP_DATA; vi.unstubAllGlobals(); fs.rmSync(root, { recursive: true, force: true }); });
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(root, 'projects-'));
  fs.writeFileSync(path.join(folder, 'Villa.json'), JSON.stringify(villa));
  fs.writeFileSync(path.join(folder, 'Failing.json'), JSON.stringify(failing));
  ctx = { folder, anywhere: false, write: true };
  vi.mocked(findRenderer).mockReset().mockReturnValue(found);
  vi.mocked(runInRenderer).mockReset().mockImplementation(async (job) => (job.kind === 'report-pdf'
    ? [{ name: 'Villa-calculation-report.pdf', about: 'Calculation report (PDF)', data: pdf }]
    : [{ name: 'E-SLD-001.dxf', about: 'DXF', data: new TextEncoder().encode('0\nSECTION\n0\nEOF\n') }]));
});

describe('PDF reports and drawing sheets through Electron', () => {
  it('preview lists the files without starting Electron', async () => {
    const p = await run('export_report', { project: 'Villa', report: 'calc-report', format: 'pdf' });
    expect(p).toMatchObject({ mode: 'preview', written: false, madeBy: 'Electron in /x' });
    expect(p.files[0].file).toMatch(/calculation-report\.pdf$/);
    const d = await run('export_dxf', { project: 'Villa', drawing: 'sld' });
    expect(d.files.map((f: { file: string }) => f.file)).toEqual(villa.drawingSet!.sheets.map((s) => `${s.number}.dxf`));
    expect(runInRenderer).not.toHaveBeenCalled();
    expect(exported()).toEqual([]);
  });

  it('needs approvedBy, and is refused while checks fail, before Electron starts', async () => {
    await expect(run('export_report', { project: 'Villa', report: 'calc-report', format: 'pdf', mode: 'export' })).rejects.toThrow(/approvedBy/);
    await expect(run('export_dxf', { project: 'Failing', drawing: 'sld', mode: 'export', approvedBy: 'A. Engineer' })).rejects.toThrow(/fail the checks/);
    expect(runInRenderer).not.toHaveBeenCalled();
    expect(exported()).toEqual([]);
    const anyway = await run('export_dxf', { project: 'Failing', drawing: 'sld', mode: 'export', approvedBy: 'A. Engineer', exportAnyway: true });
    expect(anyway.exportedAnyway[0]).toMatch(/fail the checks/);
  });

  it('is refused while proposals wait', async () => {
    await run('propose_changes', { project: 'Villa', title: 'Longer run', reason: 'Route', changes: [{ target: 'feeder', id: 'GF-LTG', field: 'lengthM', value: 31 }], mode: 'propose' });
    await expect(run('export_report', { project: 'Villa', report: 'calc-report', format: 'pdf', mode: 'export', approvedBy: 'A. Engineer' })).rejects.toThrow(/proposals waiting.*MOD-001/);
    expect(runInRenderer).not.toHaveBeenCalled();
  });

  it('writes what Electron made, never over an existing file, and logs who approved', async () => {
    const a = await run('export_report', { project: 'Villa', report: 'calc-report', format: 'pdf', mode: 'export', approvedBy: 'A. Engineer' });
    const b = await run('export_report', { project: 'Villa', report: 'calc-report', format: 'pdf', mode: 'export', approvedBy: 'A. Engineer' });
    expect(fs.readFileSync(a.files[0], 'utf-8')).toBe('%PDF-1.7 test');
    expect(b.files[0]).toMatch(/ \(2\)\.pdf$/);
    expect(vi.mocked(runInRenderer).mock.calls[0][0]).toMatchObject({ kind: 'report-pdf', report: 'calc-report', author: 'A. Engineer', project: { name: villa.name } });
    const log = fs.readFileSync(path.join(agentDir(folder), 'exports.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ tool: 'export_report', approvedBy: 'A. Engineer', exportedAnyway: false });
  });

  it('chooses sheets by number or type; all sheets is the app\'s whole-set export', async () => {
    await run('export_dxf', { project: 'Villa', drawing: 'sld', mode: 'export', approvedBy: 'A. Engineer' });
    expect(vi.mocked(runInRenderer).mock.calls[0][0]).toMatchObject({ kind: 'sheets-dxf', only: undefined });
    const earthing = villa.drawingSet!.sheets.find((s) => s.kind === 'earthing')!;
    const t = await run('export_dxf', { project: 'Villa', drawing: 'sld', types: ['earthing'] });
    expect(t.files.map((f: { file: string }) => f.file)).toEqual([`${earthing.number}.dxf`]);
    await run('export_dxf', { project: 'Villa', drawing: 'sld', sheets: [earthing.number.toLowerCase()], mode: 'export', approvedBy: 'A. Engineer' });
    expect(vi.mocked(runInRenderer).mock.calls[1][0]).toMatchObject({ only: [earthing.id] });
    await expect(run('export_dxf', { project: 'Villa', drawing: 'sld', sheets: ['E-XXX-9'] })).rejects.toThrow(/No sheet E-XXX-9/);
  });

  it('says what is needed when there is no Electron; HTML and the earthing DXF still work', async () => {
    vi.mocked(findRenderer).mockReturnValue({ missing: 'it needs Electron: npm install' });
    await expect(run('export_report', { project: 'Villa', report: 'calc-report', format: 'pdf' })).rejects.toThrow(/A PDF cannot be made here: it needs Electron.*format html/);
    await expect(run('export_dxf', { project: 'Villa', drawing: 'sld' })).rejects.toThrow(/cannot be made here: it needs Electron.*drawing earthing/);
    expect((await run('export_report', { project: 'Villa', report: 'calc-report' })).files[0].file).toMatch(/\.html$/);
    expect((await run('export_dxf', { project: 'Villa', mode: 'export', approvedBy: 'A. Engineer' })).written).toBe(true);
    const l = await run('list_exports', { project: 'Villa' });
    expect(l.pdf).toMatch(/need Electron/);
    expect(l.drawings.find((d: { drawing: string }) => d.drawing === 'sld').unavailable).toMatch(/Needs Electron/);
  });

  it('a project without drawing sheets says where to make them', async () => {
    fs.writeFileSync(path.join(folder, 'Bare.json'), JSON.stringify({ ...sampleProject, id: 'bare', drawingSet: undefined }));
    await expect(run('export_dxf', { project: 'Bare', drawing: 'sld' })).rejects.toThrow(/Reports → Drawings/);
  });

  it('the command line takes a list as comma separated text', async () => {
    let out = '';
    const code = await main(['dxf', 'Villa', '--drawing', 'sld', '--types', 'sld,panel', '--folder', folder, '--json'], 'test', { out: (s) => { out += s; }, err: () => {} });
    expect(code).toBe(0);
    expect(JSON.parse(out).files).toHaveLength(villa.drawingSet!.sheets.filter((s) => s.kind === 'system' || s.kind === 'board').length);
  });
});

describe('installed app', () => {
  const asar = (files: Record<string, unknown>) => {
    const json = Buffer.from(JSON.stringify({ files }));
    const head = Buffer.alloc(16);
    head.writeUInt32LE(4, 0); head.writeUInt32LE(json.length + 8, 4); head.writeUInt32LE(json.length + 4, 8); head.writeUInt32LE(json.length, 12);
    const f = path.join(root, `app-${Math.random().toString(36).slice(2)}.asar`);
    fs.writeFileSync(f, Buffer.concat([head, json]));
    return f;
  };
  it('is used only when its app.asar has the headless export', () => {
    expect(asarHasHeadlessExport(asar({ dist: { files: {} }, electron: { files: { 'main.cjs': {}, 'headlessExport.cjs': {} } } }))).toBe(true);
    expect(asarHasHeadlessExport(asar({ dist: { files: {} }, electron: { files: { 'main.cjs': {} } } }))).toBe(false);
    expect(asarHasHeadlessExport(path.join(root, 'none.asar'))).toBe(false);
  });
});
