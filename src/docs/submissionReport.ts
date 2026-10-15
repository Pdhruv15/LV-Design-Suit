import ExcelJS from 'exceljs';
import type { Project } from '../types';
import { dueOf, isOpen, isOverdue, submissionCounts, submissionsOf, SUB_STATUS, timeText, type Submission } from '../model/submissions';
import { printDoc } from './boqWorkbook';
import { esc } from './report';

/** Submissions as print documents: the register (landscape) with the comments and actions log,
 * and the document transmittal that goes with one submission (portrait). */

const day = (iso?: string) => {
  const d = iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : iso ?? '';
};
const docNumbers = (s: Submission) => (s.docs.length > 3 ? `${s.docs[0].number} … ${s.docs[s.docs.length - 1].number} (${s.docs.length})` : s.docs.map((d) => d.number).join(', '));
const revs = (s: Submission) => [...new Set(s.docs.map((d) => d.rev).filter(Boolean))].join(', ') || '—';

export function buildSubmissionRegisterHtml(project: Project, today = new Date().toISOString().slice(0, 10)): string {
  const all = submissionsOf(project);
  const c = submissionCounts(project, today);
  const strip: [string, number][] = [['Submissions', c.total], ['Awaiting response', c.open], ['Overdue', c.overdue], ['Approved', c.approved], ['Approved with comments', c.withComments], ['Revise and resubmit', c.resubmit], ['Rejected', c.rejected]];
  const note = (s: Submission) => [s.resubmissionOf ? `Resubmission of ${s.resubmissionOf}` : '', s.resubmittedAs ? `Resubmitted as ${s.resubmittedAs}` : '', s.transmittal && s.transmittal !== s.id ? `Transmittal ${s.transmittal}` : ''].filter(Boolean).join(' · ');
  const register = `<section>
    <h2>Submission register</h2>
    <p class="small sub">${esc(`${project.name} · All submitted documents · As at ${day(today)}`)}</p>
    <table class="strip"><tr>${strip.map(([k, v]) => `<td><b>${v}</b><span>${k}</span></td>`).join('')}</tr></table>
    ${all.length ? `<table class="b reg"><colgroup><col style="width:15mm"><col style="width:16mm"><col style="width:30mm"><col><col style="width:9mm"><col style="width:22mm"><col style="width:21mm"><col style="width:19mm"><col style="width:19mm"><col style="width:26mm"><col style="width:30mm"><col style="width:19mm"></colgroup>
      <thead><tr><th>Ref.</th><th>Type</th><th>Document no.</th><th>Title</th><th>Rev</th><th>Submitted to</th><th>Purpose</th><th>Submitted</th><th>Response due</th><th>Status</th><th>Response</th><th>Time</th></tr></thead>
      <tbody>${all.map((s) => {
        const late = isOverdue(project, s, today);
        const time = timeText(project, s, today);
        const n = note(s);
        return `<tr${late ? ' class="chg"' : ''}><td>${esc(s.id)}</td><td>${esc(s.kind)}</td><td>${esc(docNumbers(s))}</td><td>${esc(s.title)}${n ? `<div class="ref">${esc(n)}</div>` : ''}</td><td class="c">${esc(revs(s))}</td><td>${esc(s.to)}</td><td>${esc(s.purpose)}</td><td class="nw">${esc(day(s.date))}</td><td class="nw">${esc(day(dueOf(project, s)) || '—')}</td><td>${isOpen(s) ? SUB_STATUS[s.status] : `<b>${SUB_STATUS[s.status]}</b>`}</td><td>${s.responseDate ? `${esc(day(s.responseDate))}${s.responseRef ? `<div class="ref">${esc(s.responseRef)}</div>` : ''}` : '—'}</td><td class="nw">${late ? `<b>${esc(time)}</b>` : esc(time)}</td></tr>`;
      }).join('')}</tbody>
    </table>` : '<p>No submissions recorded.</p>'}
    <p class="small">Time: days from submission to response, or days open so far. Overdue rows (response due date passed, no response) are shaded. A due date not entered is the recipient’s default response time. Drawing submissions come from the drawing set transmittals.</p>
  </section>`;
  const comments = all.flatMap((s) => s.comments.map((cm, i) => ({ s, cm, n: i + 1 })));
  const log = `<section class="page">
    <h2>Comments and actions</h2>
    <p class="small sub">Comments received with each response, the action taken and whether it is closed.</p>
    ${comments.length ? `<table class="b"><colgroup><col style="width:18mm"><col style="width:9mm"><col style="width:26mm"><col><col><col style="width:16mm"><col style="width:22mm"></colgroup>
      <thead><tr><th>Ref.</th><th>No.</th><th>From</th><th>Comment</th><th>Action / response</th><th>Status</th><th>Closed</th></tr></thead>
      <tbody>${comments.map(({ s, cm, n }) => `<tr${cm.closed ? '' : ' class="chg"'}><td>${esc(s.id)}</td><td class="c">${n}</td><td>${esc(cm.from ?? s.to)}</td><td>${esc(cm.text)}</td><td>${esc(cm.action ?? '')}</td><td>${cm.closed ? 'Closed' : '<b>Open</b>'}</td><td class="nw">${esc(day(cm.closed))}</td></tr>`).join('')}</tbody>
    </table>` : '<p>No comments recorded.</p>'}
    <p class="small">Open comments: ${c.openComments}. A submission is closed when it is approved, rejected, superseded by a resubmission, or for information only.</p>
  </section>`;
  return printDoc(project, { title: `${project.name} — Submission register`, headRight: 'SUBMISSION REGISTER', footer: `Submission register · ${day(today)}`, body: register + log, landscape: true })
    .replace('</style>', `.strip { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 1mm 0 4mm; } .strip td { border: 0.4pt solid #000; padding: 1.5mm 2mm; } .strip b { font-size: 12pt; display: block; } .strip span { font-size: 7.4pt; color: #444; }
  table.b { font-size: 7.6pt; table-layout: fixed; } table.b td { overflow-wrap: anywhere; } .nw { white-space: nowrap; }</style>`);
}

/** The transmittal sheet of one submission. */
export function buildTransmittalHtml(project: Project, s: Submission): string {
  const company = project.drawing?.company?.trim() || project.info?.consultant?.trim() || '';
  const due = dueOf(project, s);
  const drawings = s.kind === 'Drawings';
  const rows: [string, string][] = [
    ['To', `<b>${esc(s.to)}</b>${s.address ? `<br>${esc(s.address)}` : ''}`], ['Attention', esc(s.attention ?? '')], ['From', esc(company)],
    ['Project', esc([project.name, [project.info?.plotNo ? `Plot ${project.info.plotNo}` : '', project.info?.area ?? ''].filter(Boolean).join(', ')].filter(Boolean).join(' · '))],
    ['Subject', esc(s.title)],
    ['Date', esc(day(s.date))], ['Your reference', esc(s.yourRef ?? '')],
    ['Purpose', `<b>${esc(s.purpose)}</b>${due ? esc(` — response requested by ${day(due)}`) : ''}`]
  ];
  const body = `<section>
    <h2>${drawings ? 'Drawing' : 'Document'} transmittal ${esc(s.id)}</h2>
    <table class="kv" style="margin-bottom:5mm"><tbody>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>
    <table class="b"><colgroup><col style="width:10mm"><col style="width:36mm"><col><col style="width:12mm"><col style="width:20mm"><col style="width:14mm"></colgroup>
      <thead><tr><th>No.</th><th>${drawings ? 'Drawing' : 'Document'} no.</th><th>Title</th><th>Rev</th><th>Format</th><th>Copies</th></tr></thead>
      <tbody>${s.docs.length ? s.docs.map((d, i) => `<tr><td class="c">${i + 1}</td><td>${esc(d.number)}</td><td>${esc(d.title)}</td><td class="c">${esc(d.rev)}</td><td>${esc(d.format ?? 'PDF')}</td><td class="c">${d.copies ?? 1}</td></tr>`).join('') : '<tr><td></td><td colspan="5"><i>No documents listed</i></td></tr>'}</tbody>
    </table>
    ${s.remarks || s.resubmissionOf ? `<h3>Remarks</h3><p class="pre">${esc([s.resubmissionOf ? `Resubmission of ${s.resubmissionOf}.` : '', s.remarks ?? ''].filter(Boolean).join(' '))}</p>` : ''}
    <table class="grid sign" style="margin-top:12mm"><thead><tr><th style="width:30mm"></th><th>Name</th><th style="width:28mm">Date</th><th style="width:45mm">Signature</th></tr></thead>
      <tbody><tr><td>Sent by</td><td>${esc(s.sentBy ?? '')}</td><td>${esc(day(s.date))}</td><td class="sig"></td></tr>
      <tr><td>Received by</td><td></td><td></td><td class="sig"></td></tr></tbody></table>
  </section>`;
  return printDoc(project, { title: `${project.name} — Transmittal ${s.id}`, headRight: drawings ? 'DRAWING TRANSMITTAL' : 'DOCUMENT TRANSMITTAL', footer: `Transmittal ${s.id} · ${day(s.date)}`, body });
}

/** The register and the comments log in Excel. */
export function buildSubmissionWorkbook(project: Project, today = new Date().toISOString().slice(0, 10)): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'LV Design Studio';
  const thin = { style: 'thin' as const, color: { argb: 'FF808080' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const head = (r: ExcelJS.Row) => { r.font = { bold: true }; r.eachCell((x) => { x.border = box; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }; }); };
  const grey = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8E8E8' } };
  const all = submissionsOf(project);
  const ws = wb.addWorksheet('Submission register', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ header: 'Ref.', width: 10 }, { header: 'Type', width: 11 }, { header: 'Document no.', width: 26 }, { header: 'Title', width: 44 }, { header: 'Rev', width: 6 }, { header: 'Submitted to', width: 18 }, { header: 'Purpose', width: 15 },
    { header: 'Submitted', width: 12 }, { header: 'Response due', width: 12 }, { header: 'Status', width: 22 }, { header: 'Response date', width: 12 }, { header: 'Response ref.', width: 22 }, { header: 'Time', width: 13 }, { header: 'Linked', width: 22 }];
  head(ws.getRow(1));
  for (const s of all) {
    const row = ws.addRow([s.id, s.kind, docNumbers(s), s.title, revs(s), s.to, s.purpose, s.date, dueOf(project, s) ?? '', SUB_STATUS[s.status], s.responseDate ?? '', s.responseRef ?? '', timeText(project, s, today),
      [s.resubmissionOf ? `Resubmission of ${s.resubmissionOf}` : '', s.resubmittedAs ? `Resubmitted as ${s.resubmittedAs}` : ''].filter(Boolean).join('; ')]);
    row.eachCell({ includeEmpty: true }, (x, n) => { if (n <= 14) { x.border = box; if (isOverdue(project, s, today)) x.fill = grey; } });
  }
  const cs = wb.addWorksheet('Comments', { views: [{ state: 'frozen', ySplit: 1 }] });
  cs.columns = [{ header: 'Ref.', width: 10 }, { header: 'No.', width: 5 }, { header: 'From', width: 18 }, { header: 'Comment', width: 60 }, { header: 'Action / response', width: 50 }, { header: 'Status', width: 9 }, { header: 'Closed', width: 12 }];
  head(cs.getRow(1));
  for (const s of all) s.comments.forEach((c, i) => cs.addRow([s.id, i + 1, c.from ?? s.to, c.text, c.action ?? '', c.closed ? 'Closed' : 'Open', c.closed ?? '']));
  for (const w of [ws, cs]) w.getColumn(4).alignment = { wrapText: true, vertical: 'top' };
  return wb;
}
