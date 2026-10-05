import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { metaOf } from './projectStore';
import { newProject } from '../types';

const pf = createRequire(import.meta.url)('../../electron/projectFiles.cjs') as {
  stampOf: (f: string) => { mtimeMs: number; size: number; hash: string } | null;
  decideSave: (e: unknown, d: unknown) => 'write' | 'conflict';
  writeFileSafe: (f: string, t: string, o?: Record<string, boolean>) => { hash: string };
  uniqueFileName: (dir: string, base: string) => string;
  conflictSiblings: (files: string[]) => Record<string, string>;
  writeRecovery: (dir: string, r: Record<string, unknown>) => boolean;
  clearRecovery: (dir: string, id: string) => boolean;
  readRecoveries: (dir: string, projects: string, legacy?: string) => Array<{ projectId: string; at: number; fileChangedSince: boolean; project: { name: string } }>;
  metaFromProject: (file: string, p: unknown, updatedAt: number) => Record<string, unknown>;
  listProjectsMeta: (folder: string, cache: string) => { list: Array<Record<string, unknown>>; parsed: number };
  moveToTrash: (folder: string, file: string, now?: number) => string;
  listTrash: (folder: string, now?: number) => Array<{ trashFile: string; file: string; name: string; daysLeft: number; deletedAt: number }>;
  restoreFromTrash: (folder: string, trashFile: string) => string;
  purgeTrash: (folder: string, days?: number, now?: number) => number;
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lvds-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('saving over a file someone else changed', () => {
  it('decides: free to write when missing, unchanged or unknown; conflict when the content differs', () => {
    const a = { mtimeMs: 1, size: 10, hash: 'aaa' };
    expect(pf.decideSave(a, null)).toBe('write');
    expect(pf.decideSave(undefined, a)).toBe('write');
    expect(pf.decideSave(a, { ...a, mtimeMs: 99 })).toBe('write'); // a sync tool touched its date only
    expect(pf.decideSave(a, { ...a, hash: 'bbb' })).toBe('conflict');
  });

  it('notices an external edit through the file stamp', () => {
    const f = join(dir, 'p.json');
    const mine = pf.writeFileSafe(f, '{"v":1}');
    expect(pf.stampOf(f)).toMatchObject({ hash: mine.hash });
    writeFileSync(f, '{"v":2}');
    expect(pf.decideSave(mine, pf.stampOf(f))).toBe('conflict');
    expect(pf.stampOf(join(dir, 'missing.json'))).toBeNull();
  });
});

describe('safe writing', () => {
  it('keeps the previous version as .bak and, after a conflict, under its own name', () => {
    const f = join(dir, 'p.json');
    pf.writeFileSafe(f, 'one');
    pf.writeFileSafe(f, 'two', { keepTheirs: true });
    expect(readFileSync(f, 'utf-8')).toBe('two');
    expect(readFileSync(`${f}.bak`, 'utf-8')).toBe('one');
    expect(readdirSync(dir).some((n) => /^p\.json\.theirs-\d+\.bak$/.test(n))).toBe(true);
    expect(readdirSync(dir).some((n) => n.includes('.tmp-'))).toBe(false);
  });

  it('refuses to report success for invalid JSON when asked to check it', () => {
    expect(() => pf.writeFileSafe(join(dir, 'q.json'), '{broken', { verifyJson: true })).toThrow();
  });

  it('never reuses a file name', () => {
    writeFileSync(join(dir, 'villa.json'), '{}');
    writeFileSync(join(dir, 'villa-2.json'), '{}');
    expect(pf.uniqueFileName(dir, 'villa')).toBe('villa-3.json');
    expect(pf.uniqueFileName(dir, 'tower')).toBe('tower.json');
  });
});

describe('sync conflict copies', () => {
  it('finds conflicted copies of a project file that exists, and nothing else', () => {
    const files = ['villa.json', "villa (John's conflicted copy 2026-10-05).json", 'villa (1).json', 'villa.sync-conflict-20261005-101010-ABC.json', 'tower (2).json', 'office-1a2b3c4d.json'];
    const m = pf.conflictSiblings(files);
    expect(m).toEqual({ "villa (John's conflicted copy 2026-10-05).json": 'villa.json', 'villa (1).json': 'villa.json', 'villa.sync-conflict-20261005-101010-ABC.json': 'villa.json' });
  });
});

describe('recovery copies, one per project', () => {
  const rec = (id: string, name: string, at: number, file?: string) => ({ projectId: id, file, at, project: { id, name, boards: [] } });

  it('keeps each project’s recovery separate: saving B does not overwrite A', () => {
    const rdir = join(dir, 'recovery');
    pf.writeRecovery(rdir, rec('a', 'A', 100)); pf.writeRecovery(rdir, rec('b', 'B', 200)); pf.writeRecovery(rdir, rec('a', 'A2', 300));
    const all = pf.readRecoveries(rdir, dir);
    expect(all.map((r) => r.project.name)).toEqual(['A2', 'B']); // newest first, one per project
    pf.clearRecovery(rdir, 'a');
    expect(pf.readRecoveries(rdir, dir).map((r) => r.projectId)).toEqual(['b']);
  });

  it('flags, but keeps, a recovery whose project file changed after it', () => {
    const rdir = join(dir, 'recovery'), file = join(dir, 'p.json');
    writeFileSync(file, '{}'); utimesSync(file, new Date(5000), new Date(5000));
    pf.writeRecovery(rdir, rec('a', 'A', 1000, 'p.json'));
    expect(pf.readRecoveries(rdir, dir)[0].fileChangedSince).toBe(true);
    pf.writeRecovery(rdir, rec('a', 'A', 9_000_000, 'p.json'));
    expect(pf.readRecoveries(rdir, dir)[0].fileChangedSince).toBe(false);
  });

  it('moves the old single recovery file into the folder', () => {
    const rdir = join(dir, 'recovery'), legacy = join(dir, 'recovery.json');
    writeFileSync(legacy, JSON.stringify({ at: 50, file: 'x.json', project: { name: 'Old', boards: [] } }));
    const all = pf.readRecoveries(rdir, dir, legacy);
    expect(all).toHaveLength(1); expect(all[0].project.name).toBe('Old'); expect(all[0].projectId).toBe('legacy-single');
    expect(existsSync(legacy)).toBe(false);
  });

  it('needs a project id', () => {
    expect(() => pf.writeRecovery(join(dir, 'r'), { at: 1, project: { name: 'x', boards: [] } })).toThrow();
  });
});

const save = (folder: string, file: string, p: unknown) => writeFileSync(join(folder, file), JSON.stringify(p));

describe('the projects list', () => {
  it('shows the same details whether made by the app or by the desktop main process', () => {
    const p = { ...sampleProject, id: 'x1', createdAt: '2026-01-01T00:00:00.000Z', tags: ['villa'], archivedAt: undefined, revisions: [{ id: 'A', date: '2026-02-01', description: '', snapshot: sampleProject }], info: { ...sampleProject.info, consultant: 'ABC', contractor: 'XYZ' } };
    const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    expect(strip(pf.metaFromProject('f.json', p, 5))).toEqual(strip(metaOf('f.json', p, 5) as unknown as Record<string, unknown>));
  });

  it('reads a file again only when it changed (cache), and drops files that are gone', () => {
    const cache = join(dir, 'index.json'), folder = join(dir, 'projects');
    mkdirSync(folder);
    save(folder, 'a.json', { ...newProject('A'), tags: ['x'] }); save(folder, 'b.json', newProject('B'));
    const first = pf.listProjectsMeta(folder, cache);
    expect(first.parsed).toBe(2);
    expect(first.list.map((m) => m.name).sort()).toEqual(['A', 'B']);
    expect(pf.listProjectsMeta(folder, cache).parsed).toBe(0);
    save(folder, 'a.json', { ...newProject('A2'), tags: ['x', 'y'] });
    const third = pf.listProjectsMeta(folder, cache);
    expect(third.parsed).toBe(1);
    expect(third.list.find((m) => m.file === 'a.json')).toMatchObject({ name: 'A2', tags: ['x', 'y'] });
    rmSync(join(folder, 'b.json'));
    expect(pf.listProjectsMeta(folder, cache).list.map((m) => m.file)).toEqual(['a.json']);
    save(folder, 'broken.json', {}); writeFileSync(join(folder, 'broken.json'), '{nope');
    expect(pf.listProjectsMeta(folder, cache).list.find((m) => m.file === 'broken.json')).toMatchObject({ name: 'broken' }); // still listed
  });

  it('flags sync conflict copies in the list without keeping the flag in the cache', () => {
    const cache = join(dir, 'i.json'), folder = join(dir, 'p2');
    mkdirSync(folder);
    save(folder, 'villa.json', newProject('V')); save(folder, 'villa (1).json', newProject('V'));
    expect(pf.listProjectsMeta(folder, cache).list.find((m) => m.file === 'villa (1).json')).toMatchObject({ conflictOf: 'villa.json' });
    rmSync(join(folder, 'villa.json'));
    expect(pf.listProjectsMeta(folder, cache).list.find((m) => m.file === 'villa (1).json')?.conflictOf).toBeUndefined();
  });
});

describe('trash', () => {
  const DAY = 86400000;
  it('moves a project and its backup to the trash, lists it with days left, and restores it', () => {
    save(dir, 'villa.json', newProject('Villa')); writeFileSync(join(dir, 'villa.json.bak'), 'old');
    const now = 1_800_000_000_000;
    const t = pf.moveToTrash(dir, 'villa.json', now);
    expect(existsSync(join(dir, 'villa.json'))).toBe(false);
    const listed = pf.listTrash(dir, now + 10 * DAY);
    expect(listed).toMatchObject([{ trashFile: t, file: 'villa.json', name: 'Villa', daysLeft: 20 }]);
    expect(pf.restoreFromTrash(dir, t)).toBe('villa.json');
    expect(readFileSync(join(dir, 'villa.json.bak'), 'utf-8')).toBe('old');
    expect(pf.listTrash(dir)).toEqual([]);
  });
  it('restores under a new name when the old one is taken, and never overwrites', () => {
    save(dir, 'villa.json', newProject('First'));
    const t = pf.moveToTrash(dir, 'villa.json', 1);
    save(dir, 'villa.json', newProject('Second'));
    expect(pf.restoreFromTrash(dir, t)).toBe('villa-2.json');
    expect(JSON.parse(readFileSync(join(dir, 'villa.json'), 'utf-8')).name).toBe('Second');
  });
  it('removes only what has been there more than 30 days, or everything when emptied', () => {
    const now = 1_800_000_000_000;
    save(dir, 'old.json', newProject('Old')); save(dir, 'new.json', newProject('New'));
    pf.moveToTrash(dir, 'old.json', now - 31 * DAY); pf.moveToTrash(dir, 'new.json', now - 2 * DAY);
    expect(pf.purgeTrash(dir, 30, now)).toBe(1);
    expect(pf.listTrash(dir, now).map((x) => x.file)).toEqual(['new.json']);
    expect(pf.purgeTrash(dir, 0, now)).toBe(1);
    expect(pf.listTrash(dir, now)).toEqual([]);
  });
  it('refuses to restore something that is not in the trash naming', () => {
    expect(() => pf.restoreFromTrash(dir, '../../etc/passwd')).toThrow();
  });
});
