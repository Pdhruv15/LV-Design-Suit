import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addSheet, fromSheetLabels, renumber, sheetChecks, sheetProject, sheetRefs, type DrawingSet } from './drawingSet';

const p = sampleProject;
// MDB on sheet 1, everything else on sheet 2.
const mdb = p.boards.find((b) => !b.upstreamId)!;
const rest = p.boards.filter((b) => b.id !== mdb.id).map((b) => b.id);
const base: DrawingSet = renumber({ prefix: 'E-SLD-', sheets: [
  { id: 'a', number: '', title: 'Main', kind: 'system', boards: [mdb.id], size: 'auto' },
  { id: 'b', number: '', title: 'Subs', kind: 'system', boards: rest, size: 'auto' }
] });

describe('cross-sheet references', () => {
  it('both ways: To on the feeding sheet, From on the fed sheet, with sheet numbers', () => {
    const [a, b] = base.sheets;
    const out = sheetRefs(p, base, a).outgoing;
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((r) => r.sheet?.id === 'b')).toBe(true);
    const inc = sheetRefs(p, base, b).incoming;
    expect(inc.length).toBeGreaterThan(0);
    expect(inc.every((r) => r.boardId === mdb.id && r.sheet?.id === 'a' && r.feederId)).toBe(true);
    // every outgoing reference has its reciprocal
    for (const r of out) expect(p.boards.find((x) => x.id === r.boardId)?.upstreamId).toBe(mdb.id);
    const labels = fromSheetLabels(p, base, b);
    expect(Object.values(labels).every((n) => n === a.number)).toBe(true);
    expect(sheetProject(p, base, a).feeders.some((f) => f.name === `To ${out[0].boardId} — sheet ${b.number}`)).toBe(true);
  });

  it('renumbering updates every reference', () => {
    const swapped = renumber({ ...base, sheets: [base.sheets[1], base.sheets[0]] });
    const a = swapped.sheets.find((s) => s.id === 'a')!, b = swapped.sheets.find((s) => s.id === 'b')!;
    expect(a.number).not.toBe(base.sheets[0].number);
    expect(Object.values(fromSheetLabels(p, swapped, b))[0]).toBe(a.number);
    expect(sheetProject(p, swapped, a).feeders.some((f) => f.name?.endsWith(`sheet ${b.number}`))).toBe(true);
  });

  it('flags a reference to a panel on no sheet; a panel on an overview and its own sheet is fine', () => {
    const only = { ...base, sheets: [base.sheets[0]] };
    const c = sheetChecks(p, only);
    expect(c.some((x) => /“To .*” has no sheet to point to/.test(x.text))).toBe(true);
    const twice = addSheet(base, [rest[0]], 'again').set;
    expect(sheetChecks(p, twice).some((x) => /no sheet to point to/.test(x.text))).toBe(false);
    expect(sheetChecks(p, base).some((x) => /no sheet to point to/.test(x.text))).toBe(false);
  });
});
