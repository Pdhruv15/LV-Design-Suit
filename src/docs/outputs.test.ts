import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { buildSection, scopeOf } from './studyReport';
import { buildStudyDocx, docxBytes } from './studyWord';
import { mergePdfs } from './mergePdf';

describe('Word report and merged PDF', () => {
  it('builds a .docx with the study tables', async () => {
    const run = runCalculations(sampleProject);
    const data = { project: run.project, results: run.results, earthing: run.earthing, selectivity: run.selectivity };
    const scope = scopeOf(sampleProject, { boards: [], downstream: true });
    const sections = [buildSection('sc', data, scope), buildSection('sizing', data, scope)];
    const bytes = await docxBytes(buildStudyDocx(sampleProject, scope, sections, { title: 'Short circuit study', docNo: 'E-CALC-01' }));
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Short circuit study');
    expect(xml).toContain('E-CALC-01');
    expect(xml).toContain('MDB-1');
  });

  it('merges parts and numbers every page', async () => {
    const part = async (n: number) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage([842, 595]); return d.save(); };
    const out = await PDFDocument.load(await mergePdfs([await part(2), await part(3)], 'Villa · Rev A'));
    expect(out.getPageCount()).toBe(5);
  });
});
