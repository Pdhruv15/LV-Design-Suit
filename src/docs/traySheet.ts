import type { CableOd } from '../types';
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
