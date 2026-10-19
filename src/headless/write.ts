import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '../types';
import { unsavedCopyInApp } from './project';

/** Writing a project file from outside the app (Stage 2), safely:
 * - never while the project has unsaved changes open in the app (its recovery copy exists);
 * - never over a file that changed since it was read (another save in between);
 * - written like the app writes it: a temporary file, flushed, then renamed over the old one, and read back;
 * - the previous version kept as a backup, and every change logged, so undo_change can put it back.
 * Backups and the log live in <projects folder>/.lvds-agent/. */

const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export const agentDir = (folder: string) => path.join(folder, '.lvds-agent');
const logFile = (folder: string) => path.join(agentDir(folder), 'log.jsonl');
/** Backups kept per project file (the oldest go first). */
export const MAX_BACKUPS = 50;

export interface ChangeEntry {
  id: string; // C-<time>-<random>
  at: string;
  file: string; // file name in the projects folder
  tool: string;
  summary: string;
  /** Content hash of the file before and after the change. */
  beforeHash: string;
  afterHash: string;
  /** The previous version, relative to the projects folder. */
  backup: string;
  /** For an undo: the change it reversed. */
  undoes?: string;
}

export class WriteRefused extends Error {}

function writeAtomic(full: string, text: string): void {
  const tmp = `${full}.tmp-lvds-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text, 'utf-8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, full);
  if (sha(fs.readFileSync(full, 'utf-8')) !== sha(text)) throw new Error('The file was written but reading it back did not match; it may not have been saved correctly.');
}

/** Why the project cannot be written now, or undefined. */
export function writeBlocked(project: Project, file: string, readText: string): string | undefined {
  if (unsavedCopyInApp(project.id)) return `${path.basename(file)} is open in LV Design Studio with unsaved changes. Save (or discard) them in the app first, then try again.`;
  let now: string;
  try { now = fs.readFileSync(file, 'utf-8'); } catch { return `${path.basename(file)} can no longer be read.`; }
  if (sha(now) !== sha(readText)) return `${path.basename(file)} changed while this was being prepared (saved from the app or a sync). Run it again on the current file.`;
  return undefined;
}

export function readLog(folder: string): ChangeEntry[] {
  try {
    return fs.readFileSync(logFile(folder), 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as ChangeEntry);
  } catch { return []; }
}

function pruneBackups(dir: string): void {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) fs.unlinkSync(path.join(dir, f));
  } catch { /* best effort */ }
}

/** Writes `text` over the project file that was read as `readText`, keeping a backup and logging the change. */
export function commitText(folder: string, file: string, readText: string, text: string, tool: string, summary: string, project: Project, undoes?: string): ChangeEntry {
  const blocked = writeBlocked(project, file, readText);
  if (blocked) throw new WriteRefused(blocked);
  const name = path.basename(file);
  const at = new Date();
  const id = `C-${at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;
  const dir = path.join(agentDir(folder), 'backups', name.replace(/\.json$/i, ''));
  fs.mkdirSync(dir, { recursive: true });
  const backupFull = path.join(dir, `${id}.json`);
  fs.writeFileSync(backupFull, readText, 'utf-8');
  writeAtomic(file, text);
  const entry: ChangeEntry = { id, at: at.toISOString(), file: name, tool, summary, beforeHash: sha(readText), afterHash: sha(text), backup: path.relative(folder, backupFull), ...(undoes ? { undoes } : {}) };
  fs.appendFileSync(logFile(folder), JSON.stringify(entry) + '\n', 'utf-8');
  pruneBackups(dir);
  return entry;
}

/** Writes the project as the app does (2-space JSON). */
export const commitProject = (folder: string, file: string, readText: string, next: Project, tool: string, summary: string) =>
  commitText(folder, file, readText, JSON.stringify(next, null, 2), tool, summary, next);

/** Puts back the version from before a change. Only when the file is still exactly what that change wrote. */
export function undoChange(folder: string, file: string, readText: string, project: Project, changeId?: string): ChangeEntry {
  const name = path.basename(file);
  const mine = readLog(folder).filter((e) => e.file === name);
  const undone = new Set(mine.map((e) => e.undoes).filter(Boolean));
  const target = changeId ? mine.find((e) => e.id === changeId) : [...mine].reverse().find((e) => !e.undoes && !undone.has(e.id));
  if (!target) throw new WriteRefused(changeId ? `No change ${changeId} for ${name}.` : `No change to undo for ${name}.`);
  if (undone.has(target.id)) throw new WriteRefused(`${target.id} has already been undone.`);
  if (sha(readText) !== target.afterHash) {
    throw new WriteRefused(`${name} has changed since ${target.id} (${target.summary}), so it is not put back automatically. Its earlier version is kept at ${path.join(folder, target.backup)}.`);
  }
  const before = fs.readFileSync(path.join(folder, target.backup), 'utf-8');
  return commitText(folder, file, readText, before, 'undo_change', `Undo ${target.id}: ${target.summary}`, project, target.id);
}
