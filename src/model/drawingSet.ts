import type { Board, Feeder, Project } from '../types';
import { boardsInSupplyOrder, boardTotals } from '../calc/summary';
import { subtree } from '../calc/pfc';
import { SHEET_MM } from '../docs/sldSheet';

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
}
export interface DrawingSet {
  prefix: string; // E-SLD-
  sheets: DrawingSheet[];
  register?: boolean; // a drawing register as the first page
  /** Result values printed on the sheets (else SHEET_LAYERS). */
  tags?: import('../diagram/annotations').ResultLayers;
}

export const SIZES: SheetSize[] = ['A4', 'A3', 'A2', 'A1'];
export const setOf = (p: Project): DrawingSet => p.drawingSet ?? { prefix: 'E-SLD-', sheets: [], register: true };
const num = (prefix: string, i: number) => `${prefix}${String(i).padStart(3, '0')}`;
export const renumber = (set: DrawingSet): DrawingSet => ({ ...set, sheets: set.sheets.map((s, i) => ({ ...s, number: num(set.prefix, i + 1) })) });

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

/** The drawing register (first page): sheet no., title, size, revision. */
export function registerHtml(p: Project, rows: { number: string; title: string; size: string }[], rev: string, date: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4 portrait; margin: 16mm; } body { font: 11px Arial, sans-serif; color: #000; }
  h1 { font-size: 16px; margin: 0 0 2px; } .m { color: #555; } table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; } th { background: #eef2f7; }
  </style></head><body><h1>Drawing register — single line diagrams</h1><div class="m">${esc(p.name)} · ${esc(p.info?.owner ?? '')} · Plot ${esc(p.info?.plotNo ?? '')}</div>
  <table><thead><tr><th style="width:18%">Drawing no.</th><th>Title</th><th style="width:9%">Size</th><th style="width:8%">Rev</th><th style="width:14%">Date</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${esc(r.number)}</td><td>${esc(r.title)}</td><td>${esc(r.size)}</td><td>${esc(rev)}</td><td>${esc(date)}</td></tr>`).join('')}
  </tbody></table></body></html>`;
}
