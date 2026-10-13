import { describe, expect, it } from 'vitest';
import type { BomItem } from '../calc/bom';
import { sampleProject } from '../data/sampleProject';
import { buildBoqHtml, buildBoqWorkbook } from '../docs/boqWorkbook';
import type { Project } from '../types';
import { boqRevisionState, compareLines, issueBoqRevision, linesOf, numberBom } from './boqRevisions';
import { newPriceList, priceBom, type BoqCustom } from './priceList';

const it1 = (key: string, qty: number, description = key): BomItem => ({ key, section: 'E', description, unit: 'm', qty, where: [] });
const list = { ...newPriceList(), rates: { a: { rate: 10 }, b: { rate: 20 }, c: { rate: 30 }, d: { rate: 40 } } };
const base: Project = { ...sampleProject, boqRevisions: undefined };
const bomOf = (items: BomItem[], p: Project = base, custom?: BoqCustom) => numberBom(priceBom(items, list, custom), p.boqRevisions);
const issue = (p: Project, items: BomItem[], description = 'Issue') => issueBoqRevision(p, bomOf(items, p), { description, date: '2026-10-01' }, 'AED');

describe('BOQ revisions', () => {
  it('numbers 1, 2, 3 before the first issue and keeps issued numbers after', () => {
    const v0 = [it1('a', 1), it1('b', 1), it1('c', 1)];
    expect(bomOf(v0).items.map((x) => x.no)).toEqual(['E.1', 'E.2', 'E.3']);
    const p = issue(base, v0);
    expect(p.boqRevisions?.map((r) => r.id)).toEqual(['0']);
    // b omitted, d added between a and c in the bill's own order: numbers do not shift, d is numbered last.
    const bom = bomOf([it1('a', 1), it1('d', 1), it1('c', 1)], p);
    expect(bom.sections[0].items.map((x) => [x.key, x.no])).toEqual([['a', 'E.1'], ['c', 'E.3'], ['d', 'E.4']]);
  });

  it('lists added, omitted, quantity, rate and scope changes with the amount change', () => {
    const before = linesOf(bomOf([it1('a', 1), it1('b', 2), it1('c', 3)]));
    const after = linesOf(numberBom(priceBom([it1('a', 1), it1('c', 5), it1('d', 1)], { ...list, rates: { ...list.rates, a: { rate: 12 } } }, { overrides: { a: { supplyBy: 'client' } } })));
    const changes = compareLines(before, after);
    expect(changes.map((c) => [c.key, c.kinds, c.delta]).sort((x, y) => String(x[0]).localeCompare(String(y[0])))).toEqual([
      ['a', ['rate', 'scope'], -10], ['b', ['omitted'], -40], ['c', ['quantity'], 60], ['d', ['added'], 40]
    ]);
  });

  it('shows a draft before the first issue, the issued revision when unchanged, and the next revision as a draft after a change', () => {
    const v0 = [it1('a', 1), it1('b', 1)];
    expect(boqRevisionState(base, bomOf(v0))).toEqual({ draft: true, changes: [] });
    const p0 = issue(base, v0);
    expect(boqRevisionState(p0, bomOf(v0, p0))).toMatchObject({ draft: false, rev: '0', changes: [] });
    const v1 = [it1('a', 2)];
    const draft = boqRevisionState(p0, bomOf(v1, p0));
    expect(draft).toMatchObject({ draft: true, rev: '1' });
    expect(draft.changes.map((c) => c.kinds[0])).toEqual(['quantity', 'omitted']);
    const p1 = issue(p0, v1, 'Addendum 1');
    const issued = boqRevisionState(p1, bomOf(v1, p1));
    expect(issued).toMatchObject({ draft: false, rev: '1', previous: { id: '0' } });
    expect(issued.changes).toHaveLength(2);
  });

  it('keeps BOQ revisions out of design revision snapshots', async () => {
    const { snapshotOf } = await import('./revisions');
    expect('boqRevisions' in snapshotOf(issue(base, [it1('a', 1)]))).toBe(false);
  });

  it('marks changed lines in the PDF with grey shading and △, keeps omitted lines struck through, and adds the revision summary', () => {
    const p0 = issue(base, [it1('a', 1, 'Cable A'), it1('b', 1, 'Cable B')]);
    const p1 = issue(p0, [it1('a', 3, 'Cable A')], 'Addendum 1');
    const bom = bomOf([it1('a', 3, 'Cable A')], p1);
    const html = buildBoqHtml(p1, bom, list);
    expect(html).toMatch(/<tr class="chg"><td><svg class="tri"[^]*?>1<\/text><\/svg> E\.1<\/td><td>Cable A[^]*?Rev 1: qty 1 → 3/);
    expect(html).toMatch(/<tr class="chg"><td><svg class="tri"[^]*?<\/svg> E\.2<\/td><td><s>Cable B<\/s>[^]*?<i>Omitted<\/i>/);
    expect(html).toContain('<section id="boq-revisions" class="page">');
    expect(html).toContain('Revision summary — Rev 1');
    expect(html).toContain('<tr><td>Revision</td><td>Rev 1 — 01 Oct 2026</td></tr>');
    expect(html).toMatch(/@bottom-left \{ content: "Rev 1 · 01 Oct 2026"/);
    // A change after the issue is the next revision, as a draft.
    const draft = buildBoqHtml(p1, bomOf([it1('a', 4, 'Cable A')], p1), list);
    expect(draft).toContain('Rev 2 (draft)');
    expect(draft).toContain('Rev 2: qty 3 → 4');
  });

  it('marks the same lines in Excel and adds a revision summary sheet', () => {
    const p0 = issue(base, [it1('a', 1, 'Cable A'), it1('b', 1, 'Cable B')]);
    const p1 = issue(p0, [it1('a', 3, 'Cable A')], 'Addendum 1');
    const wb = buildBoqWorkbook(p1, bomOf([it1('a', 3, 'Cable A')], p1), list);
    const notes: string[] = [];
    wb.getWorksheet('BOQ')!.eachRow((row) => { if (row.number < 4) return; const v = row.getCell(9).value; if (typeof v === 'string') notes.push(`${row.getCell(1).value} ${v}`); });
    expect(notes).toEqual(['Item Revision (Rev 1)', 'E.1 △1 qty 1 → 3', 'E.2 △1 omitted (was 1 m, 20.00)']);
    expect(wb.worksheets.map((s) => s.name)).toContain('Revision summary');
    expect(wb.getWorksheet('BOQ')!.getCell(2, 1).value).toMatch(/^Bill of quantities — BOQ Rev 1 · 2026-10-01/);
  });
});
