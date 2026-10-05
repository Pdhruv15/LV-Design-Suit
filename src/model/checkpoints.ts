import type { Project } from '../types';

/** Checkpoints: named copies of the working design kept beside the project so you can go back. They are not revisions: a
 * revision is an issued, frozen record and is never touched; a checkpoint is a private safety copy, kept per project and
 * bounded (the oldest unlabelled ones go first). Restoring puts the checkpoint's design into the open project as an ordinary,
 * undoable edit; revisions issued since stay exactly as they are. */
export interface Checkpoint { id: string; projectId: string; at: string; label: string; /** Made by the app (before a restore), not by the user. */ auto?: boolean; project: Project }
export const MAX_CHECKPOINTS = 12;

/** Where checkpoints are kept; IndexedDB in the app, memory in tests. */
export interface CheckpointStore {
  list(projectId: string): Promise<Checkpoint[]>;
  put(c: Checkpoint): Promise<void>;
  remove(id: string): Promise<void>;
}

export function newCheckpoint(p: Project, label: string, opts: { auto?: boolean; now?: Date } = {}): Checkpoint {
  if (!p.id) throw new Error('This project has no identity yet; save it first.');
  const now = opts.now ?? new Date();
  return { id: `cp-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, projectId: p.id, at: now.toISOString(), label: label.trim() || 'Checkpoint', ...(opts.auto ? { auto: true } : {}), project: JSON.parse(JSON.stringify(p)) };
}

/** The checkpoints to delete so no more than `max` remain: automatic ones first, then oldest. A user's labelled checkpoint outlives automatic ones. */
export function excess(list: Checkpoint[], max = MAX_CHECKPOINTS): Checkpoint[] {
  const over = list.length - max;
  if (over <= 0) return [];
  const byAge = [...list].sort((a, b) => a.at.localeCompare(b.at));
  return [...byAge.filter((c) => c.auto), ...byAge.filter((c) => !c.auto)].slice(0, over);
}

export async function saveCheckpoint(store: CheckpointStore, c: Checkpoint, max = MAX_CHECKPOINTS): Promise<Checkpoint[]> {
  await store.put(c);
  const list = await store.list(c.projectId);
  const drop = excess(list, max).filter((x) => x.id !== c.id);
  for (const d of drop) await store.remove(d.id);
  return (await store.list(c.projectId)).sort((a, b) => b.at.localeCompare(a.at));
}

/** The open project with the checkpoint's design. Identity and everything issued is kept: revisions, the baseline pointer and the
 * project's own id and creation date. */
export function restoredFrom(current: Project, c: Checkpoint): Project {
  const old: Project = JSON.parse(JSON.stringify(c.project));
  return { ...old, id: current.id, createdAt: current.createdAt, revisions: current.revisions, baseline: current.baseline };
}

export class MemoryStore implements CheckpointStore {
  private m = new Map<string, Checkpoint>();
  async list(projectId: string) { return [...this.m.values()].filter((c) => c.projectId === projectId); }
  async put(c: Checkpoint) { this.m.set(c.id, c); }
  async remove(id: string) { this.m.delete(id); }
}

/** IndexedDB store (browser and desktop renderer). Returns undefined where IndexedDB is unavailable, so callers can say so. */
export function idbStore(): CheckpointStore | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  const open = () => new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('lvds-checkpoints', 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore('cp', { keyPath: 'id' }); s.createIndex('projectId', 'projectId'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((res, rej) => { const req = fn(db.transaction('cp', mode).objectStore('cp')); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  };
  return {
    list: (id) => run('readonly', (s) => s.index('projectId').getAll(id) as IDBRequest<Checkpoint[]>),
    put: async (c) => { await run('readwrite', (s) => s.put(c)); },
    remove: async (id) => { await run('readwrite', (s) => s.delete(id)); }
  };
}
