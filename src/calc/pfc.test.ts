import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addPfcBanks, capVoltage, PFC_DEFAULTS, planPfc, subtree } from './pfc';
import { sizePfc } from './sizing';
import { buildSection, scopeOf } from '../docs/studyReport';
import type { Project } from '../types';

const central = planPfc(sampleProject, PFC_DEFAULTS);
const mdb = central.rows.find((r) => r.boardId === 'MDB-1')!;

describe('power factor correction plan', () => {
  it('central: only the main board, same bank as before', () => {
    expect(central.rows.map((r) => r.key)).toEqual(['board:MDB-1']);
    expect(mdb.bankKvar).toBe(sizePfc(sampleProject, 'MDB-1').bankKvar);
    expect(mdb.steps * mdb.stepKvar).toBe(mdb.bankKvar);
    expect(mdb.pfAfter).toBeGreaterThanOrEqual(central.pfTarget);
    expect(central.notCorrected).toContain('SMDB-GF');
    // Only the chosen main boards.
    expect(planPfc(sampleProject, { ...PFC_DEFAULTS, boards: ['SMDB-GF'] }).rows.map((r) => r.boardId)).toEqual(['MDB-1']); // not a main board: ignored in central
  });

  it('group: a sub-board bank is taken off the main board’s — nothing corrected twice', () => {
    const g = planPfc(sampleProject, { ...PFC_DEFAULTS, strategy: 'group', boards: ['SMDB-GF'] });
    const sub = g.rows.find((r) => r.boardId === 'SMDB-GF')!;
    const main = g.rows.find((r) => r.boardId === 'MDB-1')!;
    expect(sub.bankKvar).toBeGreaterThan(0);
    expect(main.downstreamKvar).toBe(sub.bankKvar);
    expect(main.remainder).toBe(true);
    expect(main.bankKvar + sub.bankKvar).toBeLessThanOrEqual(mdb.bankKvar + g.plan.stepKvar);
    expect(g.mains[0].pfAfter).toBeGreaterThanOrEqual(g.pfTarget);
    // Without the remainder bank only the chosen board.
    expect(planPfc(sampleProject, { ...PFC_DEFAULTS, strategy: 'group', boards: ['SMDB-GF'], remainder: false }).rows.map((r) => r.boardId)).toEqual(['SMDB-GF']);
  });

  it('individual: fixed capacitors at the larger motors, never over-correcting; VFDs skipped', () => {
    const r = planPfc(sampleProject, { ...PFC_DEFAULTS, strategy: 'individual', minKw: 5 });
    const loads = r.rows.filter((x) => x.kind === 'load');
    expect(loads.length).toBeGreaterThan(0);
    for (const l of loads) expect(l.bankKvar).toBeLessThanOrEqual(l.requiredKvar + 1e-9);
    const vfd: Project = { ...sampleProject, feeders: sampleProject.feeders.map((f) => (f.id === loads[0].feederId ? { ...f, starter: 'VFD' as const } : f)) };
    const v = planPfc(vfd, { ...PFC_DEFAULTS, strategy: 'individual', minKw: 5 }).rows.find((x) => x.feederId === loads[0].feederId)!;
    expect(v.bankKvar).toBe(0);
    expect(v.notes.join(' ')).toMatch(/VFD/);
  });

  it('detuning from non-linear load, capacitor voltage, light-load warning', () => {
    expect([capVoltage(415, 0), capVoltage(415, 7), capVoltage(415, 14)]).toEqual([440, 480, 525]);
    const it: Project = { ...sampleProject, feeders: sampleProject.feeders.map((f) => (f.boardId === 'SMDB-GF' && !f.feedsBoardId ? { ...f, loadType: 'it' as const } : f)) };
    const d = planPfc(it, { ...PFC_DEFAULTS, strategy: 'group', boards: ['SMDB-GF'] }).rows.find((r) => r.boardId === 'SMDB-GF')!;
    expect(d.detunedPct).toBe(7);
    expect(d.capVoltageV).toBe(480);
    const big = planPfc(sampleProject, { ...PFC_DEFAULTS, stepKvar: 50, lightLoadPct: 20 }).rows[0];
    expect(big.notes.join(' ')).toMatch(/leading/);
  });

  it('add to SLD: banks become capacitor ways, and nothing more is needed', () => {
    const g = planPfc(sampleProject, { ...PFC_DEFAULTS, strategy: 'group', boards: ['SMDB-GF'] });
    const { project, added } = addPfcBanks(sampleProject, g);
    expect(added).toHaveLength(2);
    const caps = project.feeders.filter((f) => f.loadType === 'capacitor');
    expect(caps.map((f) => f.boardId).sort()).toEqual(['MDB-1', 'SMDB-GF']);
    expect(caps.every((f) => (f.breakerRatingA ?? 0) >= ((f.kvar! * 1000) / (Math.sqrt(3) * 415)) * 1.43)).toBe(true);
    const again = planPfc(project, g.plan);
    expect(again.totalKvar).toBe(0);
    expect(again.rows.find((r) => r.boardId === 'MDB-1')!.existingKvar).toBe(g.totalKvar);
    // A board that already has a bank gets it enlarged, not a second one.
    const low = { ...project, studySettings: { ...project.studySettings, pfTarget: 0.99 } };
    const more = addPfcBanks(low, planPfc(low, g.plan)).project;
    expect(more.feeders.filter((f) => f.loadType === 'capacitor').length).toBe(2);
  });

  it('study report section, filtered to the scope', () => {
    const p: Project = { ...sampleProject, pfc: { strategy: 'group', boards: ['SMDB-GF'] } };
    const data = { project: p, results: [], earthing: [], selectivity: [] };
    const all = buildSection('pfc', data, scopeOf(p, { boards: [], downstream: true }));
    expect(all.tables[0].rows.length).toBe(2);
    const one = buildSection('pfc', data, scopeOf(p, { boards: ['SMDB-GF'], downstream: true }));
    expect(one.tables[0].rows.length).toBe(1);
    expect(subtree(p, 'MDB-1').size).toBe(p.boards.length);
  });
});
