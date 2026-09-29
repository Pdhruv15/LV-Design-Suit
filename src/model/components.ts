import type { Feeder, LoadType, Project, StarterType } from '../types';
import { evaluate, fillParams } from './params';
import type { FeederPreset } from './presets';

/** Your own equipment: inputs (numbers you set per copy, e.g. kW), results
 * worked out by formulas from the inputs (e.g. Current = kW × 1000 ÷ (√3 ×
 * Voltage × PF)), how it's wired (load type, poles, starter, cable), the
 * symbol it uses and the label printed on the SLD. Dragged from the palette
 * like a preset; editing the component updates every copy. */

export interface CompField { name: string; value?: number; formula?: string; unit?: string }

export interface UserComponent {
  id: string;
  name: string;
  loadType: LoadType; // decides the SLD symbol
  poles: 1 | 3;
  starter?: StarterType;
  cableType?: string;
  essential?: boolean;
  /** Inputs: kW and PF are required (they size the circuit); add your own. */
  inputs: CompField[];
  /** Results: formulas over the inputs, Voltage, and earlier results. */
  results: CompField[];
  /** Printed on the SLD under the load, e.g. "{Name} {kW} kW {Starter}". */
  label: string;
  brand?: string;
  model?: string;
  notes?: string;
}

export const newComponent = (id: string): UserComponent => ({
  id, name: 'AHU type A', loadType: 'hvac', poles: 3,
  inputs: [{ name: 'kW', value: 22, unit: 'kW' }, { name: 'PF', value: 0.85 }, { name: 'DF', value: 1 }],
  results: [
    { name: 'Current', formula: 'kW * 1000 / (sqrt(3) * Voltage * PF)', unit: 'A' },
    { name: 'kVA', formula: 'kW / PF', unit: 'kVA' }
  ],
  label: '{Name} · {kW} kW · {Current} A'
});

/** Inputs (with a copy's own values) and results for one copy. */
export function componentValues(c: UserComponent, voltageV: number, own: Record<string, number> = {}): { values: Record<string, number>; errors: string[] } {
  const values: Record<string, number> = { Voltage: voltageV };
  for (const f of c.inputs) values[f.name] = own[f.name] ?? f.value ?? 0;
  const errors: string[] = [];
  for (const r of c.results) {
    try { values[r.name] = evaluate(r.formula ?? '0', values); } catch (e) { values[r.name] = NaN; errors.push(`${r.name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { values, errors };
}

const num = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$|(\.\d*?)0+$/, '$1') : '?');

/** The SLD label of a copy. */
export function componentLabel(p: Project, c: UserComponent, f: Feeder): string {
  const { values } = componentValues(c, p.voltageV, f.componentValues);
  const extra: Record<string, string> = { Name: f.name, Component: c.name, Starter: c.starter ?? 'DOL', Brand: c.brand ?? '', Model: c.model ?? '' };
  for (const [k, v] of Object.entries(values)) extra[k] = num(v);
  return fillParams(c.label, p, extra);
}

/** As a feeder preset, so dropping it reuses the preset path (breaker and cable sized). */
export function componentPreset(p: Project, c: UserComponent): FeederPreset {
  const { values } = componentValues(c, p.voltageV);
  return {
    id: `cmp-${c.id}`, name: c.name, kind: 'load', loadType: c.loadType, loadName: c.name,
    loadKw: values.kW ?? 1, powerFactor: values.PF ?? 0.9, demandFactor: values.DF ?? 1,
    singlePhase: c.poles === 1 || undefined, starter: c.starter, essential: c.essential || undefined, cableType: c.cableType
  };
}

/** After editing a component: every copy takes its kW / PF / DF, type and starter. */
export function syncComponent(p: Project, c: UserComponent): { project: Project; updated: number } {
  let updated = 0;
  const feeders = p.feeders.map((f) => {
    if (f.componentId !== c.id) return f;
    updated++;
    const { values } = componentValues(c, p.voltageV, f.componentValues);
    return {
      ...f, loadType: c.loadType, starter: c.starter, loadKw: values.kW ?? f.loadKw, powerFactor: values.PF ?? f.powerFactor,
      demandFactor: values.DF ?? f.demandFactor, ...(c.cableType ? { cableType: c.cableType } : {}), ...(c.essential ? { essential: true } : {})
    };
  });
  return { project: updated ? { ...p, feeders } : p, updated };
}

const LIB = 'lvds.components';
export function loadComponentLibrary(): UserComponent[] {
  try { const v = JSON.parse(localStorage.getItem(LIB) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveComponentLibrary(list: UserComponent[]): boolean {
  try { localStorage.setItem(LIB, JSON.stringify(list)); return true; } catch { return false; }
}
