import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildBackup, checkpointsFor, readBackup } from './projectBackup';
import { autoCheckpoint, excess, MemoryStore, newCheckpoint, saveCheckpoint, type Checkpoint } from './checkpoints';
import { sampleProject } from '../data/sampleProject';
import type { Project } from '../types';

const project: Project = { ...sampleProject, id: 'p-1', schemaVersion: 1 };
const at = (min: number) => new Date(Date.UTC(2026, 9, 21, 8, min));

describe('checkpoint retention (D5)', () => {
  it('keeps the latest 20 automatic checkpoints and every labelled one', () => {
    const list: Checkpoint[] = [
      ...Array.from({ length: 23 }, (_, i) => newCheckpoint(project, `auto ${i}`, { auto: true, now: at(i) })),
      ...Array.from({ length: 30 }, (_, i) => newCheckpoint(project, `mine ${i}`, { now: at(i) }))
    ];
    expect(excess(list).map((c) => c.label)).toEqual(['auto 0', 'auto 1', 'auto 2']);
  });

  it('takes automatic checkpoints quietly, and never for a project without an identity', async () => {
    const store = new MemoryStore();
    await autoCheckpoint(project, 'Before issuing', store);
    await autoCheckpoint({ ...project, id: undefined }, 'Nothing', store);
    expect((await store.list('p-1')).map((c) => [c.label, c.auto])).toEqual([['Before issuing', true]]);
    const errors: string[] = [];
    await autoCheckpoint(project, 'Fails', { list: async () => [], put: async () => { throw new Error('disk full'); }, remove: async () => {} }, (m) => errors.push(m));
    expect(errors).toEqual(['Automatic checkpoint not saved: disk full']);
    expect((await saveCheckpoint(store, newCheckpoint(project, 'Mine', { now: new Date(Date.UTC(2099, 0, 1)) })))[0].label).toBe('Mine'); // newest first
  });
});

describe('portable project backup', () => {
  const checkpoints = [newCheckpoint(project, 'Before client comments', { now: at(1) }), newCheckpoint(project, 'Before issuing', { auto: true, now: at(2) })];

  it('round-trips the project and its checkpoints with a manifest check', async () => {
    const bytes = await buildBackup(project, checkpoints, '1.69', at(5));
    const r = await readBackup(bytes);
    expect(r.manifest).toMatchObject({ format: 'lvds-backup', formatVersion: 1, appVersion: '1.69', project: { id: 'p-1', name: project.name, schemaVersion: 1 } });
    expect(r.manifest.files.map((f) => f.path)).toEqual(['project.json', ...checkpoints.map((c) => `checkpoints/${c.id}.json`)]);
    expect(r.project).toEqual(project);
    expect(r.checkpoints.map((c) => c.label)).toEqual(['Before client comments', 'Before issuing']);
    // Opened as a new project: copies with their own ids, so the original project's checkpoints stay where they are.
    const store = new MemoryStore();
    for (const c of r.checkpoints) await store.put(c);
    for (const c of checkpointsFor(r.checkpoints, 'p-2-new-id')) await store.put(c);
    expect((await store.list('p-1')).length).toBe(2);
    expect((await store.list('p-2-new-id')).map((c) => c.label).sort()).toEqual(['Before client comments', 'Before issuing']);
  });

  it('refuses damaged, foreign or newer backups before anything is opened', async () => {
    const good = await buildBackup(project, checkpoints, '1.69');
    const tamper = async (fn: (z: JSZip) => void) => { const z = await JSZip.loadAsync(good); fn(z); return z.generateAsync({ type: 'uint8array' }); };
    await expect(readBackup(new TextEncoder().encode('not a zip'))).rejects.toThrow('not a zip file');
    await expect(readBackup(await tamper((z) => z.remove('manifest.json')))).rejects.toThrow('no manifest');
    await expect(readBackup(await tamper((z) => z.file('project.json', JSON.stringify({ ...project, name: 'Changed' }))))).rejects.toThrow('project.json in the backup is damaged');
    await expect(readBackup(await tamper((z) => z.remove('project.json')))).rejects.toThrow('missing project.json');
    const manifest = JSON.parse(await (await JSZip.loadAsync(good)).file('manifest.json')!.async('string'));
    await expect(readBackup(await tamper((z) => z.file('manifest.json', JSON.stringify({ ...manifest, formatVersion: 2, appVersion: '9.0' }))))).rejects.toThrow('newer LV Design Studio (9.0)');
    await expect(readBackup(await tamper((z) => z.file('manifest.json', JSON.stringify({ ...manifest, format: 'other' }))))).rejects.toThrow('not an LV Design Studio backup');
  });

  it('drops checkpoints that belong to another project', async () => {
    const other = newCheckpoint({ ...project, id: 'p-9' }, 'Other', { now: at(3) });
    const r = await readBackup(await buildBackup(project, [...checkpoints, other], '1.69'));
    expect(r.checkpoints.map((c) => c.label)).toEqual(['Before client comments', 'Before issuing']);
  });
});
