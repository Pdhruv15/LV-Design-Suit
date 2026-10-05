import type { Project, ProjectStatus } from '../types';
import type { ProjectMeta } from './projectStore';

/** Searching, filtering, sorting and editing the details of projects in the Projects list. */

export type ArchiveFilter = 'active' | 'archived' | 'all';
export interface ListFilters {
  text: string;
  status: '' | ProjectStatus;
  client: string; // owner
  year: string; // of the last save, e.g. "2026"
  tag: string;
  archived: ArchiveFilter;
}
export const NO_FILTERS: ListFilters = { text: '', status: '', client: '', year: '', tag: '', archived: 'active' };

export type SortKey = 'name' | 'status' | 'owner' | 'plot' | 'revision' | 'boards' | 'updatedAt';
export interface SortBy { key: SortKey; dir: 'asc' | 'desc' }

const yearOf = (ms: number) => String(new Date(ms).getFullYear());

/** Words that must all appear somewhere in the project's name, client, consultant, contractor, plot, area, tags, engineer or file. */
export function matchesText(m: ProjectMeta, text: string): boolean {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [m.name, m.owner, m.consultant, m.contractor, m.plotNo, m.area, m.updatedBy, m.file, ...(m.tags ?? [])].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterProjects(list: ProjectMeta[], f: ListFilters): ProjectMeta[] {
  return list.filter((m) =>
    (f.archived === 'all' || (f.archived === 'archived') === !!m.archivedAt) &&
    (!f.status || (m.status ?? 'design') === f.status) &&
    (!f.client || m.owner === f.client) &&
    (!f.year || yearOf(m.updatedAt) === f.year) &&
    (!f.tag || (m.tags ?? []).includes(f.tag)) &&
    matchesText(m, f.text));
}

const text = (v?: string) => (v ?? '').toLowerCase();
export function sortProjects(list: ProjectMeta[], by: SortBy): ProjectMeta[] {
  const k = (m: ProjectMeta): string | number => {
    switch (by.key) {
      case 'name': return text(m.name);
      case 'status': return m.status ?? 'design';
      case 'owner': return text(m.owner);
      case 'plot': return text([m.plotNo, m.area].filter(Boolean).join(' '));
      case 'revision': return text(m.revision);
      case 'boards': return m.boards ?? -1;
      case 'updatedAt': return m.updatedAt;
    }
  };
  const sign = by.dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = k(a), y = k(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    return c * sign || b.updatedAt - a.updatedAt;
  });
}

/** What can be chosen in each filter, from the projects that exist (archived ones included). */
export function facets(list: ProjectMeta[]) {
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
  return {
    clients: uniq(list.map((m) => m.owner)),
    years: uniq(list.map((m) => yearOf(m.updatedAt))).reverse(),
    tags: uniq(list.flatMap((m) => m.tags ?? []))
  };
}

// ---- Details of one project, edited from the list ---------------------------------

export interface ProjectDetails {
  name: string;
  status: ProjectStatus;
  owner: string;
  consultant: string;
  contractor: string;
  plotNo: string;
  area: string;
  tags: string[];
  notes: string;
}

export function detailsOf(p: Project): ProjectDetails {
  return {
    name: p.name, status: p.status ?? 'design', owner: p.info?.owner ?? '', consultant: p.info?.consultant ?? '', contractor: p.info?.contractor ?? '',
    plotNo: p.info?.plotNo ?? '', area: p.info?.area ?? '', tags: p.tags ?? [], notes: p.notes ?? ''
  };
}

/** Tags typed as "villa, DEWA  2026": split on commas, trimmed, no empties, no repeats (case-insensitive). */
export function parseTags(s: string): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (const t of s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
    const k = t.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(t); }
  }
  return out;
}

/** The project with its details replaced; blank fields are removed, everything else is untouched.
 * (The file name does not change when a project is renamed.) */
export function applyDetails(p: Project, d: ProjectDetails): Project {
  const blank = (v: string) => (v.trim() ? v.trim() : undefined);
  const info = { ...p.info, owner: blank(d.owner), consultant: blank(d.consultant), contractor: blank(d.contractor), plotNo: blank(d.plotNo), area: blank(d.area) };
  for (const k of Object.keys(info) as (keyof typeof info)[]) if (info[k] === undefined) delete info[k];
  return {
    ...p,
    name: d.name.trim() || p.name,
    status: d.status,
    info,
    tags: d.tags.length ? d.tags : undefined,
    notes: blank(d.notes)
  };
}

/** Archive: hidden from the active list, everything kept; clear to bring it back. */
export const withArchived = (p: Project, archived: boolean, now = new Date()): Project => ({ ...p, archivedAt: archived ? now.toISOString() : undefined });
