import { PRINT_BASE_CSS } from '../docs/printStyles';
import type { Project } from '../types';
import { escapeHtmlText as esc } from '../util/escape';
import { remarkOf, type ScheduleTable } from './outputs';

/** The ELV schedules as one printable document (A4 landscape, black and white like every report): each non-empty
 * schedule on its own pages, headings repeated on every page, group and total rows bold, the engineer's remarks in
 * the last column, and the schedule's notes under it. */

const CSS = `${PRINT_BASE_CSS}
@page { size: A4 landscape; margin: 12mm 10mm 14mm; }
section + section { break-before: page; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.group td { font-weight: 700; border-top: 1.2pt solid #000; }
td.remark { width: 22%; }
p.note { font-size: 7.5pt; margin: 2px 0; }`;

export function elvSchedulesHtml(project: Project, tables: ScheduleTable[], stamp = ''): string {
  const sections = tables.filter((t) => t.rows.length).map((t) => `<section>
  <h2>${esc(t.title)}</h2>
  <p class="sub">${esc(project.name)}${stamp ? ` · ${esc(stamp)}` : ''}</p>
  <table><thead><tr>${t.columns.map((c) => `<th${c.num ? ' class="num"' : ''}${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}</th>`).join('')}<th>Remarks</th></tr></thead><tbody>
  ${t.rows.map((r) => `<tr${r.kind === 'sum' ? ' class="total"' : r.kind === 'group' ? ' class="group"' : ''}>${r.cells.map((v, i) => `<td${t.columns[i]?.num ? ' class="num"' : ''}>${esc(v)}</td>`).join('')}<td class="remark">${r.kind === 'sum' ? '' : esc(remarkOf(project, t.id, r.key))}</td></tr>`).join('\n  ')}
  </tbody></table>
  ${t.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
</section>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(`${project.name} - ELV schedules`)}</title><style>${CSS}</style></head><body>
${sections.join('\n')}
</body></html>`;
}
