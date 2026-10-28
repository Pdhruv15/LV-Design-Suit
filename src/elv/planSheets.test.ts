import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { placeDevices } from './placed';
import { legendSvg, planDxf, planLevels, planSheetHtml, planSvg, sheetInfo } from './planSheets';

const box = (x1: number, y1: number, x2: number, y2: number): [number, number][] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const base = (): Project => ({
  name: 'Tower', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
  building: {
    buildings: [{ id: 'T', name: 'Tower', levels: [
      { id: 'GF', name: 'Ground', kind: 'ground', heightM: 4.5 },
      { id: 'L1', name: 'Typical', kind: 'typical', heightM: 3.5, count: 5 }
    ] }],
    rooms: [
      { id: 'R1', buildingId: 'T', levelId: 'L1', name: 'Office', type: 'office', areaM2: 200, outline: box(0, 0, 20, 10) },
      { id: 'R2', buildingId: 'T', levelId: 'L1', name: 'Store', type: 'store', areaM2: 16, outline: box(20, 0, 24, 4) }
    ]
  }
});
const project = () => placeDevices(base(), 'T', 'L1', [
  { type: 'smoke-detector', x: 5, y: 5 }, { type: 'smoke-detector', x: 15, y: 5 }, { type: 'call-point', x: 0.5, y: 5 },
  { type: 'camera', x: 1, y: 9, rotationDeg: 315 }, { type: 'sounder-beacon', x: 10, y: 9.5 }
]).project;

describe('ELV plan sheets', () => {
  it('makes one sheet per level with devices, a typical level naming its floors', () => {
    expect(planLevels(base())).toEqual([]);
    const [lv] = planLevels(project());
    expect(lv).toEqual({ buildingId: 'T', levelId: 'L1', name: 'Typical', floors: 'L01–L05', count: 5 });
    const info = sheetInfo(project(), lv, 0, 1);
    expect(info).toMatchObject({ no: 'ELV-101', title: 'Typical (Typical floors L01–L05) · ELV layout', index: 1, count: 1, scale: 'NTS' });
    expect(info.notes![0]).toBe('Typical floors L01–L05: this level is drawn once and applies to each of those floors.');
  });

  it('draws rooms in grey and devices in black, and lists the devices per floor in the legend', () => {
    const p = project(), [lv] = planLevels(p);
    const svg = planSvg(p, lv);
    expect(svg).toContain('>OFFICE<');
    expect((svg.match(/<circle /g) ?? []).length).toBe(2); // the two smoke detectors
    expect(svg).toContain('rotate(-315 '); // the camera faces where it was turned
    const colours = new Set((svg.match(/#[0-9a-f]{3,6}\b/gi) ?? []).map((c) => c.toLowerCase()));
    for (const c of colours) expect(['#000', '#fff', '#777', '#999'], c).toContain(c);
    const legend = legendSvg(p, lv);
    expect(legend).toMatch(/Smoke detector<\/text><text [^>]*>2<\/text>/);
    expect(legend).toContain('L01–L05');
  });

  it('puts the plan in the project sheet frame and title block', () => {
    const p = project(), [lv] = planLevels(p);
    const html = planSheetHtml(p, lv, 0, 1);
    expect(html).toContain('@page { size: 420mm 297mm');
    expect(html).toContain('ELV-101');
    expect(html).toContain('LEGEND · ELV DEVICES PER FLOOR');
  });

  it('exports the devices as DXF in millimetres, one layer per system, each tagged with its ID', () => {
    const p = project(), [lv] = planLevels(p);
    const dxf = planDxf(p, lv).replace(/\r\n/g, '\n'); // R12 lines end in CRLF
    for (const layer of ['A-ELV-ROOMS', 'E-ELV-FA', 'E-ELV-CCTV']) expect(dxf).toContain(`\n${layer}\n`);
    expect(dxf).toContain('elv:E1');
    expect(dxf).toMatch(/\n10\n5000\n20\n5000\n/); // the first smoke detector at 5 m, 5 m
  });
});
