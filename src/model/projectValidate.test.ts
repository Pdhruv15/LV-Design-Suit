import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { boardDemandKw } from '../calc/electrical';
import { runCalculations } from '../calc/runs';
import { buildDashboard } from '../calc/dashboard';
import { vdCandidates, vdRow } from '../calc/voltageDrop';
import { exportDss } from '../engines/opendss/exportDss';
import { checkReferences } from './integrity';
import { checkProjectShape, ProjectFileError, projectInputIssues } from './projectValidate';
import type { Feeder, Project } from '../types';

const fd = (over: Partial<Feeder>): Feeder => ({
  id: 'F', boardId: 'MDB', name: 'Load', loadKw: 10, demandFactor: 1, powerFactor: 0.9,
  lengthM: 20, cableCsaMm2: 10, cores: 4, breakerRatingA: 32, breakerIcuKa: 25, ...over
});
const proj = (boards: Project['boards'], feeders: Feeder[]): Project => ({ name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 40, vdLimitPct: 4, boards, feeders, updatedAt: '' });

// MDB → SMDB → DB, each with one 10 kW load.
const tree = (extra: Feeder[] = []) => proj(
  [{ id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 }, { id: 'SMDB', name: 'S', upstreamId: 'MDB' }, { id: 'DB', name: 'D', upstreamId: 'SMDB' }],
  [fd({ id: 'L1' }), fd({ id: 'I1', feedsBoardId: 'SMDB', loadKw: 0 }), fd({ id: 'L2', boardId: 'SMDB' }), fd({ id: 'I2', boardId: 'SMDB', feedsBoardId: 'DB', loadKw: 0 }), fd({ id: 'L3', boardId: 'DB' }), ...extra]
);

describe('board network topology', () => {
  it('single board and multilevel network: demand summed down the tree, no issues', () => {
    expect(boardDemandKw(proj([{ id: 'MDB', name: 'M' }], [fd({ id: 'A' }), fd({ id: 'B', demandFactor: 0.5 })]), 'MDB')).toBe(15);
    const p = tree();
    expect(boardDemandKw(p, 'MDB')).toBe(30);
    expect(boardDemandKw(p, 'SMDB')).toBe(20);
    expect(checkReferences(p)).toEqual([]);
  });

  it('a circuit loop does not overflow, and is reported with its path', () => {
    const p = tree([fd({ id: 'BACK', boardId: 'DB', feedsBoardId: 'MDB', loadKw: 0 })]);
    expect(boardDemandKw(p, 'MDB')).toBe(30);
    expect(checkReferences(p).map((i) => i.problem)).toEqual(['is fed in a loop through its circuits (MDB → SMDB → DB → MDB)']);
  });

  it('a circuit feeding its own panel is reported', () => {
    const p = tree([fd({ id: 'SELF', boardId: 'DB', feedsBoardId: 'DB', loadKw: 0 })]);
    expect(boardDemandKw(p, 'DB')).toBe(10);
    expect(checkReferences(p)).toEqual([{ where: 'Circuit SELF', ref: 'DB', problem: 'feeds the panel it is on' }]);
  });

  it('a panel fed from itself, a missing downstream panel and a duplicate panel name are reported', () => {
    const p = tree([fd({ id: 'GONE', feedsBoardId: 'NOPE', loadKw: 0 })]);
    p.boards = [...p.boards, { id: 'X', name: 'X', upstreamId: 'X' }, { id: 'DB', name: 'dup', upstreamId: 'MDB' }];
    const problems = checkReferences(p).map((i) => `${i.where}: ${i.problem}`);
    expect(problems).toContain('Circuit GONE: Panel it feeds does not exist');
    expect(problems).toContain('Panel X: is fed in a loop');
    expect(problems).toContain('Panel DB: has the same name as another panel');
    expect(boardDemandKw(p, 'MDB')).toBe(30); // the missing panel contributes nothing
  });

  it('the screens that walk the network survive a loop in the sample project', () => {
    const main = sampleProject.boards.find((b) => !b.upstreamId)!;
    const leaf = sampleProject.boards.find((b) => b.upstreamId && !sampleProject.feeders.some((f) => f.boardId === b.id && f.feedsBoardId))!;
    const p: Project = { ...sampleProject, feeders: [...sampleProject.feeders, { ...sampleProject.feeders[0], id: 'LOOP', boardId: leaf.id, feedsBoardId: main.id }] };
    expect(() => exportDss(p)).not.toThrow();
    expect(() => vdCandidates(p).map((f) => vdRow(p, f))).not.toThrow();
    expect(buildDashboard(p, runCalculations(p)).todo.some((t) => /fed in a loop through its circuits/.test(t.text) && t.status === 'bad')).toBe(true);
  });
});

describe('project file structure (on open)', () => {
  it('accepts the sample project and an old minimal file', () => {
    expect(checkProjectShape(sampleProject)).toBe(sampleProject);
    expect(() => checkProjectShape({ name: 'Old', boards: [{ id: 'MDB' }], feeders: [] })).not.toThrow();
  });
  it.each([
    [null, 'it does not contain a project'],
    [[1, 2], 'it does not contain a project'],
    [{ feeders: [] }, 'the list of panels (boards) is missing'],
    [{ boards: [] }, 'the list of circuits (feeders) is missing'],
    [{ boards: [{ name: 'no id' }], feeders: [] }, 'panel 1 has no name (id)'],
    [{ boards: [{ id: 'MDB' }], feeders: [{ id: 'F1' }] }, 'circuit F1 does not say which panel it is on'],
    [{ boards: [{ id: 'MDB' }], feeders: [null] }, 'circuit 1 has no id']
  ])('rejects %j: %s', (raw, why) => {
    expect(() => checkProjectShape(raw, 'x.json')).toThrow(ProjectFileError);
    expect(() => checkProjectShape(raw, 'x.json')).toThrow(`x.json is not a valid LV Design Studio project: ${why}.`);
  });
});

describe('engineering input checks', () => {
  it('the sample project has none', () => expect(projectInputIssues(sampleProject)).toEqual([]));

  it('project settings: zero / non-finite voltage, frequency, limit, temperature', () => {
    const p = { ...tree(), voltageV: 0, frequencyHz: NaN, vdLimitPct: -1, vdTempC: Infinity };
    expect(projectInputIssues(p)).toEqual([{ status: 'bad', text: 'Project settings: system voltage 0 V (must be above 0); frequency NaN Hz (must be above 0); voltage drop limit -1 % (must be above 0); conductor temperature Infinity °C (not a number)' }]);
  });

  it('transformer data: zero is a failure, an unusually high %Z a warning', () => {
    const bad = tree(); bad.boards[0] = { ...bad.boards[0], sourceKva: 0 };
    expect(projectInputIssues(bad)[0]).toMatchObject({ status: 'bad', text: 'Panel MDB: transformer rating 0 kVA (must be above 0)' });
    const high = tree(); high.boards[0] = { ...high.boards[0], sourceImpedancePct: 45 };
    expect(projectInputIssues(high)[0].status).toBe('warn');
  });

  it('a circuit names each impossible input', () => {
    const p = tree([fd({ id: 'BAD', powerFactor: 0, demandFactor: 1.5, lengthM: -5, breakerRatingA: 0, parallel: 1.5, loadKw: NaN, cores: 1 as 2 })]);
    const i = projectInputIssues(p);
    expect(i).toHaveLength(1);
    expect(i[0]).toMatchObject({ status: 'bad', go: { view: 'design', feederId: 'BAD' } });
    for (const s of ['load kW NaN', 'demand factor 1.5', 'power factor 0', 'cable length m -5', 'parallel runs 1.5', 'cores 1', 'breaker rating A 0']) expect(i[0].text).toContain(s);
  });

  it('a value missing from an old file is named as missing', () => {
    const f = fd({ id: 'OLD' }) as Partial<Feeder>; delete f.breakerIcuKa;
    expect(projectInputIssues(tree([f as Feeder]))[0].text).toBe('Circuit OLD: breaker Icu kA missing (above 0)');
  });

  it('incomers and capacitor banks are not checked for a load power factor', () => {
    const p = tree([fd({ id: 'CAP', kvar: 50, powerFactor: 0, loadKw: 0 })]);
    p.feeders = p.feeders.map((f) => (f.id === 'I1' ? { ...f, powerFactor: 0 } : f));
    expect(projectInputIssues(p)).toEqual([]);
  });
});
