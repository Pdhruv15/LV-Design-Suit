import { currentRevision } from '../model/revisions';
import type { Project, ReportIssueStatus } from '../types';
import { esc } from './report';

/** The document frame of the design report: cover page, document control,
 * contents, running header / footer and the report typography. Presentation
 * only — no calculations here; the sections come from studyReport.ts.
 *
 * Missing identification data is never filled in: it shows as "Not defined"
 * (highlighted) so the gap is visible before the report is issued. */

export const NOT_DEFINED = 'Not defined';

export const ISSUE_STATUSES: ReportIssueStatus[] = ['For information', 'For review', 'For approval', 'For construction', 'As built'];

/** What the user typed for this report (Reports → Study reports → Output). */
export interface ReportMeta {
  title: string;
  docNo?: string;
  projectNo?: string;
  preparedBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  issueStatus?: ReportIssueStatus;
  date?: string;
}

/** Report data / view model of the document frame: everything the cover,
 * document control and header / footer show, resolved once from the project. */
export interface ReportDoc {
  projectName: string;
  projectNo?: string;
  client?: string;
  consultant?: string;
  contractor?: string;
  location?: string;
  title: string;
  docNo?: string;
  revision?: string;
  revisionDate?: string;
  date: string;
  preparedBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  issueStatus?: ReportIssueStatus;
  /** Issued revisions, oldest first. */
  revisions: { id: string; date: string; description: string; by?: string }[];
  logo?: string;
}

const clean = (s?: string) => (s?.trim() ? s.trim() : undefined);

export function reportDoc(project: Project, meta: ReportMeta): ReportDoc {
  const info = project.info ?? {};
  const params = project.params ?? {};
  const rev = currentRevision(project);
  return {
    projectName: project.name,
    projectNo: clean(meta.projectNo),
    client: clean(info.owner),
    consultant: clean(info.consultant),
    contractor: clean(info.contractor),
    location: clean([info.plotNo, info.area].filter(Boolean).join(' · ')),
    title: meta.title,
    docNo: clean(meta.docNo),
    revision: rev?.id,
    revisionDate: rev?.date,
    date: meta.date ?? new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
    // The report's own names first, then the people named in the project parameters / drawing title block.
    preparedBy: clean(meta.preparedBy) ?? clean(params.designedBy),
    checkedBy: clean(meta.checkedBy) ?? clean(params.checkedBy) ?? clean(project.drawing?.checkedBy),
    approvedBy: clean(meta.approvedBy) ?? clean(params.approvedBy) ?? clean(project.drawing?.approvedBy),
    issueStatus: meta.issueStatus,
    revisions: (project.revisions ?? []).map((r) => ({ id: r.id, date: r.date, description: r.description, by: r.by })),
    logo: project.drawing?.logo?.startsWith('data:image/') ? project.drawing.logo : undefined
  };
}

/** A value, or a highlighted "Not defined". */
export const valueOrMissing = (v?: string) => (v ? esc(v) : `<span class="missing">${NOT_DEFINED}</span>`);

/** Identification fields the report should carry but doesn't (for the warning on the Output tab). */
export function missingFields(d: ReportDoc): string[] {
  const req: [string, string | undefined][] = [['Project no.', d.projectNo], ['Client', d.client], ['Document no.', d.docNo], ['Revision', d.revision],
    ['Prepared by', d.preparedBy], ['Checked by', d.checkedBy], ['Approved by', d.approvedBy], ['Issue status', d.issueStatus]];
  return req.filter(([, v]) => !v).map(([k]) => k);
}

const revText = (d: ReportDoc) => (d.revision ? `${d.revision}${d.revisionDate ? ` (${d.revisionDate})` : ''}` : undefined);

const rows = (r: [string, string][]) => r.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('');

// ---- Cover ---------------------------------------------------------------------

/** Cover page: identification only. `extra` rows (scope, studies, system) and
 * the `foot` note come from the report being built. */
export function coverPageHtml(d: ReportDoc, extra: [string, string][], foot = ''): string {
  return `
<section class="cover">
  ${d.logo ? `<img class="cover-logo" src="${esc(d.logo)}" alt="">` : ''}
  <p class="kicker">${esc(d.projectName)}</p>
  <h1>${esc(d.title)}</h1>
  <table class="meta">
    ${rows([
      ['Project', esc(d.projectName)], ['Project no.', valueOrMissing(d.projectNo)],
      ['Client', valueOrMissing(d.client)], ['Consultant', valueOrMissing(d.consultant)], ['Contractor', valueOrMissing(d.contractor)],
      ...(d.location ? [['Plot / area', esc(d.location)] as [string, string]] : []),
      ...extra.map(([k, v]) => [k, esc(v)] as [string, string]),
      ['Document no.', valueOrMissing(d.docNo)], ['Revision', valueOrMissing(revText(d))], ['Date', esc(d.date)], ['Issue status', valueOrMissing(d.issueStatus)]
    ])}
  </table>
  <table class="sign">
    <thead><tr><th></th><th>Name</th><th>Signature</th><th>Date</th></tr></thead>
    <tbody>${([['Prepared by', d.preparedBy], ['Checked by', d.checkedBy], ['Approved by', d.approvedBy]] as const)
      .map(([k, v]) => `<tr><th>${k}</th><td>${valueOrMissing(v)}</td><td></td><td></td></tr>`).join('')}</tbody>
  </table>
  ${foot}
</section>`;
}

// ---- Document control -------------------------------------------------------------

export function documentControlHtml(d: ReportDoc): string {
  const history = d.revisions.length
    ? `<table class="revs"><thead><tr><th>Rev.</th><th>Date</th><th>Description</th><th>By</th></tr></thead><tbody>${[...d.revisions].reverse()
      .map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.date)}</td><td>${esc(r.description)}</td><td>${valueOrMissing(r.by)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="warning">No revision has been issued for this project (Revisions → Issue revision). This report is an unissued draft.</p>`;
  return `
<section class="doc-control">
  <h2 class="unnumbered">Document control</h2>
  <h3>Document information</h3>
  <table class="meta">${rows([
    ['Document title', esc(d.title)], ['Document no.', valueOrMissing(d.docNo)], ['Project', esc(d.projectName)], ['Project no.', valueOrMissing(d.projectNo)],
    ['Current revision', valueOrMissing(revText(d))], ['Issue status', valueOrMissing(d.issueStatus)], ['Date of this print', esc(d.date)]
  ])}</table>
  <h3>Revision history</h3>
  ${history}
  <h3>Prepared, checked and approved</h3>
  <table class="sign">
    <thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead>
    <tbody>${([['Prepared by', d.preparedBy], ['Checked by', d.checkedBy], ['Approved by', d.approvedBy]] as const)
      .map(([k, v]) => `<tr><th>${k}</th><td>${valueOrMissing(v)}</td><td></td><td></td></tr>`).join('')}</tbody>
  </table>
</section>`;
}

// ---- Contents and numbering ---------------------------------------------------------

export interface TocEntry { number: string; title: string; level: number; anchor: string }

/** Numbers a section tree 1, 1.1, 1.1.1 … — the one place section numbers are made. */
export function numberSections(tree: { title: string; children?: { title: string; children?: { title: string }[] }[] }[]): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (nodes: { title: string; children?: { title: string; children?: { title: string }[] }[] }[], prefix: string, level: number) =>
    nodes.forEach((n, i) => {
      const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      out.push({ number, title: n.title, level, anchor: `sec-${number.replace(/\./g, '-')}` });
      if (n.children?.length) walk(n.children, number, level + 1);
    });
  walk(tree, '', 1);
  return out;
}

export function tocHtml(entries: TocEntry[]): string {
  return `
<section class="toc">
  <h2 class="unnumbered">Contents</h2>
  <ol class="toc-list">${entries.map((e) => `<li class="l${e.level}"><a href="#${e.anchor}"><span class="n">${esc(e.number)}</span>${esc(e.title)}</a></li>`).join('')}</ol>
</section>`;
}

/** Numbers the H3 sub-sections of a numbered section (6 → 6.1, 6.2 …; Appendix A → A.1 …) and captions
 * every data table (one with a heading row) "Table n", counting across the report. */
export function numberSubsections(html: string, prefix: string, tables: { n: number }): string {
  let k = 0;
  return html
    .replace(/<h3>/g, () => `<h3><span class="sn">${prefix}.${++k}</span> `)
    .replace(/<table><thead>/g, () => `<table><caption>Table ${++tables.n}</caption><thead>`);
}

// ---- Header / footer -----------------------------------------------------------------

/** Running header and footer stamped on every page after the cover (see pdfTools.stampFrame). */
export interface PageFrame { headerLeft: string; headerRight: string; footerLeft: string }

export const pageFrame = (d: ReportDoc): PageFrame => ({
  headerLeft: d.projectName,
  headerRight: d.title,
  footerLeft: `Doc. no. ${d.docNo ?? NOT_DEFINED}   ·   Rev. ${d.revision ?? NOT_DEFINED}`
});

// ---- Typography and layout -----------------------------------------------------------------

/** Report typography (H1/H2/H3, body, tables, notes, warnings, captions) and
 * page layout. Added after REPORT_CSS by the design report. */
export const REPORT_DOC_CSS = `
    @page { size: A4 landscape; margin: 16mm 14mm 14mm; }
    body { font-size: 10px; line-height: 1.45; }
    h1 { font-size: 24px; line-height: 1.2; margin: 4px 0 14px; color: #0f2a4d; }
    h2 { font-size: 15px; margin: 0 0 8px; padding-bottom: 3px; border-bottom: 2px solid #1d4f8f; color: #1d4f8f; break-after: avoid; }
    h3 { font-size: 11.5px; margin: 12px 0 4px; color: #17202e; break-after: avoid; }
    p { margin: 3px 0 6px; } ul { margin: 3px 0 8px; }
    table { break-inside: auto; } thead { display: table-header-group; } tr { break-inside: avoid; }
    th { font-size: 9.5px; text-transform: none; }
    .note { color: #5b6b82; font-size: 9px; }
    .warning { border-left: 3px solid #a86500; background: #fff7e8; color: #6b4200; padding: 4px 8px; margin: 6px 0; }
    .caption { color: #5b6b82; font-size: 9px; font-style: italic; margin: -4px 0 8px; }
    .sn { color: #5b6b82; margin-right: 6px; } caption { caption-side: top; text-align: left; font-size: 8.5px; color: #5b6b82; padding: 0 0 2px; }
    .missing { color: #a86500; font-style: italic; }
    .cover, .doc-control, .toc { break-after: page; }
    .cover .kicker { color: #5b6b82; margin: 30px 0 0; font-size: 12px; }
    .cover-logo { float: right; max-height: 22mm; max-width: 70mm; margin-top: 20px; }
    .meta { width: 70%; } .meta th { width: 28%; }
    .sign { width: 70%; margin-top: 10px; } .sign th:first-child { width: 20%; } .sign td { height: 18px; }
    .toc-list { list-style: none; padding: 0; margin: 6px 0; width: 70%; }
    .toc-list li { padding: 3px 0; border-bottom: 1px dotted #c9d2de; } .toc-list a { color: inherit; text-decoration: none; }
    .toc-list .n { display: inline-block; min-width: 34px; margin-right: 8px; font-weight: 600; } .toc-list .l2 { padding-left: 24px; } .toc-list .l3 { padding-left: 48px; }`;
