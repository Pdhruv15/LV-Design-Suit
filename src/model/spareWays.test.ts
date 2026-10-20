import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { boardPhaseKw, nextFreeSlot, scheduleCircuits } from '../calc/loadSchedule';
import { buildBom } from '../calc/bom';
import { buildDbSheet, applySheetEdits } from '../docs/dbSheet';
import { applyMdEdits, buildMdSheet } from '../docs/mdSheet';
import { buildLoadScheduleHtml, loadScheduleCsv, loadScheduleRows } from '../docs/loadScheduleDoc';
import { layoutSystem } from '../diagram/layout';
import { neededDevices } from './enclosureLibrary';
import { form4FromSld } from './form4Count';
import { addCircuit, balancePhases } from './schedule';
import { addSpareWay, dbSpares, deleteSpareWay, isDbBoard, reslotSpares, spareWaysOf, updateSpareWay } from './spareWays';
import type { Project } from '../types';

const p = sampleProject;
const db = p.boards.find((b) => isDbBoard(b) && scheduleCircuits(p, b.id).length)!;
const panel = p.boards.find((b) => !isDbBoard(b) && b.upstreamId)!;
const boardOf = (q: Project, id: string) => q.boards.find((b) => b.id === id)!;

describe('spares and spaces on a DB', () => {
  it('takes the next free slot, and new circuits leave it alone', () => {
    const free = nextFreeSlot(p, db.id);
    const r = addSpareWay(p, db.id, 'spare');
    const s = spareWaysOf(boardOf(r.project, db.id))[0];
    expect([s.phase, s.way]).toEqual([free.phase, free.way]);
    expect(s.ratingA).toBe(20);
    expect(r.message).toMatch(/spare 20 A SP/);
    const next = addCircuit(r.project, db.id).project;
    const added = next.feeders.find((f) => !r.project.feeders.some((x) => x.id === f.id))!;
    expect(`${added.phase}${added.way}`).not.toBe(`${s.phase}${s.way}`);
  });

  it('a 3-phase spare or space takes a whole free way', () => {
    const r = addSpareWay(p, db.id, 'space', 'RYB');
    const s = spareWaysOf(boardOf(r.project, db.id))[0];
    expect(s.phase).toBe('RYB');
    expect(nextFreeSlot(r.project, db.id, 'RYB').way).toBeGreaterThan(s.way!);
  });

  it('does not change any load or demand figure', () => {
    const q = addSpareWay(addSpareWay(p, db.id, 'spare').project, db.id, 'space').project;
    expect(boardPhaseKw(q, db.id)).toEqual(boardPhaseKw(p, db.id));
    expect(q.feeders).toBe(p.feeders);
  });

  it('Balance phases puts spares and spaces in the free slots after the circuits', () => {
    // A spare sitting in slot R1 (before the circuits are renumbered).
    const q: Project = { ...p, boards: p.boards.map((b) => (b.id === db.id ? { ...b, spareWays: [{ id: 'sp1', kind: 'spare', phase: 'R', way: 1, ratingA: 20 }] } : b)) };
    const bal = balancePhases(q, db.id);
    const s = dbSpares(boardOf(bal, db.id))[0];
    const taken = scheduleCircuits(bal, db.id).flatMap((f) => (f.phase === 'RYB' ? ['R', 'Y', 'B'] : [f.phase!]).map((ph) => `${ph}${f.way}`));
    expect(taken).not.toContain(`${s.phase}${s.way}`);
    expect(reslotSpares(bal, db.id)).toEqual(bal); // stable
  });

  it('edits and deletes', () => {
    const r = addSpareWay(p, db.id, 'spare');
    const q = updateSpareWay(r.project, db.id, r.id!, { ratingA: 32, remarks: 'future AC' });
    expect(spareWaysOf(boardOf(q, db.id))[0]).toMatchObject({ ratingA: 32, remarks: 'future AC' });
    const d = deleteSpareWay(q, db.id, r.id!);
    expect(boardOf(d.project, db.id).spareWays).toBeUndefined();
    expect(deleteSpareWay(d.project, db.id, r.id!).project).toBe(d.project);
  });

  it('shows on the schedule, its Excel sheet, PDF and CSV in its slot', () => {
    const r = addSpareWay(p, db.id, 'spare');
    const s = spareWaysOf(boardOf(r.project, db.id))[0];
    const rows = loadScheduleRows(r.project, db.id);
    const e = rows.entries.find((x) => x.type === 'spare')!;
    expect(rows.entries.map((x) => x.sl)).toEqual(rows.entries.map((_, i) => i + 1));
    expect(e.way).toBe(s.way);
    const sheet = buildDbSheet(r.project, db.id);
    const y = sheet.rows.findIndex((x) => x.type === 'spare');
    const at = (k: string) => sheet.sheetCols.findIndex((c) => c.key === k);
    expect(sheet.data[y][at('room')]).toBe('SPARE');
    expect(sheet.data[y][at('mcb')]).toBe(20);
    expect(sheet.editable(y, at('mcb'))).toBe(true);
    expect(sheet.editable(y, at('wire'))).toBe(false);
    const edited = applySheetEdits(r.project, sheet, [{ y, x: at('mcb'), value: '25' }]).project;
    expect(spareWaysOf(boardOf(edited, db.id))[0].ratingA).toBe(25);
    expect(buildLoadScheduleHtml(r.project, db.id)).toContain('<b>SPARE</b>');
    expect(loadScheduleCsv(r.project, db.id).rows.some((row) => row.includes('SPARE'))).toBe(true);
  });
});

describe('spares and spaces on a feeder panel', () => {
  it('adds a TP spare MCCB after the outgoing feeders, and an SP space', () => {
    let q = addSpareWay(p, panel.id, 'spare').project;
    q = addSpareWay(q, panel.id, 'space', 'R').project;
    const [sp, gap] = spareWaysOf(boardOf(q, panel.id));
    expect(sp).toMatchObject({ kind: 'spare', phase: 'RYB', ratingA: 100, device: 'MCCB' });
    expect(sp.way).toBeUndefined();
    expect(gap).toMatchObject({ kind: 'space', phase: 'R' });

    const md = buildMdSheet(q, panel.id);
    const ys = md.rows.map((r, y) => (r.type === 'way' ? y : -1)).filter((y) => y >= 0);
    expect(ys).toHaveLength(2);
    expect(md.rows[md.rows.length - 1].type).toBe('spare'); // the blank line stays last
    const at = (k: string) => md.keys.indexOf(k as never);
    expect(md.data[ys[0]].slice(0, 4)).toEqual(['SPARE', 'TP', '', 100]);
    expect(md.data[ys[1]][0]).toBe('SPACE');
    expect(md.data[ys[1]][at('MCCB')]).toBe('');
    expect(md.editable(ys[1], at('MCCB'))).toBe(false);
    expect(md.totals).toEqual(buildMdSheet(p, panel.id).totals); // no load
    const edited = applyMdEdits(q, md, [{ y: ys[0], x: at('ACB'), value: '630' }, { y: ys[0], x: at('remarks'), value: 'future chiller' }]).project;
    expect(spareWaysOf(boardOf(edited, panel.id))[0]).toMatchObject({ device: 'ACB', ratingA: 630, remarks: 'future chiller' });
  });

  it('is drawn on the SLD busbar, and DB spares are not', () => {
    let q = addSpareWay(p, panel.id, 'spare').project;
    q = addSpareWay(q, db.id, 'spare').project;
    const lay = layoutSystem(q);
    expect(lay.spares.map((s) => s.boardId)).toEqual([panel.id]);
    const busFeeders = lay.feeders.filter((f) => f.feeder.boardId === panel.id).map((f) => f.x);
    expect(lay.spares[0].x).toBeGreaterThan(Math.max(...busFeeders));
  });
});

describe('counts', () => {
  const q = [
    (x: Project) => addSpareWay(x, panel.id, 'spare').project,
    (x: Project) => addSpareWay(x, panel.id, 'space').project,
    (x: Project) => addSpareWay(x, db.id, 'spare').project,
    (x: Project) => addSpareWay(x, db.id, 'space').project
  ].reduce((acc, f) => f(acc), p);

  it('BOQ: one more breaker per spare, none for a space', () => {
    const qty = (pr: Project) => buildBom(pr).filter((i) => i.section === 'B').reduce((n, i) => n + i.qty, 0);
    expect(qty(q) - qty(p)).toBe(2);
  });

  it('Form-4: a spare fills an outgoing cubicle; a space is noted', () => {
    const f = form4FromSld(q, panel.id);
    expect(f.items.filter((i) => i.what === 'Spare')).toHaveLength(1);
    expect(f.notes.join(' ')).toMatch(/1 space/);
  });

  it('enclosure: spares and spaces both take room', () => {
    const n = (pr: Project) => neededDevices(pr, db.id).reduce((s, d) => s + d.count, 0);
    expect(n(q) - n(p)).toBe(2); // grouped with the circuits' breakers of the same size
  });
});
