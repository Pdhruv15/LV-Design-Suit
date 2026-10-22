import { describe, expect, it } from 'vitest';
import { dssComment, dssName, exportDss, uniqueDssNames } from './exportDss';
import type { Project } from '../../types';

// Fixed fixture (independent of the app's sample project, which may change).
const sampleProject: Project = {
  name: 'Demonstration Project — Not for Construction',
  voltageV: 415,
  frequencyHz: 50,
  ambientC: 45,
  vdLimitPct: 4,
  boards: [{ id: 'MDB-1', name: 'Main Distribution Board', sourceKva: 1000, sourceImpedancePct: 5 }],
  feeders: [
    { id: 'SMDB-GF', boardId: 'MDB-1', name: 'Ground floor SMDB', loadKw: 205, demandFactor: 0.8, powerFactor: 0.85, lengthM: 42, cableCsaMm2: 185, cores: 4, breakerRatingA: 400, breakerIcuKa: 36 },
    { id: 'SMDB-FF', boardId: 'MDB-1', name: 'First floor SMDB', loadKw: 138, demandFactor: 0.78, powerFactor: 0.85, lengthM: 55, cableCsaMm2: 120, cores: 4, breakerRatingA: 250, breakerIcuKa: 36 },
    { id: 'DB-AC', boardId: 'MDB-1', name: 'HVAC distribution board', loadKw: 310, demandFactor: 0.92, powerFactor: 0.85, lengthM: 68, cableCsaMm2: 300, cores: 4, breakerRatingA: 500, breakerIcuKa: 50 },
    { id: 'DB-EM', boardId: 'MDB-1', name: 'Emergency board (ATS)', loadKw: 96, demandFactor: 0.81, powerFactor: 0.85, lengthM: 25, cableCsaMm2: 120, cores: 4, breakerRatingA: 250, breakerIcuKa: 36 },
    { id: 'DB-PV', boardId: 'MDB-1', name: 'Solar PV inverter board', loadKw: 50, demandFactor: 1, powerFactor: 0.95, lengthM: 30, cableCsaMm2: 70, cores: 4, breakerRatingA: 160, breakerIcuKa: 25, generation: true }
  ],
  updatedAt: ''
};

const lines = (script: string, prefix: string) => script.split('\n').filter((l) => l.startsWith(prefix));

describe('OpenDSS export', () => {
  it('sanitises names that OpenDSS would misread', () => {
    expect(dssName('DB 1.2/A')).toBe('DB_1_2_A');
    expect(dssName('SMDB-GF')).toBe('SMDB-GF');
  });

  it('keeps sanitised names unique without case-only collisions', () => {
    expect([...uniqueDssNames(['DB 1', 'DB.1', 'db_1', 'DB 1']).values()]).toEqual(['DB_1', 'DB_1_2', 'db_1_3']);
    const project: Project = {
      ...sampleProject,
      boards: [
        { ...sampleProject.boards[0], id: 'Main.1' },
        { id: 'Main 1', name: 'Sub', upstreamId: 'Main.1' }
      ],
      feeders: [
        { ...sampleProject.feeders[0], id: 'Load.1', boardId: 'Main.1', feedsBoardId: 'Main 1' },
        { ...sampleProject.feeders[1], id: 'Load 1', boardId: 'Main 1' }
      ]
    };
    const { script } = exportDss(project);
    expect(script).toContain('buses=[sourcebus bb_Main_1]');
    expect(script).toContain('New Line.Load_1 phases=3 bus1=bb_Main_1 bus2=bb_Main_1_2');
    expect(script).toContain('New Line.Load_1_2 phases=3 bus1=bb_Main_1_2 bus2=ld_Load_1_2');
  });

  it('keeps imported text on its OpenDSS comment line', () => {
    expect(dssComment('first\r\nClear\u2028Solve')).toBe('first Clear Solve');
    const project: Project = {
      ...sampleProject,
      name: 'Project\nClear',
      feeders: [{ ...sampleProject.feeders[0], id: 'F\r\nSolve', name: 'Load\u2029Redirect output' }]
    };
    const { script } = exportDss(project);
    expect(script).toContain('! Project: Project Clear');
    expect(script).toContain('! F Solve — Load Redirect output');
    expect(script.split('\n').filter((line) => line === 'Clear')).toHaveLength(1);
    expect(script.split('\n').filter((line) => line === 'Solve')).toHaveLength(1);
  });

  it('exports the sample project: transformer, a line per feeder, loads and PV', () => {
    const { script, warnings } = exportDss(sampleProject);
    expect(warnings).toEqual([]);

    const [tx] = lines(script, 'New Transformer.');
    expect(tx).toContain('buses=[sourcebus bb_MDB-1]');
    expect(tx).toContain('kVs=[11 0.415]');
    expect(tx).toContain('kVAs=[1000 1000]');
    // 5 % at X/R 5 → R = 0.9806 %, X = 4.9029 %
    expect(tx).toContain('XHL=4.9029');
    expect(tx).toContain('%loadloss=0.9806');

    expect(lines(script, 'New Line.')).toHaveLength(sampleProject.feeders.length);
    expect(lines(script, 'New Load.')).toHaveLength(4);
    const [pv] = lines(script, 'New Generator.');
    expect(pv).toContain('Generator.DB-PV');
    expect(pv).toContain('kW=50');

    // 185 mm²: R = 0.0991 × 1.2 = 0.11892 Ω/km
    expect(script).toContain('New LineCode.cu185_3ph nphases=3 r1=0.11892 x1=0.07');
    expect(script).toContain('Solve mode=faultstudy');
  });

  it('connects an incomer to the downstream busbar with no load, and exports 2-core circuits as single-phase', () => {
    const p: Project = {
      ...sampleProject,
      boards: [...sampleProject.boards, { id: 'SMDB 2', name: 'Sub', upstreamId: 'MDB-1' }],
      feeders: [
        { id: 'RISER', boardId: 'MDB-1', name: 'Riser', loadKw: 0, demandFactor: 1, powerFactor: 0.85, lengthM: 40, cableCsaMm2: 95, cores: 4, breakerRatingA: 200, breakerIcuKa: 36, feedsBoardId: 'SMDB 2' },
        { id: 'LTG', boardId: 'SMDB 2', name: 'Lighting', loadKw: 3, demandFactor: 1, powerFactor: 0.9, lengthM: 25, cableCsaMm2: 2.5, cores: 2, breakerRatingA: 20, breakerIcuKa: 10 }
      ]
    };
    const { script } = exportDss(p);

    expect(script).toContain('New Line.RISER phases=3 bus1=bb_MDB-1 bus2=bb_SMDB_2 linecode=cu95_3ph length=40 units=m');
    expect(lines(script, 'New Load.RISER')).toHaveLength(0);

    // 2.5 mm² single-phase loop: 2 × 7.41 × 1.2 = 17.784 Ω/km
    expect(script).toContain('New LineCode.cu2p5_1ph nphases=1 r1=17.784');
    expect(script).toContain('New Line.LTG phases=1 bus1=bb_SMDB_2.1 bus2=ld_LTG.1');
    expect(script).toContain('New Load.LTG bus1=ld_LTG.1 phases=1 kv=0.2396 kW=3');
  });

  it('exports a capacitor bank as a Capacitor at its rated kvar, not as a zero-power load', () => {
    const cap = { id: 'PFC', boardId: 'MDB-1', name: 'PFC', loadKw: 0, kvar: 150, capSteps: 6, demandFactor: 1, powerFactor: 0, lengthM: 5, cableCsaMm2: 95, cores: 4, loadType: 'capacitor', breakerRatingA: 315, breakerIcuKa: 36 } as const;
    const { script } = exportDss({ ...sampleProject, feeders: [...sampleProject.feeders, cap] });
    expect(script).toContain('New Capacitor.PFC bus1=ld_PFC phases=3 kv=0.415 kvar=150');
    expect(lines(script, 'New Load.PFC')).toHaveLength(0);
  });

  it('warns when the main board has no transformer data', () => {
    const p: Project = { ...sampleProject, boards: [{ id: 'MDB-1', name: 'Main' }] };
    const { script, warnings } = exportDss(p);
    expect(warnings[0]).toMatch(/no transformer data/);
    expect(lines(script, 'New Transformer.')).toHaveLength(0);
  });
});
