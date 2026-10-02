import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { REFERENCE_DATA_NOTICE, usingReferenceCables } from '../calc/cableTable';
import { CALC_DISCLAIMER } from '../calc/statusText';
import type { Project } from '../types';
import { currentRevision } from '../model/revisions';
import { scopeText, type ReportMeta, type Scope, type Section } from './studyReport';

/** The study report as an editable Word document (.docx): cover details,
 * results summary, then per study its method, key results and tables.
 * Landscape A4 so the wide tables fit. */

const COLOR = { ok: '13803D', warn: 'A86500', bad: 'C21F32' } as const;
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

export function buildStudyDocx(project: Project, scope: Scope, sections: Section[], meta: ReportMeta): Document {
  const rev = currentRevision(project);
  const info = project.info ?? {};
  const logo = logoRun(project);
  const children: (Paragraph | Table)[] = [
    ...(logo ? [new Paragraph({ alignment: AlignmentType.RIGHT, children: [logo] })] : []),
    new Paragraph({ children: [new TextRun({ text: project.name, color: '5B6B82' })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: meta.title })] }),
    kv([
      ['Project', project.name], ['Owner', info.owner], ['Consultant', info.consultant], ['Contractor', info.contractor],
      ['Plot / area', [info.plotNo, info.area].filter(Boolean).join(' · ') || undefined], ['Scope', scopeText(project, scope)],
      ['Studies', sections.map((s) => s.title).join('; ')], ['System', `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz, TN-S`],
      ['Document no.', meta.docNo], ['Revision', rev ? `${rev.id} (${rev.date})` : undefined],
      ['Date', meta.date ?? new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })],
      ['Prepared by', meta.preparedBy], ['Checked by', meta.checkedBy]
    ]),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Results summary')] }),
    table(['Study', 'Result'], sections.map((s) => {
      const f = s.statuses.filter((x) => x === 'bad').length, w = s.statuses.filter((x) => x === 'warn').length, p = s.statuses.length - f - w;
      return [s.title, s.statuses.length ? { v: `${p} pass · ${w} check · ${f} fail`, s: f ? 'bad' : w ? 'warn' : 'ok' } : '—'];
    }))
  ];
  sections.forEach((s, i) => {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun(`${i + 1}. ${s.title}`)] }),
      new Paragraph({ children: [new TextRun({ text: `Scope: ${scopeText(project, scope)}`, color: '5B6B82' })] }),
      kv(s.summary.map((k) => [k.label, k.value])),
      new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun('Method')] }),
      ...s.method.map((m) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun(m)] }))
    );
    for (const t of s.tables) {
      if (t.title) children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t.title)] }));
      children.push(t.rows.length ? table(t.headers, t.rows) : new Paragraph({ children: [new TextRun({ text: 'Nothing in scope.', italics: true })] }));
    }
  });
  children.push(new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: `Generated by LV Design Studio from the latest calculation run. Results must be checked by a qualified engineer before submission. ${CALC_DISCLAIMER}${usingReferenceCables() ? ` ${REFERENCE_DATA_NOTICE}` : ''}`, size: 16, color: '5B6B82' })] }));
  return new Document({
    creator: meta.preparedBy ?? 'LV Design Studio',
    title: meta.title,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children }]
  });
}

export async function docxBytes(doc: Document): Promise<Uint8Array> {
  return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());
}
