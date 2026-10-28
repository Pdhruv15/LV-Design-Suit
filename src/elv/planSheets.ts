import { buildingInfoOf, floorsOf } from '../calc/building';
import { toDxf, type DxfPrimitive } from '../docs/dxf';
import { buildSldSheetHtml, type SheetInfo } from '../docs/sldSheet';
import type { Project } from '../types';
import { escapeHtmlText as esc } from '../util/escape';
import type { ElvSystem } from './defaults';
import { ELV_DEVICES, type DeviceSymbol, type ElvDeviceType } from './devices';
import { floorRef } from './outputs';
import { devicesOn } from './placed';

/** ELV plan sheets: one A3 sheet per level that has devices placed, all ELV systems on it, in the project's own sheet
 * frame and title block (docs/sldSheet.ts). A typical level is drawn once and names the floors it stands for
 * (L05–L09, or L05, L07, L08). The plan is the level's room outlines and names in grey (from the CAD rooms, so every
 * level prints without its drawing open) with the devices in black, and a legend of the devices per floor. Black
 * and white, like every report. The same plans export as DXF, in millimetres on the architect plan's origin. */

type Pt = [number, number];
export interface PlanLevel { buildingId: string; levelId: string; name: string; floors: string; count: number }

/** The levels with ELV devices placed, in building order, with the floors each stands for. */
export function planLevels(p: Project): PlanLevel[] {
  const info = buildingInfoOf(p);
  const out: PlanLevel[] = [];
  for (const b of info.buildings) {
    const tags = new Map<string, string[]>();
    for (const f of floorsOf(info, b)) tags.set(f.level.id, [...(tags.get(f.level.id) ?? []), f.tag]);
    for (const l of b.levels) {
      if (!devicesOn(p, b.id, l.id).length) continue;
      out.push({ buildingId: b.id, levelId: l.id, name: `${info.buildings.length > 1 ? `${b.name} · ` : ''}${l.name}`, floors: floorRef(tags.get(l.id) ?? []), count: Math.max(1, Math.round(l.count ?? 1)) });
    }
  }
  return out;
}

const SYSTEM_LAYER: Record<ElvSystem, string> = { 'fire-alarm': 'E-ELV-FA', cctv: 'E-ELV-CCTV', 'access-control': 'E-ELV-ACS', ict: 'E-ELV-ICT', 'public-address': 'E-ELV-PA' };

function bounds(p: Project, lv: PlanLevel) {
  const rooms = buildingInfoOf(p).rooms.filter((r) => r.buildingId === lv.buildingId && r.levelId === lv.levelId && r.outline && r.outline.length >= 3);
  const pts: Pt[] = [...rooms.flatMap((r) => r.outline!), ...devicesOn(p, lv.buildingId, lv.levelId).map((d): Pt => [d.x, d.y])];
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const pad = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * 0.03);
  return { rooms, x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad };
}

/** One symbol as SVG at (x, y) with radius r: the plan's shapes and letter codes (cameras and speakers turned). */
function symbolSvg(s: DeviceSymbol, x: number, y: number, r: number, rotationDeg = 0): string {
  const fill = s.filled ? '#000' : '#fff', ink = s.filled ? '#fff' : '#000', sw = r * 0.14;
  const shape = s.shape === 'circle' ? `<circle cx="${x}" cy="${y}" r="${r}"/>`
    : s.shape === 'square' ? `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"/>`
      : s.shape === 'triangle' ? `<path d="M${x} ${y - 1.1 * r}L${x + 1.1 * r} ${y + 0.9 * r}H${x - 1.1 * r}Z"/>`
        : s.shape === 'diamond' ? `<path d="M${x} ${y - 1.1 * r}L${x + 1.1 * r} ${y}L${x} ${y + 1.1 * r}L${x - 1.1 * r} ${y}Z"/>`
          : s.shape === 'hexagon' ? `<path d="M${x - r} ${y}L${x - r / 2} ${y - 0.87 * r}H${x + r / 2}L${x + r} ${y}L${x + r / 2} ${y + 0.87 * r}H${x - r / 2}Z"/>`
            : s.shape === 'camera' ? `<g transform="rotate(${-rotationDeg} ${x} ${y})"><rect x="${x - r}" y="${y - 0.6 * r}" width="${1.3 * r}" height="${1.2 * r}"/><path d="M${x + 0.3 * r} ${y - 0.25 * r}L${x + r} ${y - 0.6 * r}V${y + 0.6 * r}L${x + 0.3 * r} ${y + 0.25 * r}Z"/></g>`
              : `<g transform="rotate(${-rotationDeg} ${x} ${y})"><rect x="${x - r}" y="${y - 0.45 * r}" width="${0.6 * r}" height="${0.9 * r}"/><path d="M${x - 0.4 * r} ${y - 0.45 * r}L${x + 0.6 * r} ${y - r}V${y + r}L${x - 0.4 * r} ${y + 0.45 * r}Z"/></g>`;
  const text = s.shape === 'camera' || s.shape === 'speaker' ? ''
    : `<text x="${x}" y="${y + (s.shape === 'triangle' ? 0.25 * r : 0)}" font-size="${(s.text.length > 1 ? 0.8 : 1.05) * r}" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${ink}" stroke="none">${esc(s.text)}</text>`;
  return `<g fill="${fill}" stroke="#000" stroke-width="${sw}">${shape}${text}</g>`;
}

/** The plan as SVG, metres with y up (flipped for SVG): room outlines and names in grey, devices in black. */
export function planSvg(p: Project, lv: PlanLevel): string {
  const { rooms, x0, x1, y0, y1 } = bounds(p, lv);
  const w = x1 - x0, h = y1 - y0;
  const r = Math.max(w / 370, h / 230) * 1.8; // symbols about 3.6 mm across on an A3 drawing area
  const Y = (y: number) => y1 - y + y0; // flip about the box
  const outline = rooms.map((rm) => `<path d="M${rm.outline!.map(([x, y]) => `${x} ${Y(y)}`).join('L')}Z"/>`).join('');
  const names = rooms.map((rm) => {
    const cx = rm.outline!.reduce((t, q) => t + q[0], 0) / rm.outline!.length, cy = rm.outline!.reduce((t, q) => t + q[1], 0) / rm.outline!.length;
    return `<text x="${cx}" y="${Y(cy) + 2.2 * r}" text-anchor="middle">${esc(rm.name.toUpperCase())}</text>`;
  }).join('');
  const devices = devicesOn(p, lv.buildingId, lv.levelId).map((d) => symbolSvg(ELV_DEVICES[d.type].symbol, d.x, Y(d.y), r, d.rotationDeg ?? 0)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${w} ${h}" font-family="Arial, sans-serif">
  <g fill="none" stroke="#999" stroke-width="${r * 0.12}">${outline}</g>
  <g fill="#777" font-size="${r * 1.1}">${names}</g>
  <g>${devices}</g>
</svg>`;
}

/** The legend: each device type on the level, its symbol and how many per floor. */
export function legendSvg(p: Project, lv: PlanLevel): string {
  const counts = new Map<ElvDeviceType, number>();
  for (const d of devicesOn(p, lv.buildingId, lv.levelId)) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  const types = (Object.keys(ELV_DEVICES) as ElvDeviceType[]).filter((t) => counts.has(t));
  const rowH = 6;
  const rows = types.map((t, i) => `${symbolSvg(ELV_DEVICES[t].symbol, 4, 10 + i * rowH, 2)}<text x="9" y="${11.2 + i * rowH}" font-size="3">${esc(ELV_DEVICES[t].label)}</text><text x="86" y="${11.2 + i * rowH}" font-size="3" text-anchor="end">${counts.get(t)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 ${10 + types.length * rowH}" font-family="Arial, sans-serif">
  <text x="0" y="4" font-size="3.4" font-weight="700">LEGEND · ELV DEVICES PER FLOOR</text>${lv.count > 1 ? `<text x="86" y="4" font-size="3" text-anchor="end">${esc(lv.floors)}</text>` : ''}
  ${rows}
</svg>`;
}

/** Sheet number and title for each level: ELV-101, ELV-102, … */
export function sheetInfo(p: Project, lv: PlanLevel, index: number, count: number, notes: string[] = []): SheetInfo {
  const typical = lv.count > 1 ? `Typical floors ${lv.floors}` : '';
  return {
    no: `ELV-${101 + index}`, title: `${lv.name}${typical ? ` (${typical})` : ''} · ELV layout`, index: index + 1, count, scale: 'NTS',
    legendSvg: legendSvg(p, lv),
    notes: [
      ...(typical ? [`${typical}: this level is drawn once and applies to each of those floors.`] : []),
      'Devices from the ELV design on the floor plan; room outlines from the architect plan. Detector coverage to BS 5839-1 (smoke 7.5 m, heat 5.3 m radius).',
      ...notes
    ]
  };
}

/** Print-ready HTML for one level's A3 sheet. */
export function planSheetHtml(p: Project, lv: PlanLevel, index: number, count: number, notes: string[] = []): string {
  return buildSldSheetHtml(p, planSvg(p, lv), 'A3', sheetInfo(p, lv, index, count, notes));
}

const UNIT_M: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };

/** The units of the architect plan a level's devices were placed on (project.cadPlanUnits, recorded per drawing file):
 * the file of the level's rooms, else the only units the project's plans use, else millimetres. */
export function levelUnits(p: Project, lv: PlanLevel): string {
  const units = p.cadPlanUnits ?? {};
  const file = buildingInfoOf(p).rooms.find((r) => r.buildingId === lv.buildingId && r.levelId === lv.levelId && r.source?.file)?.source?.file;
  const fromFile = file ? units[file.trim().toLowerCase()] : undefined;
  const all = [...new Set(Object.values(units))];
  return fromFile ?? (all.length === 1 ? all[0] : 'mm');
}

/** The level's ELV devices as DXF (AutoCAD R12) in the plan's own units on its origin, so it lies on the architect's
 * drawing: room outlines on A-ELV-ROOMS, each system's symbols on its own layer, each device tagged with its ID. */
export function planDxf(p: Project, lv: PlanLevel, units = levelUnits(p, lv)): string {
  const mm = 1 / (UNIT_M[units] ?? 0.001), r = 0.15 * mm; // symbols 300 mm across: 3 mm on paper at 1:100
  const items: DxfPrimitive[] = [];
  for (const rm of bounds(p, lv).rooms) {
    items.push({ type: 'polyline', layer: 'A-ELV-ROOMS', points: rm.outline!.map(([x, y]): Pt => [x * mm, y * mm]), closed: true });
    const cx = rm.outline!.reduce((t, q) => t + q[0], 0) / rm.outline!.length, cy = rm.outline!.reduce((t, q) => t + q[1], 0) / rm.outline!.length;
    items.push({ type: 'text', layer: 'A-ELV-ROOMS', x: cx * mm, y: cy * mm - 3 * r, height: r, text: rm.name.toUpperCase(), align: 'center' });
  }
  for (const d of devicesOn(p, lv.buildingId, lv.levelId)) {
    const spec = ELV_DEVICES[d.type], layer = SYSTEM_LAYER[spec.system], x = d.x * mm, y = d.y * mm, tag = `elv:${d.id}`;
    const turn = (pts: Pt[]): Pt[] => { const a = ((d.rotationDeg ?? 0) * Math.PI) / 180; return pts.map(([u, v]) => [x + u * Math.cos(a) - v * Math.sin(a), y + u * Math.sin(a) + v * Math.cos(a)]); };
    const s = spec.symbol.shape;
    if (s === 'circle') items.push({ type: 'circle', layer, x, y, r, tag });
    else if (s === 'square') items.push({ type: 'polyline', layer, points: [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], closed: true, tag });
    else if (s === 'triangle') items.push({ type: 'polyline', layer, points: [[x, y + 1.1 * r], [x + 1.1 * r, y - 0.9 * r], [x - 1.1 * r, y - 0.9 * r]], closed: true, tag });
    else if (s === 'diamond') items.push({ type: 'polyline', layer, points: [[x, y + 1.1 * r], [x + 1.1 * r, y], [x, y - 1.1 * r], [x - 1.1 * r, y]], closed: true, tag });
    else if (s === 'hexagon') items.push({ type: 'polyline', layer, points: [0, 1, 2, 3, 4, 5].map((i): Pt => [x + r * Math.cos((Math.PI / 3) * i), y + r * Math.sin((Math.PI / 3) * i)]), closed: true, tag });
    else if (s === 'camera') items.push({ type: 'polyline', layer, points: turn([[-r, -0.6 * r], [0.3 * r, -0.6 * r], [0.3 * r, -0.25 * r], [r, -0.6 * r], [r, 0.6 * r], [0.3 * r, 0.25 * r], [0.3 * r, 0.6 * r], [-r, 0.6 * r]]), closed: true, tag });
    else items.push({ type: 'polyline', layer, points: turn([[-r, -0.45 * r], [-0.4 * r, -0.45 * r], [0.6 * r, -r], [0.6 * r, r], [-0.4 * r, 0.45 * r], [-r, 0.45 * r]]), closed: true, tag });
    if (s !== 'camera' && s !== 'speaker') items.push({ type: 'text', layer, x, y: y - 0.35 * r, height: 0.7 * r, text: spec.symbol.text, align: 'center', tag });
  }
  return toDxf(items, { 'A-ELV-ROOMS': 8, 'E-ELV-FA': 1, 'E-ELV-CCTV': 5, 'E-ELV-ACS': 3, 'E-ELV-ICT': 4, 'E-ELV-PA': 6 });
}
