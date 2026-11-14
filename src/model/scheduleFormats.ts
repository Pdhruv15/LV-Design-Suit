import { pushLibrary } from '../database/librarySync';
import type { Sheet } from './sheets';

/** Your office's schedule formats: a linked sheet layout saved once and reused for other boards and other projects. Kept like the
 * other libraries: a working copy in this computer's storage, synced through LV Database/Library.json. */

export const FORMATS_KEY = 'lvds.scheduleFormats';

/** A linked sheet layout saved for reuse: your office's own schedule format. */
export interface ScheduleFormat { id: string; name: string; category: 'db'; sheet: Sheet; updatedAt: string } // updatedAt: yyyy-mm-dd

const isFormat = (x: unknown): x is ScheduleFormat => {
  const f = x as ScheduleFormat;
  return !!f && typeof f === 'object' && typeof f.id === 'string' && !!f.id && typeof f.name === 'string' && !!f.name && !!f.sheet && typeof f.sheet === 'object' && !!f.sheet.link;
};

/** Your formats on this computer (synced from Library.json). */
export function loadFormats(): ScheduleFormat[] {
  try {
    const v = JSON.parse(localStorage.getItem(FORMATS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isFormat) : [];
  } catch { return []; }
}
export function saveFormats(list: ScheduleFormat[]): void {
  try { localStorage.setItem(FORMATS_KEY, JSON.stringify(list)); void pushLibrary(); } catch { /* storage full or blocked */ }
}

/** Why a format name is not accepted (the format `exceptId` is not counted as another). */
export function formatNameError(name: string, list: ScheduleFormat[], exceptId?: string): string | undefined {
  const t = name.trim();
  if (!t) return 'Give the format a name.';
  if (t.length > 60) return 'Keep the name to 60 characters.';
  if (list.some((f) => f.id !== exceptId && f.name.trim().toLowerCase() === t.toLowerCase())) return 'Another format has this name.';
  return undefined;
}

const newId = () => `fmt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The list with the format saved: one of that name (case ignored) gets the new sheet and date, else a new one is added. */
export function withFormat(list: ScheduleFormat[], name: string, template: Sheet, at = new Date()): { list: ScheduleFormat[]; updated: boolean } {
  const t = name.trim(), updatedAt = at.toISOString().slice(0, 10), same = list.find((f) => f.name.trim().toLowerCase() === t.toLowerCase());
  if (same) return { list: list.map((f) => (f === same ? { ...f, sheet: template, updatedAt } : f)), updated: true };
  return { list: [...list, { id: newId(), name: t, category: 'db', sheet: template, updatedAt }], updated: false };
}
export const renameFormat = (list: ScheduleFormat[], id: string, name: string): ScheduleFormat[] => list.map((f) => (f.id === id ? { ...f, name: name.trim() } : f));
export const removeFormat = (list: ScheduleFormat[], id: string): ScheduleFormat[] => list.filter((f) => f.id !== id);
