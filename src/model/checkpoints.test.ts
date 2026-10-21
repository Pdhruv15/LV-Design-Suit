import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { issueRevision } from './revisions';
import { excess, MemoryStore, newCheckpoint, restoredFrom, saveCheckpoint } from './checkpoints';

const p = { ...sampleProject, id: 'proj-1', createdAt: '2026-01-01T00:00:00Z' };
const at = (n: number) => new Date(Date.UTC(2026, 9, n));

describe('checkpoints', () => {
  it('needs a saved project identity and copies the design (later edits do not change it)', () => {
    expect(() => newCheckpoint({ ...p, id: undefined }, 'x')).toThrow();
    const c = newCheckpoint(p, 'Before change');
    const edited = { ...p, feeders: p.feeders.map((f, i) => (i ? f : { ...f, lengthM: 999 })) };
    expect(c.project.feeders[0].lengthM).toBe(p.feeders[0].lengthM);
    expect(edited.feeders[0].lengthM).toBe(999);
  });
  it('keeps the latest automatic ones up to the limit and every named one (decision D5), never the new one', async () => {
    const store = new MemoryStore();
    await saveCheckpoint(store, newCheckpoint(p, 'mine 1', { now: at(1) }), 2);
    await saveCheckpoint(store, newCheckpoint(p, 'auto 1', { auto: true, now: at(2) }), 2);
    await saveCheckpoint(store, newCheckpoint(p, 'auto 2', { auto: true, now: at(3) }), 2);
    await saveCheckpoint(store, newCheckpoint(p, 'mine 2', { now: at(4) }), 2);
    const list = await saveCheckpoint(store, newCheckpoint(p, 'auto 3', { auto: true, now: at(5) }), 2);
    expect(list.map((c) => c.label)).toEqual(['auto 3', 'mine 2', 'auto 2', 'mine 1']);
    expect(excess(list, 2)).toEqual([]);
  });
  it('does not mix projects', async () => {
    const store = new MemoryStore();
    await saveCheckpoint(store, newCheckpoint(p, 'a'));
    await saveCheckpoint(store, newCheckpoint({ ...p, id: 'proj-2' }, 'b'));
    expect((await store.list('proj-1')).map((c) => c.label)).toEqual(['a']);
  });
  it('restores the design but keeps revisions issued since, and the project identity', () => {
    const c = newCheckpoint(p, 'old');
    const later = issueRevision({ ...p, feeders: p.feeders.map((f, i) => (i ? f : { ...f, lengthM: 77 })) }, { description: 'A', date: '2026-10-02' });
    const r = restoredFrom(later, c);
    expect(r.feeders[0].lengthM).toBe(p.feeders[0].lengthM);
    expect(r.revisions).toEqual(later.revisions);
    expect(r.revisions!.length).toBe(1);
    expect(r.id).toBe('proj-1');
  });
});
