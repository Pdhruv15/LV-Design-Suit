import type { Project, ProjectStatus } from '../types';
import { currentRevision } from './revisions';
import type { FileStamp, SaveOutcome } from './saveSafety';

/** Saving and opening projects: JSON files in the projects folder in the
 * desktop app; in a plain browser (web version, preview) this browser's own
 * storage. Plus the recovery copy of unsaved work and the recent list. */

export interface ProjectMeta {
  file: string;
  id?: string;
  /** Looks like a sync tool's conflicted copy of this file. */
  conflictOf?: string;
  name: string;
  updatedAt: number; // ms
  status?: ProjectStatus;
  owner?: string;
  plotNo?: string;
  area?: string;
  revision?: string;
  updatedBy?: string;
  boards?: number;
}

/** What the dashboard shows about a project (also written by the desktop
 * app's main process, which reads it from each file). */
export const metaOf = (file: string, p: Project, updatedAt = Date.parse(p.updatedAt) || 0): ProjectMeta => ({
  file,
  id: p.id,
  name: p.name,
  updatedAt,
  status: p.status,
  owner: p.info?.owner,
  plotNo: p.info?.plotNo,
  area: p.info?.area,
  revision: currentRevision(p)?.id,
  updatedBy: p.updatedBy,
  boards: p.boards?.length
});

const bridge = () => (typeof window !== 'undefined' && window.lvds ? window.lvds : undefined);
export const inDesktop = () => !!bridge();

// ---- Browser storage (no desktop app) --------------------------------------

const INDEX = 'lvds.projects';
const fileKey = (file: string) => `lvds.project.${file}`;
const readIndex = (): ProjectMeta[] => {
  try { return JSON.parse(localStorage.getItem(INDEX) ?? '[]') as ProjectMeta[]; } catch { return []; }
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

export async function listProjects(): Promise<ProjectMeta[]> {
  const b = bridge();
  const list = b ? await b.projects.list() : readIndex();
  return [...list].sort((a, c) => c.updatedAt - a.updatedAt);
}

export async function loadProject(file: string): Promise<Project> {
  return (await loadProjectStamped(file)).project;
}

/** The project and what its file was when read (desktop), to notice later changes made by someone else. */
export async function loadProjectStamped(file: string): Promise<{ project: Project; stamp?: FileStamp | null }> {
  const b = bridge();
  if (b) {
    const r = b.projects.read ? await b.projects.read(file) : { project: await b.projects.load(file), stamp: undefined };
    const p = r.project as Project & { _restoredFromBackup?: boolean };
    if (p._restoredFromBackup) {
      delete p._restoredFromBackup;
      window.alert(`${file} was damaged (for example by a crash or a sync during saving). The last good version (${file}.bak) was opened instead — check it and save.`);
    }
    return { project: p, stamp: r.stamp };
  }
  const s = localStorage.getItem(fileKey(file));
  if (!s) throw new Error(`${file} is not in this browser`);
  return { project: JSON.parse(s) as Project };
}

/** The file now (desktop); null when it is gone, undefined when it cannot be checked. */
export async function statProject(file: string): Promise<FileStamp | null | undefined> {
  const b = bridge();
  if (!b?.projects.stat) return undefined;
  try { return await b.projects.stat(file); } catch { return undefined; }
}

/** Saves to file (a new file named after the project when undefined). With `expected` (what the file was when
 * opened or last saved), a file someone else changed since is a conflict and is not overwritten, unless `force`. */
export async function saveProjectFile(file: string | undefined, p: Project, opts: { expected?: FileStamp | null; force?: boolean } = {}): Promise<SaveOutcome> {
  const b = bridge();
  if (b) {
    const r = await b.projects.save(file, p, opts.expected ?? undefined, opts.force);
    return r.conflict ? { conflict: true, file: r.file, disk: r.disk } : { file: r.file, stamp: r.stamp };
  }
  const f = file ?? `${slug(p.name)}-${(p.id ?? String(Date.now())).replace(/[^a-z0-9]/gi, '').slice(0, 8)}.json`;
  localStorage.setItem(fileKey(f), JSON.stringify(p)); // throws when the browser's storage is full
  localStorage.setItem(INDEX, JSON.stringify([metaOf(f, p, Date.now()), ...readIndex().filter((m) => m.file !== f)]));
  return { file: f };
}

export async function deleteProjectFile(file: string): Promise<void> {
  const b = bridge();
  if (b) { await b.projects.delete(file); return; }
  localStorage.removeItem(fileKey(file));
  localStorage.setItem(INDEX, JSON.stringify(readIndex().filter((m) => m.file !== file)));
}

// ---- Recovery copy of unsaved work -----------------------------------------

export interface Recovery {
  projectId?: string; // one recovery copy per project (its id)
  file?: string; // the project's file, if it was ever saved
  at: number;
  project: Project;
  /** The project's file was saved again after this copy was made (desktop). */
  fileChangedSince?: boolean;
}

const RECOVERY = 'lvds.recovery'; // older: a single copy for whatever project autosaved last
const RECOVERY_IDS = 'lvds.recovery.ids';
const recoveryKey = (id: string) => `lvds.recovery.${id}`;
const recoveryId = (r: Recovery) => r.projectId ?? r.project.id;
const readIds = (): string[] => { try { return (JSON.parse(localStorage.getItem(RECOVERY_IDS) ?? '[]') as string[]).filter((x) => typeof x === 'string'); } catch { return []; } };

/** One recovery copy for each project (so one project's autosave never replaces another's): in the desktop
 * app files in the app's own folder (no size limit); else this browser's storage. */
export async function writeRecovery(r: Recovery): Promise<boolean> {
  try {
    const id = recoveryId(r);
    if (!id) return false;
    const b = bridge();
    if (b?.recovery) await b.recovery.write({ ...r, projectId: id });
    else {
      localStorage.setItem(recoveryKey(id), JSON.stringify({ ...r, projectId: id }));
      if (!readIds().includes(id)) localStorage.setItem(RECOVERY_IDS, JSON.stringify([...readIds(), id]));
    }
    return true;
  } catch {
    return false;
  }
}

const valid = (r: Recovery | null | undefined): r is Recovery => !!r && !!r.project && Array.isArray(r.project.boards);

/** Every recovery copy, newest first. */
export async function readRecoveries(): Promise<Recovery[]> {
  try {
    const b = bridge();
    if (b?.recovery) {
      const all = b.recovery.readAll ? await b.recovery.readAll() : [await b.recovery.read()];
      return all.filter(valid).sort((x, y) => y.at - x.at);
    }
    const legacy = JSON.parse(localStorage.getItem(RECOVERY) ?? 'null') as Recovery | null;
    if (valid(legacy)) { await writeRecovery({ ...legacy, projectId: legacy.project.id ?? 'legacy-single' }); localStorage.removeItem(RECOVERY); }
    return readIds().map((id) => { try { return JSON.parse(localStorage.getItem(recoveryKey(id)) ?? 'null') as Recovery | null; } catch { return null; } }).filter(valid).sort((x, y) => y.at - x.at);
  } catch {
    return [];
  }
}

/** Forgets one project's recovery copy (after it is saved, restored or discarded). */
export async function clearRecovery(projectId: string | undefined): Promise<void> {
  if (!projectId) return;
  try {
    const b = bridge();
    if (b?.recovery) await b.recovery.clear(projectId);
    localStorage.removeItem(recoveryKey(projectId));
    localStorage.setItem(RECOVERY_IDS, JSON.stringify(readIds().filter((x) => x !== projectId)));
  } catch { /* nothing to clear */ }
}

// ---- Recently opened ---------------------------------------------------------

const RECENT = 'lvds.recent';
export function recentFiles(): string[] {
  try { return (JSON.parse(localStorage.getItem(RECENT) ?? '[]') as string[]).filter((f) => typeof f === 'string'); } catch { return []; }
}
export function touchRecent(file: string, remove = false): string[] {
  const list = [...(remove ? [] : [file]), ...recentFiles().filter((f) => f !== file)].slice(0, 8);
  try { localStorage.setItem(RECENT, JSON.stringify(list)); } catch { /* preference only */ }
  return list;
}

/** "5 min ago", "yesterday", "12 Sep 2026". */
export function whenText(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24 && new Date(ms).getDate() === new Date(now).getDate()) return `${h} h ago`;
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Open project… (desktop): a file picker. Returns a file in the projects
 * folder, or the content of a project from elsewhere; null when cancelled
 * or in the browser (where projects are only the list). */
export async function pickProject(): Promise<{ file?: string; data?: Project; from?: string } | null> {
  const b = bridge();
  if (!b) return null;
  return (await b.projects.pick()) as { file?: string; data?: Project; from?: string } | null;
}
