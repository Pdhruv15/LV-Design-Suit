import { describe, expect, it } from 'vitest';
import type { Feeder, Project } from '../types';
import { boardSummary } from './summary';
import { boardDemandKw, evaluateProject } from './electrical';
import { boardPhaseKw, boardPhasePQ } from './loadSchedule';
import { existingChecks, newDemandKva } from './existing';
import { recordedKva, recordedText } from '../model/existing';

const feeder = (id: string, boardId: string, patch: Partial<Feeder> = {}): Feeder => ({
  id, boardId, name: id, loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 30, cableCsaMm2: 95, cores: 4, breakerRatingA: 250, breakerIcuKa: 50, ...patch
});

// Existing 1000 kVA TX-1 / MDB-1 (recorded 610 kVA), an existing SMDB-OLD with an existing load (inside the reading),
// and a new SMDB-EXT with 162 kW at 0.9 (180 kVA) on a spare way.
const project: Project = {
  name: 'Extension', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
  boards: [
    { id: 'MDB-1', name: 'MDB', sourceKva: 1000, sourceImpedancePct: 6, ratedCurrentA: 1600, existing: { recordedKva: 610, powerFactor: 0.9, source: 'DEWA reading', recordedOn: '2026-08-12', spareWays: 3 } },
    { id: 'SMDB-OLD', name: 'Old', upstreamId: 'MDB-1', ratedCurrentA: 400, existing: { recordedKva: 200 } },
    { id: 'SMDB-EXT', name: 'New', upstreamId: 'MDB-1', ratedCurrentA: 250 }
  ],
  feeders: [
    feeder('INC-OLD', 'MDB-1', { feedsBoardId: 'SMDB-OLD', existing: true, breakerRatingA: 400, cableCsaMm2: 240 }),
    feeder('OLD-LOAD', 'SMDB-OLD', { loadKw: 150, existing: true }),
    feeder('INC-EXT', 'MDB-1', { feedsBoardId: 'SMDB-EXT' }),
    feeder('EXT-LOAD', 'SMDB-EXT', { loadKw: 162 })
  ]
};

describe('recorded maximum demand of an existing installation', () => {
  it('adds the reading once, with the new load on top; existing load below the reading is not added again', () => {
    const sm = boardSummary(project, project.boards[0]);
    expect(sm.demandKva).toBeCloseTo(610 + 180, 0);
    expect(boardDemandKw(project, 'MDB-1')).toBeCloseTo(0.9 * 610 + 162, 3);
    const pq = boardPhasePQ(project, 'MDB-1');
    expect(pq.R.p + pq.Y.p + pq.B.p).toBeCloseTo(0.9 * 610 + 162, 3);
    const ph = boardPhaseKw(project, 'MDB-1');
    expect(ph.R + ph.Y + ph.B).toBeCloseTo(0.9 * 610 + 162, 3);
    expect(newDemandKva(project, project.boards[0])).toBeCloseTo(180, 0);
  });

  it('uses each existing board’s own reading for its own figures', () => {
    expect(boardSummary(project, project.boards[1]).demandKva).toBeCloseTo(200, 0);
  });

  it('reads a current as kVA, adds the margin and describes the reading', () => {
    const b = { id: 'X', name: 'X', existing: { recordedA: 1000, marginPct: 10 } };
    expect(recordedKva(project, b)).toBeCloseTo((Math.sqrt(3) * 400 * 1000) / 1000 * 1.1, 1);
    expect(recordedText(project, project.boards[0])).toBe('MD 610 kVA (DEWA reading, 2026-08-12)');
  });

  it('checks transformer spare capacity, the existing incomer, existing feeders and spare ways', () => {
    const c = existingChecks(project, evaluateProject(project));
    const tx = c.find((x) => x.kind === 'transformer')!;
    expect(tx.value).toBe('610 + 180 = 790 kVA');
    expect(tx.status).toBe('warn'); // less than 5 % of the rating left
    expect(tx.result).toBe('10 kVA left');
    expect(c.find((x) => x.kind === 'incomer' && x.id === 'MDB-1')!.status).toBe('ok');
    expect(c.find((x) => x.kind === 'feeder' && x.id === 'INC-OLD')).toBeDefined();
    const spare = c.find((x) => x.kind === 'spare' && x.id === 'MDB-1')!;
    expect(spare).toMatchObject({ value: '1 new way', status: 'ok', result: '2 left' });
  });

  it('fails the transformer when the new load takes it past the loading limit', () => {
    const big: Project = { ...project, feeders: project.feeders.map((f) => (f.id === 'EXT-LOAD' ? { ...f, loadKw: 300 } : f)) };
    const tx = existingChecks(big, evaluateProject(big)).find((x) => x.kind === 'transformer')!;
    expect(tx.status).toBe('bad');
    expect(tx.result).toMatch(/^Over by \d+ kVA$/);
  });
});

describe('existing installation in the BOQ', () => {
  it('leaves out existing boards, their transformer and existing ways; new ways on an existing board stay in', async () => {
    const { buildBom } = await import('./bom');
    const bom = buildBom(project);
    const where = (prefix: string) => bom.filter((x) => x.key.startsWith(prefix)).flatMap((x) => x.where);
    expect(where('tx:')).toEqual([]);
    expect(where('panel:')).toEqual(['SMDB-EXT']);
    expect(bom.filter((x) => x.key.startsWith('cable:')).reduce((a, x) => a + x.qty, 0)).toBe(60); // INC-EXT + EXT-LOAD only
  });
});
