import { beforeEach, describe, expect, it } from 'vitest';
import { newProject } from '../types';
import { sampleProject } from '../data/sampleProject';
import { applyDefaults, applyProfile, defaultsFromProject, DEFAULT_PREFS, initialsOf, loadPrefs, savePrefs, signature, type Preferences } from './profile';
import { clearRecovery, deleteProjectFile, emptyTrash, listProjects, listTrash, restoreProject, loadProject, metaOf, readRecoveries, recentFiles, saveProjectFile, touchRecent, whenText, writeRecovery } from './projectStore';
import { titleBlockOf } from '../docs/sldSheet';

// A small in-memory localStorage (the store falls back to it without the desktop app).
beforeEach(() => {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k),
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }
  } as Storage;
});

const me: Preferences = {
  profile: { name: 'Palani Samy', designation: 'Senior Electrical Engineer', company: 'Acme Consultants', checkedBy: 'R. Kumar', logo: 'data:image/png;base64,AAAA' },
  defaults: { voltageV: 400, ambientC: 50, vdLimitPct: 5, studySettings: { elcbPowerMa: 100 }, sheet: 'A1', autoRun: true },
  app: { autosaveMin: 5 }
};

describe('profile and new project defaults', () => {
  it('a new project starts with my defaults and my details in the title block', () => {
    const p = applyDefaults(newProject('Villa'), me);
    expect([p.voltageV, p.ambientC, p.vdLimitPct, p.frequencyHz]).toEqual([400, 50, 5, 50]);
    expect(p.studySettings?.elcbPowerMa).toBe(100);
    expect(p.calc?.autoRun).toBe(true);
    expect(p.drawing).toMatchObject({ sheet: 'A1', company: 'Acme Consultants', drawnBy: 'Palani Samy', checkedBy: 'R. Kumar' });
    expect(p.createdBy).toBe('Palani Samy');
    const t = titleBlockOf(p);
    expect([t.company, t.drawnBy, t.logo]).toEqual(['Acme Consultants', 'Palani Samy', 'data:image/png;base64,AAAA']);
    // No profile: the app's defaults, nothing filled in.
    expect(applyDefaults(newProject('X'), DEFAULT_PREFS).drawing).toEqual({});
  });

  it('"use my details" replaces the names; filling only fills blanks', () => {
    const p = { ...sampleProject, drawing: { drawnBy: 'Someone', company: 'Other Co' }, studyReport: { boards: [], downstream: true, studies: [], sld: true, separate: false } };
    expect(applyProfile(p, me.profile, false).drawing).toMatchObject({ drawnBy: 'Someone', company: 'Other Co', checkedBy: 'R. Kumar' });
    const mine = applyProfile(p, me.profile, true);
    expect(mine.drawing).toMatchObject({ drawnBy: 'Palani Samy', company: 'Acme Consultants' });
    expect(mine.studyReport?.preparedBy).toBe('Palani Samy, Senior Electrical Engineer');
    expect(signature({ name: 'A' })).toBe('A');
    expect(initialsOf('Palani samy g')).toBe('PS');
    expect(initialsOf('')).toBe('?');
  });

  it('defaults copied from a project, and preferences kept on this computer', () => {
    const d = defaultsFromProject({ ...sampleProject, ambientC: 48 });
    expect(d.ambientC).toBe(48);
    expect(d.studySettings?.pfTarget).toBeGreaterThan(0);
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(savePrefs(me)).toBe(true);
    expect(loadPrefs()).toEqual(me);
  });
});

describe('trash (web version storage)', () => {
  it('delete moves a project to the trash; restore brings it back, under a new name if the old one is taken', async () => {
    const a = (await saveProjectFile(undefined, { ...sampleProject, id: 'aaaaaaaa1', name: 'Villa' })).file;
    await deleteProjectFile(a);
    expect(await listProjects()).toEqual([]);
    const trash = await listTrash();
    expect(trash).toMatchObject([{ file: a, name: 'Villa', daysLeft: 30 }]);
    const b = (await saveProjectFile(a, { ...sampleProject, id: 'bbbbbbbb2', name: 'Other' })).file; // takes the old file name
    const back = await restoreProject(trash[0].trashFile);
    expect(back).not.toBe(b);
    expect((await loadProject(back)).name).toBe('Villa');
    expect((await loadProject(b)).name).toBe('Other');
    expect(await listTrash()).toEqual([]);
  });
  it('forgets what has been in the trash more than 30 days, and can be emptied', async () => {
    const f = (await saveProjectFile(undefined, { ...sampleProject, id: 'cccccccc3' })).file;
    await deleteProjectFile(f);
    const raw = JSON.parse(localStorage.getItem('lvds.trash')!);
    raw[0].deletedAt = Date.now() - 31 * 86400000;
    localStorage.setItem('lvds.trash', JSON.stringify(raw));
    expect(await listTrash()).toEqual([]);
    const g = (await saveProjectFile(undefined, { ...sampleProject, id: 'dddddddd4' })).file;
    await deleteProjectFile(g);
    expect(await listTrash()).toHaveLength(1);
    await emptyTrash();
    expect(await listTrash()).toEqual([]);
  });
});

describe('saving, recovery and recent (web version storage)', () => {
  it('save, list with details, open, overwrite, delete', async () => {
    const p = { ...sampleProject, status: 'submitted' as const, updatedBy: 'Palani Samy' };
    const saved = await saveProjectFile(undefined, { ...p, id: 'abcd1234-0000' });
    const file = saved.file;
    expect(file).toMatch(/-abcd1234\.json$/);
    const list = await listProjects();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ file, name: p.name, status: 'submitted', updatedBy: 'Palani Samy', boards: p.boards.length });
    expect((await loadProject(file)).name).toBe(p.name);
    await saveProjectFile(file, { ...p, name: 'Renamed' });
    expect((await listProjects()).map((m) => m.name)).toEqual(['Renamed']);
    await deleteProjectFile(file);
    expect(await listProjects()).toEqual([]);
    await expect(loadProject(file)).rejects.toThrow();
  });

  it('each project keeps its own recovery copy until cleared', async () => {
    expect(await readRecoveries()).toEqual([]);
    const a = { ...sampleProject, id: 'a' }, b = { ...sampleProject, id: 'b', name: 'Other job' };
    await writeRecovery({ file: 'a.json', at: 1, project: a });
    await writeRecovery({ at: 2, project: b }); // another project autosaving does not replace A's
    expect((await readRecoveries()).map((r) => r.project.id)).toEqual(['b', 'a']);
    await clearRecovery('b');
    const left = await readRecoveries();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ projectId: 'a', file: 'a.json' });
    await clearRecovery('a');
    expect(await readRecoveries()).toEqual([]);
  });

  it('refuses a recovery copy without a project id, and picks up the older single copy', async () => {
    expect(await writeRecovery({ at: 1, project: sampleProject })).toBe(false);
    localStorage.setItem('lvds.recovery', JSON.stringify({ file: 'old.json', at: 5, project: sampleProject }));
    const all = await readRecoveries();
    expect(all).toHaveLength(1);
    expect(all[0].file).toBe('old.json');
    expect(localStorage.getItem('lvds.recovery')).toBeNull();
  });

  it('recent projects, newest first, no repeats, removable', () => {
    touchRecent('a'); touchRecent('b'); touchRecent('a');
    expect(recentFiles()).toEqual(['a', 'b']);
    touchRecent('a', true);
    expect(recentFiles()).toEqual(['b']);
  });

  it('meta and "when" text', () => {
    expect(metaOf('f.json', { ...sampleProject, revisions: [] }).revision).toBeUndefined();
    const now = new Date(2026, 8, 28, 15, 0).getTime();
    expect(whenText(now - 20000, now)).toBe('just now');
    expect(whenText(now - 5 * 60000, now)).toBe('5 min ago');
    expect(whenText(now - 3 * 3600000, now)).toBe('3 h ago');
    expect(whenText(new Date(2026, 8, 27, 9, 0).getTime(), now)).toBe('yesterday');
    expect(whenText(new Date(2026, 7, 1).getTime(), now)).toMatch(/Aug 2026/);
  });
});
