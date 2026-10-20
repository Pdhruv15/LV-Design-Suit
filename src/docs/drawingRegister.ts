import type { Project } from '../types';
import { sheetRev, type DrawingIssue, type DrawingSet, type RegisterRow } from '../model/drawingSet';
import { printDoc } from './printDoc';
import { esc } from './report';

/** Register rows with each sheet's own revision, date and status. */
export const registerRows = (set: DrawingSet, sizes: [string, string][] = [], projectRev?: string) => {
  const m = new Map(sizes);
  return set.sheets.map((s) => ({ number: s.number, title: s.title, size: m.get(s.id) ?? (s.size === 'auto' ? 'Auto' : s.size), rev: sheetRev(s, projectRev) || undefined, date: s.date || s.history?.[s.history.length - 1]?.date, status: s.status || set.status }));
};

/** The drawing register: every sheet with its revision, date and status, and the issue history
 * (the last eight issues), on the same print document as the submission register and transmittals. */
export function registerHtml(p: Project, rows: RegisterRow[], rev: string, date: string, issues: DrawingIssue[] = [], company = ''): string {
  const recent = issues.slice(-8).reverse();
  const info: [string, string][] = [
    ['Project', p.name], ['Owner / client', p.info?.owner ?? ''], ['Consultant', p.info?.consultant ?? company],
    ['Plot no. / area', [p.info?.plotNo, p.info?.area].filter(Boolean).join(' · ')], ['Sheets', String(rows.length)]
  ];
  const body = `<section>
    <h2>Drawing register — single line diagrams</h2>
    <table class="kv" style="margin-bottom:5mm"><tbody>${info.map(([k, v]) => `<tr><td>${k}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
    <h3>Drawings</h3>
    <table class="b"><colgroup><col style="width:9mm"><col style="width:32mm"><col><col style="width:12mm"><col style="width:12mm"><col style="width:22mm"><col style="width:32mm"></colgroup>
      <thead><tr><th>#</th><th>Drawing no.</th><th>Title</th><th>Size</th><th>Rev</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${esc(r.number)}</td><td>${esc(r.title)}</td><td class="c">${esc(r.size)}</td><td class="c">${esc(r.rev || rev)}</td><td class="nw">${esc(r.date || date)}</td><td>${esc(r.status ?? '')}</td></tr>`).join('')}</tbody>
    </table>
    ${recent.length ? `<h3>Issue history</h3>
    <table class="b"><colgroup><col style="width:18mm"><col style="width:22mm"><col style="width:32mm"><col><col style="width:24mm"><col style="width:14mm"></colgroup>
      <thead><tr><th>Issue</th><th>Date</th><th>Purpose</th><th>Description</th><th>To</th><th>Sheets</th></tr></thead>
      <tbody>${recent.map((x) => `<tr><td>${esc(x.id)}</td><td class="nw">${esc(x.date)}</td><td>${esc(x.purpose)}</td><td>${esc(x.description)}</td><td>${esc(x.to ?? '')}</td><td class="c">${x.sheets.length}</td></tr>`).join('')}</tbody>
    </table>` : ''}
  </section>`;
  return printDoc(p, { title: `${p.name} — Drawing register`, headRight: 'DRAWING REGISTER', footer: `Drawing register · Rev ${rev} · ${date}`, body });
}
