import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { sampleProject } from '../data/sampleProject';
import { placeBoard, placeLvPoint } from '../model/cadDevices';
import { wireLevel } from '../model/cadWiring';
import { renumber, setOf, sheetType, type DrawingSheet } from '../model/drawingSet';
import type { Project } from '../types';
import { addPlanSheets, drawingAreaMm, planDrawing, planLevels, planNotes, planScale } from './planLayout';
import { buildSheetDxfPages } from './sheetDxf';

const gf = { building: 'V', level: 'GF' };
const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
/** A villa ground floor: a 20 × 12 m majlis with the DB at its corner, three lights 4 m apart (lighting circuit) and a
 * socket (power circuit). */
function villa(width = 20): Project {
  let p: Project = {
    ...sampleProject, lvPoints: undefined, cadWiring: undefined, cadSketch: undefined, cadLength: undefined, elvDevices: undefined, drawingSet: undefined,
    building: {
      buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground floor', kind: 'ground', heightM: 4 }, { id: 'FF', name: 'First floor', kind: 'typical', heightM: 4 }] }],
      rooms: [{ id: 'r1', buildingId: 'V', levelId: 'GF', name: 'Majlis', type: 'living', areaM2: width * 12, outline: box(0, 0, width, 12) }]
    }
  };
  p = placeBoard(p, 'DB-GF1', gf, 1, 1);
  for (const x of [6, 10, 14]) p = placeLvPoint(p, gf, 'ltg', 'DB-GF1-Y1', x, 6).project;
  p = placeLvPoint(p, gf, 's13', 'DB-GF1-B6', width - 1, 1).project;
  return wireLevel(p, gf).project;
}
const sheetOf = (p: Project, type: 'lighting' | 'power' | 'elv' = 'lighting') => {
  const r = addPlanSheets(setOf(p), p, type);
  return { set: r.set, sheets: r.set.sheets.filter((s) => r.ids.includes(s.id)) };
};
/** The centres of the circles drawn (paper mm). */
const circles = (svg: string) => [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="1.8"/g)].map((m) => [Number(m[1]), Number(m[2])]);

describe('plan sheets (Design CAD → Sheets → Plans)', () => {
  beforeAll(() => vi.stubGlobal('DOMParser', DOMParser));
  afterAll(() => vi.unstubAllGlobals());

  it('reads the scale and finds the levels with something on each layout', () => {
    expect([planScale('1:50'), planScale('1 : 200'), planScale(undefined), planScale('NTS')]).toEqual([50, 200, 100, 100]);
    const p = villa();
    expect(planLevels(p, 'lighting').map((l) => l.name)).toEqual(['Ground floor']);
    expect(planLevels(p, 'power').map((l) => l.levelId)).toEqual(['GF']);
    expect(planLevels(p, 'elv')).toEqual([]);
  });

  it('adds a sheet per level, numbered per layout, at 1:100, and only once', () => {
    const p = villa();
    const { set, sheets } = sheetOf(p);
    expect(sheets.map((s) => [s.number, s.title, s.scale, s.size, s.kind])).toEqual([['E-LTG-001', 'Ground floor · Lighting layout', '1:100', 'auto', 'plan']]);
    expect(sheetType(sheets[0])).toBe('plan');
    const both = addPlanSheets(set, p, 'power').set;
    expect(both.sheets.map((s) => s.number)).toEqual(['E-LTG-001', 'E-PWR-001']);
    expect(addPlanSheets(both, p, 'lighting').ids).toEqual([]);
    expect(renumber(both, true).sheets.map((s) => s.number)).toEqual(['E-LTG-001', 'E-PWR-001']);
  });

  it('draws the level at its true scale on the paper it needs, the architect plan grey and the design black', () => {
    const p = villa();
    const s = sheetOf(p).sheets[0];
    const d = planDrawing(p, s)!;
    expect(d.size).toBe('A3');
    const area = drawingAreaMm(p, 'A3');
    expect(area).toEqual({ w: 292, h: 230 });
    expect(d.svg).toContain(`viewBox="0 0 ${area.w} ${area.h}"`);
    // Lights 4 m apart are 40 mm apart at 1:100.
    const lights = circles(d.svg).sort((a, b) => a[0] - b[0]);
    expect(lights).toHaveLength(3);
    expect(lights[1][0] - lights[0][0]).toBeCloseTo(40, 1);
    expect(d.svg).toMatch(/stroke="#8c8c8c"/);
    expect(d.svg).toContain('MAJLIS');
    expect(d.svg).toMatch(/DB-GF1\/Y1 · \dC × [\d.]+ mm² · \d+ m/); // the home run's tag
    expect(d.svg).toContain('GROUND FLOOR · LIGHTING LAYOUT');
    expect(d.svg).toContain('SCALE 1:100 AT A3');
    expect(d.svg).not.toContain('B6'); // the socket circuit is on the power layout
    expect(d.legendSvg).toMatch(/>Light<\/text>.*>3<\/text>/s);
    expect(d.legendSvg).not.toContain('KEY PLAN');
    // Black and white only.
    expect([...d.svg.matchAll(/(?:fill|stroke)="(#[0-9a-f]{3,6})"/gi)].every((m) => /^#(000|fff|8c8c8c)$/i.test(m[1]))).toBe(true);
    // At 1:50 the lights are 80 mm apart.
    expect((() => { const l = circles(planDrawing(p, { ...s, scale: '1:50' })!.svg).sort((a, b) => a[0] - b[0]); return l[1][0] - l[0][0]; })()).toBeCloseTo(80, 1);
  });

  it('keeps the scale in the DXF sheet', () => {
    const p = villa();
    const d = planDrawing(p, sheetOf(p).sheets[0])!;
    const [page] = buildSheetDxfPages(p, d.svg, d.size, { no: 'E-LTG-001', title: 'Ground floor · Lighting layout', index: 1, count: 1, legendSvg: d.legendSvg, scale: '1:100' });
    // CIRCLE entities: centre x (10) and radius (40); the light symbols have r 1.8.
    const xs: number[] = [];
    const lines = page.data.split(/\r?\n/);
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (lines[i].trim() !== '0' || lines[i + 1] !== 'CIRCLE') continue;
      let x = 0, r = 0;
      for (let j = i + 2; j < lines.length - 1 && lines[j].trim() !== '0'; j += 2) { if (lines[j].trim() === '10') x = Number(lines[j + 1]); if (lines[j].trim() === '40') r = Number(lines[j + 1]); }
      if (Math.abs(r - 1.8) < 0.1) xs.push(x);
    }
    xs.sort((a, b) => a - b);
    expect(xs.length).toBeGreaterThanOrEqual(3);
    expect(xs[1] - xs[0]).toBeGreaterThan(38);
    expect(xs[1] - xs[0]).toBeLessThan(42);
  });

  it('splits a level too big for A1 into parts with a key plan and match lines', () => {
    const p = villa(200); // 202 m with the margin: 2 020 mm at 1:100, three A1 drawing areas wide
    const { set, sheets } = sheetOf(p);
    expect(sheets.map((s) => [s.number, s.title, s.part])).toEqual([
      ['E-LTG-001', 'Ground floor · Lighting layout · part 1 of 3', 0],
      ['E-LTG-002', 'Ground floor · Lighting layout · part 2 of 3', 1],
      ['E-LTG-003', 'Ground floor · Lighting layout · part 3 of 3', 2]
    ]);
    const numberOf = (part: number) => set.sheets.find((x: DrawingSheet) => x.part === part)?.number;
    const mid = planDrawing(p, sheets[1], numberOf)!;
    expect(mid.size).toBe('A1');
    expect(mid.svg).toContain('MATCH LINE · SEE E-LTG-001');
    expect(mid.svg).toContain('MATCH LINE · SEE E-LTG-003');
    expect(mid.svg).toContain('PART 2 OF 3');
    expect(mid.legendSvg).toContain('KEY PLAN');
    // The lights at 6–14 m are on part 1 only.
    expect(circles(planDrawing(p, sheets[0], numberOf)!.svg)).toHaveLength(3);
    expect(circles(mid.svg)).toHaveLength(0);
    expect(planDrawing(p, { ...sheets[0], part: 5 })).toBeUndefined();
  });

  it('notes what the sheet shows and that it is a design-stage layout', () => {
    const p = villa();
    const notes = planNotes(p, sheetOf(p).sheets[0]);
    expect(notes.some((n) => /grey/.test(n))).toBe(true);
    expect(notes.some((n) => /not for construction/.test(n))).toBe(true);
  });
});
