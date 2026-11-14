import { describe, expect, it } from 'vitest';
import { evaluateSheet } from '../calc/sheetFormula';
import { sampleProject } from '../data/sampleProject';
import { addSpareWay, isDbBoard } from '../model/spareWays';
import { newSheet, withCells, withStyle, mergeArea, area, type Sheet, type SheetLink } from '../model/sheets';
import type { Project } from '../types';
import { fillLinked, linkAt, linkBoards, linkFromPlaceholders, linkNeeds, linkToBoard, LINK_FIELDS, removeLink, setFirstRow, setLinkCell, setLinkColumn, sheetsForBoards, startLink, suggestLink, addCircuitRow, discardPending, pendingCount, typeLinked, typeRefusal, templateOf, sheetFromFormat, boardSheet, linkFields, linkLabel } from './sheetLink';
import { withProjectFormat } from '../model/scheduleFormats';
import { deleteOutgoingFeeder } from '../model/mdFeeders';
import { panelData, panelRowKeys } from './panelFields';
import { scheduleRowKeys, templateData } from './scheduleFields';

const AT = new Date('2026-10-27T10:00:00Z');
const project = addSpareWay(sampleProject, 'DB-GF1', 'spare').project;
const data = templateData(project, 'DB-GF1', AT);
const N = data.rows.length;
const sheet = (cells: Record<string, string>): Sheet => withCells(newSheet(), cells);
const val = (s: Sheet, k: string) => evaluateSheet(s.cells)[k]?.value;

/** A panel schedule: heads in rows 1-2, the pattern row 5 (ref, room, own note, MCB, formula, watts), a SUM row below. */
const layout = (extra: Record<string, string> = {}): Sheet => {
  const s = linkFromPlaceholders(sheet({ A1: 'PANEL SCHEDULE', A2: 'DB: {{board.id}}', D2: 'FED FROM: {{board.fedFrom}} ', A5: '{{row.ref}}', B5: '{{ row.room }}', D5: '{{row.mcb}}', E5: '{{row.watts}}', F5: '=E5*2', ...extra }))!.sheet;
  return linkToBoard({ ...s, link: { ...s.link!, columns: { ...s.link!.columns, C: 'own' } } }, 'DB-GF1');
};
const sums = (extra: Record<string, string> = {}) => layout({ E6: '=SUM(E5:E5)', F7: '=SUM(E5:E5)+1', A8: 'End', ...extra });

describe('LINK_FIELDS', () => {
  it('every key is one templateData produces', () => {
    const have = new Set([...Object.keys(data.fields), ...Object.keys(data.rows[0])]);
    for (const f of LINK_FIELDS) if (f.key !== 'own') expect(have.has(f.key), f.key).toBe(true);
    expect(LINK_FIELDS.filter((f) => f.kind === 'cell').every((f) => !f.typed)).toBe(true);
    expect(LINK_FIELDS.find((f) => f.key === 'row.length')).toEqual({ key: 'row.length', label: 'Length, m', kind: 'row', typed: true });
    expect(LINK_FIELDS[LINK_FIELDS.length - 1]).toEqual({ key: 'own', label: 'Your column · kept with each circuit', kind: 'row', typed: true });
  });
});

describe('linkNeeds', () => {
  const link = (cells: SheetLink['cells'], columns: SheetLink['columns']): SheetLink => ({ category: 'db', cells, firstRow: 5, rows: [], columns });
  it('lists the three needs and which are met', () => {
    expect(linkNeeds(link({}, {})).map((n) => [n.label, n.ok])).toEqual([['Board number', false], ['Fed from', false], ['A description or a load on each row', false]]);
    expect(linkNeeds(link({ A1: { field: 'board.id' }, B1: { field: 'board.fedFrom' } }, { C: 'row.points.ltg' })).every((n) => n.ok)).toBe(true);
    expect(linkNeeds(link({ A1: { field: 'board.id' } }, { C: 'row.mcb' })).map((n) => n.ok)).toEqual([true, false, false]);
  });
});

describe('linkFromPlaceholders', () => {
  it('takes the pattern row, the header cells and their text', () => {
    const r = linkFromPlaceholders(sheet({ A2: 'DB: {{board.id}}', D2: 'FED FROM: {{board.fedFrom}} kV', A3: '{{board.name}}', A5: '{{row.ref}}', B5: '{{ row.room }}', C5: 'text', A6: '{{row.sl}}' }))!;
    expect(r.unknown).toEqual([]);
    expect(r.sheet.link).toEqual({
      category: 'db', firstRow: 5, rows: [], columns: { A: 'row.ref', B: 'row.room' },
      cells: { A2: { field: 'board.id', before: 'DB: ' }, D2: { field: 'board.fedFrom', before: 'FED FROM: ', after: ' kV' }, A3: { field: 'board.name' } }
    });
    expect(r.sheet.cells).toEqual({ A2: 'DB: ', D2: 'FED FROM:  kV', C5: 'text', A6: '{{row.sl}}' });
  });
  it('leaves unknown keys in place and lists them', () => {
    const r = linkFromPlaceholders(sheet({ A1: '{{board.colour}}', B1: '{{board.id}}', C1: '{{label.ltg}}', A5: '{{row.ref}}', B5: '{{row.nothing}}' }))!;
    expect(r.unknown).toEqual(['board.colour', 'row.nothing']);
    expect(r.sheet.cells).toEqual({ A1: '{{board.colour}}', B5: '{{row.nothing}}' });
    expect(r.sheet.link!.cells.C1).toEqual({ field: 'label.ltg' });
    expect(r.sheet.link!.columns).toEqual({ A: 'row.ref' });
  });
  it('finds nothing without a row placeholder', () => {
    expect(linkFromPlaceholders(sheet({ A1: '{{board.id}}', A5: 'x {{row.ref}}' }))).toBeUndefined();
  });
});

describe('fillLinked', () => {
  it('fills the header cells and one row per circuit and spare', () => {
    const s = fillLinked(project, layout(), AT);
    expect(s.cells.A2).toBe('DB: DB-GF1');
    expect(s.cells.D2).toBe(`FED FROM: ${data.fields['board.fedFrom']} `);
    expect(s.link!.rows).toEqual(scheduleRowKeys(project, 'DB-GF1'));
    expect(s.rows).toBeGreaterThanOrEqual(4 + N);
    for (let i = 0; i < N; i++) {
      const r = data.rows[i];
      expect(s.cells[`A${5 + i}`]).toBe(r['row.ref']);
      expect(s.cells[`B${5 + i}`]).toBe(r['row.room']);
      expect(s.cells[`D${5 + i}`]).toBe(r['row.mcb'] === '' ? undefined : String(r['row.mcb']));
      expect(s.cells[`E${5 + i}`]).toBe(r['row.watts'] === '' ? undefined : String(r['row.watts']));
    }
    expect(s.cells[`A${5 + N}`]).toBeUndefined();
  });
  it('writes a number as a number and a text that reads as a number with an apostrophe', () => {
    const s = fillLinked(project, layout(), AT);
    expect(typeof val(s, 'D5')).toBe('number');
    const named: Project = { ...project, boards: project.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, name: '1234' } : b)) };
    const base = layout();
    const t = fillLinked(named, { ...base, link: { ...base.link!, cells: { A3: { field: 'board.name' } } } }, AT);
    expect(t.cells.A3).toBe("'1234");
  });
  it('a formula column is filled down', () => {
    const s = fillLinked(project, layout(), AT);
    expect(s.cells.F5).toBe('=E5*2');
    expect(s.cells[`F${4 + N}`]).toBe(`=E${4 + N}*2`);
  });
});

/** A project whose DB-GF1 has only its first n circuit and spare rows: the link is filled for each size in turn. */
const trimmed = (n: number): Project => {
  const keep = new Set(scheduleRowKeys(project, 'DB-GF1').slice(0, n));
  return { ...project, feeders: project.feeders.filter((f) => f.boardId !== 'DB-GF1' || keep.has(f.uid ?? f.id) || !f.phase), boards: project.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, spareWays: b.spareWays?.filter((x) => keep.has(`spare:${x.id}`)) } : b)) };
};

describe('fillLinked — resizing', () => {
  const rowsOf = (p: Project) => scheduleRowKeys(p, 'DB-GF1').length;
  it('1 → 5 → 7 → 2 rows keep a SUM over the block exact, and the cells below move', () => {
    let s = fillLinked(trimmed(1), sums(), AT);
    expect(rowsOf(trimmed(1))).toBe(1);
    expect(s.cells.E6).toBe('=SUM(E5:E5)');
    for (const n of [5, 7, 2]) {
      const p = trimmed(n);
      expect(rowsOf(p)).toBe(n);
      s = fillLinked(p, s, AT);
      expect(s.link!.rows).toHaveLength(n);
      expect(s.cells[`E${5 + n}`]).toBe(`=SUM(E5:E${4 + n})`);
      expect(s.cells[`F${6 + n}`]).toBe(`=SUM(E5:E${4 + n})+1`);
      expect(s.cells[`A${7 + n}`]).toBe('End');
      expect(s.cells[`E${6 + n}`]).toBeUndefined();
      expect(s.cells[`A${5 + n}`]).toBeUndefined();
      expect(val(s, `E${5 + n}`)).toBe(data0(p).reduce((t, v) => t + v, 0));
    }
  });
  it('a DB with no circuits keeps one blank row', () => {
    const empty = { ...project, feeders: project.feeders.filter((f) => f.boardId !== 'DB-GF1' || !f.phase), boards: project.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, spareWays: undefined } : b)) };
    const s = fillLinked(empty, fillLinked(project, sums(), AT), AT);
    expect(s.link!.rows).toEqual([]);
    expect(s.cells.A5).toBeUndefined();
    expect(s.cells.E6).toBe('=SUM(E5:E5)');
  });
});
const data0 = (p: Project) => templateData(p, 'DB-GF1', AT).rows.map((r) => Number(r['row.watts']) || 0);

describe('fillLinked — look', () => {
  it('copies the first row\'s styles and one-row merges to every row', () => {
    let base = withStyle(layout({ G5: 'x' }), area({ r: 5, c: 1 }, { r: 5, c: 2 }), { bold: true, border: 'trbl' });
    base = mergeArea(base, area({ r: 5, c: 7 }, { r: 5, c: 8 }));
    const s = fillLinked(project, base, AT);
    for (let i = 0; i < N; i++) {
      expect(s.styles![`A${5 + i}`]).toEqual({ bold: true, border: 'trbl' });
      expect(s.styles![`B${5 + i}`]).toEqual({ bold: true, border: 'trbl' });
      expect(s.merges).toContainEqual({ r0: 5 + i, c0: 7, r1: 5 + i, c1: 8 });
    }
    expect(s.merges).toHaveLength(N);
    const smaller = fillLinked(trimmed(2), s, AT);
    expect(smaller.merges).toHaveLength(2);
    expect(smaller.styles![`A${N + 5}`]).toBeUndefined();
  });
});

describe('fillLinked — own column', () => {
  it('text typed beside a circuit follows it when the order changes', () => {
    const keys = scheduleRowKeys(project, 'DB-GF1');
    let s = fillLinked(project, layout(), AT);
    s = withCells(s, { C5: 'first', C6: 'second', [`C${4 + N}`]: 'last' });
    // Moving circuits to other ways changes the order: swap the ways of the first and the last circuit.
    const circuits = keys.filter((k) => !k.startsWith('spare:')), first = circuits[0], second = circuits[circuits.length - 1];
    const ways = new Map(project.feeders.filter((f) => f.id === first || f.id === second).map((f) => [f.id, f.way]));
    const swapped: Project = { ...project, feeders: project.feeders.map((f) => (ways.has(f.id) ? { ...f, way: ways.get(f.id === first ? second : first) } : f)) };
    const after = scheduleRowKeys(swapped, 'DB-GF1');
    expect(after).not.toEqual(keys);
    const t = fillLinked(swapped, s, AT);
    const own = Object.fromEntries(keys.map((k, i) => [k, s.cells[`C${5 + i}`]]));
    after.forEach((k, i) => expect(t.cells[`C${5 + i}`], k).toBe(own[k]));
    // A key no longer on the board loses its text.
    const gone = fillLinked(trimmed(N - 1), s, AT);
    expect(Object.values(gone.cells).includes('last')).toBe(false);
  });
});

describe('fillLinked — repeat and unchanged', () => {
  it('a second call with nothing changed gives an equal sheet', () => {
    const once = fillLinked(project, sums(), AT);
    expect(fillLinked(project, once, AT)).toEqual(once);
    const grown = fillLinked(trimmed(3), once, AT);
    expect(fillLinked(trimmed(3), grown, AT)).toEqual(grown);
  });
  it('a sheet without a link, without a board, or with a board not in the project is returned as it is', () => {
    const plain = sheet({ A1: 'x' });
    expect(fillLinked(project, plain)).toBe(plain);
    const noBoard = { ...layout(), link: { ...layout().link!, boardId: undefined } };
    expect(fillLinked(project, noBoard)).toBe(noBoard);
    const gone = linkToBoard(layout(), 'DB-NOPE');
    expect(fillLinked(project, gone)).toBe(gone);
  });
  it('linkToBoard sets the board; on another board the block keeps its size and loses its keys, and the fill leaves no old row', () => {
    const s = fillLinked(project, sums(), AT);
    expect(linkToBoard(s, 'DB-GF1').link!.rows).toEqual(s.link!.rows);
    expect(linkToBoard(s, 'DB-X').link).toMatchObject({ boardId: 'DB-X', rows: Array<string>(N).fill('') });
    const other = project.boards.find((b) => b.id !== 'DB-GF1' && scheduleRowKeys(project, b.id).length !== N)!;
    const typed = withCells(s, { C5: 'old board note' });
    const moved = fillLinked(project, linkToBoard(typed, other.id), AT), n = Math.max(1, scheduleRowKeys(project, other.id).length);
    expect(moved.cells.A2).toBe(`DB: ${other.id}`);
    expect(moved.link!.rows).toEqual(scheduleRowKeys(project, other.id));
    expect(moved.cells[`E${5 + n}`]).toBe(`=SUM(E5:E${4 + n})`);
    expect(moved.cells[`A${7 + n}`]).toBe('End');
    expect(moved.cells.C5).toBeUndefined();
    const plain = sheet({});
    expect(linkToBoard(plain, 'DB-GF1')).toBe(plain);
  });
});

describe('linkBoards', () => {
  it('lists the DBs and any board with schedule rows, in the project\'s order', () => {
    const list = linkBoards(sampleProject);
    expect(list.map((b) => b.id)).toContain('DB-GF1');
    expect(list.every((b) => isDbBoard(b) || scheduleRowKeys(sampleProject, b.id).length > 0)).toBe(true);
    const order = sampleProject.boards.map((b) => b.id);
    expect(list.map((b) => order.indexOf(b.id))).toEqual([...list.map((b) => order.indexOf(b.id))].sort((a, b) => a - b));
    const other = sampleProject.boards.find((b) => !isDbBoard(b) && scheduleRowKeys(sampleProject, b.id).length === 0);
    if (other) expect(list.map((b) => b.id)).not.toContain(other.id);
  });
});

describe('linking by hand', () => {
  const linked = (extra: Partial<SheetLink> = {}): Sheet => ({ ...sheet({ B2: 'FED FROM: SMDB-1', B3: 'DB-GF', C6: 'x' }), link: { category: 'db', cells: {}, firstRow: 6, rows: [], columns: {}, ...extra } });
  it('startLink and removeLink', () => {
    const s = startLink(sheet({ A1: 'x' }), 4);
    expect(s.link).toEqual({ category: 'db', cells: {}, firstRow: 4, rows: [], columns: {} });
    expect(startLink(s, 9)).toBe(s);
    const r = removeLink(s);
    expect(r.link).toBeUndefined();
    expect(r.cells).toEqual({ A1: 'x' });
  });
  it('linkAt reads a linked cell and a linked column inside the block only', () => {
    const s = linked({ cells: { B2: { field: 'board.fedFrom', before: 'FED FROM: ' } }, columns: { C: 'row.room', D: 'own' }, rows: ['a', 'b'] });
    expect(linkAt(s, 2, 2)).toEqual({ field: 'board.fedFrom', label: 'Fed from', own: false });
    expect(linkAt(s, 7, 3)).toEqual({ field: 'row.room', label: 'Room / area', own: false });
    expect(linkAt(s, 6, 4)).toMatchObject({ own: true });
    expect(linkAt(s, 8, 3)).toBeUndefined();
    expect(linkAt(s, 5, 3)).toBeUndefined();
    expect(linkAt(s, 7, 1)).toBeUndefined();
    expect(linkAt(sheet({}), 1, 1)).toBeUndefined();
  });
  it('setLinkCell keeps the text before the value, and changes only the field of a linked cell', () => {
    const s = setLinkCell(linked(), 'B2', 'board.fedFrom');
    expect(s.link!.cells.B2).toEqual({ field: 'board.fedFrom', before: 'FED FROM: ' });
    expect(s.cells.B2).toBe('FED FROM: ');
    const plain = setLinkCell(s, 'B3', 'board.id');
    expect(plain.link!.cells.B3).toEqual({ field: 'board.id' });
    expect(plain.cells.B3).toBeUndefined();
    const changed = setLinkCell(s, 'B2', 'board.name');
    expect(changed.link!.cells.B2).toEqual({ field: 'board.name', before: 'FED FROM: ' });
    expect(setLinkCell(changed, 'B2', undefined).link!.cells).toEqual({});
    expect(setLinkCell(s, 'C6', 'board.id')).toBe(s);
    expect(setLinkCell(s, 'D2', 'row.mcb')).toBe(s);
  });
  it('setLinkColumn moves a field to the column chosen; own may be on several columns', () => {
    let s = setLinkColumn(linked(), 'c', 'row.room');
    s = setLinkColumn(s, 'D', 'row.room');
    expect(s.link!.columns).toEqual({ D: 'row.room' });
    s = setLinkColumn(setLinkColumn(s, 'E', 'own'), 'F', 'own');
    expect(s.link!.columns).toEqual({ D: 'row.room', E: 'own', F: 'own' });
    expect(setLinkColumn(s, 'D', undefined).link!.columns).toEqual({ E: 'own', F: 'own' });
    expect(setLinkColumn(s, 'G', 'board.id')).toBe(s);
  });
  it('setFirstRow deletes the extra rows of the block and unlinks a cell that lands on the new row', () => {
    const base = linked({ rows: ['a', 'b', 'c'], cells: { A9: { field: 'total.all' }, A10: { field: 'md.all' }, A1: { field: 'date' } } });
    const s = setFirstRow({ ...base, cells: { A6: '1', A7: '2', A8: '3', A9: 'T', A10: 'M' } }, 8);
    expect(s.link).toMatchObject({ firstRow: 8, rows: [], cells: { A1: { field: 'date' }, A7: { field: 'total.all' } } });
    expect(Object.keys(s.link!.cells).sort()).toEqual(['A1', 'A7']);
    expect(s.cells).toEqual({ A6: '1', A7: 'T', A8: 'M' });
    expect(setFirstRow(base, 0)).toBe(base);
  });
});

describe('suggestLink', () => {
  const put = (cells: Record<string, string>, merges: [number, number, number, number][] = []) => merges.reduce((s, [r0, c0, r1, c1]) => mergeArea(s, area({ r: r0, c: c0 }, { r: r1, c: c1 })), sheet(cells));
  it('reads an office layout', () => {
    const s = suggestLink(put({
      A1: 'AL NOOR CONSULTANTS', E1: 'PANEL SCHEDULE', A2: 'PANEL', B2: 'DB-GF', C2: 'FED FROM: SMDB-1', G2: 'LOCATION: GROUND FLOOR', A3: 'MAIN', B3: '63 A TP+N',
      A5: 'CKT', B5: 'PH', C5: 'DESCRIPTION', D5: 'LOAD (W)', E5: 'MCB (A)', F5: 'CABLE (mm²)', G5: 'EARTH (mm²)', H5: 'LENGTH (m)', I5: 'ROUTE', J5: 'REMARKS'
    }))!;
    expect(s.link).toEqual({
      category: 'db', firstRow: 6, rows: [],
      columns: { A: 'row.ref', B: 'row.phase', C: 'row.room', D: 'row.watts', E: 'row.mcb', F: 'row.wire', G: 'row.ecc', H: 'row.length', J: 'row.remarks' },
      cells: { B2: { field: 'board.id' }, C2: { field: 'board.fedFrom', before: 'FED FROM: ' }, G2: { field: 'board.location', before: 'LOCATION: ' }, B3: { field: 'board.incomer' } }
    });
    expect(s.cells.C2).toBe('FED FROM: ');
    expect(s.cells.B2).toBeUndefined();
  });
  it('reads a two-row form heading with merged cells', () => {
    const heads = ['RATING OF INCOMER', 'RATING OF ELCB', 'SL NO.', 'CIR NO.', 'MCB RAT. IN AMPS', 'CCT WIRE SIZE (mm2)', 'ECC WIRE SIZE (mm2)', 'ROOM/ AREA'];
    const cells: Record<string, string> = { A1: 'DB SCHEDULE', M4: 'LOAD/CIRCUIT (WATTS)', I4: 'CONNECTED LOAD/ POINTS', L4: 'WATTS/ UNIT', P4: 'REMARKS', I5: 'LTG', J5: 'EX.FAN', K5: '13A T.S/O', M5: 'R', N5: 'Y', O5: 'B' };
    heads.forEach((h, i) => { cells[`${'ABCDEFGH'[i]}4`] = h; });
    const merges: [number, number, number, number][] = [...heads.map((_, i): [number, number, number, number] => [4, i + 1, 5, i + 1]), [4, 9, 4, 11], [4, 12, 5, 12], [4, 13, 4, 15], [4, 16, 5, 16]];
    const s = suggestLink(put(cells, merges))!;
    expect(s.link!.firstRow).toBe(6);
    expect(s.link!.columns).toEqual({ B: 'row.elcbGroup', C: 'row.sl', D: 'row.ref', E: 'row.mcb', F: 'row.wire', G: 'row.ecc', H: 'row.room', I: 'row.points.ltg', J: 'row.points.exfan', K: 'row.points.s13t', M: 'row.R', N: 'row.Y', O: 'row.B', P: 'row.remarks' });
  });
  it('finds nothing without three headings, and uses a field once', () => {
    expect(suggestLink(sheet({ A1: 'Notes', A2: 'MCB', B2: 'CABLE' }))).toBeUndefined();
    const twice = suggestLink(sheet({ A1: 'MCB (A)', B1: 'BREAKER', C1: 'CABLE', D1: 'ROOM' }))!;
    expect(twice.link!.columns).toEqual({ A: 'row.mcb', C: 'row.wire', D: 'row.room' });
  });
});

describe('sheetsForBoards', () => {
  it('adds one sheet for each board no sheet is linked to, named after it', () => {
    const from = linkToBoard(layout(), 'DB-GF1');
    const taken = { ...newSheet(), id: 'S1', name: 'DB-A', link: { ...from.link!, boardId: 'DB-A' } };
    const made = sheetsForBoards([{ ...from, id: 'S2', name: 'Main' }, taken, { ...newSheet(), id: 'S3', name: 'DB-B' }], from, ['DB-GF1', 'DB-A', 'DB-B', 'DB-C', 'DB/D', 'DB-C']);
    expect(made.map((m) => [m.id, m.name, m.link!.boardId])).toEqual([['S4', 'DB-B 2', 'DB-B'], ['S5', 'DB-C', 'DB-C'], ['S6', 'DB-D', 'DB/D']]);
    expect(made[1].link!.columns).toEqual(from.link!.columns);
  });
});

describe('typed values in a linked sheet', () => {
  const keys = scheduleRowKeys(project, 'DB-GF1');
  const base = () => fillLinked(project, layout(), AT);
  const typed = (s: Sheet, e: Record<string, string>) => typeLinked(project, s, e);
  const spareAt = keys.findIndex((k) => k.startsWith('spare:'));

  it('a typed cell of a linked column is kept beside the link and shown; the sheet equals its own fill', () => {
    const r = typed(base(), { B5: 'Hall', D5: '16' });
    expect(r.refused).toBeUndefined();
    expect(r.sheet.cells).toMatchObject({ B5: 'Hall', D5: '16' });
    expect(r.sheet.link!.pending).toEqual({ [keys[0]]: { B: 'Hall', D: '16' } });
    expect(fillLinked(project, r.sheet, AT)).toEqual(r.sheet);
    expect(pendingCount(r.sheet)).toBe(2);
    expect(discardPending(r.sheet).link!.pending).toBeUndefined();
    expect(fillLinked(project, discardPending(r.sheet), AT).cells.B5).toBe(String(data.rows[0]['row.room']));
  });
  it('a value equal to the project\'s is not pending; a stale or equal one is dropped by the fill', () => {
    const r = typed(typed(base(), { B5: 'Hall' }).sheet, { B5: String(data.rows[0]['row.room']) });
    expect(r.sheet.link!.pending).toBeUndefined();
    const s = base();
    const stored = { ...s, link: { ...s.link!, pending: { [keys[0]]: { B: String(data.rows[0]['row.room']) }, 'DB-GONE-R1': { B: 'x' }, [keys[1]]: { B: 'Majlis' } } } };
    const f = fillLinked(project, stored, AT);
    expect(f.link!.pending).toEqual({ [keys[1]]: { B: 'Majlis' } });
    expect(f.cells.B6).toBe('Majlis');
  });
  it('an ordinary cell and an own column are set as they are', () => {
    const r = typed(base(), { A1: 'note', C5: 'mine' });
    expect(r.sheet.cells).toMatchObject({ A1: 'note', C5: 'mine' });
    expect(r.sheet.link!.pending).toBeUndefined();
    expect(typed(base(), { A1: '' }).sheet).toBeDefined();
  });
  it('refuses a linked cell, a cell the app works out, the load beside points columns and a spare\'s other cells; the rest goes through', () => {
    const s = base();
    expect(typed(s, { D2: 'x' }).refused).toBe('D2 is filled from the project (Fed from).');
    expect(typed(s, { A5: 'x' })).toEqual({ sheet: s, refused: 'A5 is worked out by the app (Circuit reference).' });
    const both = typed(s, { A1: 'ok', A5: 'x', B5: 'y' });
    expect(both.refused).toBe('A5 is worked out by the app (Circuit reference).');
    expect(both.sheet.cells).toMatchObject({ A1: 'ok', B5: 'y' });
    const pts = { ...s, link: { ...s.link!, columns: { ...s.link!.columns, F: 'row.points.ltg' } } };
    expect(typed(pts, { E5: '100' }).refused).toBe('E5: the load comes from the points columns.');
    expect(typed(pts, { F5: '3' }).refused).toBeUndefined();
    const r = 5 + spareAt;
    expect(typed(s, { [`B${r}`]: 'x' }).refused).toBe(`B${r}: a spare way takes only its MCB rating and remarks.`);
    expect(typed(s, { [`D${r}`]: '25' }).sheet.link!.pending).toEqual({ [keys[spareAt]]: { D: '25' } });
    expect(typeRefusal(s, 'D2')).toBe('D2 is filled from the project (Fed from).');
    expect(typeRefusal(s, 'B5')).toBeUndefined();
    expect(typeRefusal(sheet({}), 'B5')).toBeUndefined();
  });
  it('new circuit rows follow the board\'s rows with new:i keys and keep their own text', () => {
    const s = fillLinked(project, addCircuitRow(addCircuitRow(base())), AT);
    expect(s.link!.rows).toEqual([...keys, 'new:0', 'new:1']);
    expect(s.link!.added).toEqual([{}, {}]);
    const r = typed(s, { [`B${5 + N}`]: 'New', [`C${5 + N}`]: 'mine', [`E${6 + N}`]: '900' });
    expect(r.sheet.link!.added).toEqual([{ B: 'New' }, { E: '900' }]);
    expect(pendingCount(r.sheet)).toBe(2);
    expect(r.sheet.cells[`C${5 + N}`]).toBe('mine');
    const again = fillLinked(project, r.sheet, AT);
    expect(again).toEqual(r.sheet);
    expect(fillLinked(project, again, AT)).toEqual(again);
    expect(typed(r.sheet, { [`E${6 + N}`]: '' }).sheet.link!.added).toEqual([{ B: 'New' }, {}]);
    expect(pendingCount(addCircuitRow(s))).toBe(0);
  });
  it('a board with no circuits takes a typed row as a new row', () => {
    const empty: Project = { ...project, feeders: project.feeders.filter((f) => f.boardId !== 'DB-GF1' || !f.phase), boards: project.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, spareWays: undefined } : b)) };
    const s = fillLinked(empty, layout(), AT);
    const r = typeLinked(empty, s, { B5: 'First' });
    expect(r.sheet.link!.added).toEqual([{ B: 'First' }]);
    expect(fillLinked(empty, r.sheet, AT)).toEqual(r.sheet);
  });
  it('addCircuitRow does nothing without a link or a board; linking to another board drops what was typed', () => {
    const plain = sheet({});
    expect(addCircuitRow(plain)).toBe(plain);
    const noBoard = { ...layout(), link: { ...layout().link!, boardId: undefined } };
    expect(addCircuitRow(noBoard)).toBe(noBoard);
    const r = typed(addCircuitRow(base()), { B5: 'Hall' });
    expect(linkToBoard(r.sheet, 'DB-X').link).not.toHaveProperty('pending');
    expect(linkToBoard(r.sheet, 'DB-X').link).not.toHaveProperty('added');
    expect(discardPending(plain)).toBe(plain);
    expect(pendingCount(plain)).toBe(0);
  });
});

describe('templateOf and sheetFromFormat', () => {
  const filled = () => fillLinked(project, sums({ F5: '=E5*2' }), AT);
  it('cuts a filled sheet back to its pattern row, keeping the layout and clearing what the project filled', () => {
    const s = filled(), t = templateOf(s)!;
    expect(s.link!.rows).toHaveLength(N);
    expect(t.link).toEqual({ category: 'db', cells: s.link!.cells, firstRow: 5, rows: [], columns: s.link!.columns });
    for (const k of ['A5', 'B5', 'C5', 'D5', 'E5']) expect(t.cells[k]).toBeUndefined();
    expect(t.cells).toMatchObject({ A2: 'DB: ', D2: 'FED FROM:  ', F5: '=E5*2', E6: '=SUM(E5:E5)', F7: '=SUM(E5:E5)+1', A8: 'End' });
    expect(t.rows).toBe(s.rows - (N - 1));
    expect(t.link).not.toHaveProperty('boardId');
    expect(templateOf(t)).toEqual(t);
    expect(templateOf(sheet({ A1: 'x' }))).toBeUndefined();
  });
  it('drops what was typed and the source file', () => {
    const typedSheet = typeLinked(project, addCircuitRow(filled()), { B5: 'Hall' }).sheet;
    const t = templateOf({ ...typedSheet, source: 'Panel.xlsx' })!;
    expect(t.link).not.toHaveProperty('pending');
    expect(t.link).not.toHaveProperty('added');
    expect(t).not.toHaveProperty('source');
    expect(t.link!.rows).toEqual([]);
  });
  it('a sheet from a format has its own id and tab name, is linked to the board, and fills with its circuits', () => {
    const t = templateOf(filled())!;
    const made = sheetFromFormat(t, [{ ...newSheet(), name: 'DB-GF1' }], 'DB-GF1');
    expect([made.id, made.name, made.link!.boardId]).toEqual(['S2', 'DB-GF1 2', 'DB-GF1']);
    const f = fillLinked(project, made, AT);
    expect(f.link!.rows).toEqual(scheduleRowKeys(project, 'DB-GF1'));
    expect(f.cells.A5).toBe(String(data.rows[0]['row.ref']));
    expect(f.cells[`E${5 + N}`]).toBe(`=SUM(E5:E${4 + N})`);
    expect(sheetFromFormat(t, []).name).toBe('Sheet');
    expect(sheetFromFormat(t, [], undefined, 'My copy')).toMatchObject({ name: 'My copy' });
    expect(sheetFromFormat(t, [], undefined, 'My copy').link).not.toHaveProperty('boardId');
  });
});

describe('boardSheet', () => {
  const tpl = () => templateOf(fillLinked(project, sums(), AT))!;
  const format = { id: 'f1', name: 'Office DB', category: 'db' as const, sheet: tpl(), updatedAt: '2026-11-14' };
  it('finds the first sheet of the book linked to the board', () => {
    const linked = { ...layout(), id: 'S7', name: 'Mine' };
    const p: Project = { ...project, sheets: { sheets: [newSheet(), linked, { ...linked, id: 'S8', name: 'Other' }] } };
    const r = boardSheet(withProjectFormat(p, format), 'DB-GF1')!;
    expect(r.sheetId).toBe('S7');
    expect(r.project.sheets!.sheets).toHaveLength(3);
  });
  it('makes a sheet from the project\'s format when there is none, and it holds that board\'s circuits', () => {
    const p = withProjectFormat(project, format);
    const r = boardSheet(p, 'DB-GF1')!;
    expect(r.project.sheets!.sheets).toHaveLength(1);
    const made = r.project.sheets!.sheets[0];
    expect([r.sheetId, made.name, made.link!.boardId]).toEqual([made.id, 'DB-GF1', 'DB-GF1']);
    const f = fillLinked(r.project, made, AT);
    expect(f.link!.rows).toEqual(scheduleRowKeys(project, 'DB-GF1'));
    expect(f.cells.A5).toBe(String(data.rows[0]['row.ref']));
    expect(boardSheet(r.project, 'DB-GF1')!.project).toBe(r.project);
    const second = boardSheet(p, 'DB-GF1')!;
    expect(second.project.sheets!.sheets).toHaveLength(1);
    expect(p.sheets).toBeUndefined();
  });
  it('is undefined with neither a sheet nor a format', () => {
    expect(boardSheet(project, 'DB-GF1')).toBeUndefined();
    expect(boardSheet({ ...project, sheets: { sheets: [layout()] } }, 'DB-OTHER')).toBeUndefined();
  });
});

describe('panel schedules (category md)', () => {
  const mdProject = addSpareWay(sampleProject, 'SMDB-GF', 'spare').project;
  const md = panelData(mdProject, 'SMDB-GF', AT), mdKeys = panelRowKeys(mdProject, 'SMDB-GF'), M = mdKeys.length;
  /** An office's panel layout: title, the panel line, headings in row 4 (ROUTE is not a panel field). */
  const office = (): Sheet => sheet({ A1: 'AL NOOR CONSULTANTS', D1: 'PANEL SCHEDULE', A2: 'PANEL', B2: 'SMDB-GF', C2: 'FED FROM: MDB-1', D2: 'LOCATION: GROUND FLOOR',
    A4: 'SL NO', B4: 'FEEDER', C4: 'BREAKER TYPE', D4: 'RATING (A)', E4: 'CABLE SIZE (mm²)', F4: 'ECC (mm²)', G4: 'LENGTH (m)', H4: 'TCL (kW)', I4: 'MDL (kW)', J4: 'ROUTE', K4: 'REMARKS' });
  const mdSheet = (): Sheet => linkToBoard(suggestLink(office(), 'md')!, 'SMDB-GF');
  const mdFill = (p: Project = mdProject, s: Sheet = mdSheet()) => fillLinked(p, s, AT);

  it('linkFields(md): every key is one panelData produces; labels and kind', () => {
    const have = new Set([...Object.keys(md.fields), ...Object.keys(md.rows[0])]);
    for (const f of linkFields('md')) if (f.key !== 'own') expect(have.has(f.key), f.key).toBe(true);
    expect(linkFields('md').filter((f) => f.kind === 'cell').every((f) => !f.typed)).toBe(true);
    expect(linkFields('md').find((f) => f.key === 'row.tcl')).toEqual({ key: 'row.tcl', label: 'Connected load (TCL), kW', kind: 'row', typed: true });
    expect(linkFields('md').find((f) => f.key === 'panel.mdl')!.label).toBe('Maximum demand, kW');
    expect(linkFields('db')).toBe(LINK_FIELDS);
    expect([linkLabel('db'), linkLabel('md')]).toEqual(['DB schedule', 'Panel schedule']);
  });

  it('linkNeeds asks for a feeder name on each row', () => {
    const link = (cells: SheetLink['cells'], columns: SheetLink['columns']): SheetLink => ({ category: 'md', cells, firstRow: 5, rows: [], columns });
    expect(linkNeeds(link({}, {})).map((n) => [n.label, n.ok])).toEqual([['Board number', false], ['Fed from', false], ['A feeder name on each row', false]]);
    expect(linkNeeds(link({ A1: { field: 'board.id' }, B1: { field: 'board.fedFrom' } }, { C: 'row.name' })).every((n) => n.ok)).toBe(true);
    expect(linkNeeds(link({}, { C: 'row.room' })).map((n) => n.ok)).toEqual([false, false, false]);
  });

  it('linkBoards(md): boards with outgoing feeders and boards that are not a DB', () => {
    const ids = linkBoards(sampleProject, 'md').map((b) => b.id);
    expect(ids).toEqual(sampleProject.boards.filter((b) => ['MDB-1', 'SMDB-GF', 'SMDB-FF', 'MCC-1'].includes(b.id)).map((b) => b.id));
    expect(ids).not.toContain('DB-GF1');
    expect(linkBoards(sampleProject)).toEqual(linkBoards(sampleProject, 'db'));
  });

  it('suggestLink(md) reads an office panel layout', () => {
    const s = suggestLink(office(), 'md')!, l = s.link!;
    expect([l.category, l.firstRow]).toEqual(['md', 5]);
    expect(l.columns).toEqual({ A: 'row.sl', B: 'row.name', C: 'row.device', D: 'row.rating', E: 'row.size', F: 'row.ecc', G: 'row.length', H: 'row.tcl', I: 'row.mdl', K: 'row.remarks' });
    expect(Object.keys(l.columns)).toHaveLength(10);
    expect(l.cells).toEqual({ B2: { field: 'board.id' }, C2: { field: 'board.fedFrom', before: 'FED FROM: ' }, D2: { field: 'board.location', before: 'LOCATION: ' } });
    expect(suggestLink(sheet({ A1: 'x' }), 'md')).toBeUndefined();
  });

  it('suggestLink(md) knows the other heading words', () => {
    const heads = ['SR NO', 'DESCRIPTION', 'SP/TP', 'DEVICE', 'AMP', 'FAULT kA', 'CORES', 'TYPE XLPE', 'R PH KW', 'Y', 'B KW', 'MAX DEMAND', 'CONNECTED LOAD', 'METER', 'FED TO'];
    const s = suggestLink(sheet(Object.fromEntries(heads.map((h, i) => [`${colLetters(i)}3`, h]))), 'md')!;
    expect(Object.values(s.link!.columns)).toEqual(['row.sl', 'row.name', 'row.poles', 'row.device', 'row.rating', 'row.fault', 'row.cores', 'row.cableType', 'row.R', 'row.Y', 'row.B', 'row.mdl', 'row.tcl', 'row.meter', 'row.to']);
  });

  it('fillLinked fills the header cells and one row per feeder and way', () => {
    const f = mdFill(), l = f.link!;
    expect(l.rows).toEqual(mdKeys);
    expect([f.cells.B2, f.cells.C2, f.cells.D2]).toEqual(['SMDB-GF', 'FED FROM: MDB-1', 'LOCATION: Ground floor electrical room']);
    expect([f.cells.A5, f.cells.B5, f.cells.C5, f.cells.D5, f.cells.E5, f.cells.G5, f.cells.H5]).toEqual(['1', 'LIGHTING', 'MCCB', '80', '25', '30', '45']);
    expect(f.cells[`B${5 + M - 1}`]).toBe(String(md.rows[M - 1]['row.name']));
    expect(f.cells[`A${5 + M - 1}`]).toBe(String(M));
    expect(mdFill(mdProject, f)).toEqual(f);
  });

  it('a total formula below the block follows it', () => {
    const f = fillLinked(mdProject, withCells(mdSheet(), { H6: '=SUM(H5:H5)' }), AT);
    expect(f.cells[`H${5 + M}`]).toBe(`=SUM(H5:H${4 + M})`);
    expect(val(f, `H${5 + M}`)).toBeCloseTo(Number(md.fields['panel.tcl']), 1);
  });

  it('own text follows its feeder', () => {
    const s0 = setLinkColumn(mdSheet(), 'L', 'own'), f = fillLinked(sampleProject, s0, AT);
    const second = f.link!.rows[1], noted = withCells(f, { L6: 'sockets note' });
    const gone = deleteOutgoingFeeder(sampleProject, f.link!.rows[0]).project; // the first feeder leaves: its row goes, the note moves up
    const g = fillLinked(gone, noted, AT);
    expect(g.link!.rows[0]).toBe(second);
    expect([g.cells.L5, g.cells.L6]).toEqual(['sockets note', undefined]);
  });

  it('typing: a feeder\'s own values wait for Apply, the rest is refused', () => {
    const f = mdFill();
    expect(typeRefusal(f, 'A5')).toBe('A5 is worked out by the app (Serial number).');
    expect(typeRefusal(f, 'I5')).toBe('I5 is worked out by the app (Maximum demand (MDL), kW).');
    expect(typeRefusal(f, 'B2')).toBe('B2 is filled from the project (Board number).');
    expect(typeRefusal(f, 'B5')).toBeUndefined();
    const t = typeLinked(mdProject, f, { B5: 'Corridor lights', D5: '100' });
    expect(t.refused).toBeUndefined();
    expect(t.sheet.link!.pending).toEqual({ [mdKeys[0]]: { B: 'Corridor lights', D: '100' } });
  });

  it('typing: a spare way takes only its device, rating, fault duty and remarks', () => {
    const f = mdFill(), row = 5 + M - 1;
    expect(mdKeys[M - 1]).toMatch(/^spare:/);
    expect(typeRefusal(f, `B${row}`)).toBe(`B${row}: a spare way takes only its device, rating, fault duty and remarks.`);
    expect(typeRefusal(f, `E${row}`)).toBe(`E${row}: a spare way takes only its device, rating, fault duty and remarks.`);
    for (const c of ['C', 'D', 'K']) expect(typeRefusal(f, `${c}${row}`), c).toBeUndefined();
    const t = typeLinked(mdProject, f, { [`D${row}`]: '63', [`H${row}`]: '5' });
    expect(t.refused).toContain('a spare way takes only');
    expect(t.sheet.link!.pending).toEqual({ [mdKeys[M - 1]]: { D: '63' } });
  });

  it('typing in an added row is kept in added', () => {
    const t = typeLinked(mdProject, fillLinked(mdProject, addCircuitRow(mdFill()), AT), { [`B${5 + M}`]: 'Spare pump' });
    expect(t.sheet.link!.added).toEqual([{ B: 'Spare pump' }]);
    expect(t.sheet.link!.rows[M]).toBe('new:0');
  });

  it('templateOf and sheetFromFormat keep the category, and sheetsForBoards copies it', () => {
    const tpl = templateOf(mdFill())!;
    expect(tpl.link).toMatchObject({ category: 'md', rows: [], columns: { B: 'row.name' } });
    expect(tpl.link!.boardId).toBeUndefined();
    expect(sheetFromFormat(tpl, [], 'SMDB-FF').link).toMatchObject({ category: 'md', boardId: 'SMDB-FF' });
    const made = sheetsForBoards([], tpl, ['SMDB-FF', 'MCC-1']);
    expect(made.map((m) => [m.link!.category, m.link!.boardId])).toEqual([['md', 'SMDB-FF'], ['md', 'MCC-1']]);
    const ff = fillLinked(sampleProject, made[0], AT);
    expect(ff.link!.rows).toEqual(panelRowKeys(sampleProject, 'SMDB-FF'));
  });

  it('boardSheet does not put the project\'s DB format on a panel, but finds a panel sheet', () => {
    const dbFormat = { id: 'f1', name: 'Office DB', category: 'db' as const, sheet: templateOf(fillLinked(project, sums(), AT))!, updatedAt: '2026-11-14' };
    const p = withProjectFormat(sampleProject, dbFormat);
    expect(boardSheet(p, 'SMDB-GF')).toBeUndefined();
    expect(boardSheet(p, 'DB-GF1')).toBeDefined();
    const linked = { ...mdSheet(), id: 'S9', name: 'Panel' };
    expect(boardSheet({ ...p, sheets: { sheets: [linked] } }, 'SMDB-GF')).toMatchObject({ sheetId: 'S9' });
  });
});

/** Column letters of a 0-based index below 26. */
const colLetters = (i: number) => String.fromCharCode(65 + i);
