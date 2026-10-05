import { newProject, type Project } from '../types';
import { applyDefaults, type Preferences } from './profile';
import { SYSTEM_LABEL, type SetupTemplate } from './setupTemplate';
import { applyParameters, type Database } from '../database/database';

/** What a new project will start with, and where each value comes from: the app's built-in default, the company
 * database (Parameters.xlsx), or your profile and design defaults. Shown in the New project wizard before creating. */
export type DefaultSource = 'built-in' | 'company database' | 'your profile' | 'setup template';
export interface DefaultRow { label: string; value: string; source: DefaultSource }

const show = (v: unknown): string => (v === undefined || v === null || v === '' ? '—' : String(v));

export function defaultsPreview(db: Database, prefs: Preferences): DefaultRow[] {
  const base = newProject('x');
  const afterDb = applyParameters(base, db);
  const final = applyDefaults(afterDb, prefs);
  const rows: [string, (p: Project) => unknown][] = [
    ['System voltage (V)', (p) => p.voltageV], ['Frequency (Hz)', (p) => p.frequencyHz], ['Ambient temperature (°C)', (p) => p.ambientC], ['Voltage drop limit (%)', (p) => p.vdLimitPct],
    ['Load schedule columns', (p) => p.pointTemplate], ['Drawing sheet', (p) => p.drawing?.sheet], ['Symbols', (p) => p.drawing?.symbols],
    ['Company (title block)', (p) => p.drawing?.company], ['Drawn by', (p) => p.drawing?.drawnBy], ['Checked by', (p) => p.drawing?.checkedBy],
    ['Calculations run automatically', (p) => (p.calc?.autoRun ? 'yes' : 'on Run (F5)')]
  ];
  return rows.map(([label, get]) => {
    const a = JSON.stringify(get(base) ?? null), b = JSON.stringify(get(afterDb) ?? null), c = JSON.stringify(get(final) ?? null);
    return { label, value: show(get(final)), source: c !== b ? 'your profile' : b !== a ? 'company database' : 'built-in' };
  });
}

/** The same rows with a setup template applied: where the template sets a value, it replaces the default and is shown as its source. */
export function withTemplate(rows: DefaultRow[], t?: SetupTemplate): DefaultRow[] {
  if (!t) return rows;
  return rows.map((r) => {
    const k = (Object.keys(SYSTEM_LABEL) as (keyof typeof SYSTEM_LABEL)[]).find((x) => SYSTEM_LABEL[x] === r.label);
    const v = k && t.system[k];
    return typeof v === 'number' ? { ...r, value: String(v), source: 'setup template' as const } : r;
  });
}
