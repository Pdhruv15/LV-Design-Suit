import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { projectWithCircuits } from '../../tests/fixtures/largeProject';
import { buildDbSheet } from './dbSheet';
import { buildFormWorkbook, workbookBytes } from './formWorkbook';
import { buildStudyReportHtml, scopeOf, type Section } from './studyReport';
import { buildStudyDocx, docxBytes } from './studyWord';

const COUNT = 510;
const largeSection = (count: number): Section => ({
  key: 'cable',
  title: 'Large circuit export',
  method: ['Export every circuit without truncation.'],
  summary: [{ label: 'Circuits', value: String(count) }],
  statuses: [],
  tables: [{
    title: 'Circuit register',
    headers: ['Circuit', 'Description', 'Load'],
    rows: Array.from({ length: count }, (_, i) => [`LARGE-${String(i + 1).padStart(4, '0')}`, `Large project circuit ${i + 1}`, '0.10 kW'])
  }]
});

describe('Office exports for projects with 500+ circuits', () => {
  it('builds and round-trips the complete Excel DB schedule', async () => {
    const project = projectWithCircuits(COUNT);
    const sheet = buildDbSheet(project, 'DB-GF1');
    expect(sheet.rows.filter((row) => row.type === 'circuit')).toHaveLength(COUNT);
    expect(sheet.rows.find((row) => row.type === 'circuit' && row.feeder.id === 'LARGE-0510')).toBeTruthy();

    const bytes = await workbookBytes(buildFormWorkbook(project, { boardIds: ['DB-GF1'], forms: ['db'] }));
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(bytes.buffer as ArrayBuffer);
    const values: string[] = [];
    back.worksheets[0].eachRow((row) => row.eachCell((cell) => values.push(String(cell.value ?? ''))));
    expect(values).toContain('Area 1');
    expect(values).toContain(`Area ${COUNT}`);
  }, 30_000);

  it('keeps the first and last circuit in DOCX and PDF report sources', async () => {
    const project = projectWithCircuits(COUNT);
    const section = largeSection(COUNT);
    const scope = scopeOf(project, { boards: [], downstream: true });
    const html = buildStudyReportHtml(project, scope, [section], { title: 'Large export' });
    expect(html).toContain('LARGE-0001');
    expect(html).toContain('LARGE-0510');

    const bytes = await docxBytes(buildStudyDocx(project, scope, [section], { title: 'Large export' }));
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
    expect(xml).toContain('LARGE-0001');
    expect(xml).toContain('LARGE-0510');
  }, 30_000);
});
