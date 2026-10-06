import type { Project } from '../types';
import { baselineOf } from '../model/designBaseline';
import { impactBetween } from '../model/designImpact';
import { currentRevision } from '../model/revisions';
import { CATEGORY_LABEL, needsReReview, refState, reviewSummary, SEVERITY_LABEL, STATUS_LABEL } from '../model/reviewComments';
import { describeOp, STATUS_LABEL as MOD_STATUS } from '../model/designChanges';
import { esc, REPORT_CSS } from './report';

/** The design review report as a plain document model (sections of paragraphs, bullets and tables), rendered to PDF
 * (HTML) and to Word from the same data, so both always agree. It is built from one frozen copy of the project; missing
 * evidence is stated, failed or unverified checks stay visible, and no approval wording appears unless a reviewer decision
 * has been recorded. */
export type Block = { kind: 'para'; text: string; muted?: boolean } | { kind: 'bullets'; items: string[] } | { kind: 'table'; headers: string[]; rows: string[][] };
export interface ReportSection { id: string; title: string; blocks: Block[] }
export interface ReviewDoc { title: string; project: string; sections: ReportSection[]; footer: string }

export const SECTION_IDS = ['control', 'executive', 'documents', 'basis', 'modifications', 'comments', 'consistency', 'diagrams', 'conclusion'] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_LABEL: Record<SectionId, string> = {
  control: 'Document control', executive: 'Executive assessment', documents: 'Documents reviewed', basis: 'Design basis', modifications: 'Modification summary',
  comments: 'Review-comment register', consistency: 'Drawing and schedule consistency', diagrams: 'Single line diagrams', conclusion: 'Conclusion and limitations'
};

/** Saved in the project so the same report can be produced again. */
export interface ReviewReportSetup {
  sections: SectionId[];
  title?: string; docNo?: string; purpose?: string; preparedBy?: string; checkedBy?: string;
  /** Only when the reviewer has recorded one: the report states nothing about approval otherwise. */
  decision?: { outcome: string; by: string; at: string; conditions?: string };
}
export const defaultSetup = (): ReviewReportSetup => ({ sections: [...SECTION_IDS] });

export interface ReportEvidence { /** Whether calculations have been run for this design. */ ran: boolean; /** Studies whose results are older than the inputs. */ stale: string[]; /** Studies not yet verified or failing, as readable lines. */ findings: string[] }

const MISSING = 'Not recorded';
const v = (x: string | number | undefined | null) => (x === undefined || x === null || x === '' ? MISSING : String(x));
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function buildReviewDoc(source: Project, setup: ReviewReportSetup, ev: ReportEvidence, now = new Date()): ReviewDoc {
  const p: Project = JSON.parse(JSON.stringify(source)); // frozen: nothing edited later can change this report
  const base = baselineOf(p), cur = currentRevision(p), info = p.info ?? {};
  const comments = p.reviewComments ?? [], mods = p.modifications ?? [], sum = reviewSummary(p);
  const impact = base ? impactBetween(base.revision.snapshot, p) : undefined;
  const title = setup.title?.trim() || 'Design review report';
  const out: ReportSection[] = [];
  const add = (id: SectionId, blocks: Block[]) => { if (setup.sections.includes(id)) out.push({ id, title: SECTION_LABEL[id], blocks }); };

  add('control', [{ kind: 'table', headers: ['Item', 'Value'], rows: [
    ['Project', p.name], ['Report', title], ['Document no.', v(setup.docNo)], ['Purpose', v(setup.purpose)], ['Date', now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })],
    ['Owner', v(info.owner)], ['Consultant', v(info.consultant)], ['Contractor', v(info.contractor)], ['Prepared by', v(setup.preparedBy)], ['Checked by', v(setup.checkedBy)],
    ['Baseline', base ? `Rev ${base.revision.id} (${base.revision.date})${base.chosen ? '' : ' — latest issued'}` : 'No revision issued'],
    ['Reviewed state', `Working design${cur ? `, after Rev ${cur.id}` : ''}`]
  ] }]);

  const blocking = sum.critical + sum.reReview;
  const executive: Block[] = [
    { kind: 'para', text: `${comments.length} review comment${comments.length === 1 ? '' : 's'}: ${sum.open} unresolved (${sum.critical} critical, ${sum.major} major), ${sum.awaiting} awaiting evidence, ${sum.reReview} closed but to be re-reviewed because the design changed.` },
    { kind: 'para', text: !ev.ran ? 'Calculations have not been run for this design: no calculation results are included.' : ev.stale.length ? `Calculation results are out of date for: ${ev.stale.join(', ')}. They are not included as current.` : 'Calculation results are current.' },
    ev.findings.length ? { kind: 'bullets', items: ev.findings } : { kind: 'para', text: ev.ran ? 'No failed or unverified calculation checks.' : '', muted: true },
    { kind: 'para', text: blocking ? `Unresolved matters remain (${blocking} critical or to be re-reviewed).` : 'No critical matter is unresolved.' }
  ];
  add('executive', executive.filter((b) => b.kind !== 'para' || b.text));

  const sheets = p.drawingSet?.sheets ?? [];
  add('documents', [sheets.length
    ? { kind: 'table', headers: ['Drawing no.', 'Title', 'Revision', 'Status'], rows: sheets.map((s) => [s.number, s.title, v(s.rev ?? cur?.id), v(s.status)]) }
    : { kind: 'para', text: 'No drawing set has been created. Specifications and datasheets are not recorded in the project.' }]);

  add('basis', [{ kind: 'table', headers: ['Item', 'Value'], rows: [
    ['Supply', `${p.voltageV} V, ${p.frequencyHz} Hz`], ['Voltage-drop limit', v(p.vdLimitPct !== undefined ? `${p.vdLimitPct} %` : undefined)], ['Ambient', v(p.ambientC !== undefined ? `${p.ambientC} °C` : undefined)],
    ['Panels', String(p.boards.length)], ['Circuits', String(p.feeders.length)], ['Authority', v(p.brief?.authority)]
  ] }, { kind: 'para', text: 'Operating scenarios and exclusions are not recorded in the project.', muted: true }]);

  add('modifications', [
    mods.length
      ? { kind: 'table', headers: ['Record', 'Title', 'Status', 'Item', 'Before', 'After'], rows: mods.flatMap((m) => (m.ops.length ? m.ops : [undefined]).map((op) => { const d = op && describeOp(op); return [m.id, m.title, `${MOD_STATUS[m.status]}${m.applied ? ' · applied' : ''}`, d?.item ?? '—', d?.from ?? '—', d?.to ?? '—']; })) }
      : { kind: 'para', text: 'No modification records.' },
    impact ? { kind: 'para', text: `Working design against Rev ${base!.revision.id}: ${impact.empty ? 'no engineering or drawing differences.' : `${impact.changes.length} change${impact.changes.length === 1 ? '' : 's'}; studies to run again: ${impact.studies.map((s) => s.label).join(', ') || 'none'}.`}` } : { kind: 'para', text: 'No baseline revision: the working design is not compared.' }
  ]);

  add('comments', [comments.length
    ? { kind: 'table', headers: ['ID', 'Category', 'Severity', 'Finding', 'About', 'Criterion', 'Required action', 'Assigned', 'Status', 'Response / evidence'], rows: comments.map((c) => {
      const rs = refState(p, c);
      return [c.id, CATEGORY_LABEL[c.category], SEVERITY_LABEL[c.severity], c.finding, c.ref ? `${c.ref.id}${rs === 'missing' ? ' (deleted)' : ''}` : '—', v(c.criterion), v(c.requiredAction), v(c.assignedTo),
        `${STATUS_LABEL[c.status]}${needsReReview(p, c) ? ' — re-review: design changed since closed' : ''}`, [c.response, c.evidence].filter(Boolean).join(' / ') || MISSING];
    }) }
    : { kind: 'para', text: 'No review comments have been recorded.' }]);

  const unnumbered = sheets.filter((s) => !s.number?.trim()).length;
  add('consistency', [{ kind: 'bullets', items: [
    `${sheets.length} drawing sheet${sheets.length === 1 ? '' : 's'}${unnumbered ? `, ${unnumbered} without a drawing number` : ''}.`,
    impact?.documents.length ? `Documents to regenerate after the changes: ${impact.documents.map((d) => d.label).join(', ')}.` : 'No schedule or drawing regeneration is flagged by the changes.',
    impact?.quantities.length ? `${impact.quantities.length} design quantit${impact.quantities.length === 1 ? 'y' : 'ies'} change (BOQ to be rechecked).` : 'No design quantity changes against the baseline.'
  ] }]);

  add('diagrams', [sheets.length
    ? { kind: 'table', headers: ['Sheet', 'Title', 'Revision', 'Status'], rows: sheets.map((s) => [s.number, s.title, v(s.rev ?? cur?.id), v(s.status)]) }
    : { kind: 'para', text: 'No drawing set has been created, so there are no diagrams to attach.' },
    { kind: 'para', text: 'In the PDF (desktop app) these sheets follow the report as full drawing sheets with their title blocks, drawn from the current design. The Word file lists them only.', muted: true }]);

  const d = setup.decision;
  add('conclusion', [
    d ? { kind: 'para', text: `Reviewer decision: ${d.outcome}. Recorded by ${d.by} on ${dateOf(d.at)}.${d.conditions ? ` Conditions: ${d.conditions}` : ''}` }
      : { kind: 'para', text: 'No reviewer decision has been recorded. This report makes no statement of approval.' },
    { kind: 'para', text: 'Names are typed text; the application does not verify identity. Calculation outputs are the application’s and must be checked by a qualified engineer. Appendices (detailed calculations, diagrams) are issued separately from the study reports.', muted: true }
  ]);
  return { title, project: p.name, sections: out, footer: `Generated by LV Design Studio from a frozen copy of the project on ${dateOf(now.toISOString())}.` };
}

const tag = (b: Block): string => {
  if (b.kind === 'para') return `<p${b.muted ? ' class="note"' : ''}>${esc(b.text)}</p>`;
  if (b.kind === 'bullets') return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
  return `<table><thead><tr>${b.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
};

/** Print-ready HTML (A4 landscape) for the PDF. Every user-entered text is escaped. */
export function reviewHtml(doc: ReviewDoc): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${REPORT_CSS} h2{break-after:avoid} section{break-inside:auto}</style></head><body>
<h1>${esc(doc.title)}</h1><p class="sub">${esc(doc.project)}</p>
${doc.sections.map((s, i) => `<section><h2>${i + 1}. ${esc(s.title)}</h2>${s.blocks.map(tag).join('')}</section>`).join('\n')}
<p class="note">${esc(doc.footer)}</p></body></html>`;
}
