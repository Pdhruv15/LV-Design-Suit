import { describe, expect, it } from 'vitest';
import { newProject } from '../types';
import { sampleProject } from '../data/sampleProject';
import { copyProject, CURRENT_SCHEMA, isFutureSchema, legacyIdFor, migrateProject } from './projectMigrate';

const legacy = () => { const { id: _i, schemaVersion: _s, createdAt: _c, ...rest } = newProject('Old'); return { ...rest, updatedAt: '2026-03-01T08:00:00.000Z' }; };

describe('project identity and migration', () => {
  it('gives a new project an id, version and creation date', () => {
    const p = newProject('A');
    expect(p.id).toBeTruthy(); expect(p.schemaVersion).toBe(CURRENT_SCHEMA); expect(p.createdAt).toBeTruthy();
    expect(newProject('B').id).not.toBe(p.id);
  });

  it('stamps an old file, with the same legacy id every time it is opened', () => {
    const a = migrateProject(legacy(), 'villa-1.json'), b = migrateProject(legacy(), 'villa-1.json');
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(legacyIdFor('villa-1.json'));
    expect(a.id).not.toBe(legacyIdFor('villa-2.json'));
    expect(a.schemaVersion).toBe(CURRENT_SCHEMA);
    expect(a.createdAt).toBe('2026-03-01T08:00:00.000Z');
  });

  it('takes the creation date from the first issued revision when there is one', () => {
    const p = { ...legacy(), revisions: [{ id: 'A', date: '2026-01-15', description: 'First', snapshot: legacy() }] };
    expect(migrateProject(p, 'x.json').createdAt).toBe(new Date('2026-01-15').toISOString());
  });

  it('is idempotent and returns the same object when nothing is missing', () => {
    const p = newProject('A');
    expect(migrateProject(p, 'a.json')).toBe(p);
    const m = migrateProject(legacy(), 'a.json');
    expect(migrateProject(m, 'a.json')).toBe(m);
  });

  it('gives a file opened from outside the folder a random id once', () => {
    const m = migrateProject(legacy());
    expect(m.id).toBeTruthy(); expect(m.id!.startsWith('legacy-')).toBe(false);
  });

  it('leaves a project from a newer version alone', () => {
    const future = { ...newProject('F'), schemaVersion: CURRENT_SCHEMA + 1 };
    expect(isFutureSchema(future)).toBe(true);
    expect(migrateProject(future, 'f.json')).toBe(future);
  });
});

describe('copying a project', () => {
  const issued = {
    ...sampleProject,
    id: 'orig', status: 'approved' as const, createdBy: 'Asha',
    revisions: [{ id: 'A', date: '2026-02-01', description: 'IFA', snapshot: { ...sampleProject } }],
    drawingSet: { prefix: 'E-SLD-', sheets: [{ id: 's1', number: 'E-SLD-001', title: 'SLD', kind: 'system' as const, boards: ['MDB-1'], size: 'auto' as const, rev: 'A', issuedHash: 'abc', history: [{ rev: 'A', date: '2026-02-01', description: 'IFA' }] }], issues: [{ id: 'T-001', date: '2026-02-01', purpose: 'FOR APPROVAL', description: '', sheets: [] }] }
  };
  const now = new Date('2026-10-05T10:00:00Z');

  it('Save as keeps the design, revisions and transmittals but is a new project that starts at Design', () => {
    const c = copyProject(issued, 'save-as', 'Villa (branch)', 'Ravi', now);
    expect(c.id).not.toBe('orig');
    expect(c.origin).toEqual({ copiedFromId: 'orig', copiedFromName: issued.name, copiedAt: now.toISOString(), kind: 'save-as' });
    expect(c.name).toBe('Villa (branch)');
    expect(c.status).toBeUndefined();
    expect(c.revisions).toHaveLength(1);
    expect(c.drawingSet?.issues).toHaveLength(1);
    expect(c.drawingSet?.sheets[0].history).toHaveLength(1);
    expect(c.boards).toBe(issued.boards);
    expect(c.createdBy).toBe('Ravi'); expect(c.createdAt).toBe(now.toISOString());
  });

  it('Duplicate drops revision history, issue history and transmittals, keeps the sheets', () => {
    const c = copyProject(issued, 'duplicate', 'Next villa', undefined, now);
    expect(c.revisions).toBeUndefined();
    expect(c.drawingSet?.issues).toBeUndefined();
    expect(c.drawingSet?.sheets[0]).toMatchObject({ number: 'E-SLD-001', history: undefined, issuedHash: undefined, rev: undefined });
    expect(c.createdBy).toBe('Asha');
    expect(c.origin?.kind).toBe('duplicate');
  });

  it('never changes the original', () => {
    const before = JSON.stringify(issued);
    copyProject(issued, 'duplicate', 'X', 'Y', now);
    expect(JSON.stringify(issued)).toBe(before);
  });
});
