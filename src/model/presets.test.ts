import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyDrop, canDrop } from './sldEdit';
import { applyPreset, BUILT_IN_PRESETS, presetFromFeeder, presetParts, type FeederPreset } from './presets';
import { evaluateFeeder } from '../calc/electrical';
import type { Project } from '../types';

const preset = (id: string) => BUILT_IN_PRESETS.find((p) => p.id === id)!;
const drop = (p: FeederPreset, boardId = 'SMDB-GF') => applyDrop(sampleProject, { kind: 'preset', preset: p }, { type: 'bus', boardId });
const added = (before: Project, after: Project) => after.feeders.filter((f) => !before.feeders.some((x) => x.id === f.id));

describe('feeder presets', () => {
  it('AHU: MCCB + RCD 300 mA + isolator + a 30 kW AHU, breaker and cable sized and passing', () => {
    const r = drop(preset('bi-ahu'));
    const [f] = added(sampleProject, r.project);
    expect(f).toMatchObject({ boardId: 'SMDB-GF', loadKw: 30, loadType: 'hvac', breakerType: 'MCCB', rcdMa: 300, localIsolator: true, cores: 4 });
    const res = evaluateFeeder(r.project, f);
    expect(res.ib).toBeLessThanOrEqual(f.breakerRatingA);
    expect(res.ampacity).toBeGreaterThanOrEqual(f.breakerRatingA);
    expect(r.message).toContain('MCCB');
  });

  it('single-phase sockets on an MCB with a 30 mA RCD; pump keeps its star-delta starter', () => {
    const [s] = added(sampleProject, drop(preset('bi-sockets')).project);
    expect(s).toMatchObject({ cores: 2, rcdMa: 30, breakerType: 'C' });
    const [p] = added(sampleProject, drop(preset('bi-pump')).project);
    expect(p).toMatchObject({ starter: 'SD', localIsolator: true, loadType: 'motor' });
  });

  it('a sub-board preset adds the board and its incomer with the meter; MDB only under a meter cabinet', () => {
    const r = drop(preset('bi-smdb'), 'MDB-1');
    const board = r.project.boards.find((b) => !sampleProject.boards.some((x) => x.id === b.id))!;
    expect(board).toMatchObject({ kind: 'SMDB', upstreamId: 'MDB-1', ratedCurrentA: 250 });
    const inc = r.project.feeders.find((f) => f.feedsBoardId === board.id)!;
    expect(inc).toMatchObject({ breakerRatingA: 250, breakerType: 'MCCB', kwhMeter: 'CT', boardId: 'MDB-1' });
    expect(evaluateFeeder(r.project, inc).ampacity).toBeGreaterThanOrEqual(250);
    const mdb: FeederPreset = { id: 'x', name: 'MDB', kind: 'board', boardKind: 'MDB', boardRatingA: 1600 };
    expect(canDrop(sampleProject, { kind: 'preset', preset: mdb }, { type: 'bus', boardId: 'MDB-1' })).toBe(false);
    expect(canDrop(sampleProject, { kind: 'preset', preset: preset('bi-db') }, { type: 'feeder', feederId: inc.id })).toBe(false);
  });

  it('a fixed breaker rating gets a cable that carries it', () => {
    const p: FeederPreset = { id: 'x', name: 'x', kind: 'load', loadName: 'Load', loadKw: 5, powerFactor: 0.9, breaker: 'MCCB', breakerRatingA: 100, lengthM: 30 };
    const r = applyPreset(sampleProject, p, 'SMDB-GF');
    const [f] = added(sampleProject, r.project);
    expect(f.breakerRatingA).toBe(100);
    expect(evaluateFeeder(r.project, f).ampacity).toBeGreaterThanOrEqual(100);
  });

  it('save any feeder as a preset and drop it again elsewhere — same way, new load', () => {
    const src = { ...sampleProject.feeders.find((f) => f.id === 'GF-HVAC')!, rcdMa: 300, localIsolator: true, kwhMeter: '3-PH' as const };
    const p = presetFromFeeder(sampleProject, src, 'My HVAC way');
    expect(p).toMatchObject({ kind: 'load', loadKw: src.loadKw, breakerRatingA: src.breakerRatingA, rcdMa: 300, localIsolator: true, kwhMeter: '3-PH' });
    expect(presetParts(p)).toContain('RCD 300 mA');
    const [f] = added(sampleProject, drop(p, 'MCC-1').project);
    expect(f).toMatchObject({ boardId: 'MCC-1', loadKw: src.loadKw, breakerRatingA: src.breakerRatingA, rcdMa: 300, localIsolator: true });
    const inc = sampleProject.feeders.find((x) => x.feedsBoardId)!;
    expect(presetFromFeeder(sampleProject, inc, 'sub').kind).toBe('board');
    expect(presetFromFeeder(sampleProject, { ...src, name: 'AHU 2' }, 'n').loadName).toBe('AHU');
  });

  it('every built-in preset drops on a sub-board or main board', () => {
    for (const p of BUILT_IN_PRESETS) {
      const r = drop(p, p.kind === 'board' ? 'MDB-1' : 'SMDB-GF');
      expect(r.project).not.toBe(sampleProject);
    }
  });
});
