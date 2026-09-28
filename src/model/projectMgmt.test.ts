import { beforeEach, describe, expect, it } from 'vitest';
import { newProject } from '../types';
import { sampleProject } from '../data/sampleProject';
import { applyDefaults, applyProfile, defaultsFromProject, DEFAULT_PREFS, initialsOf, loadPrefs, savePrefs, signature, type Preferences } from './profile';
import { clearRecovery, deleteProjectFile, listProjects, loadProject, metaOf, readRecovery, recentFiles, saveProjectFile, touchRecent, whenText, writeRecovery } from './projectStore';
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

describe('saving, recovery and recent (web version storage)', () => {
  it('save, list with details, open, overwrite, delete', async () => {
    const p = { ...sampleProject, status: 'submitted' as const, updatedBy: 'Palani Samy' };
    const file = await saveProjectFile(undefined, p);
    expect(file).toMatch(/\.json$/);
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

  it('a recovery copy is kept until cleared', async () => {
    expect(await readRecovery()).toBeNull();
    await writeRecovery({ file: 'a.json', at: 1, project: sampleProject });
    expect((await readRecovery())?.project.name).toBe(sampleProject.name);
    await clearRecovery();
    expect(await readRecovery()).toBeNull();
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
