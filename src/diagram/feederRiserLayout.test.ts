import { describe, expect, it } from 'vitest';
import type { Board, BuildingInfo, Feeder, Project } from '../types';
import { sampleProject } from '../data/sampleProject';
import { feederRiserLayout, leafSymbol } from './feederRiserLayout';
import { U } from './riserLayout';
import { addRiserSheet } from '../model/drawingSet';
import { sheetsByCount } from '../model/drawingSet';

const info: BuildingInfo = { rooms: [], buildings: [{ id: 'A', name: 'Tower A', levels: [
  { id: 'g', name: 'GF', kind: 'ground', heightM: 4 }, { id: 't', name: 'Typical', kind: 'typical', heightM: 3.6, count: 2 }
] }] };
const at = (level: string, index?: number) => ({ building: 'A', level, ...(index ? { index } : {}) });
const base = sampleProject.feeders[0];
const fd = (id: string, from: string, to: string, a = 63, cableType?: string): Feeder => ({ ...base, id, boardId: from, feedsBoardId: to, name: to, breakerRatingA: a, breakerIcuKa: 50, cableType });
const boards: Board[] = [
  { id: 'MDB', name: 'MDB', kind: 'MDB', sourceKva: 1600, ratedCurrentA: 2500, level: at('g') },
  { id: 'SMDB-1', name: 'L1', kind: 'SMDB', upstreamId: 'MDB', level: at('t', 0) },
  { id: 'DB-1A', name: 'L1 A', kind: 'DB', upstreamId: 'SMDB-1', level: at('t', 0) },
  { id: 'DB-2A', name: 'L2 A', kind: 'DB', upstreamId: 'SMDB-1', level: at('t', 1) },
  { id: 'MCC-1', name: 'Pumps', kind: 'MCC', upstreamId: 'MDB', level: at('g') },
  { id: 'EMDB', name: 'Emergency', kind: 'EMDB', standby: { kva: 500 }, ratedCurrentA: 800, level: at('g') },
  { id: 'EDB-2', name: 'L2 E', kind: 'EDB', upstreamId: 'EMDB', level: at('t', 1) },
  { id: 'EMCC-1', name: 'Fire pumps', kind: 'EMCC', upstreamId: 'EMDB', level: at('g') }
];
const project = {
  ...sampleProject, building: info, boards, busRisers: [],
  feeders: [fd('F1', 'MDB', 'SMDB-1', 630), fd('F2', 'SMDB-1', 'DB-1A'), fd('F3', 'SMDB-1', 'DB-2A'), fd('F4', 'MDB', 'MCC-1', 250),
    fd('F5', 'EMDB', 'EDB-2', 40, 'FR BS 6387 CWZ'), fd('F6', 'EMDB', 'EMCC-1', 160, 'FR BS 6387 CWZ')]
} as unknown as Project;

describe('riser schematic with individual feeders', () => {
  const L = feederRiserLayout(project, 'A');
  const panel = (id: string) => L.panels.find((p) => p.board.id === id)!;
  const leaf = (id: string) => L.leaves.find((n) => n.board.id === id)!;

  it('boards that feed others are panels with a busbar; the rest are symbols by kind', () => {
    expect(L.panels.map((p) => p.board.id).sort()).toEqual(['EMDB', 'MDB', 'SMDB-1']);
    expect(L.leaves.map((n) => [n.board.id, n.symbol])).toEqual(expect.arrayContaining([['DB-1A', 'db'], ['DB-2A', 'db'], ['MCC-1', 'mcc'], ['EDB-2', 'db'], ['EMCC-1', 'mcc']]));
    expect(leaf('DB-1A').lines[0]).toBe('REF: DB-1A');
    expect(leafSymbol('SMDB')).toBe('smdb');
    expect(leafSymbol('UPS')).toBe('ups');
  });

  it('each board fed has its own breaker on its own column, from its panel busbar', () => {
    const out = L.feeders.filter((f) => !f.incomer);
    expect(out).toHaveLength(6);
    expect(new Set(out.map((f) => f.x)).size).toBe(6);
    const toSmdb = out.find((f) => f.x === panel('SMDB-1').incomerX)!;
    expect(toSmdb.yBus).toBe(panel('MDB').busY);
    expect(toSmdb.yTo).toBe(panel('SMDB-1').y2); // up into the SMDB's incomer
    expect(toSmdb.device).toEqual(['630 A TPN', 'MCCB 50 kA']);
    expect(out.find((f) => f.x === leaf('DB-2A').x)!.yBus).toBe(panel('SMDB-1').busY);
    expect(out.filter((f) => f.fireRated)).toHaveLength(2);
    // Every cable says its size and length, short runs too (beside the run instead of along it).
    expect(out.every((f) => f.cable && f.cableAt)).toBe(true);
    expect(out.find((f) => f.x === leaf('MCC-1').x)!.cableVertical).toBeFalsy();
  });

  it('panels sit on their level, higher levels higher up; sources under the main boards', () => {
    expect(panel('SMDB-1').y2).toBeLessThan(panel('MDB').y1);
    expect(leaf('DB-2A').y).toBeLessThan(leaf('DB-1A').y);
    expect(L.rows.map((r) => r.label)).toEqual(['GF', 'L01', 'L02']);
    expect(L.sources.map((s) => s.kind).sort()).toEqual(['gen', 'tx']);
    expect(L.ats).toHaveLength(1);
    expect(L.height).toBeGreaterThan(L.rows[0].yLine + 3 * U);
    expect([...L.used].sort()).toEqual(['ats', 'breaker', 'cable', 'fr', 'gen', 'p-db', 'p-edb', 'p-mcc', 'panel', 'standby', 'tx']);
    // End boards as their IEC panel symbol; panels feeding ways keep their enclosure with a busbar.
    expect(leaf('DB-1A').panel).toBe('p-db');
    expect(leaf('MCC-1').panel).toBe('p-mcc');
  });

  it('riser sheets can use individual feeders', () => {
    const r = addRiserSheet(sheetsByCount(project, 10), 'A', 'Tower A', 'feeders');
    const s = r.set.sheets.find((x) => x.id === r.id)!;
    expect(s.riserStyle).toBe('feeders');
    expect(s.title).toBe('Riser schematic — Tower A');
  });
});

describe('busbar trunking from the same MDB', () => {
  const withBus = {
    ...project,
    boards: [...boards, { id: 'DB-1B', name: 'L1 B', kind: 'DB', upstreamId: 'MDB', level: at('t', 0) }, { id: 'DB-2B', name: 'L2 B', kind: 'DB', upstreamId: 'MDB', level: at('t', 1) }],
    feeders: [...project.feeders, fd('T1', 'MDB', 'DB-1B', 100), fd('T2', 'MDB', 'DB-2B', 100)],
    busRisers: [{ id: 'R1', name: 'Riser 1', sourceBoardId: 'MDB', material: 'cu', feedM: 10, floorHeightM: 3.6, offsetFloors: 1, elementM: 3, elbows: 2,
      floors: [{ id: 'F1', name: 'L1', boardId: 'DB-1B' }, { id: 'F2', name: 'L2', boardId: 'DB-2B' }] }]
  } as unknown as Project;
  const L = feederRiserLayout(withBus, 'A');
  const leaf = (id: string) => L.leaves.find((n) => n.board.id === id)!;
  const mdb = L.panels.find((p) => p.board.id === 'MDB')!;

  it('one breaker on the MDB busbar feeds the busway; its boards hang on tap-offs, one above the other', () => {
    expect(L.busways).toHaveLength(1);
    const bw = L.busways[0];
    const onBusway = L.feeders.filter((f) => f.x === bw.x);
    expect(onBusway).toHaveLength(1);
    expect(onBusway[0].yBus).toBe(mdb.busY);
    expect(bw.taps.map((t) => t.y).sort()).toEqual([leaf('DB-1B').y, leaf('DB-2B').y].sort());
    expect(leaf('DB-1B').x).toBe(leaf('DB-2B').x);
    expect(leaf('DB-1B').x).toBeGreaterThan(bw.x);
    expect(mdb.x2).toBeGreaterThan(bw.x);
    // The cable feeders are still individual, and no feeder runs to a tapped board.
    expect(L.feeders.filter((f) => !f.incomer)).toHaveLength(7);
    expect(L.feeders.some((f) => f.x === leaf('DB-1B').x)).toBe(false);
    expect(L.used.has('bus') && L.used.has('tap')).toBe(true);
  });
});

describe('a sub-panel beside its parent that feeds a level below', () => {
  const twoLevels: BuildingInfo = { rooms: [], buildings: [{ id: 'A', name: 'Tower A', levels: [
    { id: 'b1', name: 'B1', kind: 'basement', heightM: 4 }, { id: 'g', name: 'GF', kind: 'ground', heightM: 4 }
  ] }] };
  const p = {
    ...sampleProject, building: twoLevels, busRisers: [],
    boards: [
      { id: 'MDB', name: 'MDB', kind: 'MDB', sourceKva: 1000, level: at('g') },
      { id: 'SMDB-G', name: 'GF', kind: 'SMDB', upstreamId: 'MDB', level: at('g') },
      { id: 'DB-B1', name: 'Basement', kind: 'DB', upstreamId: 'SMDB-G', level: at('b1') },
      { id: 'DB-G', name: 'GF', kind: 'DB', upstreamId: 'MDB', level: at('g') }
    ],
    feeders: [fd('F1', 'MDB', 'SMDB-G', 250), fd('F2', 'SMDB-G', 'DB-B1'), fd('F3', 'MDB', 'DB-G')]
  } as unknown as Project;
  const L = feederRiserLayout(p, 'A');

  it('its drop runs right of the parent enclosure, not through it', () => {
    const mdb = L.panels.find((x) => x.board.id === 'MDB')!;
    const smdb = L.panels.find((x) => x.board.id === 'SMDB-G')!;
    const drop = L.feeders.find((f) => f.x === L.leaves.find((n) => n.board.id === 'DB-B1')!.x)!;
    expect(smdb.y2).toBeLessThan(mdb.y1); // stacked above the MDB on the same level
    expect(drop.yTo).toBeGreaterThan(mdb.y2); // goes down past the MDB
    expect(drop.x).toBeGreaterThan(mdb.x2);
  });
});
