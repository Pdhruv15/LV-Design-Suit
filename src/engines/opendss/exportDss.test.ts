import { describe, expect, it } from 'vitest';
import { dssName, exportDss } from './exportDss';
import { sampleProject } from '../../data/sampleProject';
import type { Project } from '../../types';

const lines = (script: string, prefix: string) => script.split('\n').filter((l) => l.startsWith(prefix));

describe('OpenDSS export', () => {
  it('sanitises names that OpenDSS would misread', () => {
    expect(dssName('DB 1.2/A')).toBe('DB_1_2_A');
    expect(dssName('SMDB-GF')).toBe('SMDB-GF');
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

  it('warns when the main board has no transformer data', () => {
    const p: Project = { ...sampleProject, boards: [{ id: 'MDB-1', name: 'Main' }] };
    const { script, warnings } = exportDss(p);
    expect(warnings[0]).toMatch(/no transformer data/);
    expect(lines(script, 'New Transformer.')).toHaveLength(0);
  });
});
