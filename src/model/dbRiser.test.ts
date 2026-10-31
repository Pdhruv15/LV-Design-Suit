// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Board, Feeder, Project } from '../types';
import { cablesAtGap, countTotal, dbRiserLayout, dbRiserOffered, dbRiserTitles, flagLetter, refLines, rowsTotal } from './dbRiser';
import { dbRiserDrawing, dbRiserSheetNos } from '../diagram/dbRiserDrawing';
import { addDbRiserSheets, drawable, setOf, sheetChecks, toggleRiserBreak, type DrawingSet } from './drawingSet';
import { buildSheetDxfPages } from '../docs/sheetDxf';
import { dbRiserLegend } from '../diagram/dbRiserDrawing';
import { dxfOf, prepareSheets, sheetHtml } from '../components/docs/sheetRender';

const B = 'T';
const lv = (level: string, index = 0) => ({ building: B, level, ...(index ? { index } : {}) });
const feeder = (from: string, to: string, a = 160): Feeder => ({ id: `F-${to}`, boardId: from, feedsBoardId: to, name: `To ${to}`, loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 30, cableCsaMm2: 95, cores: 4, breakerRatingA: a, breakerIcuKa: 36, breakerType: 'MCCB' });

/** 2B-free tower: Ground, podium, N typical floors (SMDB + 2 DBs + EDB each), roof. */
function tower(n = 4, extra?: (boards: Board[], feeders: Feeder[]) => void): Project {
  const boards: Board[] = [{ id: 'MDB-1', name: 'Main', kind: 'MDB', ratedCurrentA: 2500, sourceKva: 1500, level: lv('G') }, { id: 'EMDB-1', name: 'Emergency', kind: 'EMDB', ratedCurrentA: 1000, upstreamId: 'MDB-1', standby: { kva: 800 } as Board['standby'], level: lv('G') }];
  const feeders: Feeder[] = [feeder('MDB-1', 'EMDB-1', 800)];
  const add = (id: string, kind: Board['kind'], up: string, level: Board['level'], a = 63) => { boards.push({ id, name: id, kind, upstreamId: up, ratedCurrentA: a, level }); feeders.push(feeder(up, id, a)); };
  add('SMDB-P', 'SMDB', 'MDB-1', lv('P'), 125);
  add('DB-P', 'DB', 'SMDB-P', lv('P'));
  for (let i = 0; i < n; i++) {
    add(`SMDB-${i}`, 'SMDB', 'MDB-1', lv('Y', i), 250);
    add(`DB-${i}a`, 'DB', `SMDB-${i}`, lv('Y', i));
    add(`DB-${i}b`, 'DB', `SMDB-${i}`, lv('Y', i));
    add(`EDB-${i}`, 'EDB', 'EMDB-1', lv('Y', i), 40);
  }
  add('SMDB-R', 'SMDB', 'MDB-1', lv('R'), 160);
  add('MCC-R', 'MCC', 'SMDB-R', lv('R'), 100);
  extra?.(boards, feeders);
  return {
    ...sampleProject, boards, feeders, busRisers: [],
    building: { rooms: [], buildings: [{ id: B, name: 'Tower', levels: [
      { id: 'G', name: 'Ground floor', kind: 'ground', heightM: 4.5 },
      { id: 'P', name: 'Podium', kind: 'podium', heightM: 6 },
      { id: 'Y', name: 'Typical', kind: 'typical', heightM: 3.5, count: n },
      { id: 'R', name: 'Roof', kind: 'roof', heightM: 3 }
    ] }] }
  };
}

describe('DB riser by level', () => {
  it('collapses identical floors and counts boards by kind', () => {
    const L = dbRiserLayout(tower(), B);
    expect(L.rows).toHaveLength(4);
    const typ = L.rows.find((r) => r.floors.length === 4)!;
    expect(typ.sub).toBe('typical ×4');
    expect(typ.counts).toMatchObject({ smdb: 1, db: 2, edb: 1, mcc: 0, mdb: 0 });
    const t = rowsTotal(L.rows);
    expect(t).toMatchObject({ mdb: 2, smdb: 6, db: 9, edb: 4, mcc: 1 });
    expect(countTotal(t)).toBe(tower().boards.length);
  });

  it('gives a typical floor with a different board its own row, so ×n stays true', () => {
    const p = tower(5, (boards, feeders) => { boards.push({ id: 'DB-X', name: 'X', kind: 'DB', upstreamId: 'SMDB-2', level: lv('Y', 2) }); feeders.push(feeder('SMDB-2', 'DB-X')); });
    const L = dbRiserLayout(p, B);
    expect(L.rows.filter((r) => r.counts.db === 3).map((r) => r.floors.length)).toEqual([1]);
    expect(L.rows.filter((r) => r.counts.smdb === 1 && r.counts.db === 2).map((r) => r.floors.length)).toEqual([2, 2]);
    expect(countTotal(rowsTotal(L.rows))).toBe(p.boards.length);
  });

  it('is offered from G+2 up: basements and the roof do not count', () => {
    const p = tower(1);
    expect(dbRiserOffered(p, B)).toBe(true); // G, P, one typical
    const low: Project = { ...p, building: { rooms: [], buildings: [{ id: B, name: 'Villa', levels: [{ id: 'b', name: 'B', kind: 'basement', heightM: 3 }, { id: 'G', name: 'G', kind: 'ground', heightM: 3 }, { id: 'P', name: 'F', kind: 'other', heightM: 3 }, { id: 'R', name: 'R', kind: 'roof', heightM: 3 }] }] } };
    expect(dbRiserOffered(low, B)).toBe(false);
  });

  it('draws cables to one row on one line with the floor count, with lengths', () => {
    const L = dbRiserLayout(tower(), B);
    const run = L.runs.find((r) => r.fed.get(L.rows.findIndex((x) => x.floors.length === 4)) === 4 && r.mainId === 'MDB-1')!;
    expect(run.kind).toBe('cable');
    expect(run.breaker).toBe('4× 250 A');
    expect(run.verticalM).toBeCloseTo(4.5 + 6 + 3 * 3.5, 5);
    expect(cablesAtGap(run, 0, 0)).toBe(4);
  });

  it('continues risers over sheets at a chosen break, with one flag per riser', () => {
    let p = tower();
    const L0 = dbRiserLayout(p, B);
    expect(L0.pages).toHaveLength(1);
    const typ = L0.rows.find((r) => r.floors.length === 4)!;
    let set: DrawingSet = toggleRiserBreak(setOf(p), B, typ.floors.map((f) => f.key));
    p = { ...p, drawingSet: set };
    const L = dbRiserLayout(p, B);
    expect(L.pages).toHaveLength(2);
    expect(L.runs.filter((r) => r.letter).map((r) => r.letter)).toEqual(['A', 'B']) // the normal cables and the EDB cables;
    // Cables that leave the sheet of their panel share a line, down to the floors they feed.
    const far = L.runs.find((r) => r.id.startsWith('far:MDB-1'))!;
    expect([...far.fed.values()].reduce((a, b) => a + b)).toBe(5);

    set = addDbRiserSheets(set, p, B).set;
    expect(set.sheets.map((s) => s.part)).toEqual([0, 1]);
    expect(set.sheets[1].title).toBe('DB riser diagram — Tower (2 of 2)');
    expect(set.sheets.every(drawable)).toBe(true);
    p = { ...p, drawingSet: set };
    const nos = dbRiserSheetNos(set, B)!;
    const a = dbRiserDrawing(p, B, { sheetNos: nos, countTable: true }, 0), b = dbRiserDrawing(p, B, { sheetNos: nos, countTable: true }, 1);
    expect(a.pages).toBe(2);
    expect(a.svg).toContain(`CONTINUES ON ${nos[1]}`);
    expect(b.svg).toContain(`CONTINUED FROM ${nos[0]}`);
    expect(a.svg).toContain(`A → ${nos[1]}`);
    expect(b.svg).toContain(`A ← ${nos[0]}`);
    expect(b.svg).toContain('>Building<');
    expect(a.svg).not.toContain('>Building<');
    // Taking the break out leaves one sheet needed: the extra one is reported.
    const back = toggleRiserBreak(set, B, typ.floors.map((f) => f.key));
    expect(dbRiserTitles({ ...p, drawingSet: back }, B)).toEqual(['DB riser diagram — Tower']);
    expect(sheetChecks({ ...p, drawingSet: back }, back).some((c) => c.text.includes('DB riser now needs 1 sheet(s), the set has 2'))).toBe(true);
  });

  it('shares one cable line when a panel feeds many rows', () => {
    const p = tower(2, (boards, feeders) => {
      for (const i of [0, 1, 2]) { boards.push({ id: `EDB-F${i}`, name: 'E', kind: 'EDB', upstreamId: 'EMDB-1', level: lv(`F${i}`) }); feeders.push(feeder('EMDB-1', `EDB-F${i}`, 40)); }
    });
    p.building!.buildings[0].levels.splice(2, 0, ...[0, 1, 2].map((i) => ({ id: `F${i}`, name: `F${i}`, kind: 'other' as const, heightM: 3 })));
    const L = dbRiserLayout(p, B);
    const own = L.runs.filter((r) => r.mainId === 'EMDB-1');
    expect(own).toHaveLength(1);
    expect(own[0].fed.size).toBe(4);
    expect(cablesAtGap(own[0], 0, 0)).toBe(5);
  });

  it('splits by height without a chosen break, and never inside a row', () => {
    const p = tower(3, (boards, feeders) => {
      boards.forEach((b) => { if (b.level?.level === 'Y') b.level = lv('Y', b.level.index ?? 0); });
      for (let i = 0; i < 3; i++) for (const k of ['MCC', 'UPS', 'FP'] as const) { boards.push({ id: `${k}-${i}`, name: k, kind: k, upstreamId: `SMDB-${i}`, level: lv('Y', i) }); feeders.push(feeder(`SMDB-${i}`, `${k}-${i}`)); }
    });
    p.building!.buildings[0].levels = [...p.building!.buildings[0].levels.filter((l) => l.kind !== 'roof'), ...Array.from({ length: 12 }, (_, i) => ({ id: `F${i}`, name: `Floor ${i}`, kind: 'other' as const, heightM: 3 })), { id: 'R', name: 'Roof', kind: 'roof', heightM: 3 }];
    const L = dbRiserLayout(p, B);
    expect(L.pages.length).toBeGreaterThan(1);
    expect(L.pages.flat()).toEqual(L.rows.map((r) => r.index));
    expect(dbRiserDrawing(p, B, {}, 99).pages).toBe(L.pages.length);
  });

  it('draws a busbar riser with tap-offs, passing floors with no dot, ended by a T-bar', () => {
    const base = tower();
    const p: Project = { ...base, busRisers: [{ id: 'BR1', name: 'BR-1', sourceBoardId: 'MDB-1', material: 'cu', feedM: 5, floorHeightM: 3.5, offsetFloors: 0, elementM: 3, elbows: 0, floors: [0, 1, 2, 3].map((i) => ({ id: `f${i}`, name: `L${i}`, boardId: `SMDB-${i}` })) }] };
    const L = dbRiserLayout(p, B);
    const bus = L.runs.find((r) => r.id === 'BR1')!;
    expect(bus.kind).toBe('bus');
    expect(bus.heavy).toBe(true);
    expect(bus.name).toBe('BR-1');
    expect(bus.type).toMatch(/^Busbar/);
    expect(L.runs.some((r) => r.kind === 'cable' && [...r.fed.keys()].includes(L.rows.findIndex((x) => x.floors.length === 4)) && r.mainId === 'MDB-1')).toBe(false);
    expect(dbRiserDrawing(p, B).svg).toContain('BR-1');
  });

  it('shows board references, with the first and last floor on a typical row', () => {
    const L = dbRiserLayout(tower(), B);
    const typ = L.rows.find((r) => r.floors.length === 4)!;
    const smdb = typ.entries.find((e) => e.kind === 'SMDB')!;
    expect(smdb.kids[0].ids).toEqual(['DB-0a', 'DB-0b']);
    expect(refLines(smdb.kids[0])).toEqual(['DB-0a … DB-0b', 'to DB-3a … DB-3b']);
    expect(refLines(typ.entries.find((e) => e.kind === 'EDB')!)).toEqual(['EDB-0 … 3']);
    expect(refLines({ ids: ['DB-L01-A1', 'DB-L01-A2', 'DB-L01-A3'] })).toEqual(['DB-L01-A1, A2', 'DB-L01-A3']);
    expect(refLines({ ids: ['D1', 'D2', 'D3', 'D4', 'D5'] })).toEqual(['D1 … D5']);
    const svg = dbRiserDrawing(tower(), B).svg;
    expect(svg).toContain('DB-0a … DB-0b');
    expect(svg).not.toContain('×2<');
  });

  it('draws a tap-off box for each tap-off, two on a floor with two', () => {
    const p = tower(2, (boards, feeders) => { boards.push({ id: 'SMDB-0B', name: 'B', kind: 'SMDB', upstreamId: 'MDB-1', ratedCurrentA: 100, level: lv('Y', 0) }); feeders.push(feeder('MDB-1', 'SMDB-0B', 100)); });
    p.busRisers = [{ id: 'BR1', name: 'BR-1', sourceBoardId: 'MDB-1', material: 'cu', feedM: 5, floorHeightM: 3.5, offsetFloors: 0, elementM: 3, elbows: 0, floors: [{ id: 'a', name: 'L0', boardId: 'SMDB-0' }, { id: 'b', name: 'L0', boardId: 'SMDB-0B' }, { id: 'c', name: 'L1', boardId: 'SMDB-1' }, { id: 'd', name: 'Spare', kw: 20, count: 2 }] }];
    const L = dbRiserLayout(p, B);
    const twoTaps = L.rows.find((r) => r.tapOffs === 2)!, one = L.rows.find((r) => r.tapOffs === 1)!;
    expect(twoTaps.floors).toHaveLength(1);
    expect(twoTaps.entries.filter((e) => e.tapOff).map((e) => e.board.id)).toEqual(['SMDB-0', 'SMDB-0B']);
    expect(one.entries.filter((e) => e.tapOff)).toHaveLength(1);
    expect(L.looseTapOffs).toEqual(['BR-1 (2)']);
    const svg = dbRiserDrawing(p, B).svg;
    expect(svg.match(/>TOB</g)).toHaveLength(3);
    expect(svg).toContain('Tap-offs with a load and no board, not drawn: BR-1 (2).');
  });

  it('draws an EMDB with mains and generator through its changeover', () => {
    const ats = dbRiserDrawing(tower(), B).svg;
    expect(ats).toContain('ATS 1000 A 4P');
    expect(ats).toContain('Mains from MDB-1');
    expect(ats).toContain('800 kVA');
    expect(ats).toContain('stroke-dasharray="5 3"');
    const acb = tower(2, (boards) => { boards.find((b) => b.id === 'EMDB-1')!.standby = { kva: 800, changeover: 'ACB' }; });
    const s = dbRiserDrawing(acb, B).svg;
    expect(s).toContain('interlock');
    expect(s).not.toContain('ATS 1000');
    // Its own transformer instead of a feed from a panel.
    const own = tower(2, (boards) => { const e = boards.find((b) => b.id === 'EMDB-1')!; e.upstreamId = undefined; e.sourceKva = 1000; });
    own.feeders = own.feeders.filter((f) => f.feedsBoardId !== 'EMDB-1');
    const o = dbRiserDrawing(own, B).svg;
    expect(o).toContain('TX-EMDB-1');
    expect(o).not.toContain('Mains from');
  });

  it('draws a bus coupler between panels side by side, and names it otherwise', () => {
    const extra = (boards: Board[]) => { boards.push({ id: 'MDB-2', name: 'M2', kind: 'MDB', sourceKva: 1500, level: lv('G') }); };
    const p = tower(2, extra);
    p.ties = [{ id: 'BC-1', a: 'MDB-1', b: 'MDB-2', ratingA: 1600 }];
    const L = dbRiserLayout(p, B);
    expect(L.mains.map((m) => m.board.id).slice(0, 2)).toEqual(['MDB-1', 'MDB-2']);
    const svg = dbRiserDrawing(p, B).svg;
    expect(svg).toContain('>BC-1<');
    expect(svg).toContain('1600 A · N.O.');
    const far = tower(2, (boards) => { extra(boards); boards.find((b) => b.id === 'MDB-2')!.level = lv('P'); });
    far.ties = [{ id: 'BC-1', a: 'MDB-1', b: 'MDB-2', ratingA: 1600, closed: true }];
    const s = dbRiserDrawing(far, B).svg;
    expect(s).toContain('Coupler BC-1 to MDB-2 · 1600 A · N.C.');
    expect(s).toContain('Coupler BC-1 to MDB-1 · 1600 A · N.C.');
  });

  it('prints the board count table only when chosen', () => {
    const p = tower();
    expect(dbRiserDrawing(p, B).svg).not.toContain('BOARDS PER LEVEL');
    const svg = dbRiserDrawing(p, B, { countTable: true }).svg;
    expect(svg).toContain('BOARDS PER LEVEL');
    expect(svg).toContain('TOB');
    expect(svg).toContain('4×4=16');
  });

  it('has a legend of what is on the sheet only', () => {
    const p = tower();
    p.ties = [];
    const legend = dbRiserLegend(dbRiserLayout(p, B));
    expect(legend).toContain('LEGEND');
    expect(legend).toContain('Main panel with busbar');
    expect(legend).toContain('Automatic transfer switch (ATS)');
    expect(legend).toContain('Standby generator');
    expect(legend).not.toContain('Tap-off box');
    expect(legend).not.toContain('Bus coupler');
    expect(legend).not.toContain('Match line');
    const colours = new Set([...legend.matchAll(/#[0-9a-f]{3,6}/gi)].map((m) => m[0].toLowerCase()));
    expect([...colours].sort()).toEqual(['#111', '#fff']);
  });

  it('prints on the submission sheet with its title block, drawing number and legend (PDF and DXF)', async () => {
    let p = tower();
    const set0 = toggleRiserBreak(setOf(p), B, dbRiserLayout(p, B).rows.find((r) => r.floors.length === 4)!.floors.map((f) => f.key));
    p = { ...p, drawingSet: set0 };
    const set = addDbRiserSheets(set0, p, B).set;
    p = { ...p, drawingSet: set };
    const s = set.sheets[1];
    const sheet = (await sheetHtml(p, set, s))!;
    expect(s.number).not.toBe('');
    expect(sheet.html).toContain(s.number);
    expect(sheet.html).toContain('DB riser diagram — Tower (2 of 2)');
    expect(sheet.html).toContain('LEGEND');
    expect(sheet.html).toContain('Match line between sheets');
    expect(sheet.legendSvg).toContain('Match line between sheets');
    const noLegend = (await sheetHtml({ ...p, drawing: { ...p.drawing, legend: false } }, set, s))!;
    expect(noLegend.legendSvg).toBe('');
    const dxf = dxfOf(p, set, await prepareSheets(p, set, undefined, [s.id]));
    const all = dxf.map((f) => f.data).join('');
    expect(all).toContain(s.number);
    expect(all).toContain('LEGEND');
  });

  it('reports boards with no level instead of counting short', () => {
    const p = tower(2, (boards) => {
      boards.find((b) => b.id === 'MDB-1')!.level = undefined;
      boards.push({ id: 'DB-LOST', name: 'Lost', kind: 'DB' });
    });
    const L = dbRiserLayout(p, B);
    expect(L.notOnLevel).toEqual(['MDB-1']);
    expect(L.unplaced).toEqual(['DB-LOST']);
    const svg = dbRiserDrawing(p, B).svg;
    expect(svg).toContain('drawn on the lowest level: MDB-1');
    expect(svg).toContain('not counted or drawn: DB-LOST');
  });

  it('is black and white, and exports to DXF', () => {
    const p = tower();
    const { svg } = dbRiserDrawing(p, B);
    const colours = new Set([...svg.matchAll(/#[0-9a-f]{3,6}/gi)].map((m) => m[0].toLowerCase()));
    expect([...colours].sort()).toEqual(['#111', '#fff']);
    expect(svg).not.toContain('NaN');
    const pages = buildSheetDxfPages(p, svg, 'A3', { no: 'E-RSR-001', title: 'DB riser', count: 1, index: 1 });
    expect(pages[0].data).toContain('SMDB-P');
  });

  it('is empty without panels on levels, and names flags past Z', () => {
    const p: Project = { ...tower(), boards: [], feeders: [] };
    expect(dbRiserLayout(p, B).empty).toBe(true);
    expect(dbRiserDrawing(p, B).svg).toContain('No panels');
    expect(flagLetter(0)).toBe('A');
    expect(flagLetter(26)).toBe('AA');
  });
});
