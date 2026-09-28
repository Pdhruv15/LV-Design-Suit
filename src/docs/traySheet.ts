import { cableSizeText } from '../calc/electrical';
import { ensureRoutes, joinPath, routeNames, trayPlanOf } from '../calc/cableTray';
import type { CableOd, Feeder, Project } from '../types';
import { cellName, parsePositive, STYLE, type SheetEdit, type SheetModel } from './sheet';

/** Cable outer diameters and weights as an Excel-style sheet: one row per
 * size, OD and kg/m for 1C–4C (paste a manufacturer's table straight in).
 * Blank rows at the end take new sizes. */

const CORES = [1, 2, 3, 4];
const SPARE_ROWS = 3;

export interface OdSheet extends SheetModel {
  sizes: (number | undefined)[];
}

/** Column x (1…8) → cores and field. */
const colOf = (x: number) => ({ cores: CORES[Math.floor((x - 1) / 2)], field: (x - 1) % 2 === 0 ? 'odMm' as const : 'kgPerM' as const });

export function buildOdSheet(ods: CableOd[]): OdSheet {
  const sizes: (number | undefined)[] = [...[...new Set(ods.map((o) => o.csaMm2))].sort((a, b) => a - b), ...Array(SPARE_ROWS).fill(undefined)];
  const data = sizes.map((csa) => [
    csa ?? '',
    ...CORES.flatMap((c) => {
      const o = csa === undefined ? undefined : ods.find((x) => x.cores === c && x.csaMm2 === csa);
      return [o?.odMm || '', o?.kgPerM || ''];
    })
  ]);
  const styles: Record<string, string> = {};
  sizes.forEach((csa, y) => { for (let x = 0; x < 9; x++) styles[cellName(x, y)] = x === 0 && csa !== undefined ? STYLE.label : STYLE.input; });
  return {
    sizes,
    data,
    merges: {},
    groups: [{ title: '', colspan: 1 }, ...CORES.map((c) => ({ title: c === 1 ? '1C (earth)' : `${c}C`, colspan: 2 }))],
    styles,
    editable: () => true,
    shape: JSON.stringify(sizes),
    cols: [
      { title: 'SIZE (mm²)', width: 80, input: true },
      ...CORES.flatMap(() => [{ title: 'OD (mm)', width: 70, input: true }, { title: 'kg/m', width: 60, input: true }])
    ]
  };
}

/** Applies typed or pasted values; returns the same array when nothing changed. */
export function applyOdEdits(ods: CableOd[], sheet: OdSheet, edits: SheetEdit[]): { ods: CableOd[]; rejected: string[] } {
  let out = ods.map((o) => ({ ...o }));
  const rejected: string[] = [];
  const sizes = [...sheet.sizes];
  let changed = false;
  // Size column first, so a pasted new row gets its size before its values.
  const ordered = [...edits].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const e of ordered) {
    const raw = String(e.value).trim();
    if (e.x === 0) {
      const old = sizes[e.y];
      if (raw === '') {
        if (old !== undefined) { out = out.filter((o) => o.csaMm2 !== old); sizes[e.y] = undefined; changed = true; }
        continue;
      }
      const v = parsePositive(raw);
      if (v === null) { rejected.push(`${raw} is not a size`); continue; }
      if (v === old) continue;
      if (sizes.includes(v)) { rejected.push(`${v} mm² is already in the table`); continue; }
      if (old !== undefined) out = out.map((o) => (o.csaMm2 === old ? { ...o, csaMm2: v } : o));
      // A new size keeps its row until its diameters are entered (0 = not given).
      else out.push(...CORES.map((cores) => ({ cores, csaMm2: v, odMm: 0, kgPerM: 0 })));
      sizes[e.y] = v;
      changed = true;
      continue;
    }
    const csa = sizes[e.y];
    if (csa === undefined) { if (raw) rejected.push('enter the size first'); continue; }
    const { cores, field } = colOf(e.x);
    const i = out.findIndex((o) => o.cores === cores && o.csaMm2 === csa);
    if (raw === '') {
      if (i >= 0 && out[i][field]) { out[i] = { ...out[i], [field]: 0 }; changed = true; }
      continue;
    }
    const v = parsePositive(raw);
    if (v === null) { rejected.push(`${raw} is not a number`); continue; }
    if (i >= 0) {
      if (out[i][field] !== v) { out[i] = { ...out[i], [field]: v }; changed = true; }
    } else {
      out.push({ cores, csaMm2: csa, odMm: field === 'odMm' ? v : 0, kgPerM: field === 'kgPerM' ? v : 0 });
      changed = true;
    }
  }
  return { ods: changed ? out.sort((a, b) => a.cores - b.cores || a.csaMm2 - b.csaMm2) : ods, rejected };
}

/** Cable routing: one row per SLD cable with its route path ("A-B-C"),
 * typed, pasted or filled down like Excel. The cable then appears on
 * every route of its path; unknown route names create the route. */
export interface RoutingSheet extends SheetModel {
  feeders: Feeder[];
}

export function buildRoutingSheet(project: Project, feeders: Feeder[]): RoutingSheet {
  const plan = trayPlanOf(project);
  const known = new Set(plan.routes.map((r) => r.name.toUpperCase()));
  const data = feeders.map((f) => {
    const names = routeNames(f.trayRoute);
    const legacy = plan.routes.filter((r) => !names.includes(r.name.toUpperCase()) && r.cables.some((c) => c.feederId === f.id)).map((r) => r.name);
    const all = [...names, ...legacy];
    return [
      f.id, f.boardId, f.feedsBoardId ?? f.name, cableSizeText(f), f.lengthM,
      f.trayRoute ?? (legacy.length ? joinPath(legacy) : ''),
      all.length ? (all.every((n) => known.has(n.toUpperCase())) ? `${all.length} route${all.length === 1 ? '' : 's'}` : 'new route') : 'not on a tray'
    ];
  });
  const styles: Record<string, string> = {};
  feeders.forEach((f, y) => {
    for (let x = 0; x < 7; x++) styles[cellName(x, y)] = x === 5 ? STYLE.input : x === 6 && data[y][6] === 'not on a tray' ? STYLE.highlight : x === 0 ? STYLE.label : STYLE.calc;
  });
  return {
    feeders,
    data,
    merges: {},
    groups: [{ title: '', colspan: 7 }],
    styles,
    editable: (_y, x) => x === 5,
    shape: JSON.stringify(feeders.map((f) => f.id)),
    freezeColumns: 1,
    cols: [
      { title: 'CABLE TAG', width: 110, input: false, align: 'left' },
      { title: 'FROM (PANEL)', width: 100, input: false, align: 'left' },
      { title: 'TO', width: 170, input: false, align: 'left' },
      { title: 'CABLE', width: 130, input: false, align: 'left' },
      { title: 'LENGTH (m)', width: 70, input: false },
      { title: 'TRAY ROUTE PATH (e.g. A-B-C)', width: 170, input: true, align: 'left' },
      { title: 'ON TRAYS', width: 100, input: false }
    ]
  };
}

export function applyRoutingEdits(project: Project, sheet: RoutingSheet, edits: SheetEdit[]): { project: Project; rejected: string[]; created: string[] } {
  const paths = new Map<string, string | undefined>();
  for (const e of edits) {
    if (e.x !== 5) continue;
    const f = sheet.feeders[e.y];
    if (!f) continue;
    paths.set(f.id, joinPath(routeNames(String(e.value))) || undefined);
  }
  if (!paths.size) return { project, rejected: [], created: [] };
  const plan = trayPlanOf(project);
  const next: Project = {
    ...project,
    feeders: project.feeders.map((f) => (paths.has(f.id) ? { ...f, trayRoute: paths.get(f.id) } : f)),
    // The path now says where the cable runs: drop old route entries that
    // it no longer names (overrides of routes still on the path are kept).
    trays: {
      ...plan,
      routes: plan.routes.map((r) => ({
        ...r,
        cables: r.cables.filter((c) => !c.feederId || !paths.has(c.feederId) || routeNames(paths.get(c.feederId)).includes(r.name.toUpperCase()))
      }))
    }
  };
  const { project: withRoutes, created } = ensureRoutes(next);
  return { project: withRoutes, rejected: [], created };
}
