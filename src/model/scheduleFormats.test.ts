// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_KEYS } from '../database/librarySync';
import { sampleProject } from '../data/sampleProject';
import { FORMATS_KEY, formatNameError, loadFormats, projectFormat, projectFormatStale, removeFormat, renameFormat, saveFormats, withFormat, withProjectFormat, type ScheduleFormat } from './scheduleFormats';
import { newSheet, type Sheet } from './sheets';

const tpl = (): Sheet => ({ ...newSheet(), link: { category: 'db', cells: {}, firstRow: 5, rows: [], columns: { A: 'row.ref' } } });
const fmt = (id: string, name: string): ScheduleFormat => ({ id, name, category: 'db', sheet: tpl(), updatedAt: '2026-11-14' });
beforeEach(() => localStorage.clear());

describe('schedule formats library', () => {
  it('is one of the synced libraries', () => {
    expect(FORMATS_KEY).toBe('lvds.scheduleFormats');
    expect(LIBRARY_KEYS).toContain(FORMATS_KEY);
  });
  it('loads what was saved, drops bad entries and survives broken JSON', () => {
    expect(loadFormats()).toEqual([]);
    saveFormats([fmt('a', 'Alpha')]);
    expect(loadFormats()).toEqual([fmt('a', 'Alpha')]);
    localStorage.setItem(FORMATS_KEY, JSON.stringify([fmt('a', 'Alpha'), { id: '', name: 'x', sheet: tpl() }, { id: 'b', sheet: tpl() }, { id: 'c', name: 'No link', sheet: newSheet() }, { id: 'd', name: 'No sheet' }, null, 5]));
    expect(loadFormats().map((f) => f.id)).toEqual(['a']);
    localStorage.setItem(FORMATS_KEY, '{not json');
    expect(loadFormats()).toEqual([]);
    localStorage.setItem(FORMATS_KEY, '{"a":1}');
    expect(loadFormats()).toEqual([]);
  });
  it('gives a format its category: none means db, and the sheet\'s link wins when the two differ', () => {
    const md = (): Sheet => ({ ...tpl(), link: { ...tpl().link!, category: 'md' } });
    const { category: _c, ...bare } = fmt('n', 'None');
    localStorage.setItem(FORMATS_KEY, JSON.stringify([bare, { ...fmt('m', 'Panel'), category: 'db', sheet: md() }, { ...fmt('p', 'Panel 2'), category: 'md', sheet: md() }, { ...fmt('q', 'Odd'), category: 'md' }]));
    expect(loadFormats().map((f) => [f.id, f.category])).toEqual([['n', 'db'], ['m', 'md'], ['p', 'md'], ['q', 'db']]);
  });
  it('withFormat takes the category from the template\'s link, on a new format and on a replaced one', () => {
    const md: Sheet = { ...tpl(), link: { ...tpl().link!, category: 'md' } };
    const added = withFormat([], 'Office panel', md, new Date('2026-11-14T10:00:00Z'));
    expect(added.list[0].category).toBe('md');
    const same = withFormat(added.list, 'office PANEL', tpl());
    expect([same.updated, same.list[0].category]).toEqual([true, 'db']);
  });
  it('withFormat adds a new one, and replaces by name ignoring case', () => {
    const added = withFormat([], ' Office DB ', tpl(), new Date('2026-11-14T10:00:00Z'));
    expect(added.updated).toBe(false);
    expect(added.list).toHaveLength(1);
    expect(added.list[0]).toMatchObject({ name: 'Office DB', category: 'db', updatedAt: '2026-11-14' });
    expect(added.list[0].id).toMatch(/^fmt-/);
    const again = withFormat(added.list, 'office db', { ...tpl(), name: 'newer' }, new Date('2026-12-01T10:00:00Z'));
    expect(again.updated).toBe(true);
    expect(again.list).toHaveLength(1);
    expect(again.list[0]).toMatchObject({ id: added.list[0].id, name: 'Office DB', updatedAt: '2026-12-01' });
    expect(again.list[0].sheet.name).toBe('newer');
  });
  it('rename and remove give new lists', () => {
    const list = [fmt('a', 'Alpha'), fmt('b', 'Beta')];
    expect(renameFormat(list, 'b', ' Gamma ').map((f) => f.name)).toEqual(['Alpha', 'Gamma']);
    expect(list[1].name).toBe('Beta');
    expect(removeFormat(list, 'a').map((f) => f.id)).toEqual(['b']);
  });
  it('names: needed, 60 characters, not another format\'s', () => {
    const list = [fmt('a', 'Alpha')];
    expect(formatNameError('  ', list)).toBe('Give the format a name.');
    expect(formatNameError('x'.repeat(61), list)).toBe('Keep the name to 60 characters.');
    expect(formatNameError('x'.repeat(60), list)).toBeUndefined();
    expect(formatNameError(' ALPHA ', list)).toBe('Another format has this name.');
    expect(formatNameError('alpha', list, 'a')).toBeUndefined();
    expect(formatNameError('Beta', list)).toBeUndefined();
  });
});

describe('the format a project uses', () => {
  const alpha = fmt('a', 'Alpha');
  it('withProjectFormat sets a copy, replaces it, and removes it without leaving an empty object', () => {
    expect(projectFormat(sampleProject)).toBeUndefined();
    const p = withProjectFormat(sampleProject, alpha, new Date('2026-11-14T10:00:00Z'));
    expect(projectFormat(p)).toEqual({ id: 'a', name: 'Alpha', sheet: alpha.sheet, appliedAt: '2026-11-14' });
    expect(sampleProject.scheduleFormats).toBeUndefined();
    const q = withProjectFormat(p, fmt('b', 'Beta'), new Date('2026-12-01T10:00:00Z'));
    expect(projectFormat(q)).toMatchObject({ id: 'b', name: 'Beta', appliedAt: '2026-12-01' });
    const gone = withProjectFormat(q, undefined);
    expect(gone).not.toHaveProperty('scheduleFormats');
    expect(withProjectFormat(sampleProject, undefined)).toEqual(sampleProject);
  });
  it('is stale when My formats has the format with a different sheet, and not otherwise', () => {
    const p = withProjectFormat(sampleProject, alpha);
    expect(projectFormatStale(p, [alpha])).toBe(false);
    expect(projectFormatStale(p, [{ ...alpha, sheet: { ...alpha.sheet, name: 'changed' } }])).toBe(true);
    expect(projectFormatStale(p, [fmt('other', 'Alpha')])).toBe(false);
    expect(projectFormatStale(p, [])).toBe(false);
    expect(projectFormatStale(sampleProject, [alpha])).toBe(false);
  });
});
