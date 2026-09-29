import type { Project, ProjectStatus } from '../types';
import { currentRevision } from './revisions';

/** Saving and opening projects: JSON files in the projects folder in the
 * desktop app; in a plain browser (web version, preview) this browser's own
 * storage. Plus the recovery copy of unsaved work and the recent list. */

export interface ProjectMeta {
  file: string;
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
  const b = bridge();
  if (b) return b.projects.load(file);
  const s = localStorage.getItem(fileKey(file));
  if (!s) throw new Error(`${file} is not in this browser`);
  return JSON.parse(s) as Project;
}

/** Saves to file (a new file named after the project when undefined). */
export async function saveProjectFile(file: string | undefined, p: Project): Promise<string> {
  const b = bridge();
  if (b) return (await b.projects.save(file, p)).file;
  const f = file ?? `${slug(p.name)}-${Date.now()}.json`;
  localStorage.setItem(fileKey(f), JSON.stringify(p)); // throws when the browser's storage is full
  localStorage.setItem(INDEX, JSON.stringify([metaOf(f, p, Date.now()), ...readIndex().filter((m) => m.file !== f)]));
  return f;
}

export async function deleteProjectFile(file: string): Promise<void> {
  const b = bridge();
  if (b) { await b.projects.delete(file); return; }
  localStorage.removeItem(fileKey(file));
  localStorage.setItem(INDEX, JSON.stringify(readIndex().filter((m) => m.file !== file)));
}

// ---- Recovery copy of unsaved work -----------------------------------------

export interface Recovery {
  file?: string; // the project's file, if it was ever saved
  at: number;
  project: Project;
}

const RECOVERY = 'lvds.recovery';

/** In the desktop app a file in the app's own folder (no size limit); else
 * this browser's storage. */
export async function writeRecovery(r: Recovery): Promise<boolean> {
  try {
    const b = bridge();
    if (b?.recovery) await b.recovery.write(r);
    else localStorage.setItem(RECOVERY, JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

export async function readRecovery(): Promise<Recovery | null> {
  try {
    const b = bridge();
    const r = b?.recovery ? await b.recovery.read() : (JSON.parse(localStorage.getItem(RECOVERY) ?? 'null') as Recovery | null);
    return r && r.project && Array.isArray(r.project.boards) ? r : null;
  } catch {
    return null;
  }
}

export async function clearRecovery(): Promise<void> {
  try {
    const b = bridge();
    if (b?.recovery) await b.recovery.clear();
    localStorage.removeItem(RECOVERY);
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
