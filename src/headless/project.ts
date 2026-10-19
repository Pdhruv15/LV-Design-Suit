import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProjectShape } from '../model/projectValidate';
import { isFutureSchema, migrateProject } from '../model/projectMigrate';
import type { Project } from '../types';

/** Finding and opening project files without the app (command line, MCP server, local API).
 * Read only: nothing here writes a file. */

/** The desktop app's settings file (Electron userData of "LV Design Studio"), per platform. */
function appSettingsPath(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'LV Design Studio', 'settings.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'LV Design Studio', 'settings.json');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'LV Design Studio', 'settings.json');
}

/** The projects folder: LVDS_PROJECTS, else the one chosen in the app, else the app's default. */
export function projectsFolder(): string {
  if (process.env.LVDS_PROJECTS) return path.resolve(process.env.LVDS_PROJECTS);
  try {
    const s = JSON.parse(fs.readFileSync(appSettingsPath(), 'utf-8')) as { projectsFolder?: unknown };
    if (typeof s.projectsFolder === 'string' && s.projectsFolder) return s.projectsFolder;
  } catch { /* no settings yet: the default */ }
  return path.join(os.homedir(), 'LV Design Studio Projects');
}

/** A project from the text of its file: checked like the app checks it on opening, and brought up to the current format (in memory only). */
export function parseProject(text: string, name: string): Project {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`${name} could not be read as a project (${(e as Error).message}).`); }
  const p = checkProjectShape(raw, name);
  if (isFutureSchema(p)) throw new Error(`${name} was saved by a newer version of LV Design Studio. Update the app to read it.`);
  return migrateProject(p, name);
}

export interface ProjectRef {
  /** A file name in the projects folder (with or without .json), or a path. */
  ref: string;
  /** Where the project files are. */
  folder: string;
  /** false (MCP, local API): only files inside the projects folder can be opened. */
  anywhere: boolean;
}

/** The full path of a project file, or an error saying why it cannot be opened. */
export function resolveProject({ ref, folder, anywhere }: ProjectRef): string {
  const name = ref.trim();
  if (!name) throw new Error('Give a project: a file name in the projects folder, or a path.');
  const withExt = name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
  const candidates = path.isAbsolute(name) ? [name] : [path.resolve(folder, withExt), path.resolve(folder, name), ...(anywhere ? [path.resolve(name)] : [])];
  const full = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!full) throw new Error(`No project "${name}" in ${folder}. Use list_projects to see the project files.`);
  if (!anywhere) {
    const rel = path.relative(path.resolve(folder), path.resolve(full));
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Only projects inside the projects folder (${folder}) can be opened here.`);
  }
  return full;
}

export function openProject(r: ProjectRef): { project: Project; file: string } {
  const file = resolveProject(r);
  return { project: parseProject(fs.readFileSync(file, 'utf-8'), path.basename(file)), file };
}

export interface ProjectListing { file: string; name: string; panels: number; circuits: number; status?: string; revision?: string; modified: string }

/** The project files in a folder, newest first. Files that are not projects are left out. */
export function listProjects(folder: string): ProjectListing[] {
  let names: string[] = [];
  try { names = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.json')); } catch { return []; }
  const out: (ProjectListing & { t: number })[] = [];
  for (const f of names) {
    const full = path.join(folder, f);
    try {
      const p = parseProject(fs.readFileSync(full, 'utf-8'), f);
      const t = fs.statSync(full).mtimeMs;
      const rev = p.revisions?.[p.revisions.length - 1];
      out.push({ file: f, name: p.name, panels: p.boards.length, circuits: p.feeders.length, status: p.status, revision: rev?.id, modified: new Date(t).toISOString(), t });
    } catch { /* not a project file */ }
  }
  return out.sort((a, b) => b.t - a.t).map(({ t: _t, ...rest }) => rest);
}
