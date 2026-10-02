import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addSheet, applyTemplate, issueSheets, sheetChecks, sheetHash, sheetsByCount, templateFromSheet } from './drawingSet';

describe('publishing checks', () => {
  const set = sheetsByCount(sampleProject, 10);
  it('flags panels on no sheet and empty sheets', () => {
    const one = { ...set, sheets: [{ ...set.sheets[0], boards: set.sheets[0].boards.slice(0, 1) }] };
    const c = sheetChecks(sampleProject, addSheet(one, [], 'empty').set);
    expect(c.some((x) => x.text.includes('is on no sheet'))).toBe(true);
    expect(c.some((x) => x.text.includes('no panels'))).toBe(true);
  });
  it('flags a sheet changed since it was issued', () => {
    const issued = issueSheets(set, set.sheets.map((s) => s.id), { date: '2026-10-01', purpose: 'FOR APPROVAL', description: '', bump: true }, undefined, (s) => sheetHash(sampleProject, set, s)).set;
    expect(sheetChecks(sampleProject, issued).some((x) => x.text.includes('changed since'))).toBe(false);
    const changed = { ...sampleProject, feeders: sampleProject.feeders.map((f, i) => (i === 0 ? { ...f, lengthM: f.lengthM + 5 } : f)) };
    expect(sheetChecks(changed, issued).some((x) => x.text.includes('changed since'))).toBe(true);
  });
  it('flags failing circuits on the sheets', () => {
    const f = sampleProject.feeders[0];
    expect(sheetChecks(sampleProject, set, [{ feederId: f.id, boardId: f.boardId, status: 'fail' }]).some((x) => x.level === 'bad' && x.text.includes('fail'))).toBe(true);
  });
  it('templates carry paper, cable text, view, notes', () => {
    const s = { ...set.sheets[0], size: 'A2' as const, cableLabels: 'ref' as const, notes: ['N1'] };
    const t = templateFromSheet(s, 'Big');
    const applied = applyTemplate(set.sheets[0], t);
    expect([applied.size, applied.cableLabels, applied.notes]).toEqual(['A2', 'ref', ['N1']]);
  });
});
