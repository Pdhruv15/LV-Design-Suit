import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Board, Feeder, Project } from '../types';
import { panelScheduleDocs } from './panelScheduleDocs';

describe('panel schedules in the issue package', () => {
  it('includes MD forms for MCC and EMCC package panels and a circuit schedule for EDB', () => {
    const boards: Board[] = [
      ...sampleProject.boards,
      { id: 'EMCC-1', name: 'Emergency MCC', kind: 'EMCC', upstreamId: 'MDB-1' },
      { id: 'EDB-1', name: 'Emergency DB', kind: 'EDB', upstreamId: 'MDB-1' }
    ];
    const feeders: Feeder[] = [
      ...sampleProject.feeders,
      { id: 'INC-EMCC', boardId: 'MDB-1', feedsBoardId: 'EMCC-1', name: 'To EMCC', loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 20, cableCsaMm2: 35, cores: 4, breakerRatingA: 100, breakerIcuKa: 25 },
      { id: 'EMCC-PUMP', boardId: 'EMCC-1', name: 'Smoke extract fan', loadKw: 22, demandFactor: 1, powerFactor: 0.86, lengthM: 15, cableCsaMm2: 10, cores: 4, breakerRatingA: 40, breakerIcuKa: 25, loadType: 'motor' },
      { id: 'INC-EDB', boardId: 'MDB-1', feedsBoardId: 'EDB-1', name: 'To EDB', loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 20, cableCsaMm2: 16, cores: 4, breakerRatingA: 63, breakerIcuKa: 25 },
      { id: 'EDB-L1', boardId: 'EDB-1', name: 'Emergency lighting', loadKw: 1, demandFactor: 1, powerFactor: 0.9, lengthM: 15, cableCsaMm2: 2.5, cores: 2, breakerRatingA: 10, breakerIcuKa: 10, loadType: 'lighting', phase: 'R', way: 1 }
    ];
    const p: Project = { ...sampleProject, boards, feeders };
    const docs = panelScheduleDocs(p, boards);
    expect(docs).toEqual(expect.arrayContaining([
      expect.objectContaining({ boardId: 'MCC-1', kind: 'md', title: 'Connected load / MD — MCC-1' }),
      expect.objectContaining({ boardId: 'EMCC-1', kind: 'md', title: 'Connected load / MD — EMCC-1' }),
      expect.objectContaining({ boardId: 'EDB-1', kind: 'db', title: 'Load schedule — EDB-1' })
    ]));
  });
});
