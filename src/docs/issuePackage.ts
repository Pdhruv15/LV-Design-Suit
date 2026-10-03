import type { Status } from '../calc/electrical';
import type { Project } from '../types';
import { currentRevision } from '../model/revisions';
import { esc } from './report';
import type { Section } from './studyReport';
import pkg from '../../package.json';

/** Issue package: every document in a submission made from ONE frozen
 * calculation run, with a cover listing the contents, the unresolved checks,
 * the assumptions, the app version and a snapshot ID printed on every page. */

export const APP_VERSION: string = pkg.version;

/** Short fingerprint of the calculated project (FNV-1a, 32 bit): the same
 * inputs always give the same ID, any change gives a different one. */
export function snapshotId(project: Project): string {
  const s = JSON.stringify(project);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export interface Unresolved { study: string; item: string; check: string; value: string; status: Exclude<Status, 'ok'> }

/** Everything not passing, as the reports state it: each table row's failing
 * or unverified cells (with the column it sits in), and each summary line that
 * isn't a pass (e.g. "Not verified — supply loop incomplete"). Fails first. */
export function unresolvedChecks(sections: Section[]): Unresolved[] {
  const out: Unresolved[] = [];
  for (const s of sections) {
    for (const m of s.summary) if (m.status && m.status !== 'ok' && !/^(Circuits|Boards|Pairs|Items) checked$/i.test(m.label) && !/\d+ pass · \d+ check · \d+ fail/.test(m.value)) out.push({ study: s.title, item: '—', check: m.label, value: m.value, status: m.status });
    for (const t of s.tables) {
      // The overall result column repeats the cells before it; report the specific checks.
      const last = t.headers.length - 1;
      const overall = /^(result|status)$/i.test(t.headers[last] ?? '');
      for (const row of t.rows) {
        const bad = row.map((c, i) => ({ c, i })).filter(({ c, i }) => typeof c === 'object' && c.s !== 'ok' && !(overall && i === last));
        const shown = bad.length ? bad : overall && typeof row[last] === 'object' && (row[last] as { s: Status }).s !== 'ok' ? [{ c: row[last], i: last }] : [];
        const text = (c: (typeof row)[number]) => String(typeof c === 'object' ? c.v : c);
        for (const { c, i } of shown) {
          const cell = c as { v: string | number; s: Exclude<Status, 'ok'> };
          // Only the overall result is flagged: show the row's figures so the reader sees what to check.
          const check = bad.length ? t.headers[i] ?? '' : row.slice(1, last).map((x, k) => `${t.headers[k + 1]}: ${text(x)}`).join(' · ');
          out.push({ study: s.title, item: text(row[0]), check, value: String(cell.v), status: cell.s });
        }
      }
    }
  }
  return out.sort((a, b) => (a.status === b.status ? 0 : a.status === 'bad' ? -1 : 1));
}

/** The calculation basis of each study, as the reports state it (no repeats). */
export function assumptions(sections: Section[]): { study: string; lines: string[] }[] {
  const seen = new Set<string>();
  return sections.map((s) => ({ study: s.title, lines: s.method.filter((l) => !seen.has(l) && seen.add(l)) })).filter((a) => a.lines.length);
}

export interface PackagePart { title: string; pages: number }
export interface PackageMeta { title: string; docNo?: string; preparedBy?: string; checkedBy?: string; calculatedAt: number; snapshot: string }

/** The footer stamp on every page of the package. */
export const packageStamp = (project: Project, m: PackageMeta) => {
  const rev = currentRevision(project);
  return `${project.name} · ${m.docNo ?? m.title} · ${rev ? `Rev ${rev.id}` : 'no revision'} · snapshot ${m.snapshot} · LV Design Studio ${APP_VERSION}`;
};

/** Cover, contents, unresolved checks and assumptions. `parts` are the
 * documents after this cover; `coverPages` its own length, for page numbers. */
export function packageCoverHtml(project: Project, m: PackageMeta, parts: PackagePart[], coverPages: number, sections: Section[]): string {
  const rev = currentRevision(project);
  const info = project.info ?? {};
  let page = coverPages + 1;
  const contents = parts.map((p) => { const from = page; page += p.pages; return { ...p, from, to: page - 1 }; });
  const open = unresolvedChecks(sections);
  const fails = open.filter((u) => u.status === 'bad').length;
  const basis = assumptions(sections);
  const when = new Date(m.calculatedAt).toLocaleString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const kv = (rows: [string, string | undefined][]) => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || '—')}</td></tr>`).join('')}</table>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} — issue package</title><style>
  @page { size: A4; margin: 14mm 14mm 16mm; } body { font: 10.5px/1.45 Arial, sans-serif; color: #111; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 13px; color: #1d4f8f; border-bottom: 1px solid #1d4f8f; margin: 16px 0 6px; break-after: avoid; }
  .kicker { color: #555; margin: 0 0 10px; } .logo { max-height: 16mm; max-width: 60mm; float: right; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 0.2mm solid #999; padding: 3px 6px; text-align: left; vertical-align: top; }
  thead th { background: #1d4f8f; color: #fff; } .kv th { background: #eef2f7; width: 30%; } td.num { text-align: right; white-space: nowrap; }
  .bad { color: #b00020; font-weight: 700; } .warn { color: #a15c00; font-weight: 700; } .ok { color: #1b7a3a; font-weight: 700; }
  .snap { font: 700 12px monospace; letter-spacing: 1px; } ul { margin: 4px 0 8px 18px; padding: 0; } li { margin: 2px 0; } tr { break-inside: avoid; }
  </style></head><body>
  ${project.drawing?.logo?.startsWith('data:image/') ? `<img class="logo" src="${esc(project.drawing.logo)}" alt="">` : ''}
  <p class="kicker">${esc(project.name)}</p>
  <h1>${esc(m.title)} — issue package</h1>
  ${kv([['Owner', info.owner], ['Consultant', info.consultant], ['Plot / area', [info.plotNo, info.area].filter(Boolean).join(' · ')], ['Document no.', m.docNo],
    ['Revision', rev ? `${rev.id} (${rev.date})${rev.description ? ` — ${rev.description}` : ''}` : 'No revision recorded'], ['Prepared by', m.preparedBy], ['Checked by', m.checkedBy]])}
  <h2>Calculation snapshot</h2>
  ${kv([['Snapshot ID', m.snapshot], ['Calculated', when], ['Calculation engine', `LV Design Studio ${APP_VERSION} (built-in)`], ['System', `${project.voltageV} V, 3-phase + N, ${project.frequencyHz} Hz`]])}
  <p>Every document in this package was produced from this one calculation run. The snapshot ID is printed at the foot of every page; a page with a different ID is not part of this issue.</p>
  <h2>Contents</h2>
  <table><thead><tr><th>#</th><th>Document</th><th>Pages</th></tr></thead><tbody>
  <tr><td>—</td><td>This cover: snapshot, contents, unresolved checks, assumptions</td><td class="num">1${coverPages > 1 ? `–${coverPages}` : ''}</td></tr>
  ${contents.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.title)}</td><td class="num">${c.from}${c.to > c.from ? `–${c.to}` : ''}</td></tr>`).join('')}
  </tbody></table>
  <h2>Unresolved checks</h2>
  ${open.length
    ? `<p><span class="${fails ? 'bad' : 'warn'}">${fails} fail${fails === 1 ? '' : 's'} · ${open.length - fails} to check or not verified</span> — listed as the reports state them. These are open items of this issue, not hidden by it.</p>
  <table><thead><tr><th>Study</th><th>Item</th><th>Check</th><th>Result</th></tr></thead><tbody>${open.map((u) => `<tr><td>${esc(u.study)}</td><td>${esc(u.item)}</td><td>${esc(u.check)}</td><td class="${u.status}">${esc(u.value)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="ok">None — every check in the studies of this package passes.</p>'}
  <h2>Assumptions and calculation basis</h2>
  ${basis.map((a) => `<p><b>${esc(a.study)}</b></p><ul>${a.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')}
  <p class="kicker">Factors and limits are the app's stated defaults unless entered for the project; confirm them against the authority's requirements and the manufacturers' data.</p>
  </body></html>`;
}
