import { areaLoad, usesOf } from '../calc/spacePlan';
import type { SpaceArea, SpacePlan } from '../types';
import { cellName, parsePositive, STYLE, type SheetEdit, type SheetModel } from './sheet';

/** The space plan's areas as an Excel-style sheet (paste an area schedule
 * straight from Excel). Blank rows at the end take new areas. */

type Key = 'building' | 'floor' | 'name' | 'use' | 'areaM2' | 'wPerM2' | 'kw' | 'df' | 'panel' | 'connected' | 'demand';
const KEYS: Key[] = ['building', 'floor', 'name', 'use', 'areaM2', 'wPerM2', 'kw', 'df', 'panel', 'connected', 'demand'];
const INPUT = new Set<Key>(['building', 'floor', 'name', 'use', 'areaM2', 'wPerM2', 'kw', 'df', 'panel']);
export const SPARE_ROWS = 8;

export interface PlanSheet extends SheetModel {
  keys: Key[];
  rows: (SpaceArea | undefined)[]; // undefined = a blank row for a new area
}

export function buildPlanSheet(plan: SpacePlan): PlanSheet {
  const uses = usesOf(plan);
  const useLabel = (id: string) => uses.find((u) => u.id === id)?.label ?? id;
  const rows: (SpaceArea | undefined)[] = [...plan.areas, ...Array.from({ length: SPARE_ROWS }, () => undefined)];
  const data = rows.map((a) => {
    if (!a) return KEYS.map(() => '');
    const l = areaLoad(plan, a);
    return [
      a.building, a.floor ?? '', a.name, useLabel(a.use), a.areaM2 ?? '',
      a.wPerM2 ?? '', a.kw ?? '', a.demandFactor ?? '', a.panel ?? '',
      l.connectedKw.toFixed(1), l.demandKw.toFixed(1)
    ];
  });
  const at = (k: Key) => KEYS.indexOf(k);
  const editable = (_y: number, x: number) => INPUT.has(KEYS[x]);
  const styles: Record<string, string> = {};
  rows.forEach((a, y) => KEYS.forEach((k, x) => {
    styles[cellName(x, y)] = INPUT.has(k) ? (a ? STYLE.input : 'background-color:#fbfcfe') : STYLE.calc;
  }));
  // Defaults shown as placeholders would need per-cell rendering; the
  // computed columns show what is used.
  const totals = KEYS.map(() => '');
  const sum = (f: (a: SpaceArea) => number) => plan.areas.reduce((s, a) => s + f(a), 0);
  totals[at('name')] = 'TOTAL';
  totals[at('areaM2')] = sum((a) => a.areaM2 ?? 0).toFixed(0);
  totals[at('connected')] = sum((a) => areaLoad(plan, a).connectedKw).toFixed(1);
  totals[at('demand')] = sum((a) => areaLoad(plan, a).demandKw).toFixed(1);
  const panels = plan.panels.map((p) => p.id);
  return {
    keys: KEYS,
    rows,
    data,
    merges: {},
    groups: [{ title: 'WHERE', colspan: 3 }, { title: 'LOAD', colspan: 5 }, { title: '', colspan: 1 }, { title: 'CALCULATED (kW)', colspan: 2 }],
    totals,
    styles,
    editable,
    freezeColumns: 3,
    shape: JSON.stringify([rows.length, panels, uses.map((u) => u.id)]),
    cols: [
      { title: 'BUILDING', width: 120, input: true, align: 'left' },
      { title: 'FLOOR', width: 70, input: true },
      { title: 'AREA / ZONE', width: 150, input: true, align: 'left' },
      { title: 'USE', width: 170, input: true, source: uses.map((u) => u.label), align: 'left' },
      { title: 'AREA (m²)', width: 80, input: true },
      { title: 'W/m² (blank = use type)', width: 90, input: true },
      { title: 'SPECIFIC LOAD (kW)', width: 90, input: true },
      { title: 'DEMAND FACTOR (blank = use type)', width: 100, input: true },
      { title: 'FED FROM PANEL', width: 120, input: true, source: ['', ...panels] },
      { title: 'CONNECTED', width: 85, input: false },
      { title: 'DEMAND', width: 85, input: false }
    ]
  };
}

/** Applies typed / pasted values. Typing in a blank row adds an area. */
export function applyPlanEdits(plan: SpacePlan, sheet: PlanSheet, edits: SheetEdit[]): { plan: SpacePlan; rejected: string[] } {
  const uses = usesOf(plan);
  const rejected: string[] = [];
  const areas = [...plan.areas];
  const added = new Map<number, SpaceArea>();
  let n = areas.length;
  const nextId = () => {
    let id = `A${++n}`;
    while (areas.some((a) => a.id === id) || [...added.values()].some((a) => a.id === id)) id = `A${++n}`;
    return id;
  };
  for (const e of edits) {
    const k = sheet.keys[e.x];
    if (!k || !INPUT.has(k)) continue;
    const v = String(e.value ?? '').trim();
    let a = sheet.rows[e.y] ? areas.find((x) => x.id === sheet.rows[e.y]!.id) : added.get(e.y);
    if (!a) {
      if (!v) continue;
      a = { id: nextId(), building: '', name: '', use: uses[0]?.id ?? 'residential' };
      added.set(e.y, a);
    }
    const i = areas.indexOf(a);
    const next: SpaceArea = { ...a };
    const num = (label: string, allowBlank = true) => {
      if (v === '' && allowBlank) return undefined;
      const x = parsePositive(v) ?? (v === '0' ? 0 : null);
      if (x === null) rejected.push(`${cellName(e.x, e.y)}: "${v}" is not ${label}`);
      return x;
    };
    if (k === 'building') next.building = v;
    else if (k === 'floor') next.floor = v || undefined;
    else if (k === 'name') next.name = v;
    else if (k === 'use') {
      const u = uses.find((x) => x.label.toLowerCase() === v.toLowerCase() || x.id === v.toLowerCase());
      if (u) next.use = u.id;
      else if (v) rejected.push(`${cellName(e.x, e.y)}: "${v}" is not a use type`);
    } else if (k === 'panel') next.panel = v || undefined;
    else {
      const x = num(k === 'df' ? 'a demand factor' : k === 'areaM2' ? 'an area in m²' : k === 'wPerM2' ? 'W/m²' : 'kW');
      if (x === null) continue;
      if (k === 'df' && x !== undefined && x > 1) { rejected.push(`${cellName(e.x, e.y)}: demand factor ${v} is above 1`); continue; }
      if (k === 'areaM2') next.areaM2 = x;
      if (k === 'wPerM2') next.wPerM2 = x;
      if (k === 'kw') next.kw = x;
      if (k === 'df') next.demandFactor = x;
    }
    for (const key of Object.keys(next) as (keyof SpaceArea)[]) if (next[key] === undefined) delete next[key];
    if (i >= 0) areas[i] = next;
    else added.set(e.y, next);
  }
  return { plan: { ...plan, areas: [...areas, ...[...added.entries()].sort(([a], [b]) => a - b).map(([, a]) => a)] }, rejected };
}
