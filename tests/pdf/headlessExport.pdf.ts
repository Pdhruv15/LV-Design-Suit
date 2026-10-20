// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { sampleProject } from '../../src/data/sampleProject';
import { autoSheets } from '../../src/model/drawingSet';
import { main } from '../../src/headless/cli';
import { findRenderer } from '../../src/headless/electronExport';
import type { Project } from '../../src/types';

/** lvds exports made by the app's renderer in Electron (electron/headlessExport.cjs), on the sample project:
 * the Reports → Drawings sheets as DXF and an Export centre report as PDF, through the same approval as every
 * export. Needs Electron (npm install) and the built app (npm run build). */

let root: string, folder: string;
const villa: Project = { ...sampleProject, id: 'proj-villa', drawingSet: autoSheets(sampleProject, 'perMdb', true) };

async function lvds(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '', err = '';
  const code = await main([...argv, '--folder', folder, '--json'], 'test', { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}
const exported = (ext: string) => fs.readdirSync(path.join(folder, 'Exports'), { recursive: true }).map(String).filter((f) => f.endsWith(ext));

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lvds-e2e-'));
  process.env.LVDS_APP_DATA = path.join(root, 'app');
  folder = path.join(root, 'projects');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'Villa.json'), JSON.stringify(villa, null, 2));
});
afterAll(() => { delete process.env.LVDS_APP_DATA; fs.rmSync(root, { recursive: true, force: true }); });

describe('lvds exports through Electron', () => {
  it('finds Electron and the built app', () => {
    expect(findRenderer()).toHaveProperty('command');
    expect(villa.drawingSet!.sheets.map((s) => s.kind)).toEqual(expect.arrayContaining(['system', 'board', 'earthing']));
  });

  it('exports the Reports → Drawings sheets as DXF, after approval', async () => {
    const preview = await lvds('dxf', 'Villa', '--drawing', 'sld');
    expect(preview.code, preview.err).toBe(0);
    const p = JSON.parse(preview.out);
    expect(p).toMatchObject({ mode: 'preview', written: false });
    expect(p.files.length).toBe(villa.drawingSet!.sheets.length);
    expect(fs.existsSync(path.join(folder, 'Exports'))).toBe(false);

    const refused = await lvds('dxf', 'Villa', '--drawing', 'sld', '--export');
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/approvedBy/);

    const done = await lvds('dxf', 'Villa', '--drawing', 'sld', '--export', '--approvedBy', 'A. Engineer');
    expect(done.code, done.err).toBe(0);
    const files = exported('.dxf');
    expect(files.length).toBeGreaterThanOrEqual(villa.drawingSet!.sheets.length);
    for (const s of villa.drawingSet!.sheets) expect(files.some((f) => path.basename(f).startsWith(s.number))).toBe(true);
    for (const f of files) {
      const data = fs.readFileSync(path.join(folder, 'Exports', f), 'utf-8');
      expect(data).toMatch(/^\s*0\r?\nSECTION/);
      expect(data).toMatch(/ENTITIES[\s\S]*TEXT[\s\S]*EOF\s*$/);
    }
    // The sheet's own drawing number is in its title block.
    const first = villa.drawingSet!.sheets[0];
    const own = files.find((f) => path.basename(f).startsWith(first.number))!;
    expect(fs.readFileSync(path.join(folder, 'Exports', own), 'utf-8')).toContain(first.number);
    const log = fs.readFileSync(path.join(folder, '.lvds-agent', 'exports.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log[log.length - 1]).toMatchObject({ tool: 'export_dxf', approvedBy: 'A. Engineer' });
  });

  it('exports only chosen sheet types', async () => {
    const before = exported('.dxf').length;
    const done = await lvds('dxf', 'Villa', '--drawing', 'sld', '--types', 'earthing', '--export', '--approvedBy', 'A. Engineer');
    expect(done.code, done.err).toBe(0);
    expect(JSON.parse(done.out).files).toHaveLength(1);
    expect(exported('.dxf').length).toBe(before + 1);
  });

  it('exports the calculation report as PDF', async () => {
    const preview = await lvds('report', 'Villa', '--report', 'calc-report', '--format', 'pdf');
    expect(preview.code, preview.err).toBe(0);
    expect(JSON.parse(preview.out).files[0].file).toMatch(/\.pdf$/);
    const done = await lvds('report', 'Villa', '--report', 'calc-report', '--format', 'pdf', '--export', '--approvedBy', 'A. Engineer');
    expect(done.code, done.err).toBe(0);
    const [pdf] = exported('.pdf');
    const doc = await PDFDocument.load(fs.readFileSync(path.join(folder, 'Exports', pdf)));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getAuthor()).toBe('A. Engineer');
  });
});
