import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CadDrawing } from '../src/model/cadDrawing';

const require = createRequire(import.meta.url);
const { readDrawingFile } = require('../electron/cadFile.cjs') as { readDrawingFile: (file: string) => Promise<CadDrawing> };
const fixture = (name: string) => join(__dirname, 'fixtures', 'cad', name);

describe('desktop floor plan reader (electron/cadFile.cjs)', () => {
  it('reads DWG and DXF in the main process', async () => {
    const dwg = await readDrawingFile(fixture('plan-2018.dwg'));
    expect(dwg.format).toBe('DWG');
    expect(dwg.entities.find((e) => e.k === 'text')).toMatchObject({ s: 'MAJLIS', ht: 300 });
    expect((await readDrawingFile(fixture('plan-tagged.dxf'))).format).toBe('DXF');
  });

  it('refuses other files, empty files and broken drawings, and still reads afterwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lvds-cadfile-'));
    writeFileSync(join(dir, 'a.txt'), 'x');
    writeFileSync(join(dir, 'empty.dwg'), '');
    writeFileSync(join(dir, 'broken.dwg'), 'AC1032 not a drawing');
    await expect(readDrawingFile(join(dir, 'a.txt'))).rejects.toThrow(/not a DWG or DXF/);
    await expect(readDrawingFile(join(dir, 'empty.dwg'))).rejects.toThrow(/empty/);
    await expect(readDrawingFile(join(dir, 'broken.dwg'))).rejects.toThrow(/could not be read/);
    expect((await readDrawingFile(fixture('plan-2004.dwg'))).entities.length).toBeGreaterThan(50);
  });
});
