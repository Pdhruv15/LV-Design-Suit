import type { Board, Feeder, Project } from '../types';
import { boardsInSupplyOrder, boardTotals } from '../calc/summary';
import { subtree } from '../calc/pfc';
import { SHEET_MM } from '../docs/sldSheet';
import { boardsWithoutLevel } from './levels';

/** The SLD as a set of sheets. Each sheet shows the panels ticked for it
 * (DBs as a box with their circuit count and kW — their final circuits are
 * on the load schedule), or one DB's own circuit diagram. Feeders to a panel
 * on another sheet end in "to X — sheet N". The size is chosen from what's
 * drawn: the smallest of A4…A1 that keeps the text readable. */

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1';
export interface DrawingSheet {
  id: string;
  number: string; // e.g. E-SLD-002
  title: string; // e.g. SLD — MDB-1
  kind: 'system' | 'board'; // board = one DB's circuit diagram
  boards: string[];
  size: 'auto' | SheetSize;
  // Title block of this sheet (blank = the project's, managed in the drawing register)
  status?: string; // e.g. FOR APPROVAL, IFC, AS-BUILT
  rev?: string; // blank = the project's current revision
  date?: string;
  drawnBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  scale?: string; // default NTS
  remarks?: string; // register only
  history?: SheetRev[]; // this sheet's issued revisions, oldest first
  // This sheet only (blank = the set's / project's):
  cableLabels?: 'auto' | 'ref' | 'full';
  tags?: import('../diagram/annotations').ResultLayers; // values printed (a "view": e.g. fault levels sheet)
  notes?: string[]; // notes on this sheet only
  clouds?: SheetCloud[]; // revision clouds around panels
  issuedHash?: string; // what was drawn when last issued (to flag changes since)
  arrows?: SheetArrow[]; // callouts with a leader arrow, on this sheet only
}
/** A callout: text with a leader arrow pointing at a panel or a circuit. */
export interface SheetArrow { target: string; text: string; dir: 'ne' | 'nw' | 'se' | 'sw'; len?: number } // target: board id, or "f:" + feeder id
/** A revision cloud around panels on one sheet, with its revision triangle. */
export interface SheetCloud { boards: string[]; rev: string }
/** One issued revision of a sheet (printed in its title block revision table). */
export interface SheetRev { rev: string; date: string; description: string; issueId?: string }
/** One issue of drawings (a transmittal): which sheets, at which revision, why. */
export interface DrawingIssue {
  id: string; // T-001
  date: string;
  purpose: string; // e.g. FOR APPROVAL
  description: string;
  to?: string; // recipient, e.g. DEWA
  sheets: { id: string; number: string; title: string; rev: string }[];
}
export interface DrawingSet {
  prefix: string; // E-SLD-
  sheets: DrawingSheet[];
  register?: boolean; // a drawing register as the first page
  /** Result values printed on the sheets (else SHEET_LAYERS). */
  tags?: import('../diagram/annotations').ResultLayers;
  /** Numbers typed by hand: renumbering fills blanks only. */
  manualNumbers?: boolean;
  start?: number; // first number (default 1)
  digits?: number; // zero padding (default 3)
  suffix?: string; // after the number, e.g. "-EL"
  status?: string; // default status of every sheet
  issues?: DrawingIssue[]; // transmittals, oldest first
}

export const SHEET_STATUSES = ['FOR APPROVAL', 'FOR AUTHORITY SUBMISSION', 'FOR TENDER', 'FOR CONSTRUCTION', 'AS-BUILT', 'PRELIMINARY'];

export const SIZES: SheetSize[] = ['A4', 'A3', 'A2', 'A1'];
export const setOf = (p: Project): DrawingSet => p.drawingSet ?? { prefix: 'E-SLD-', sheets: [], register: true };
export const sheetNumber = (set: DrawingSet, i: number) => `${set.prefix}${String((set.start ?? 1) + i).padStart(set.digits ?? 3, '0')}${set.suffix ?? ''}`;
/** Numbers in order (prefix, start, digits, suffix); with manual numbers only blanks are filled. */
export const renumber = (set: DrawingSet, force = false): DrawingSet => ({
  ...set,
  sheets: set.sheets.map((s, i) => ({ ...s, number: set.manualNumbers && !force && s.number ? s.number : sheetNumber(set, i) }))
});

const isDb = (b: Board) => (b.kind ?? (b.upstreamId ? 'DB' : 'MDB')) === 'DB';

/** Automatic sets. perMdb: an overview (when there are several MDBs) and one
 * sheet per MDB with everything it feeds. perSmdb: an overview of the MDBs
 * and SMDBs, then a sheet per SMDB / MCC with its DBs. dbSheets: also a
 * circuit diagram sheet for every DB. */
export function autoSheets(p: Project, mode: 'perMdb' | 'perSmdb', dbSheets = false, prefix = 'E-SLD-'): DrawingSet {
  const order = boardsInSupplyOrder(p);
  const mains = order.filter((b) => !b.upstreamId);
  const sheets: Omit<DrawingSheet, 'number'>[] = [];
  const id = () => `sh-${Math.random().toString(36).slice(2, 8)}`;
  if (mode === 'perMdb') {
    if (mains.length > 1) sheets.push({ id: id(), title: 'SLD — overall (main boards and sub-mains)', kind: 'system', boards: order.filter((b) => !isDb(b)).map((b) => b.id), size: 'auto' });
    for (const m of mains) sheets.push({ id: id(), title: `SLD — ${m.id}`, kind: 'system', boards: order.filter((b) => subtree(p, m.id).has(b.id)).map((b) => b.id), size: 'auto' });
  } else {
    const subs = order.filter((b) => b.upstreamId && mains.some((m) => m.id === b.upstreamId) && !isDb(b));
    sheets.push({ id: id(), title: 'SLD — main boards and sub-mains', kind: 'system', boards: [...mains, ...subs].map((b) => b.id), size: 'auto' });
    for (const s of subs) {
      const below = order.filter((b) => subtree(p, s.id).has(b.id));
      if (below.length > 1) sheets.push({ id: id(), title: `SLD — ${s.id}`, kind: 'system', boards: below.map((b) => b.id), size: 'auto' });
    }
  }
  if (dbSheets) for (const b of order.filter((x) => isDb(x) && p.feeders.some((f) => f.boardId === x.id))) sheets.push({ id: id(), title: `${b.id} — circuit diagram`, kind: 'board', boards: [b.id], size: 'auto' });
  return renumber({ prefix, register: true, sheets: sheets.map((s) => ({ ...s, number: '' })) });
}

/** Sheets of at most n panels each (authority submissions: e.g. 10 per
 * sheet), in supply order, keeping each panel's branch together where it
 * fits: a sub-main's branch starts a new sheet rather than being split. */
export function sheetsByCount(p: Project, n: number, prefix = 'E-SLD-'): DrawingSet {
  const max = Math.max(1, Math.round(n));
  const order = boardsInSupplyOrder(p);
  const sheets: string[][] = [[]];
  const size = (id: string) => order.filter((b) => subtree(p, id).has(b.id)).length;
  for (const b of order) {
    const cur = sheets[sheets.length - 1];
    // A panel whose whole branch fits on a fresh sheet but not on this one starts a new sheet.
    const branch = size(b.id);
    const parentHere = !!b.upstreamId && cur.includes(b.upstreamId);
    const startNew = cur.length >= max || (cur.length > 0 && branch > 1 && branch <= max && cur.length + branch > max && !(parentHere && cur.length + 1 <= max && branch > max));
    if (startNew) sheets.push([b.id]);
    else cur.push(b.id);
  }
  const list = sheets.filter((x) => x.length);
  return renumber({
    prefix, register: true,
    sheets: list.map((boards, i) => ({ id: `sh-${Math.random().toString(36).slice(2, 8)}`, number: '', title: `SLD — ${boards[0]}${boards.length > 1 ? ` to ${boards[boards.length - 1]}` : ''}${list.length > 1 ? ` (${i + 1} of ${list.length})` : ''}`, kind: 'system' as const, boards, size: 'auto' as const }))
  });
}

/** Where each board is drawn in full (its first system sheet, or its DB sheet). */
export function sheetOfBoard(set: DrawingSet): Map<string, DrawingSheet> {
  const m = new Map<string, DrawingSheet>();
  for (const s of set.sheets) if (s.kind === 'system') for (const b of s.boards) if (!m.has(b)) m.set(b, s);
  return m;
}

/** The project as drawn on one system sheet: its panels only; a feeder to a
 * panel drawn elsewhere becomes an outgoing way "to X — sheet N". */
export function sheetProject(p: Project, set: DrawingSet, sheet: DrawingSheet): Project {
  const ids = new Set(sheet.boards);
  const where = sheetOfBoard(set);
  const feeders: Feeder[] = p.feeders.filter((f) => ids.has(f.boardId)).map((f) => {
    if (!f.feedsBoardId || ids.has(f.feedsBoardId)) return f;
    const other = where.get(f.feedsBoardId);
    const t = boardTotals(p, f.feedsBoardId);
    const { feedsBoardId: _x, ...rest } = f;
    return { ...rest, name: `To ${f.feedsBoardId}${other ? ` — sheet ${other.number}` : ''}`, loadType: 'general', loadKw: t.connectedKw, demandFactor: t.connectedKw > 0 ? t.demandKw / t.connectedKw : 1, powerFactor: t.demandKw ? t.demandKw / Math.max(t.demandKw, Math.hypot(t.demandKw, t.demandKvar)) : 0.9 };
  });
  return {
    ...p,
    boards: p.boards.filter((b) => ids.has(b.id)),
    feeders,
    ties: (p.ties ?? []).filter((t) => ids.has(t.a) && ids.has(t.b))
  };
}

/** Smallest sheet on which the drawing stays readable (text ≥ ≈ 2 mm):
 * drawing area = sheet − frame (30 × 20 mm) − title block band (48 mm). */
export const MIN_MM_PER_PX = 0.2;
export function autoSize(widthPx: number, heightPx: number): { size: SheetSize; scale: number; fits: boolean } {
  for (const size of SIZES) {
    const { w, h } = SHEET_MM[size];
    const scale = Math.min((w - 36) / widthPx, (h - 20 - 48) / heightPx);
    if (scale >= MIN_MM_PER_PX) return { size, scale, fits: true };
  }
  const { w, h } = SHEET_MM.A1;
  return { size: 'A1', scale: Math.min((w - 36) / widthPx, (h - 68) / heightPx), fits: false };
}

/** The drawing register (cover page of the set): project details, every
 * sheet with its revision, date and status, and the issue history. */
export interface RegisterRow { number: string; title: string; size: string; rev?: string; date?: string; status?: string }
export function registerHtml(p: Project, rows: RegisterRow[], rev: string, date: string, issues: DrawingIssue[] = [], company = ''): string {
  const esc = escH;
  const recent = issues.slice(-8).reverse();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Drawing register</title><style>
  @page { size: A4 portrait; margin: 16mm; } body { font: 11px Arial, sans-serif; color: #000; }
  .co { font-weight: bold; font-size: 13px; } h1 { font-size: 18px; margin: 2px 0 8px; } h2 { font-size: 13px; margin: 14px 0 0; } .m { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; } th { background: #eef2f7; }
  .kv td:first-child { width: 24%; background: #f6f8fb; font-weight: bold; }
  </style></head><body><div class="co">${esc(company)}</div><h1>Drawing register — single line diagrams</h1>
  <table class="kv"><tbody>
  <tr><td>Project</td><td>${esc(p.name)}</td></tr>
  <tr><td>Owner / client</td><td>${esc(p.info?.owner ?? '')}</td></tr>
  <tr><td>Consultant</td><td>${esc(p.info?.consultant ?? '')}</td></tr>
  <tr><td>Plot no. / area</td><td>${esc([p.info?.plotNo, p.info?.area].filter(Boolean).join(' · '))}</td></tr>
  <tr><td>Sheets</td><td>${rows.length}</td></tr>
  </tbody></table>
  <h2>Drawings</h2>
  <table><thead><tr><th style="width:5%">#</th><th style="width:18%">Drawing no.</th><th>Title</th><th style="width:7%">Size</th><th style="width:7%">Rev</th><th style="width:12%">Date</th><th style="width:17%">Status</th></tr></thead><tbody>
  ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.number)}</td><td>${esc(r.title)}</td><td>${esc(r.size)}</td><td>${esc(r.rev || rev)}</td><td>${esc(r.date || date)}</td><td>${esc(r.status ?? '')}</td></tr>`).join('')}
  </tbody></table>
  ${recent.length ? `<h2>Issue history</h2><table><thead><tr><th style="width:11%">Issue</th><th style="width:12%">Date</th><th style="width:20%">Purpose</th><th>Description</th><th style="width:14%">To</th><th style="width:8%">Sheets</th></tr></thead><tbody>
  ${recent.map((x) => `<tr><td>${esc(x.id)}</td><td>${esc(x.date)}</td><td>${esc(x.purpose)}</td><td>${esc(x.description)}</td><td>${esc(x.to ?? '')}</td><td>${x.sheets.length}</td></tr>`).join('')}</tbody></table>` : ''}
  </body></html>`;
}

/** Next revision: A→B, Z→AA, 0→1, P1→P2, C2→C3; blank → A. */
export function nextRev(r?: string): string {
  const v = (r ?? '').trim();
  if (!v || v === '—') return 'A';
  const m = v.match(/^(.*?)(\d+)$/);
  if (m) return `${m[1]}${String(Number(m[2]) + 1).padStart(m[2].length, '0')}`;
  if (/^[A-Z]+$/i.test(v)) {
    const up = v === v.toUpperCase();
    const chars = v.toUpperCase().split('');
    let i = chars.length - 1;
    while (i >= 0 && chars[i] === 'Z') { chars[i] = 'A'; i--; }
    if (i < 0) chars.unshift('A'); else chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
    const out = chars.join('');
    return up ? out : out.toLowerCase();
  }
  return `${v}1`;
}

/** Revision a sheet carries now: its own, else its last issue, else the project's. */
export const sheetRev = (s: DrawingSheet, projectRev?: string) => s.rev || s.history?.[s.history.length - 1]?.rev || projectRev || '';

export interface IssueInput { date: string; purpose: string; description: string; to?: string; bump: boolean }
/** Issues the chosen sheets: each moves to its next revision (when bump),
 * takes the date and purpose as its status, records the revision in its
 * history, and the set records a transmittal. */
export function issueSheets(set: DrawingSet, ids: string[], o: IssueInput, projectRev?: string, hashOf?: (s: DrawingSheet) => string): { set: DrawingSet; issue: DrawingIssue } {
  const n = (set.issues ?? []).length + 1;
  const id = `T-${String(n).padStart(3, '0')}`;
  const chosen = new Set(ids);
  const sheets = set.sheets.map((s) => {
    if (!chosen.has(s.id)) return s;
    const cur = sheetRev(s, projectRev);
    const rev = o.bump && (s.history?.length || s.rev) ? nextRev(cur) : (cur || 'A');
    return { ...s, rev, date: o.date, status: o.purpose || s.status, issuedHash: hashOf?.(s), history: [...(s.history ?? []), { rev, date: o.date, description: o.description || o.purpose, issueId: id }] };
  });
  const issue: DrawingIssue = {
    id, date: o.date, purpose: o.purpose, description: o.description, to: o.to || undefined,
    sheets: sheets.filter((s) => chosen.has(s.id)).map((s) => ({ id: s.id, number: s.number, title: s.title, rev: s.rev ?? '' }))
  };
  return { set: { ...set, sheets, issues: [...(set.issues ?? []), issue] }, issue };
}

/** Moves a sheet to a new position; automatic numbers follow the order. */
export function moveSheet(set: DrawingSet, from: number, to: number): DrawingSet {
  if (from === to || from < 0 || to < 0 || from >= set.sheets.length || to >= set.sheets.length) return set;
  const sheets = [...set.sheets];
  const [s] = sheets.splice(from, 1);
  sheets.splice(to, 0, s);
  return renumber({ ...set, sheets });
}

export type SheetType = 'sld' | 'db';
export const sheetType = (s: DrawingSheet): SheetType => (s.kind === 'board' ? 'db' : 'sld');
export interface SheetFilter { q?: string; status?: string; rev?: string; type?: SheetType | '' }
export type SheetSort = { key: 'order' | 'number' | 'title' | 'status' | 'rev' | 'date'; desc?: boolean };

/** Sheets matching the filter (search in number, title, panels, remarks), sorted. */
export function filterSheets(set: DrawingSet, f: SheetFilter, sort: SheetSort = { key: 'order' }, projectRev?: string): DrawingSheet[] {
  const q = (f.q ?? '').trim().toLowerCase();
  const list = set.sheets.filter((s) => {
    if (f.type && sheetType(s) !== f.type) return false;
    if (f.status && (s.status || set.status || '') !== f.status) return false;
    if (f.rev && sheetRev(s, projectRev) !== f.rev) return false;
    if (q && ![s.number, s.title, s.remarks ?? '', ...s.boards].some((x) => x.toLowerCase().includes(q))) return false;
    return true;
  });
  if (sort.key === 'order') return sort.desc ? list.reverse() : list;
  const val = (s: DrawingSheet) => sort.key === 'status' ? (s.status || set.status || '') : sort.key === 'rev' ? sheetRev(s, projectRev) : String(s[sort.key as 'number' | 'title' | 'date'] ?? '');
  const out = [...list].sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true }));
  return sort.desc ? out.reverse() : out;
}

/** Colour of a status badge (thumbnails, register). */
export function statusColor(status?: string): string {
  const s = (status ?? '').toUpperCase();
  if (s.includes('CONSTRUCTION')) return '#15803d';
  if (s.includes('AS-BUILT') || s.includes('AS BUILT')) return '#0f766e';
  if (s.includes('APPROV') || s.includes('AUTHORITY')) return '#b45309';
  if (s.includes('TENDER')) return '#1d4ed8';
  if (s.includes('PRELIM')) return '#64748b';
  return s ? '#6d28d9' : '#94a3b8';
}

const escH = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A transmittal: which sheets were issued, at which revision, to whom and why. */
export function transmittalHtml(p: Project, issue: DrawingIssue, company = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Transmittal ${escH(issue.id)}</title><style>
  @page { size: A4 portrait; margin: 16mm; } body { font: 11px Arial, sans-serif; color: #000; }
  h1 { font-size: 18px; margin: 0; } .co { font-weight: bold; font-size: 13px; } .m { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; } th { background: #eef2f7; }
  .kv td:first-child { width: 28%; background: #f6f8fb; font-weight: bold; } .sign { margin-top: 28px; display: flex; gap: 40px; } .sign div { flex: 1; border-top: 1px solid #000; padding-top: 4px; }
  </style></head><body>
  <div class="co">${escH(company)}</div><h1>Drawing transmittal ${escH(issue.id)}</h1>
  <table class="kv"><tbody>
  <tr><td>Project</td><td>${escH(p.name)}</td></tr>
  <tr><td>Owner / client</td><td>${escH(p.info?.owner ?? '')}${p.info?.plotNo ? ` · Plot ${escH(p.info.plotNo)}` : ''}</td></tr>
  <tr><td>To</td><td>${escH(issue.to ?? '')}</td></tr>
  <tr><td>Date</td><td>${escH(issue.date)}</td></tr>
  <tr><td>Purpose of issue</td><td>${escH(issue.purpose)}</td></tr>
  <tr><td>Description</td><td>${escH(issue.description)}</td></tr>
  </tbody></table>
  <table><thead><tr><th style="width:6%">#</th><th style="width:22%">Drawing no.</th><th>Title</th><th style="width:8%">Rev</th><th style="width:10%">Copies</th></tr></thead><tbody>
  ${issue.sheets.map((s, i) => `<tr><td>${i + 1}</td><td>${escH(s.number)}</td><td>${escH(s.title)}</td><td>${escH(s.rev)}</td><td>1 (PDF)</td></tr>`).join('')}
  </tbody></table>
  <p class="m">${issue.sheets.length} drawing(s).</p>
  <div class="sign"><div>Issued by</div><div>Received by (name, signature, date)</div></div>
  </body></html>`;
}

/** Fingerprint of what a sheet draws (its panels, their circuits and the
 * values on them) — compared with the one stored when it was issued. */
export function sheetHash(p: Project, set: DrawingSet, s: DrawingSheet): string {
  const d = s.kind === 'board' ? { boards: p.boards.filter((b) => b.id === s.boards[0]), feeders: p.feeders.filter((f) => f.boardId === s.boards[0]) } : sheetProject(p, set, s);
  const txt = JSON.stringify([d.boards, d.feeders, s.title, s.size, s.tags, s.notes, s.clouds, s.arrows]);
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

export interface SheetCheck { level: 'bad' | 'warn'; text: string; sheetId?: string; boardId?: string }

/** Before publishing: panels on no sheet, empty sheets, missing title
 * block details, sheets changed since their last issue, failing circuits.
 * (Crowded sheets are found when the sheets are drawn.) */
export function sheetChecks(p: Project, set: DrawingSet, failing: { feederId: string; boardId: string; status: string }[] = []): SheetCheck[] {
  const out: SheetCheck[] = [];
  if (!set.sheets.length) return [{ level: 'bad', text: 'No sheets yet — add one with + or Split by panels.' }];
  const drawn = new Set(set.sheets.filter((s) => s.kind === 'system').flatMap((s) => s.boards));
  for (const b of p.boards) if (!drawn.has(b.id)) {
    const db = (b.kind ?? (b.upstreamId ? 'DB' : 'MDB')) === 'DB';
    out.push({ level: db ? 'warn' : 'bad', text: db ? `${b.id} is on no sheet (shown only as an outgoing way “To ${b.id}”)` : `${b.id} is on no sheet`, boardId: b.id });
  }
  for (const s of set.sheets) if (!s.boards.length) out.push({ level: 'bad', text: `${s.number}: no panels on the sheet`, sheetId: s.id });
  const d = p.drawing ?? {}, info = p.info ?? {}, pp = p.params ?? {};
  const missing = [
    !(d.company || info.consultant) && 'company / consultant',
    !info.owner && 'owner / client',
    !(pp.drawnBy || d.drawnBy || set.sheets.every((s) => s.drawnBy)) && 'drawn by',
    !(pp.checkedBy || d.checkedBy || set.sheets.every((s) => s.checkedBy)) && 'checked by'
  ].filter(Boolean);
  if (missing.length) out.push({ level: 'warn', text: `Title block: ${missing.join(', ')} not filled in` });
  for (const s of set.sheets) if (s.issuedHash && s.issuedHash !== sheetHash(p, set, s)) out.push({ level: 'warn', text: `${s.number} changed since it was issued (Rev ${s.rev ?? '—'}) — issue a new revision`, sheetId: s.id });
  const noLevel = boardsWithoutLevel(p);
  if (noLevel.length) out.push({ level: 'warn', text: `${noLevel.length} panel(s) have no level (Building information): ${noLevel.slice(0, 6).map((b) => b.id).join(', ')}${noLevel.length > 6 ? ' …' : ''}`, boardId: noLevel[0].id });
  const onSheets = failing.filter((f) => drawn.has(f.boardId));
  const bad = onSheets.filter((f) => f.status === 'fail').length, warn = onSheets.filter((f) => f.status === 'warn').length;
  if (bad) out.push({ level: 'bad', text: `${bad} circuit(s) fail a check (cable, breaker or voltage drop) — they print in red` });
  if (warn) out.push({ level: 'warn', text: `${warn} circuit(s) need checking` });
  return out;
}

/** Sheet templates: paper size, cable text, values printed, notes, status,
 * scale — applied to new or existing sheets. Kept on this computer and in
 * the database Library.json. */
export interface SheetTemplate { id: string; name: string; size: DrawingSheet['size']; cableLabels?: DrawingSheet['cableLabels']; tags?: DrawingSheet['tags']; notes?: string[]; status?: string; scale?: string }
const TPL = 'lvds.sheetTemplates';
export function loadSheetTemplates(): SheetTemplate[] { try { return JSON.parse(localStorage.getItem(TPL) ?? '[]'); } catch { return []; } }
export function saveSheetTemplates(list: SheetTemplate[]): void {
  try { localStorage.setItem(TPL, JSON.stringify(list)); } catch { /* storage blocked */ }
  void import('../database/librarySync').then((m) => m.pushLibrary());
}
export const templateFromSheet = (s: DrawingSheet, name: string): SheetTemplate => ({ id: `st-${Date.now().toString(36)}`, name, size: s.size, cableLabels: s.cableLabels, tags: s.tags, notes: s.notes, status: s.status, scale: s.scale });
export const applyTemplate = (s: DrawingSheet, t: SheetTemplate): DrawingSheet => ({ ...s, size: t.size, cableLabels: t.cableLabels, tags: t.tags, notes: t.notes, status: t.status ?? s.status, scale: t.scale ?? s.scale });

/** A new system sheet with these panels (e.g. a selected panel and its branch). */
export function addSheet(set: DrawingSet, boards: string[], title: string): { set: DrawingSet; id: string } {
  const id = `sh-${Date.now().toString(36)}`;
  return { id, set: renumber({ ...set, sheets: [...set.sheets, { id, number: '', title, kind: 'system', boards, size: 'auto' }] }) };
}

/** Moves a panel to another sheet (Design: drag it into that sheet's
 * outline): off every other SLD sheet, onto this one in supply order. */
export function movePanelToSheet(set: DrawingSet, boardId: string, sheetId: string, supplyOrder: string[]): DrawingSet {
  return {
    ...set,
    sheets: set.sheets.map((s) => {
      if (s.kind !== 'system') return s;
      if (s.id === sheetId) return s.boards.includes(boardId) ? s : { ...s, boards: supplyOrder.filter((id) => id === boardId || s.boards.includes(id)) };
      return s.boards.includes(boardId) ? { ...s, boards: s.boards.filter((b) => b !== boardId) } : s;
    })
  };
}
