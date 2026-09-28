import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { dropMany } from './sldEdit';
import { BUILT_IN_PRESETS, mergePresets, presetsFile, readPresetsFile, type FeederPreset } from './presets';
import { legendEntries, polesText, switchKindOf } from '../diagram/IecSymbols';
import type { Project } from '../types';

const ahu = BUILT_IN_PRESETS.find((p) => p.id === 'bi-ahu')!;
const onBoard = (p: Project, b: string) => p.feeders.filter((f) => f.boardId === b).map((f) => f.id);

describe('drop where you point, several at once', () => {
  it('a way dropped between two feeders goes in front of the one after the pointer', () => {
    const before = onBoard(sampleProject, 'SMDB-GF');
    const r = dropMany(sampleProject, { kind: 'preset', preset: ahu }, { type: 'bus', boardId: 'SMDB-GF', before: before[1] });
    const after = onBoard(r.project, 'SMDB-GF');
    expect(after.length).toBe(before.length + 1);
    expect(after[1]).toMatch(/AHU/);
    expect(after[2]).toBe(before[1]);
    // No "before": at the end, as before.
    const end = onBoard(dropMany(sampleProject, { kind: 'preset', preset: ahu }, { type: 'bus', boardId: 'SMDB-GF' }).project, 'SMDB-GF');
    expect(end[end.length - 1]).toMatch(/AHU/);
  });

  it('× 5 adds five ways, each sized, together at the drop point', () => {
    const before = onBoard(sampleProject, 'SMDB-GF');
    const r = dropMany(sampleProject, { kind: 'preset', preset: ahu }, { type: 'bus', boardId: 'SMDB-GF', before: before[0] }, 5);
    const after = onBoard(r.project, 'SMDB-GF');
    expect(after.length).toBe(before.length + 5);
    expect(after.slice(0, 5).every((id) => /AHU/.test(id))).toBe(true);
    expect(new Set(after).size).toBe(after.length); // unique ids
    expect(r.message).toMatch(/^Added 5 × /);
    // Sub-boards repeat too (5 apartment DBs), each with its incomer; a supply item doesn't.
    const db = BUILT_IN_PRESETS.find((p) => p.id === 'bi-db')!;
    const five = dropMany(sampleProject, { kind: 'preset', preset: db }, { type: 'bus', boardId: 'MDB-1' }, 5).project;
    expect(five.boards.length).toBe(sampleProject.boards.length + 5);
    expect(new Set(five.boards.map((b) => b.id)).size).toBe(five.boards.length);
    expect(dropMany(sampleProject, { kind: 'transformer' }, { type: 'canvas' }, 5).project.boards.length).toBe(sampleProject.boards.length + 1);
  });
});

describe('sharing presets', () => {
  const mine: FeederPreset = { id: 'up-1', name: 'My AHU', kind: 'load', loadType: 'hvac', loadKw: 22, breaker: 'MCCB', rcdMa: 300 };

  it('export and import round trip; same name or id replaces, others are added', () => {
    const text = presetsFile([mine]);
    expect(readPresetsFile(text)).toEqual([mine]);
    expect(readPresetsFile('not json')).toBeNull();
    const m = mergePresets([mine], [{ ...mine, loadKw: 30 }, { id: 'x', name: 'Other', kind: 'board', boardKind: 'DB' }, { name: 'bad' } as unknown as FeederPreset]);
    expect([m.added, m.updated]).toEqual([1, 1]);
    expect(m.list.find((p) => p.name === 'My AHU')!.loadKw).toBe(30);
    expect(mergePresets([mine], [mine]).updated).toBe(0);
  });
});

describe('IEC symbols and legend', () => {
  it('switching device and poles from the feeder', () => {
    const f = sampleProject.feeders.find((x) => !x.phase)!;
    expect(switchKindOf({ ...f, breakerType: 'ACB' })).toBe('acb');
    expect(switchKindOf({ ...f, device: 'ISOL' })).toBe('isolator');
    expect(switchKindOf({ ...f, breakerType: 'MCCB', device: undefined })).toBe('breaker');
    expect(polesText({ ...f, cores: 2 })).toBe('SP+N');
    expect(polesText({ ...f, cores: 4 })).toBe('TP+N');
  });

  it('the legend lists only the symbols the drawing uses', () => {
    const keys = legendEntries(sampleProject).map((e) => e.key);
    expect(keys).toContain('tx');
    expect(keys).toContain('cb');
    expect(keys).toContain('m'); // the sample has pumps
    expect(keys).not.toContain('rcd');
    expect(keys).not.toContain('spd');
    const withAcc: Project = {
      ...sampleProject,
      boards: sampleProject.boards.map((b) => (b.id === 'MDB-1' ? { ...b, spd: 'T1+2' as const } : b)),
      feeders: sampleProject.feeders.map((f, i) => (i === 0 ? { ...f, rcdMa: 30, kwhMeter: 'CT' as const } : f))
    };
    const k2 = legendEntries(withAcc).map((e) => e.key);
    expect(k2).toEqual(expect.arrayContaining(['rcd', 'ct', 'kwh', 'spd']));
  });
});
