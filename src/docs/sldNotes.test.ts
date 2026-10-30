import { describe, expect, it } from 'vitest';
import { abbreviationsIn, DEWA_GENERAL_NOTES } from './sldNotes';
import { buildSldSheetHtml } from './sldSheet';
import { sampleProject } from '../data/sampleProject';

describe('SLD abbreviations', () => {
  it('lists only the abbreviations used in the drawing text', () => {
    const svg = '<svg><text>MDB-1</text><text>CT 1600/5A · ELR</text><text>4C × 240mm² XLPE</text><g><text>ACB</text></g></svg>';
    const a = abbreviationsIn(svg).map(([k]) => k);
    expect(a).toEqual(expect.arrayContaining(['MDB', 'CT', 'ELR', 'XLPE', 'ACB', 'NTS']));
    expect(a).not.toContain('MCC'); // not a substring match of MCCB etc.
    expect(a).not.toContain('UPS');
  });
  it('prints the table on the sheet unless switched off', () => {
    const p = sampleProject;
    const svg = '<svg><text>ACB</text></svg>';
    expect(buildSldSheetHtml(p, svg)).toContain('ABBREVIATIONS');
    expect(buildSldSheetHtml({ ...p, drawing: { ...p.drawing, abbreviations: false } }, svg)).not.toContain('ABBREVIATIONS');
  });
  it('has standard notes', () => expect(DEWA_GENERAL_NOTES.length).toBeGreaterThan(5));
});

describe('sheet title block values', () => {
  it("prints the sheet's own status, revision, date and people", () => {
    const html = buildSldSheetHtml(sampleProject, '<svg></svg>', 'A3', { no: 'E-SLD-002', title: 'SLD — SMDB-FF', count: 3, index: 2, status: 'FOR APPROVAL', rev: 'B', date: '2026-10-01', drawnBy: 'AK', checkedBy: 'PG' });
    for (const t of ['E-SLD-002', 'SLD — SMDB-FF', 'FOR APPROVAL', '2 of 3', '2026-10-01', 'AK', 'PG']) expect(html).toContain(t);
  });
});

describe('sheet furniture scale', async () => {
  const { furnitureScale } = await import('./sldSheet');
  it('keeps the standard 180 mm title block from A3 to A1, whatever the drawing', () => {
    for (const size of ['A3', 'A2', 'A1'] as const) expect(furnitureScale(size)).toBe(1);
    expect(furnitureScale('A1', { w: 180, h: 55 })).toBe(1);
  });
  it('keeps the title block within ≈ 60 % of an A4 sheet', () => {
    const k = furnitureScale('A4');
    expect(180 * k).toBeLessThanOrEqual((297 - 30) * 0.6 + 0.5);
  });
  it('shrinks on A4 only as far as it must: values stay above 2 mm', () => {
    expect(furnitureScale('A4') * 2.5).toBeGreaterThan(2);
  });
});
