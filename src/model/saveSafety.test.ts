import { describe, expect, it } from 'vitest';
import { newProject } from '../types';
import { diffSections, projectFingerprint } from './saveSafety';

describe('project fingerprint', () => {
  it('is the same for the same content, different after a real change', () => {
    const a = newProject('A');
    expect(projectFingerprint(a)).toBe(projectFingerprint(JSON.parse(JSON.stringify(a))));
    expect(projectFingerprint({ ...a, name: 'B' })).not.toBe(projectFingerprint(a));
    expect(projectFingerprint({ ...a, boards: [...a.boards, { ...a.boards[0], id: 'X' }] })).not.toBe(projectFingerprint(a));
  });
});

describe('what differs between two versions', () => {
  const base = newProject('Villa');
  it('ignores who/when saved and reports nothing for identical projects', () => {
    expect(diffSections(base, { ...base, updatedAt: '2030-01-01', updatedBy: 'X' })).toEqual([]);
  });
  it('names the sections that changed, with counts for lists', () => {
    const theirs = { ...base, name: 'Villa 2', boards: [...base.boards, { ...base.boards[0], id: 'SMDB-1' }], status: 'review' as const };
    const d = Object.fromEntries(diffSections(base, theirs).map((c) => [c.key, c]));
    expect(d.name.label).toBe('Project name');
    expect(d.boards).toMatchObject({ label: 'Panels', detail: '1 → 2, 1 only in the other' });
    expect(d.status.detail).toBe('only in the other');
    const edited = diffSections(base, { ...base, boards: [{ ...base.boards[0], ratedCurrentA: 2000 }] });
    expect(edited[0].detail).toBe('1 → 1, 1 edited');
  });
});
