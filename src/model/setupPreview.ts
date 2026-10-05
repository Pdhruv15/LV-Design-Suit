import { newProject, type Project } from '../types';
import { applyDefaults, type Preferences } from './profile';
import { applyParameters, type Database } from '../database/database';

/** What a new project will start with, and where each value comes from: the app's built-in default, the company
 * database (Parameters.xlsx), or your profile and design defaults. Shown in the New project wizard before creating. */
export type DefaultSource = 'built-in' | 'company database' | 'your profile';
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
