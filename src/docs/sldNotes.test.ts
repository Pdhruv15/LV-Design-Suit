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
