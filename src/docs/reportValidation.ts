import type { FeederResult } from '../calc/electrical';
import { settingsOf, STUDY_DEFAULTS, type Project } from '../types';
import { buildResults } from './compliance';
import { missingFields, reportDoc, type ReportMeta } from './reportFrame';
import type { CalcData, Scope, Section } from './studyReport';

/** Pre-export validation of the design report. Nothing here changes the
 * report or the project: it lists what is missing, failed or inconsistent so
 * the user sees it before issuing. Errors are not hidden — the export asks
 * for confirmation while any remain. */

export type IssueLevel = 'error' | 'warning' | 'info';
export interface ReportIssue { level: IssueLevel; area: string; message: string }

export interface ValidationInput {
  project: Project;
  meta: ReportMeta;
  scope: Scope;
  sections: Section[];
  data?: CalcData;
  /** What changed since the last calculation run (empty = up to date). */
  stale: string[];
  designBasis: boolean;
  resultsSummary: boolean;
}

const SETTING_LABEL: Partial<Record<keyof typeof STUDY_DEFAULTS, string>> = { pfTarget: 'power factor target', futureGrowthPct: 'future growth', transformerMaxLoadingPct: 'transformer design loading', generatorMaxLoadingPct: 'generator design loading' };

export function validateReport(v: ValidationInput): ReportIssue[] {
  const out: ReportIssue[] = [];
  const add = (level: IssueLevel, area: string, message: string) => out.push({ level, area, message });
  const p = v.project;

  // Calculations
  if (!v.data) add('error', 'Calculations', 'The calculations have not been run (F5). The report has no results.');
  else if (v.stale.length) add('error', 'Calculations', `The results are out of date: ${v.stale.slice(0, 5).join(', ')}${v.stale.length > 5 ? ' …' : ''}. Run (F5) before issuing.`);

  // Project and document data
  const gaps = missingFields(reportDoc(p, v.meta));
  if (gaps.length) add('warning', 'Project data', `Shown as "Not defined": ${gaps.join(', ')}.`);
  if (!v.scope.boards.length) add('error', 'Scope', 'No board is in the report scope.');
  if (!v.sections.length) add('error', 'Sections', 'No study is selected.');

  // Design criteria
  const own = p.studySettings ?? {};
  const defaults = (Object.keys(STUDY_DEFAULTS) as (keyof typeof STUDY_DEFAULTS)[]).filter((k) => own[k] === undefined && ['pfTarget', 'futureGrowthPct', 'transformerMaxLoadingPct', 'generatorMaxLoadingPct'].includes(k));
  if (defaults.length) add('warning', 'Design criteria', `App defaults used (not set for the project): ${defaults.map((k) => SETTING_LABEL[k] ?? k).join(', ')}.`);
  if (v.designBasis && !(p.standards ?? []).length) add('warning', 'Design criteria', 'No project standards or specifications are listed (Output tab).');
  if (v.designBasis && !p.brief?.scope.length) add('info', 'Design criteria', 'The project scope (brief) is not defined; the scope section says so.');
  if (!(p.voltageV > 0) || !(p.frequencyHz > 0) || !(p.vdLimitPct > 0)) add('error', 'Design criteria', 'System voltage, frequency or voltage drop limit is missing or zero.');

  // Results: failures, warnings, invalid numbers
  for (const s of v.sections) {
    const bad = s.statuses.filter((x) => x === 'bad').length, warn = s.statuses.filter((x) => x === 'warn').length;
    if (bad) add('error', 'Failed calculations', `${s.title}: ${bad} check(s) FAIL.`);
    if (warn) add('warning', 'Warnings', `${s.title}: ${warn} check(s) WARNING.`);
    // Empty / broken tables
    const shown = s.tables.filter((t) => t.rows.length);
    if (!shown.length && !s.verification?.rows.length && !s.cards?.length) add('warning', 'Empty sections', `${s.title}: nothing in scope — the section has no results.`);
    for (const t of [...s.tables, ...(s.verification ? [s.verification] : [])]) {
      if (t.rows.some((r) => r.length !== t.headers.length)) add('error', 'Broken tables', `${s.title} — ${t.title ?? 'table'}: a row has a different number of cells from the headings.`);
      if (t.rows.some((r) => r.some((c) => (typeof c === 'number' && !Number.isFinite(c)) || (typeof c === 'string' && /\b(NaN|Infinity|undefined)\b/.test(c))))) add('error', 'Invalid results', `${s.title} — ${t.title ?? 'table'}: a value is not a number (NaN / Infinity).`);
    }
  }
  if (v.data) {
    const invalid = v.data.results.filter((r: FeederResult) => ![r.ib, r.ampacity, r.vdTotalPct, r.breakerFaultKA].every(Number.isFinite));
    if (invalid.length) add('error', 'Invalid results', `No valid result for ${invalid.length} circuit(s): ${invalid.slice(0, 6).map((r) => r.feeder.id).join(', ')}${invalid.length > 6 ? ' …' : ''}.`);
    if (v.resultsSummary) for (const c of buildResults(v.data, v.scope).compliance.filter((x) => x.status === 'data')) add('warning', 'Undefined equipment', `${c.check} — ${c.item}: ${c.requirement}.`);
  }

  // Units and references
  const ids = new Set(p.boards.map((b) => b.id));
  const orphan = p.feeders.filter((f) => !ids.has(f.boardId) || (f.feedsBoardId && !ids.has(f.feedsBoardId)));
  if (orphan.length) add('error', 'Missing references', `Circuits on or to a board that does not exist: ${orphan.slice(0, 6).map((f) => f.id).join(', ')}.`);
  const parent = p.boards.filter((b) => b.upstreamId && !ids.has(b.upstreamId));
  if (parent.length) add('error', 'Missing references', `Boards fed from a board that does not exist: ${parent.map((b) => b.id).join(', ')}.`);
  const units = p.feeders.filter((f) => !(f.lengthM >= 0) || !(f.breakerRatingA > 0) || !(f.powerFactor > 0 && f.powerFactor <= 1) || !(f.demandFactor >= 0 && f.demandFactor <= 1.5));
  if (units.length) add('warning', 'Inconsistent units', `Implausible length, rating, power factor or demand factor on: ${units.slice(0, 6).map((f) => f.id).join(', ')}${units.length > 6 ? ' …' : ''}.`);
  const set = settingsOf(p);
  if (set.pfTarget > 1 || set.pfTarget < 0.5) add('warning', 'Inconsistent units', `Power factor target ${set.pfTarget} is outside 0.5–1.`);

  return out;
}

export const issueCounts = (xs: ReportIssue[]) => ({ error: xs.filter((x) => x.level === 'error').length, warning: xs.filter((x) => x.level === 'warning').length, info: xs.filter((x) => x.level === 'info').length });
