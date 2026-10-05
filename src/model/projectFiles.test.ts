import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const pf = createRequire(import.meta.url)('../../electron/projectFiles.cjs') as {
  stampOf: (f: string) => { mtimeMs: number; size: number; hash: string } | null;
  decideSave: (e: unknown, d: unknown) => 'write' | 'conflict';
  writeFileSafe: (f: string, t: string, o?: Record<string, boolean>) => { hash: string };
  uniqueFileName: (dir: string, base: string) => string;
  conflictSiblings: (files: string[]) => Record<string, string>;
  writeRecovery: (dir: string, r: Record<string, unknown>) => boolean;
  clearRecovery: (dir: string, id: string) => boolean;
  readRecoveries: (dir: string, projects: string, legacy?: string) => Array<{ projectId: string; at: number; fileChangedSince: boolean; project: { name: string } }>;
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
