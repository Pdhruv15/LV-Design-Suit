import { cableDataStatus, type CableSource } from '../calc/cableTable';
import { resistanceFactor, type Status } from '../calc/electrical';
import { checkReferences } from '../model/integrity';
import { CURRENT_SCHEMA } from '../model/projectMigrate';
import { projectInputIssues } from '../model/projectValidate';
import type { Project } from '../types';
import pkg from '../../package.json';
import { esc } from './report';

/** The calculation record: what a report's results were calculated from, with what, and how far they can be
 * relied on (project and file version, when, software, basis, assumptions, cable data source, input checks,
 * warnings, limitations) and a validation status that is never an approval. Shared by the study report
 * (PDF and Word) and the design report. */

export type ValidationStatus = 'PRELIMINARY' | 'CALCULATED — FOR ENGINEERING REVIEW';

/** One row: a label and its lines; a line in `strong` is printed bold. */
export interface RecordRow { label: string; lines: string[]; list?: boolean; strong?: string[] }

export interface CalcRecord { rows: RecordRow[]; status: ValidationStatus; statusText: string }

export interface CalcRecordInput {
  /** When the results were calculated (ms); undefined = calculated for this print from the current inputs. */
  calculatedAt?: number;
  /** false when the inputs changed after the calculation. */
  current?: boolean;
  /** Results of the checks in the report (all studies). */
  statuses: Status[];
  /** Where the warnings are listed in this document. */
  warningsAt?: string;
}

/** Cable data counts by source, e.g. "11 app reference values (approximate, …)". */
const COUNT_TEXT: Record<CableSource, string> = {
  reference: 'app reference values (approximate, not manufacturer-verified)',
  fallback: 'missing from Cables.xlsx, app reference values used',
  user: 'user-entered without a manufacturer / reference document',
  manufacturer: 'manufacturer data'
};
const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildCalcRecord(project: Project, i: CalcRecordInput): CalcRecord {
  const cable = cableDataStatus(project);
  const count = (s: CableSource) => cable.sizes.filter((x) => x.source === s).length;
  const unverified = count('reference') + count('fallback') + count('user');
  const inputs = projectInputIssues(project).filter((x) => x.status === 'bad');
  const refs = checkReferences(project);
  const loops = refs.filter((r) => /loop|feeds the panel it is on/.test(r.problem)).length;
  const fails = i.statuses.filter((s) => s === 'bad').length, warns = i.statuses.filter((s) => s === 'warn').length;
  const stale = i.current === false;

  const cableLine = `${plural(cable.sizes.length + cable.missing.length, 'size')} used: ${(['reference', 'fallback', 'user', 'manufacturer'] as const)
    .filter((s) => count(s) || s === 'reference' || s === 'manufacturer')
    .map((s) => `${count(s)} ${COUNT_TEXT[s]}`).join(' · ')}${cable.missing.length ? ` · ${cable.missing.length} without any cable data` : ''}`;
  const inputLine = !inputs.length && !refs.length ? 'No invalid inputs, no supply loops, no missing references'
    : [inputs.length && `${plural(inputs.length, 'item')} with invalid inputs`, loops && plural(loops, 'supply loop'), refs.length - loops && plural(refs.length - loops, 'missing reference')].filter(Boolean).join(' · ') + ' — see the To do list';

  const rows: RecordRow[] = [
    { label: 'Project', lines: [project.name, `Project ID ${project.id ?? 'not assigned (save the project)'} · file format version ${project.schemaVersion ?? CURRENT_SCHEMA}`] },
    { label: 'Calculated', lines: [i.calculatedAt === undefined ? 'At the time of this print, from the current inputs' : `${when(i.calculatedAt)} · ${stale ? 'inputs changed since — run the calculations again before issue' : 'results current for the inputs in this report'}`] },
    { label: 'Software', lines: [`LV Design Studio ${pkg.version} · built-in calculation engine (no external engine used)`] },
    { label: 'Calculation basis', lines: ["Methods per Codes and standards → Calculation basis and each study's Method notes.", 'Standard editions: not verified against a specific edition'] },
    {
      label: 'Key assumptions', list: true, lines: [
        `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz, TN-S · design ambient ${project.ambientC} °C · voltage drop limit ${project.vdLimitPct} % source to load`,
        project.vdTempC === undefined ? 'Cable resistance at operating temperature 1.2 × R20 (not set for the project)' : `Cable resistance for voltage drop at ${project.vdTempC} °C = R20 × ${resistanceFactor(project.vdTempC).toFixed(3)}; for fault levels 1.2 × R20`,
        'Fault levels: maximum Ik″ with c max = 1.05 and cable R at 20 °C, MV network infinite, transformer correction KT not applied — simplified, preliminary, not a full IEC 60909 study'
      ], strong: ['simplified, preliminary, not a full IEC 60909 study']
    },
    { label: 'Cable data', lines: [cableLine, `Final-design requirement for manufacturer cable data: ${project.strictCableData ? 'set' : 'not set'}`], strong: unverified ? [cableLine] : [] },
    { label: 'Input checks', lines: [inputLine] },
    { label: 'Calculation warnings', lines: [`${plural(fails, 'failure')} · ${warns} to check${i.warningsAt ? ` (${i.warningsAt})` : ''}`] },
    {
      label: 'Limitations', list: true, lines: [
        'Cable ratings: ambient and grouping derating only; other installation-method factors not applied',
        "Selectivity from current thresholds only — confirm with the manufacturer's tables",
        'Voltage drop: first-order, summed along the radial path; not an unbalanced load flow'
      ]
    }
  ];

  const reasons = [
    unverified && 'using approximate reference or unverified cable data',
    cable.missing.length && 'with cable sizes that have no data',
    (inputs.length || refs.length) && 'with invalid inputs or references',
    fails && 'with failing checks',
    stale && 'from results that are out of date'
  ].filter(Boolean) as string[];
  const status: ValidationStatus = reasons.length ? 'PRELIMINARY' : 'CALCULATED — FOR ENGINEERING REVIEW';
  const statusText = `Calculated checks against the project limits${reasons.length ? `, ${reasons.join(', ')}` : ''}. Not an engineering approval and not an approval by DEWA or any other authority.`;
  return { rows, status, statusText };
}

const lineHtml = (r: RecordRow, l: string) => (r.strong?.some((s) => l === s) ? `<b>${esc(l)}</b>`
  : r.strong?.reduce((h, s) => h.replace(esc(s), `<b>${esc(s)}</b>`), esc(l)) ?? esc(l));

/** The record as a report section (black and white: table rules and bold only). */
export function calcRecordHtml(r: CalcRecord, heading = '<h2 class="unnumbered">Calculation record</h2>'): string {
  return `
<section class="calc-record">
  ${heading}
  <p class="caption">What these results were calculated from, with what, and how far they can be relied on.</p>
  <table class="meta"><tbody>${r.rows.map((row) => `<tr><th>${esc(row.label)}</th><td>${row.list ? `<ul style="margin:0;padding-left:14px">${row.lines.map((l) => `<li>${lineHtml(row, l)}</li>`).join('')}</ul>` : row.lines.map((l) => lineHtml(row, l)).join('<br>')}</td></tr>`).join('')}</tbody></table>
  <p class="validation" style="border:2px solid #000;padding:6px 8px;margin-top:10px"><b>Validation status: ${esc(r.status)}.</b> ${esc(r.statusText)}</p>
</section>`;
}
