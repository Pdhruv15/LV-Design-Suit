import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { elvBoq, elvTables, floorRef, remarkOf, withRemark } from './outputs';
import { placeDevices, type NewElvDevice } from './placed';
import { elvWorkbook } from './workbook';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

// Ground floor (estimate only) and a typical office level used for 4 floors, with fire alarm devices placed.
const base = (): Project => ({
  name: 'Tower', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: {
    buildings: [{ id: 'T', name: 'Tower', levels: [
      { id: 'GF', name: 'Ground', kind: 'ground', heightM: 4.5 },
      { id: 'L1', name: 'Typical', kind: 'typical', heightM: 3.5, count: 4 }
    ] }],
    rooms: [
      { id: 'R1', buildingId: 'T', levelId: 'GF', name: 'Lobby', type: 'lobby', areaM2: 200 },
      { id: 'R2', buildingId: 'T', levelId: 'L1', name: 'Office', type: 'office', areaM2: 200, outline: box(0, 0, 20, 10) },
      { id: 'R3', buildingId: 'T', levelId: 'L1', name: 'WC', type: 'toilet', areaM2: 20, outline: box(20, 0, 24, 5) }
    ]
  }
});
const fire: NewElvDevice[] = [{ type: 'smoke-detector', x: 5, y: 5 }, { type: 'smoke-detector', x: 15, y: 5 }, { type: 'call-point', x: 0.5, y: 5 }, { type: 'sounder-beacon', x: 10, y: 9 }];
const placed = () => placeDevices(base(), 'T', 'L1', fire).project;
const table = (p: Project, id: string) => elvTables(p).find((t) => t.id === id)!;

describe('ELV schedules', () => {
  it('names typical floors as a range, or one by one when they are not consecutive', () => {
    expect(floorRef(['L05', 'L06', 'L07', 'L08', 'L09'])).toBe('L05–L09');
    expect(floorRef(['L05', 'L07', 'L08'])).toBe('L05, L07, L08');
    expect(floorRef(['G'])).toBe('G');
    expect(floorRef([])).toBe('');
  });

  it('lists devices per room, from the plan where placed and the estimate elsewhere, with per-floor and building totals', () => {
    const t = table(placed(), 'devices');
    expect(t.columns.slice(0, 3).map((c) => c.label)).toEqual(['Room', 'From', 'm²']);
    const col = (code: string) => t.columns.findIndex((c) => c.label === code);
    const row = (key: string) => t.rows.find((r) => r.key === key)!;
    expect(row('T/L1').cells[0]).toBe('Typical (L01–L04)');
    expect(row('R2').cells[1]).toBe('plan');
    expect(row('R2').cells[col('SD')]).toBe(2);
    expect(row('R1').cells[1]).toBe('estimate'); // the ground floor has nothing placed
    expect(row('T/L1/sum').cells[0]).toBe('Per floor (× 4: L01–L04)');
    // Building smoke detectors: the lobby's estimate + 2 per typical floor × 4.
    const lobby = Number(row('R1').cells[col('SD')] || 0);
    expect(row('total').cells[col('SD')]).toBe(lobby + 8);
  });

  it('lists the loops with floors, zones and addresses, and the zones, from the placed devices', () => {
    const loops = table(placed(), 'loops');
    // 4 devices × 4 floors = 16 on one loop; 1 isolator; floors L01–L04, zones Z1–Z4.
    expect(loops.rows).toHaveLength(1);
    const c = loops.rows[0].cells;
    expect([c[0], c[1], c[2], c[3]]).toEqual(['P1-L1', 'L01–L04', 'Z1–Z4', '1–16']);
    expect(c.slice(-4)).toEqual([16, '4.8', (16 * 0.3 + 4 * 24.7 + 5 * 4.7).toFixed(1), 1]);
    expect(loops.notes.some((n) => /Annex E/.test(n))).toBe(true);
    const zones = table(placed(), 'zones');
    expect(zones.rows.map((r) => r.cells.slice(0, 3))).toEqual([['Z1', 'Typical (L01)', 220], ['Z2', 'Typical (L02)', 220], ['Z3', 'Typical (L03)', 220], ['Z4', 'Typical (L04)', 220]]);
    expect(table(base(), 'loops').rows).toEqual([]); // nothing placed: no loops yet, and the note says so
    expect(table(base(), 'loops').notes.at(-1)).toMatch(/No fire alarm devices placed/);
  });

  it('counts the BOQ from the devices and the equipment serving them, per system', () => {
    const lines = elvBoq(placed());
    const qty = (key: string) => lines.find((l) => l.key === key)?.qty;
    const p = placed();
    const lobbySmoke = Number(table(p, 'devices').rows.find((r) => r.key === 'R1')!.cells[table(p, 'devices').columns.findIndex((c) => c.label === 'SD')] || 0);
    expect(qty('smoke')).toBe(lobbySmoke + 8);
    expect(qty('call-point')).toBeGreaterThanOrEqual(4); // 1 placed per typical floor × 4, plus any estimated on the ground floor
    expect(qty('isolator')).toBe(1); // from the placed loop
    expect(lines.find((l) => l.key.startsWith('panel-'))).toMatchObject({ system: 'fire-alarm', unit: 'no.', qty: 1 });
    expect(lines.find((l) => l.key.startsWith('battery-'))!.description).toMatch(/^Standby battery 12 V \d+ Ah/);
    expect(new Set(lines.map((l) => l.system))).toEqual(new Set(['fire-alarm', 'cctv', 'access-control', 'ict', 'public-address']));
    const boq = table(p, 'boq');
    expect(boq.rows[0]).toMatchObject({ key: 'fire-alarm', kind: 'group', cells: ['1', 'Fire alarm', '', ''] });
    expect(boq.rows[1].cells[0]).toBe('1.1');
  });

  it('keeps a remark per schedule row, and drops it when cleared', () => {
    let p = withRemark(placed(), 'devices', 'R2', '  Coverage checked on site  ');
    expect(remarkOf(p, 'devices', 'R2')).toBe('Coverage checked on site');
    expect(remarkOf(p, 'boq', 'R2')).toBe('');
    p = withRemark(p, 'devices', 'R2', ' ');
    expect(p.elvRemarks).toBeUndefined();
  });

  it('exports every schedule with rows as a sheet, remarks in the last column', async () => {
    const p = withRemark(placed(), 'loops', 'T/P1-L1', 'Loop to riser A');
    const wb = await elvWorkbook(p, elvTables(p), 'REV A · 2026-10-28');
    // No CCTV, access, data or PA devices placed: that schedule is empty and gets no sheet.
    expect(wb.worksheets.map((w) => w.name)).toEqual(['device schedule', 'Fire alarm loop schedule', 'Fire detection zones', 'bill of quantities']);
    const ws = wb.getWorksheet('Fire alarm loop schedule')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Tower — Fire alarm loop schedule');
    expect(ws.getRow(3).getCell(ws.getRow(3).cellCount).value).toBe('Remarks');
    expect(ws.getRow(4).getCell(ws.getRow(4).cellCount).value).toBe('Loop to riser A');
    expect(ws.headerFooter.oddHeader).toContain('REV A');
  });
});
