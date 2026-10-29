import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Board, Feeder, Project } from '../types';
import { DEFAULT_RISER_TAPE, earthRiserLayout, floorGroups, newRiserId, nextRiserName, riserPages, riserRows, risersOf, setRisers } from './earthRiser';
import { earthFloorDrawing, earthRiserDrawing, earthSheetRefs } from '../diagram/earthRiserDrawing';
import { earthingDrawing, pitTags } from '../diagram/earthingDrawing';
import { addEarthRiserSheet, drawable, earthSheetFor, earthSheetGaps, renumber, setOf, sheetChecks, sheetType } from './drawingSet';
import { cpcOf } from '../calc/cableTable';

/** G+3 tower (or taller): one SMDB per floor fed from MDB-1 of the sample project. */
const FLOORS = 4;
function tower(FLOORS = 4) {
  const buildingId = 'BLD-T';
  const panelIds: string[] = [];
  const boards: Board[] = [], feeders: Feeder[] = [];
  for (let floor = 0; floor < FLOORS; floor++) {
    const id = `SMDB-${floor}`;
    panelIds.push(id);
    boards.push({ id, name: `Floor ${floor} SMDB`, kind: 'SMDB', upstreamId: 'MDB-1', ratedCurrentA: 250,
      level: { building: buildingId, level: floor === 0 ? 'G' : 'T', ...(floor > 1 ? { index: floor - 1 } : {}) } });
    feeders.push({ id: `F-${id}`, boardId: 'MDB-1', feedsBoardId: id, name: `To ${id}`, loadKw: 0, demandFactor: 1, powerFactor: 0.9,
      lengthM: 8, cableCsaMm2: floor === 0 ? 120 : 70, cores: 4, breakerRatingA: 160, breakerIcuKa: 36, breakerType: 'MCCB' });
  }
  const project: Project = {
    ...sampleProject,
    building: { buildings: [{ id: buildingId, name: 'Tower', levels: [
      { id: 'G', name: 'Ground floor', kind: 'ground', heightM: 4.5 },
      { id: 'T', name: 'Typical floors', kind: 'typical', heightM: 3.6, count: FLOORS - 1 }
    ] }], rooms: [] },
    boards: [...sampleProject.boards, ...boards],
    feeders: [...sampleProject.feeders, ...feeders]
  };
  return { project, buildingId, panelIds };
}

describe('earthing riser', () => {
  it('gives every floor a floor earth bar and earths each SMDB to it with its incoming CPC', () => {
    const r = tower();
    const L = earthRiserLayout(r.project, r.buildingId);
    expect(L.empty).toBe(false);
    expect(L.tape).toBe(DEFAULT_RISER_TAPE);
    expect(L.floors).toHaveLength(FLOORS);
    expect(L.floors.map((f) => f.feb)).toEqual(['EB-EL-A-GF', 'EB-EL-A-L01', 'EB-EL-A-L02', 'EB-EL-A-L03']);
    const all = L.floors.flatMap((f) => f.boards);
    expect(all.map((b) => b.board.id).sort()).toEqual([...r.panelIds].sort());
    for (const b of all) {
      expect(b.toBoard).toBeUndefined();
      expect(b.cpcMm2).toBe(cpcOf(b.feeder!));
    }
    expect(L.mains.map((m) => m.board.id)).toEqual(['MDB-1']);
    expect(L.mains[0].pits.length).toBeGreaterThan(0);
    expect(L.lvFloor).toBe(L.floors[0].floor.key); // main board without a level: the lowest floor
  });

  it('draws the riser as the reference: bars with test links, cable bar to bar, LV room cable, no panels', () => {
    const r = tower();
    const { svg, pages } = earthRiserDrawing(r.project, r.buildingId, { mono: true });
    expect(pages).toBe(1);
    for (const tag of ['EB-EL-A-GF', 'EB-EL-A-L03', 'GROUND FLOOR', 'LEVEL-03', 'CONNECTED TO LV ROOM', '1C 150 MM² G/Y PVC', '1C 95 MM² G/Y PVC']) expect(svg).toContain(tag);
    expect((svg.match(/>TL</g) ?? []).length).toBe(2 * FLOORS + 2); // two per bar, and the legend's bar
    expect(svg).not.toContain('SMDB-1<'); // panels are on the floor earthing sheets
    expect(svg).not.toMatch(/#1a7f37|#5b6b82|#c0392b/i); // printed sheet is black and white
  });

  it('prints the LV earth pit tags of the earthing schematic', () => {
    const r = tower();
    const L = earthRiserLayout(r.project, r.buildingId);
    const tags = pitTags(r.project);
    const riser = earthRiserDrawing(r.project, r.buildingId).svg, schematic = earthingDrawing(r.project).svg;
    for (const id of L.mains[0].pits) {
      const tag = tags.get(id)!;
      expect(tag).toMatch(/^EP-MDB-1/);
      expect(schematic).toContain(`>${tag}<`);
      expect(riser).toContain(tag);
    }
  });

  it('splits a 100-floor riser over sheets of 20 levels with match lines', () => {
    const r = tower(101); // G + 100
    const L = earthRiserLayout(r.project, r.buildingId);
    const pages = riserPages(L);
    expect(pages.map((p) => p.length)).toEqual([20, 20, 20, 20, 20, 1]);
    expect(pages.flat().map((x) => x.floors[0].feb)).toEqual(L.floors.map((f) => f.feb)); // every level, once, in order
    const first = earthRiserDrawing(r.project, r.buildingId, {}, 0).svg, mid = earthRiserDrawing(r.project, r.buildingId, {}, 2).svg, top = earthRiserDrawing(r.project, r.buildingId, {}, 5).svg;
    expect(first).toContain('CONTINUED ON SHEET 2 OF 6');
    expect(first).not.toContain('CONTINUED FROM');
    expect(first).toContain('CONNECTED TO LV ROOM');
    expect(mid).toContain('CONTINUED FROM SHEET 2 OF 6');
    expect(mid).toContain('CONTINUED ON SHEET 4 OF 6');
    expect(mid).not.toContain('CONNECTED TO LV ROOM');
    expect(top).toContain('EB-EL-A-L100');
    expect(top).not.toContain('CONTINUED ON');
  });

  it('groups typical floors on one sheet when chosen', () => {
    const r = tower(101);
    const p: Project = { ...r.project, earthingPlan: { riserStyle: 'typical', riserName: 'EL-B', riserTape: '1C 120 mm² G/Y PVC earth cable' } };
    const L = earthRiserLayout(p, r.buildingId);
    expect(riserPages(L)).toHaveLength(1);
    const rows = riserRows(L);
    expect(rows.map((x) => [x.label, x.floors.length])).toEqual([['GROUND FLOOR', 1], ['LEVEL-01', 1], ['TYPICAL LEVEL-02 TO LEVEL-99', 98], ['LEVEL-100', 1]]);
    expect(rows[2].bar).toBe('EB-EL-B-L02 TO L99');
    const svg = earthRiserDrawing(p, r.buildingId).svg;
    expect(svg).toContain('TYPICAL LEVEL-02 TO LEVEL-99');
    expect(svg).toContain('98 LEVELS');
    expect(svg).toContain('1C 120 MM² G/Y PVC');
    // Floor earthing: one sheet for the ground floor, one for the typical levels.
    expect(floorGroups(L).map((g) => g.floors.length)).toEqual([1, 100]);
  });

  it('draws the floor earthing sheet: each panel to the floor earth bar, a same-floor DB to its parent', () => {
    const r = tower();
    const smdb = r.project.boards.find((b) => b.id === r.panelIds[3])!;
    const p: Project = {
      ...r.project,
      boards: [...r.project.boards, { id: 'DB-L03-A', name: 'Flat DB', kind: 'DB', upstreamId: smdb.id, level: smdb.level }],
      feeders: [...r.project.feeders, { id: 'F-DB-L03-A', boardId: smdb.id, feedsBoardId: 'DB-L03-A', name: 'To DB-L03-A', loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 10, cableCsaMm2: 10, cores: 4, breakerRatingA: 63, breakerIcuKa: 10 }]
    };
    const L = earthRiserLayout(p, r.buildingId);
    const groups = floorGroups(L);
    expect(groups).toHaveLength(FLOORS);
    const k = groups.findIndex((g) => g.floors[0].boards.some((b) => b.board.id === 'DB-L03-A'));
    expect(groups[k].floors[0].boards.map((b) => b.board.id)).toEqual([smdb.id, 'DB-L03-A']);
    expect(groups[k].floors[0].boards[1]).toMatchObject({ toBoard: smdb.id, cpcMm2: 10 });
    const { svg } = earthFloorDrawing(p, r.buildingId, { mono: true }, k);
    expect(svg).toContain('EB-EL-A-L03');
    expect(svg).toContain('1C 10 mm² G/Y');
    expect(svg).toContain(`${smdb.id} earth bar`);
    expect(svg).not.toMatch(/#1a7f37|#5b6b82|#c0392b/i);
  });

  it('lists a sub-board without a level instead of drawing it', () => {
    const r = tower();
    const p: Project = { ...r.project, boards: [...r.project.boards, { id: 'DB-X', name: 'No level', kind: 'DB', upstreamId: r.panelIds[0] }] };
    expect(earthRiserLayout(p, r.buildingId).notOnLevel).toEqual(['DB-X']);
    expect(earthRiserDrawing(p, r.buildingId).svg).toContain('NOT SHOWN — NO LEVEL IN THIS BUILDING: DB-X');
  });

  it('finds or adds the sheet the earthing screen shows, for Design CAD → Sheets', () => {
    const r = tower(41); // 3 riser sheets
    const set = setOf(r.project);
    const second = earthSheetFor(set, r.project, 'earthRiser', r.buildingId, 1);
    expect(second.set.sheets.filter((x) => x.kind === 'earthRiser')).toHaveLength(3); // the whole riser, the first time
    expect(second.set.sheets.find((x) => x.id === second.id)).toMatchObject({ kind: 'earthRiser', part: 1, buildingId: r.buildingId });
    expect(earthSheetFor(second.set, r.project, 'earthRiser', r.buildingId, 1)).toEqual({ set: second.set, id: second.id }); // there: unchanged
    const e = earthSheetFor(set, r.project, 'earthing');
    expect(e.set.sheets.filter((x) => x.kind === 'earthing')).toHaveLength(1);
    expect(earthSheetFor(e.set, r.project, 'earthing').id).toBe(e.id);
    expect(earthSheetFor(set, r.project, 'earthFloor')).toEqual({ set }); // no building chosen
  });

  it('adds every riser sheet and floor sheet, numbered with the earthing sheets, and flags a riser that outgrew its sheets', () => {
    const r = tower(41); // G + 40: 3 riser sheets
    const set = renumber({ ...setOf(r.project), earthPrefix: 'E-ERT-' });
    const a = addEarthRiserSheet(set, r.project, r.buildingId);
    const riser = a.set.sheets.filter((x) => x.kind === 'earthRiser');
    expect(riser.map((x) => x.part)).toEqual([0, 1, 2]);
    expect(riser[0].id).toBe(a.id);
    expect(riser[2].title).toBe('Earthing riser diagram — Tower (3 of 3)');
    for (const s of riser) { expect(s.number.startsWith('E-ERT-')).toBe(true); expect(drawable(s)).toBe(true); expect(sheetType(s)).toBe('earthing'); }
    expect(addEarthRiserSheet(a.set, r.project, r.buildingId).set.sheets).toHaveLength(a.set.sheets.length); // nothing missing
    const f = addEarthRiserSheet(a.set, r.project, r.buildingId, 'earthFloor');
    expect(f.set.sheets.filter((x) => x.kind === 'earthFloor')).toHaveLength(41);
    expect(earthSheetGaps(r.project, f.set)).toEqual([]);
    // Match lines and floor sheet references use the set's numbers.
    const refs = earthSheetRefs(r.project, f.set, r.buildingId);
    expect(earthRiserDrawing(r.project, r.buildingId, refs, 0).svg).toContain(`CONTINUED ON ${riser[1].number}`);
    // Ten more floors: the riser needs a fourth sheet.
    const taller = tower(61);
    expect(earthSheetGaps(taller.project, f.set)).toContainEqual({ buildingId: r.buildingId, kind: 'earthRiser', need: 4, have: 3 });
    expect(sheetChecks(taller.project, f.set).some((c) => c.text.includes('earthing riser diagram now needs 4 sheet(s)'))).toBe(true);
    expect(addEarthRiserSheet(f.set, taller.project, r.buildingId).set.sheets.filter((x) => x.kind === 'earthRiser').map((x) => x.part)).toEqual([0, 1, 2, 3]);
  });

  describe('several risers', () => {
    /** G+10: EL-A on every level, EL-B from the ground floor to L03. */
    function twoRisers() {
      const r = tower(11);
      const floors = earthRiserLayout(r.project, r.buildingId).floors;
      const p = setRisers(r.project, r.buildingId, [
        { id: 'er-1', buildingId: r.buildingId, name: 'EL-A' },
        { id: 'er-2', buildingId: r.buildingId, name: 'EL-B', to: floors[3].floor.key }
      ]);
      return { ...r, p, floors };
    }

    it('gives each riser bars only on the levels it serves, and a panel the bar of its riser', () => {
      const { p, buildingId, panelIds } = twoRisers();
      const q: Project = { ...p, boards: p.boards.map((b) => (b.id === panelIds[2] ? { ...b, earthRiser: 'er-2' } : b.id === panelIds[8] ? { ...b, earthRiser: 'er-2' } : b)) };
      const L = earthRiserLayout(q, buildingId);
      expect(L.risers.map((x) => [x.name, x.lo, x.hi])).toEqual([['EL-A', 0, 10], ['EL-B', 0, 3]]);
      expect(L.floors[2].febs.map((x) => x.tag)).toEqual(['EB-EL-A-L02', 'EB-EL-B-L02']);
      expect(L.floors[5].febs.map((x) => x.tag)).toEqual(['EB-EL-A-L05']);
      expect(L.floors[2].boards[0].riser).toBe('er-2');
      expect(L.floors[1].boards[0].riser).toBe('er-1'); // default: first riser on its level
      // EL-B does not reach L08: earthed to EL-A, and noted.
      expect(L.floors[8].boards[0].riser).toBe('er-1');
      expect(L.wrongRiser).toEqual([panelIds[8]]);
      const svg = earthRiserDrawing(q, buildingId, { mono: true }).svg;
      expect(svg).toContain('ELECTRICAL RISER EL-B');
      expect(svg).toContain('EB-EL-B-L03');
      expect(svg).not.toContain('EB-EL-B-L04');
      expect(svg).toContain('(TO EACH RISER)');
      expect(svg).toContain('EVERY LEVEL EACH RISER SERVES: EL-A GF TO L10, EL-B GF');
      expect(svg).toContain('CHOSEN RISER DOES NOT SERVE THEIR LEVEL');
      // Floor sheet of L02: both bars, the SMDB on EL-B's.
      const g = floorGroups(L).findIndex((x) => x.floors[0].floor.key === L.floors[2].floor.key);
      const floor = earthFloorDrawing(q, buildingId, {}, g).svg;
      expect(floor).toContain('TO RISER EL-A');
      expect(floor).toContain('TO RISER EL-B');
      expect(floor).toContain('EB-EL-B-L02</text>');
    });

    it('lands the LV room cable on each riser, a riser above the LV room on its lowest level', () => {
      const { p, buildingId, floors } = twoRisers();
      const q = setRisers(p, buildingId, [...risersOf(p, buildingId), { id: 'er-3', buildingId, name: 'EL-C', from: floors[6].floor.key }]);
      const L = earthRiserLayout(q, buildingId);
      expect(L.risers.map((x) => x.lvFloor)).toEqual([floors[0].floor.key, floors[0].floor.key, floors[6].floor.key]);
      // Typical grouping never swallows the floor a riser starts on.
      const rows = riserRows({ ...L, style: 'typical' });
      expect(rows.some((r) => r.floors.length === 1 && r.floors[0].floor.key === floors[6].floor.key)).toBe(true);
    });

    it('a removed riser returns its panels to the default', () => {
      const { p, buildingId, panelIds } = twoRisers();
      const q: Project = { ...p, boards: p.boards.map((b) => (b.id === panelIds[1] ? { ...b, earthRiser: 'er-2' } : b)) };
      const back = setRisers(q, buildingId, risersOf(q, buildingId).filter((x) => x.id !== 'er-2'));
      expect(back.boards.find((b) => b.id === panelIds[1])!.earthRiser).toBeUndefined();
      expect(risersOf(setRisers(q, buildingId, []), buildingId)).toEqual([{ id: '', buildingId, name: 'EL-A' }]);
      expect(newRiserId(q)).toBe('er-3');
      expect(nextRiserName(['EL-A', 'EL-B'])).toBe('EL-C');
    });
  });
});
