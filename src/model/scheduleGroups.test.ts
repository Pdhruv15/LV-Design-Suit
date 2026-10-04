import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { planEmergency } from './emergency';
import { scheduleGroups } from './scheduleGroups';
import { buildFormWorkbook } from '../docs/formWorkbook';

describe('load schedule groups', () => {
  it('sample: MDB, SMDB, DB and MCC tabs in supply order', () => {
    const g = scheduleGroups(sampleProject);
    expect(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((b) => b.id)]))).toEqual({ mdb: ['MDB-1'], smdb: ['SMDB-GF', 'SMDB-FF'], db: ['DB-GF1'], emg: [], mcc: ['MCC-1'], other: [] });
  });

  it('emergency system in its own tab: EMDB, then ESMDBs, then EDBs; workbook in the same order', () => {
    const e = planEmergency(sampleProject, { count: 1, mainsFrom: 'MDB-1', esmdb: 2, edb: 3, incomers: true });
    expect(e.ok).toBe(true);
    const p = { ...sampleProject, boards: [...sampleProject.boards, ...e.boards], feeders: [...sampleProject.feeders, ...e.feeders] };
    const g = scheduleGroups(p);
    expect(g.emg.map((b) => b.kind)).toEqual(['EMDB', 'SMDB', 'SMDB', 'DB', 'DB', 'DB']);
    expect(g.smdb.map((b) => b.id)).toEqual(['SMDB-GF', 'SMDB-FF']); // emergency sub-mains are not in the normal SMDB tab
    const names = buildFormWorkbook(p).worksheets.map((w) => w.name);
    expect(names.indexOf('DB-GF1 SCHEDULE')).toBeLessThan(names.findIndex((n) => n.startsWith(e.boards[0].id)));
    expect(names.findIndex((n) => n.startsWith(e.boards[0].id))).toBeLessThan(names.indexOf('MCC-1 MD'));
  });
});
