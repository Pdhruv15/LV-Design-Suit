import { describe, expect, it } from 'vitest';
import { newProject } from '../types';
import type { ProjectMeta } from './projectStore';
import { applyDetails, detailsOf, facets, filterProjects, NO_FILTERS, parseTags, sortProjects, withArchived } from './projectList';

const d = (y: number, m = 5) => new Date(y, m, 10).getTime();
const list: ProjectMeta[] = [
  { file: 'a.json', name: 'Villa Al Barsha', updatedAt: d(2026), owner: 'Mansoori', plotNo: '123', status: 'design', boards: 5, tags: ['villa', 'DEWA'] },
  { file: 'b.json', name: 'Office Tower', updatedAt: d(2025), owner: 'Emaar', consultant: 'ABC Eng', status: 'approved', boards: 40, tags: ['tower'] },
  { file: 'c.json', name: 'Old warehouse', updatedAt: d(2024), owner: 'Mansoori', status: 'completed', archivedAt: '2025-01-01T00:00:00.000Z', boards: 3 }
];

describe('finding projects', () => {
  it('hides archived ones by default, shows them on request', () => {
    expect(filterProjects(list, NO_FILTERS).map((m) => m.file)).toEqual(['a.json', 'b.json']);
    expect(filterProjects(list, { ...NO_FILTERS, archived: 'archived' }).map((m) => m.file)).toEqual(['c.json']);
    expect(filterProjects(list, { ...NO_FILTERS, archived: 'all' })).toHaveLength(3);
  });
  it('searches words across name, client, consultant, plot, tags and file', () => {
    const f = (text: string) => filterProjects(list, { ...NO_FILTERS, archived: 'all', text }).map((m) => m.file);
    expect(f('villa dewa')).toEqual(['a.json']); // every word, any field
    expect(f('abc')).toEqual(['b.json']);
    expect(f('123')).toEqual(['a.json']);
    expect(f('mansoori')).toEqual(['a.json', 'c.json']);
    expect(f('nothing here')).toEqual([]);
  });
  it('filters by status, client, year and tag together', () => {
    const f = (x: Partial<typeof NO_FILTERS>) => filterProjects(list, { ...NO_FILTERS, archived: 'all', ...x }).map((m) => m.file);
    expect(f({ status: 'approved' })).toEqual(['b.json']);
    expect(f({ client: 'Mansoori', year: '2024' })).toEqual(['c.json']);
    expect(f({ tag: 'villa' })).toEqual(['a.json']);
    expect(f({ client: 'Emaar', tag: 'villa' })).toEqual([]);
  });
  it('lists what can be chosen in each filter', () => {
    expect(facets(list)).toEqual({ clients: ['Emaar', 'Mansoori'], years: ['2026', '2025', '2024'], tags: ['DEWA', 'tower', 'villa'] });
  });
  it('sorts by any column, both ways, numbers as numbers', () => {
    const order = (key: Parameters<typeof sortProjects>[1]['key'], dir: 'asc' | 'desc') => sortProjects(list, { key, dir }).map((m) => m.file);
    expect(order('name', 'asc')).toEqual(['b.json', 'c.json', 'a.json']);
    expect(order('boards', 'desc')).toEqual(['b.json', 'a.json', 'c.json']);
    expect(order('updatedAt', 'desc')).toEqual(['a.json', 'b.json', 'c.json']);
    expect(order('status', 'asc')[0]).toBe('b.json'); // approved < completed < design
  });
});

describe('editing details from the list', () => {
  it('parses tags: commas, trimmed, no empties or repeats', () => {
    expect(parseTags(' villa, DEWA ;; Villa,  2026\n')).toEqual(['villa', 'DEWA', '2026']);
    expect(parseTags('')).toEqual([]);
  });
  it('changes only the details, removes blanks, and never blanks the name', () => {
    const p = { ...newProject('Villa'), info: { owner: 'Old', mdDemandFactor: 0.8, tel: '04 000' } };
    const next = applyDetails(p, { ...detailsOf(p), name: '  ', owner: 'Mansoori', plotNo: '123', consultant: '', tags: ['villa'], notes: ' note ', status: 'review' });
    expect(next.name).toBe('Villa');
    expect(next.info).toEqual({ owner: 'Mansoori', plotNo: '123', mdDemandFactor: 0.8, tel: '04 000' });
    expect(next).toMatchObject({ status: 'review', tags: ['villa'], notes: 'note' });
    expect(next.boards).toBe(p.boards);
    expect(applyDetails(next, { ...detailsOf(next), tags: [], notes: '' })).toMatchObject({ tags: undefined, notes: undefined });
  });
  it('archives and restores without touching anything else', () => {
    const p = newProject('A');
    const a = withArchived(p, true, new Date('2026-10-05T10:00:00Z'));
    expect(a.archivedAt).toBe('2026-10-05T10:00:00.000Z');
    expect(a.boards).toBe(p.boards);
    expect(withArchived(a, false).archivedAt).toBeUndefined();
  });
});
