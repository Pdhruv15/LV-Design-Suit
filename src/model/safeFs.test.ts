import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Fn = (...a: unknown[]) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
const require = createRequire(import.meta.url);
const S = require('../../electron/safeFs.cjs') as Record<'readFileNoFollow' | 'writeNewFile' | 'replaceFile' | 'copyFileNoFollow' | 'ensureRealDir' | 'listFiles' | 'makePrivateTempDir' | 'removeDir', Fn>;
const P = require('../../electron/projectFiles.cjs') as Record<'writeFileSafe' | 'listProjectsMeta' | 'readRecoveries' | 'writeRecovery' | 'moveToTrash' | 'listTrash' | 'restoreFromTrash' | 'purgeTrash', Fn>;
const L = require('../../electron/limits.cjs') as Record<'readJsonLimited', Fn>;
const DB = require('../../electron/database.cjs') as { setFolder: (d: string | null) => void; writeBook: Fn; ensureDatabase: Fn; spec: { books: { id: string; file: string }[] } };

/** Symbolic links need permission on Windows; skip there when they cannot be made. */
const canLink = (() => {
  const d = mkdtempSync(join(tmpdir(), 'lvds-link-'));
  try { symlinkSync(join(d, 'x'), join(d, 'y')); return true; } catch { return false; } finally { rmSync(d, { recursive: true, force: true }); }
})();
const it_ = canLink ? it : it.skip; // skipped where symbolic links cannot be created (Windows without the right)

let root: string, folder: string, outside: string, victim: string;
const VICTIM = 'outside the projects folder — must never change';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lvds-safefs-'));
  folder = join(root, 'projects');
  outside = join(root, 'outside');
  mkdirSync(folder);
  mkdirSync(outside);
  victim = join(outside, 'victim.txt');
  writeFileSync(victim, VICTIM);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const project = (name = 'P') => JSON.stringify({ id: 'p1', name, boards: [], feeders: [] });
const leftovers = (dir: string) => readdirSync(dir).filter((f) => f.includes('.tmp-'));

describe('reading', () => {
  it_('refuses a link at a file name, unless it is a file the user picked', () => {
    const link = join(folder, 'link.json');
    writeFileSync(join(outside, 'real.json'), project());
    symlinkSync(join(outside, 'real.json'), link);
    expect(() => S.readFileNoFollow(link)).toThrow(/is a link/);
    expect(() => L.readJsonLimited(link, 1e6, 'link.json')).toThrow(/is a link/);
    expect(L.readJsonLimited(link, 1e6, 'link.json', { follow: true }).name).toBe('P');
  });
});

describe('saving a project', () => {
  it_('replaces a link planted at name.json.bak instead of writing through it', () => {
    const full = join(folder, 'a.json');
    writeFileSync(full, project('old'));
    symlinkSync(victim, `${full}.bak`);
    P.writeFileSafe(full, project('new'), { verifyJson: true });
    expect(readFileSync(victim, 'utf8')).toBe(VICTIM);
    expect(lstatSync(`${full}.bak`).isSymbolicLink()).toBe(false);
    expect(JSON.parse(readFileSync(`${full}.bak`, 'utf8')).name).toBe('old');
    expect(JSON.parse(readFileSync(full, 'utf8')).name).toBe('new');
    expect(leftovers(folder)).toEqual([]);
  });

  it_('refuses to save over a project name that is a link', () => {
    const full = join(folder, 'b.json');
    symlinkSync(victim, full);
    expect(() => P.writeFileSafe(full, project())).toThrow(/is a link/);
    expect(readFileSync(victim, 'utf8')).toBe(VICTIM);
    expect(leftovers(folder)).toEqual([]);
  });

  it('keeps the project file permissions; recovery copies and temp folders are private', () => {
    const full = join(folder, 'c.json');
    writeFileSync(full, project(), { mode: 0o644 });
    P.writeFileSafe(full, project('2'));
    if (process.platform !== 'win32') {
      expect(statSync(full).mode & 0o777).toBe(0o644);
      const rec = join(root, 'recovery');
      P.writeRecovery(rec, { projectId: 'p1', project: { id: 'p1', boards: [] }, at: 1 });
      expect(statSync(join(rec, 'p1.json')).mode & 0o777).toBe(0o600);
      const t = S.makePrivateTempDir('lvds-test-', root);
      expect(statSync(t).mode & 0o777).toBe(0o700);
      S.removeDir(t);
      expect(existsSync(t)).toBe(false);
    }
  });

  it_('creates new files exclusively: an existing name or a planted link is never reused', () => {
    expect(() => S.writeNewFile(victim, 'x')).toThrow(/EEXIST/);
    const link = join(folder, 'planted');
    symlinkSync(join(outside, 'not-yet.txt'), link);
    expect(() => S.writeNewFile(link, 'x')).toThrow(/EEXIST/);
    expect(existsSync(join(outside, 'not-yet.txt'))).toBe(false);
  });

  it_('copies without following a link at either end', () => {
    const src = join(folder, 'src.json');
    writeFileSync(src, 'copy me');
    const dest = join(folder, 'dest.bak');
    symlinkSync(victim, dest);
    S.copyFileNoFollow(src, dest);
    expect(readFileSync(victim, 'utf8')).toBe(VICTIM);
    expect(readFileSync(dest, 'utf8')).toBe('copy me');
    const linkSrc = join(folder, 'linksrc.json');
    symlinkSync(victim, linkSrc);
    expect(() => S.copyFileNoFollow(linkSrc, join(folder, 'x.bak'))).toThrow(/is a link/);
  });
});

describe('listing and recovery', () => {
  it_('does not list or read linked project files or recovery copies', () => {
    writeFileSync(join(folder, 'real.json'), project('Real'));
    writeFileSync(join(outside, 'secret.json'), project('Secret'));
    symlinkSync(join(outside, 'secret.json'), join(folder, 'secret.json'));
    const { list } = P.listProjectsMeta(folder, join(root, 'cache.json'));
    expect(list.map((m: { name: string }) => m.name)).toEqual(['Real']);

    const rec = join(root, 'recovery');
    mkdirSync(rec);
    writeFileSync(join(outside, 'r.json'), JSON.stringify({ projectId: 'x', project: { boards: [] }, at: 1 }));
    symlinkSync(join(outside, 'r.json'), join(rec, 'x.json'));
    expect(P.readRecoveries(rec)).toEqual([]);
    const linkedDir = join(root, 'recovery-link');
    symlinkSync(outside, linkedDir);
    expect(P.readRecoveries(linkedDir)).toEqual([]);
    expect(() => P.writeRecovery(linkedDir, { projectId: 'y', project: { id: 'y', boards: [] }, at: 1 })).toThrow(/not a real folder/);
  });
});

describe('trash', () => {
  it_('leaves a linked trash folder alone: nothing listed, restored or deleted through it', () => {
    writeFileSync(join(outside, '1__keep.json'), project('Keep'));
    symlinkSync(outside, join(folder, '.trash'));
    expect(P.listTrash(folder)).toEqual([]);
    expect(P.purgeTrash(folder, 0)).toBe(0);
    expect(() => P.restoreFromTrash(folder, '1__keep.json')).toThrow(/link/);
    expect(existsSync(join(outside, '1__keep.json'))).toBe(true);
    writeFileSync(join(folder, 'd.json'), project());
    expect(() => P.moveToTrash(folder, 'd.json')).toThrow(/not a real folder/);
    expect(existsSync(join(folder, 'd.json'))).toBe(true);
  });

  it_('does not move a linked project to the trash', () => {
    symlinkSync(victim, join(folder, 'e.json'));
    expect(() => P.moveToTrash(folder, 'e.json')).toThrow(/is a link/);
    expect(readFileSync(victim, 'utf8')).toBe(VICTIM);
  });

  it('still moves, lists and restores an ordinary project', () => {
    writeFileSync(join(folder, 'f.json'), project('F'));
    const t = P.moveToTrash(folder, 'f.json', 1000);
    expect(P.listTrash(folder, 2000).map((x: { name: string }) => x.name)).toEqual(['F']);
    expect(P.restoreFromTrash(folder, t)).toBe('f.json');
    expect(existsSync(join(folder, 'f.json'))).toBe(true);
  });
});

describe('LV Database', () => {
  it_('refuses a linked workbook or Backups folder', async () => {
    const db = join(root, 'db');
    DB.setFolder(db);
    try {
      await DB.ensureDatabase(folder);
      const book = DB.spec.books[0];
      symlinkSync(outside, join(db, 'Backups'));
      await expect(DB.writeBook(folder, book.id, [])).rejects.toThrow(/not a real folder/);
      rmSync(join(db, 'Backups'));
      rmSync(join(db, book.file));
      writeFileSync(join(outside, 'book.xlsx'), 'not touched');
      symlinkSync(join(outside, 'book.xlsx'), join(db, book.file));
      await expect(DB.writeBook(folder, book.id, [])).rejects.toThrow(/is a link/);
      expect(readFileSync(join(outside, 'book.xlsx'), 'utf8')).toBe('not touched');
      expect(leftovers(db)).toEqual([]);
    } finally { DB.setFolder(null); }
  }, 30_000); // builds every workbook: ~0.6 s locally, past 5 s on a busy CI runner
});
