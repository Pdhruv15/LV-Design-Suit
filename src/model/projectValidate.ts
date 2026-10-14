import type { Project } from '../types';
import type { MainView } from '../views';

/** Checks on project data at the loading boundary and on the engineering inputs.
 *
 * Two levels, so that a file with a bad value still opens and can be fixed:
 * - checkProjectShape: what the app needs to open the file at all (boards and circuits with ids). A file that fails
 *   is not opened, and the message says what is wrong.
 * - projectInputIssues: numbers the calculations divide by or derate with (voltage, power factor, breaker rating…)
 *   that are missing, not finite or physically impossible. They are listed in the To do list as failures, naming
 *   the panel or circuit and the input. */

export class ProjectFileError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown) => typeof v === 'string' && v.trim() !== '';

/** The project, when the data has the structure the app needs; otherwise a ProjectFileError naming the problem. */
export function checkProjectShape(raw: unknown, name = 'The file'): Project {
  const fail = (why: string): never => { throw new ProjectFileError(`${name} is not a valid LV Design Studio project: ${why}.`); };
  if (!isObj(raw)) return fail('it does not contain a project');
  if (!Array.isArray(raw.boards)) return fail('the list of panels (boards) is missing');
  if (!Array.isArray(raw.feeders)) return fail('the list of circuits (feeders) is missing');
  raw.boards.forEach((b, i) => { if (!isObj(b) || !isId(b.id)) fail(`panel ${i + 1} has no name (id)`); });
  raw.feeders.forEach((f, i) => {
    if (!isObj(f) || !isId(f.id)) fail(`circuit ${i + 1} has no id`);
    else if (!isId(f.boardId)) fail(`circuit ${String(f.id)} does not say which panel it is on`);
  });
  return raw as unknown as Project;
}

export interface InputIssue { status: 'bad' | 'warn'; text: string; go?: { view: MainView; boardId?: string; feederId?: string } }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const show = (v: unknown) => (v === undefined ? 'missing' : v === null ? 'blank' : String(v));

/** Engineering inputs that cannot give a valid result. Empty for a sound project. */
export function projectInputIssues(p: Project): InputIssue[] {
  const out: InputIssue[] = [];
  const proj: string[] = [];
  if (!fin(p.voltageV) || p.voltageV <= 0) proj.push(`system voltage ${show(p.voltageV)} V (must be above 0)`);
  if (!fin(p.frequencyHz) || p.frequencyHz <= 0) proj.push(`frequency ${show(p.frequencyHz)} Hz (must be above 0)`);
  if (!fin(p.vdLimitPct) || p.vdLimitPct <= 0) proj.push(`voltage drop limit ${show(p.vdLimitPct)} % (must be above 0)`);
  if (p.vdTempC !== undefined && !fin(p.vdTempC)) proj.push(`conductor temperature ${show(p.vdTempC)} °C (not a number)`);
  if (proj.length) out.push({ status: 'bad', text: `Project settings: ${proj.join('; ')}` });

  for (const b of p.boards) {
    const bad: string[] = [];
    const pos = (v: number | undefined, label: string, unit: string) => { if (v !== undefined && v !== null && (!fin(v) || v <= 0)) bad.push(`${label} ${show(v)}${unit} (must be above 0)`); };
    pos(b.sourceKva, 'transformer rating', ' kVA');
    pos(b.sourceImpedancePct, 'transformer impedance', ' %');
    pos(b.sourceXr, 'transformer X/R', '');
    if (bad.length) out.push({ status: 'bad', text: `Panel ${b.id}: ${bad.join('; ')}`, go: { view: 'sizing' } });
    else if (fin(b.sourceImpedancePct) && b.sourceImpedancePct > 20) out.push({ status: 'warn', text: `Panel ${b.id}: transformer impedance ${b.sourceImpedancePct} % is unusually high — check the value`, go: { view: 'sizing' } });
  }

  for (const f of p.feeders) {
    const bad: string[] = [];
    const need = (ok: boolean, label: string, v: unknown, rule: string) => { if (!ok) bad.push(`${label} ${show(v)} (${rule})`); };
    const isLoad = !f.feedsBoardId && !f.kvar;
    if (!f.feedsBoardId) {
      need(fin(f.loadKw) && f.loadKw >= 0, 'load kW', f.loadKw, '0 or more');
      need(fin(f.demandFactor) && f.demandFactor >= 0 && f.demandFactor <= 1, 'demand factor', f.demandFactor, '0 to 1');
    }
    if (isLoad) need(fin(f.powerFactor) && f.powerFactor > 0 && f.powerFactor <= 1, 'power factor', f.powerFactor, 'above 0, at most 1');
    if (f.kvar !== undefined) need(fin(f.kvar) && f.kvar >= 0, 'capacitor kvar', f.kvar, '0 or more');
    need(fin(f.lengthM) && f.lengthM >= 0, 'cable length m', f.lengthM, '0 or more');
    need(fin(f.cableCsaMm2) && f.cableCsaMm2 > 0, 'cable size mm²', f.cableCsaMm2, 'above 0');
    if (f.cpcMm2 !== undefined) need(fin(f.cpcMm2) && f.cpcMm2 > 0, 'earth conductor mm²', f.cpcMm2, 'above 0');
    if (f.parallel !== undefined) need(fin(f.parallel) && f.parallel >= 1 && Number.isInteger(f.parallel), 'parallel runs', f.parallel, 'a whole number, 1 or more');
    need([2, 3, 4].includes(f.cores), 'cores', f.cores, '2, 3 or 4');
    need(fin(f.breakerRatingA) && f.breakerRatingA > 0, 'breaker rating A', f.breakerRatingA, 'above 0');
    need(fin(f.breakerIcuKa) && f.breakerIcuKa > 0, 'breaker Icu kA', f.breakerIcuKa, 'above 0');
    if (bad.length) out.push({ status: 'bad', text: `Circuit ${f.id}: ${bad.join('; ')}`, go: { view: 'design', feederId: f.id } });
  }
  return out;
}
