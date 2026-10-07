import { AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, Packer, PageNumber, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableOfContents, TableRow, TextRun, WidthType } from 'docx';
import { REFERENCE_DATA_NOTICE, usingReferenceCables } from '../calc/cableTable';
import { CALC_DISCLAIMER, REPORT_STATUS_TEXT, type ReportStatus } from '../calc/statusText';
import type { Project } from '../types';
import { NOT_DEFINED, pageFrame } from './reportFrame';
import { planReport, scopeText, type ReportMeta, type ReportOptions, type Scope, type Section } from './studyReport';

/** Word (.docx) output of the design report. Landscape A4 so the wide tables fit. */

const COLOR = { ok: '13803D', warn: 'A86500', bad: 'C21F32', nc: '5B6B82', data: 'A86500' } as const;
const border = { style: BorderStyle.SINGLE, size: 4, color: '9AA6B8' };
const borders = { top: border, bottom: border, left: border, right: border };

type Cell = Section['tables'][number]['rows'][number][number];
const cellText = (c: Cell) => (typeof c === 'object' ? String(c.v) : String(c));
const cellColor = (c: Cell) => (typeof c === 'object' ? COLOR[c.s] : undefined);

function table(headers: string[], rows: Cell[][]): Table {
  const head = new TableRow({
    tableHeader: true,
    children: headers.map((h) => new TableCell({ borders, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF2F7' }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 16 })] })] }))
  });
  const body = rows.map((r) => new TableRow({
    children: r.map((c) => new TableCell({ borders, children: [new Paragraph({ children: [new TextRun({ text: cellText(c), size: 16, color: cellColor(c), bold: !!cellColor(c) && cellColor(c) !== COLOR.ok })] })] }))
  }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [head, ...body] });
}

const kv = (rows: [string, string | undefined][]) =>
  table(['Item', 'Value'], rows.filter(([, v]) => v).map(([k, v]) => [k, v!]));

function logoRun(project: Project): ImageRun | undefined {
  const logo = project.drawing?.logo;
  const m = logo?.match(/^data:image\/(png|jpe?g);base64,(.+)$/);
  if (!m) return undefined;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new ImageRun({ type: m[1] === 'png' ? 'png' : 'jpg', data: bytes, transformation: { width: 150, height: 50 } });
}

const LABEL: Record<ReportStatus | 'info', string> = { ...REPORT_STATUS_TEXT, info: 'NOTE' };
const P = (text: string, o: { italics?: boolean; color?: string; bold?: boolean; size?: number } = {}) => new Paragraph({ children: [new TextRun({ text, ...o })] });
const bullets = (xs: string[]) => xs.map((x) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(x)] }));
const missing = (x?: string): Cell => (x ? x : { v: NOT_DEFINED, s: 'data' });

/** The design report as an editable Word document: the same plan, numbering and
 * sections as the PDF (cover, document control, contents, design basis, studies,
 * results and compliance, appendices). Charts and single line diagrams are in the
 * PDF only; the Word contents is a field Word fills in (Update field). */
export function buildStudyDocx(project: Project, scope: Scope, sections: Section[], meta: ReportMeta, opts: ReportOptions = {}): Document {
  const plan = planReport(project, scope, sections, meta, [], opts);
  const { doc, basisData, resultsData, appendices, basisNo, secNo, resNo } = plan;
  const logo = logoRun(project);
  const tableNo = { n: 0 };
  const out: (Paragraph | Table | TableOfContents)[] = [];
  const h1 = (text: string) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(text)] }));
  let prefix = '', sub = 0;
  const h3 = (text: string) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(prefix ? `${prefix}.${++sub}  ${text}` : text)] }));
  const section = (number: string, title: string) => { h1(`${number}${/^\d/.test(number) ? '.' : ' —'} ${title}`); prefix = number.replace(/^Appendix /, ''); sub = 0; };
  const tbl = (title: string | undefined, headers: string[], rows: Cell[][]) => {
    if (title) h3(title);
    if (!rows.length) { out.push(P('Nothing in scope.', { italics: true, color: '5B6B82' })); return; }
    out.push(P(`Table ${++tableNo.n}`, { size: 14, color: '5B6B82' }), table(headers, rows));
  };
  const kvT = (rows: [string, Cell][]) => out.push(table(['Item', 'Value'], rows.map(([k, v]) => [k, v])));
  const sign = () => table(['Role', 'Name', 'Signature', 'Date'], ([['Prepared by', doc.preparedBy], ['Checked by', doc.checkedBy], ['Approved by', doc.approvedBy]] as const).map(([k, v]) => [k, missing(v), '', '']));
  const revText = doc.revision ? `${doc.revision}${doc.revisionDate ? ` (${doc.revisionDate})` : ''}` : undefined;

  // Cover
  if (logo) out.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [logo] }));
  out.push(P(doc.projectName, { color: '5B6B82' }), new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: doc.title })] }));
  kvT([['Project', doc.projectName], ['Project no.', missing(doc.projectNo)], ['Client', missing(doc.client)], ['Consultant', missing(doc.consultant)], ['Contractor', missing(doc.contractor)],
    ...(doc.location ? [['Plot / area', doc.location] as [string, Cell]] : []), ['Scope', scopeText(project, scope)], ['Studies', sections.map((x) => x.title).join('; ')],
    ['System', `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz, TN-S`], ['Document no.', missing(doc.docNo)], ['Revision', missing(revText)], ['Date', doc.date], ['Issue status', missing(doc.issueStatus)]]);
  out.push(P(''), sign(), P(`Generated by LV Design Studio from the latest calculation run. Results must be checked by a qualified engineer before submission. ${CALC_DISCLAIMER}${usingReferenceCables() ? ` ${REFERENCE_DATA_NOTICE}` : ''}`, { size: 16, color: '5B6B82' }));

  // Document control and contents (unnumbered)
  prefix = '';
  out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: true, children: [new TextRun('Document control')] }));
  h3('Document information');
  kvT([['Document title', doc.title], ['Document no.', missing(doc.docNo)], ['Project', doc.projectName], ['Project no.', missing(doc.projectNo)], ['Current revision', missing(revText)], ['Issue status', missing(doc.issueStatus)], ['Date of this print', doc.date]]);
  h3('Revision history');
  out.push(doc.revisions.length ? table(['Rev.', 'Date', 'Description', 'By'], [...doc.revisions].reverse().map((r) => [r.id, r.date, r.description, missing(r.by)])) : P('No revision has been issued for this project. This report is an unissued draft.', { color: COLOR.warn }));
  h3('Prepared, checked and approved');
  out.push(sign());
  out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: true, children: [new TextRun('Contents')] }),
    new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-1' }),
    P('If the page numbers are missing, right-click the contents and choose Update field.', { italics: true, size: 16, color: '5B6B82' }));
  h3('Results summary');
  out.push(table(['Section', 'Study', 'Result'], sections.map((x, i) => {
    const f = x.statuses.filter((y) => y === 'bad').length, w = x.statuses.filter((y) => y === 'warn').length;
    return [secNo[i].number, x.title, x.statuses.length ? { v: `${x.statuses.length - f - w} pass · ${w} warning · ${f} fail`, s: f ? 'bad' : w ? 'warn' : 'ok' } : '—'];
  })));

  // Design basis (sections 1–5)
  if (basisData) {
    const b = basisData, e = b.summary, n0 = (x: number, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d });
    section(basisNo[0].number, basisNo[0].title);
    kvT([['Connected load', `${n0(e.connectedKw)} kW`], ['Maximum demand', `${n0(e.demandKw)} kW · ${n0(e.demandKva)} kVA`], ['Demand ÷ connected', e.demandRatio === undefined ? missing() : n0(e.demandRatio, 2)], ['Power factor · current', `${n0(e.powerFactor, 2)} · ${n0(e.currentA)} A`]]);
    tbl('Transformer requirement', ['Main board', 'Required (kVA)', 'Recommended', 'Installed (kVA)', 'Loading', 'Status'],
      e.transformers.map((t) => [t.board, n0(t.requiredKva), t.recommended ?? 'Above the largest standard size', t.installedKva ? n0(t.installedKva) : missing(), t.loadingPct === undefined ? '—' : `${n0(t.loadingPct)} %`, { v: LABEL[t.status], s: t.status }]));
    if (e.generator) tbl('Generator requirement', ['Essential demand (kVA)', 'Rating needed (kVA)', 'Governed by', 'Recommended', 'Installed (kVA)', 'Status'],
      [[n0(e.generator.demandKva), n0(e.generator.requiredKva), e.generator.governing, e.generator.recommended ?? 'Above the largest standard set', e.generator.installedKva ? n0(e.generator.installedKva) : missing(), { v: LABEL[e.generator.status], s: e.generator.status }]]);
    h3('Main LV distribution'); out.push(...bullets(e.arrangement));
    tbl('Major design findings', ['Status', 'Finding'], e.findings.map((f) => [f.status === 'info' ? LABEL.info : { v: LABEL[f.status], s: f.status }, f.text]));
    section(basisNo[1].number, basisNo[1].title);
    if (!b.scope.defined) out.push(P('The project scope is not defined (Project → Brief). Included and excluded systems are not listed.', { color: COLOR.warn }));
    h3('Electrical systems included'); out.push(...(b.scope.defined ? bullets(b.scope.included) : [P(NOT_DEFINED, { italics: true, color: COLOR.warn })]));
    h3('Electrical systems excluded'); out.push(...(b.scope.defined ? bullets(b.scope.excluded.length ? b.scope.excluded : ['None — every system the app covers is in scope.']) : [P(NOT_DEFINED, { italics: true, color: COLOR.warn })]));
    h3('Design boundaries'); out.push(...bullets(b.scope.boundaries));
    section(basisNo[2].number, basisNo[2].title);
    for (const [t, xs] of [['Incoming supply', b.system.supply], ['MV / LV arrangement and transformers', b.system.transformers], ['Main LV distribution', b.system.distribution], ['Emergency supply', b.system.emergency], ['UPS', b.system.ups], ['Other systems', b.system.other]] as const) {
      if (t === 'Other systems' && !xs.length) continue;
      h3(t); out.push(...(xs.length ? bullets([...xs]) : [P('None defined in the project.', { color: '5B6B82' })]));
    }
    section(basisNo[3].number, basisNo[3].title);
    h3('Project and authority requirements');
    kvT([['Approving authority', missing(b.standards.authority)]]);
    out.push(...(b.standards.project.length ? bullets(b.standards.project) : [P('No project standards or specifications are defined. None are assumed.', { color: COLOR.warn })]));
    tbl('Calculation basis', ['Standard', 'Used for'], b.standards.methods.map((m) => [m.standard, m.used]));
    section(basisNo[4].number, basisNo[4].title);
    tbl(undefined, ['Parameter', 'Design value', 'Source', 'Note'], b.criteria.map((c) => [c.parameter, missing(c.value), c.source, c.flag ? { v: c.flag, s: 'data' } : '']));
  }

  // Studies
  sections.forEach((x, i) => {
    section(secNo[i].number, x.title);
    out.push(P(`Scope: ${scopeText(project, scope)}`, { color: '5B6B82' }));
    if (x.statuses.length) {
      const w = x.statuses.includes('bad') ? 'bad' : x.statuses.includes('warn') ? 'warn' : 'ok';
      out.push(new Paragraph({ children: [new TextRun('Overall status: '), new TextRun({ text: LABEL[w], bold: true, color: COLOR[w] })] }));
    }
    if (x.inputs?.length) { h3('Input'); kvT(x.inputs); }
    if (x.criteria?.length) { h3('Design criteria'); kvT(x.criteria); }
    h3('Method'); out.push(...bullets(x.method));
    h3('Result'); kvT(x.summary.map((k) => [k.label, k.status ? { v: k.value, s: k.status } : k.value]));
    for (const t of x.tables.filter((y) => !y.appendix)) tbl(t.title, t.headers, t.rows);
    if (x.cards?.length) { h3('Selection — major feeders'); for (const c of x.cards) out.push(P(c.title, { bold: true }), table(['Item', 'Value'], c.rows.map(([k, v]) => [k, v]))); }
    if (x.verification) tbl(`Verification — ${x.verification.title}`, x.verification.headers, x.verification.rows);
    const apps = plan.appendixOf(x);
    if (apps.length) out.push(P(`See also ${apps.map((a) => `Appendix ${a.letter} (${a.title.toLowerCase()})`).join(', ')}.`, { italics: true, color: '5B6B82' }));
  });

  // Results and compliance
  if (resultsData) {
    const r = resultsData;
    section(resNo[0].number, resNo[0].title);
    for (const t of r.equipment) tbl(t.title, t.headers, t.rows);
    tbl(r.load.title, r.load.headers, r.load.rows);
    if (r.charts.length) out.push(P(`Figures (${r.charts.map((c) => c.title.toLowerCase()).join('; ')}) are in the PDF report.`, { italics: true, color: '5B6B82' }));
    tbl(r.cables.title, r.cables.headers, r.cables.rows);
    section(resNo[1].number, resNo[1].title);
    tbl(undefined, ['Design check', 'Governing item', 'Calculated', 'Requirement / selected', 'Margin', 'Status'], r.compliance.map((c) => [c.check, c.item, c.calculated, c.requirement, c.margin, { v: LABEL[c.status], s: c.status }]));
    out.push(P('Each row shows the item with the least margin; the status is the worst over all items of that check. Engineering review and approval are separate.', { italics: true, size: 16, color: '5B6B82' }));
  }

  // Appendices
  for (const a of appendices) {
    section(`Appendix ${a.letter}`, a.title);
    if (a.kind === 'sld') out.push(P('The single line diagrams are A3 sheets in the PDF report.', { italics: true }));
    for (const ref of a.refs) tbl(ref.title, ref.headers, ref.rows);
    for (const { section: s, table: t } of a.tables) tbl(s && sections.length > 1 ? `${s.title} — ${t.title ?? ''}` : t.title, t.headers, t.rows);
  }

  const frame = pageFrame(doc);
  const small = (text: string) => new TextRun({ text, size: 14, color: '5B6B82' });
  return new Document({
    creator: meta.preparedBy ?? 'LV Design Studio',
    title: meta.title,
    features: { updateFields: true },
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{
      properties: { titlePage: true, page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 900, bottom: 720, left: 720, right: 720 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [small(`${frame.headerLeft}   ·   ${frame.headerRight}`)] })] }), first: new Header({ children: [] }) },
      footers: {
        default: new Footer({ children: [new Paragraph({ children: [small(`${frame.footerLeft}   ·   Page `), new TextRun({ children: [PageNumber.CURRENT], size: 14, color: '5B6B82' }), small(' of '), new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: '5B6B82' })] })] }),
        first: new Footer({ children: [] })
      },
      children: out
    }]
  });
}

export async function docxBytes(doc: Document): Promise<Uint8Array> {
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
