import { describe, expect, it } from 'vitest';
import type { Board, BuildingInfo, Feeder, Project } from '../types';
import { sampleProject } from '../data/sampleProject';
import { riserLayout, ROW_H, U } from './riserLayout';
import { addRiserSheet, renumber, sheetsByCount } from '../model/drawingSet';

const info: BuildingInfo = { rooms: [], buildings: [{ id: 'A', name: 'Tower A', levels: [
  { id: 'b1', name: 'B1', kind: 'basement', heightM: 4 }, { id: 'g', name: 'GF', kind: 'ground', heightM: 4 },
  { id: 't', name: 'Typical', kind: 'typical', heightM: 3.6, count: 5 }, { id: 'r', name: 'Roof', kind: 'roof', heightM: 3 }
] }] };
const at = (level: string, index?: number) => ({ building: 'A', level, ...(index ? { index } : {}) });
const base = sampleProject.feeders[0];
const fd = (id: string, from: string, to: string): Feeder => ({ ...base, id, boardId: from, feedsBoardId: to, name: to });
const boards: Board[] = [
  { id: 'MDB', name: 'MDB', kind: 'MDB', sourceKva: 1000, standby: { kva: 500 }, level: at('b1') },
  { id: 'SMDB-GF', name: 'GF', kind: 'SMDB', upstreamId: 'MDB', level: at('g') },
  ...[0, 1, 2, 3, 4].map((i) => ({ id: `DB-${i + 1}F`, name: `${i + 1}F`, kind: 'DB' as const, upstreamId: 'MDB', level: at('t', i) })),
  { id: 'SMDB-R', name: 'Roof', kind: 'SMDB', upstreamId: 'MDB', level: at('r') }
];
const project = {
  ...sampleProject, building: info, boards,
  feeders: [fd('F1', 'MDB', 'SMDB-GF'), fd('F2', 'MDB', 'SMDB-R'), ...[1, 2, 3, 4, 5].map((i) => fd(`T${i}`, 'MDB', `DB-${i}F`))],
  busRisers: [{ id: 'R1', name: 'Riser 1', sourceBoardId: 'MDB', material: 'cu', feedM: 10, floorHeightM: 3.6, offsetFloors: 1, elementM: 3, elbows: 2, floors: [1, 2, 3, 4, 5].map((i) => ({ id: `F${i}`, name: `${i}F`, boardId: `DB-${i}F` })) }]
} as unknown as Project;

describe('riser diagram', () => {
  const L = riserLayout(project, 'A');
  it('one row per level, bottom to top', () => {
    expect(L.rows.map((r) => r.label)).toEqual(['B1', 'GF', 'L01', 'L02', 'L03', 'L04', 'L05', 'Roof']);
    expect(L.rows[0].y).toBeGreaterThan(L.rows[7].y);
    expect(L.rows[0].y - L.rows[1].y).toBeCloseTo(ROW_H);
  });
  it('each panel on its level; busbar taps; cables; sources', () => {
    const node = (id: string) => L.nodes.find((n) => n.board.id === id)!;
    expect(node('MDB').y).toBe(L.rows[0].y);
    expect(node('DB-3F').y).toBe(L.rows[4].y);
    expect(node('SMDB-R').y).toBe(L.rows[7].y);
    expect(L.buses).toHaveLength(1);
    expect(L.buses[0].taps).toHaveLength(5);
    expect(L.sources.map((s) => s.kind).sort()).toEqual(['gen', 'tx']);
    expect([...L.used].sort()).toEqual(['ats', 'bus', 'cable', 'db', 'gen', 'standby', 'tap', 'tx']);
    expect(U).toBe(20);
  });
  it('riser sheets number in their own sequence', () => {
    const set = addRiserSheet(sheetsByCount(project, 10), 'A', 'Tower A').set;
    const r = renumber(set, true);
    expect(r.sheets.map((s) => s.number)).toEqual(['E-SLD-001', 'E-RSR-001']);
  });
});
