import type { Project } from '../types';
import type { DrawingSet } from '../model/drawingSet';
import { cablesAtGap, COUNT_COLS, countTotal, dbRiserLayout, entryHeight, ENTRY_H, MAIN_H, ROW_MIN_H, rowsTotal, type CountCol, type DbRiserLayout, type DbRiserMain, type DbRiserRow, type DbRiserRun, type KindCount, type RowEntry } from '../model/dbRiser';

/** One sheet of a building's "Boards by level" riser (printable SVG, black and white).
 * Levels top to bottom, one column group per main panel with its busbar and one
 * breaker per outgoing, the same columns on every sheet so the risers line up
 * across a break. Right: boards counted per floor and per building. Below: the
 * riser table and notes. */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ln = (x1: number, y1: number, x2: number, y2: number, w = 1.2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111" stroke-width="${w}"/>`;
const text = (x: number, y: number, s: string, o = '') => `<text x="${x}" y="${y}"${o ? ` ${o}` : ''}>${esc(s)}</text>`;
const dot = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="3" fill="#111"/>`;
const box = (x: number, y: number, w: number, h: number, t: string, sub = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#111" stroke-width="1.2"/>` +
  text(x + w / 2, y + (sub ? h / 2 - 2 : h / 2 + 4), t, 'text-anchor="middle" font-weight="bold"') +
  (sub ? text(x + w / 2, y + h / 2 + 10, sub, 'text-anchor="middle" font-size="8"') : '');
/** Break symbol: floors omitted here, the riser carries on. */
const zigzag = (x: number, y: number) => `<rect x="${x - 7}" y="${y - 6}" width="14" height="12" fill="#fff"/><path d="M${x} ${y - 7}L${x} ${y - 4}L${x - 6} ${y - 1}L${x + 6} ${y + 1}L${x} ${y + 4}L${x} ${y + 7}" fill="none" stroke="#111" stroke-width="1.4"/>`;
/** Continuation flag: the same letter on the next sheet is the same riser. */
const flag = (x: number, y: number, letter: string, up: boolean) => {
  const d = up ? -1 : 1;
  return `<path d="M${x - 9} ${y}L${x - 9} ${y + d * 12}L${x} ${y + d * 20}L${x + 9} ${y + d * 12}L${x + 9} ${y}Z" fill="#fff" stroke="#111" stroke-width="1.2"/>` + text(x, y + d * 11 + 3.5, letter, 'text-anchor="middle" font-weight="bold"');
};
const matchLine = (x1: number, x2: number, y: number) => ln(x1, y, x2, y, 1.6).replace('/>', ' stroke-dasharray="12 4 2 4"/>');
const ampsText = (r: number[], each: boolean) => (!r.length ? '' : `${each ? 'each ' : ''}${r.length === 1 ? r[0] : `${r[0]}–${r[r.length - 1]}`} A`);

const LEFT = 110, RUN_W = 58, GROUP_GAP = 22, SOURCE_W = 62, AREA_W = 182, AREA_MIN = 100, HEAD_W = 76, KID_W = 88;
const COL_LABEL: Record<CountCol, string> = { mdb: 'MDB', smdb: 'SMDB', db: 'DB', edb: 'EDB', mcc: 'MCC', ups: 'UPS' };
const TOP = 92, MATCH_H = 34;

interface Group { main: DbRiserMain; x: number; x1: number; x2: number; areaX: number; runX: Map<string, number>; areaW: number }

/** The same columns on every sheet. */
function groupsOf(L: DbRiserLayout): { groups: Group[]; right: number } {
  let x = LEFT;
  const groups = L.mains.map((main) => {
    const hasSource = !!main.sourceKva || main.hasStandby;
    const x1 = x + (hasSource ? SOURCE_W : 0);
    const runX = new Map(main.runs.map((r, i) => [r.id, x1 + 24 + i * RUN_W]));
    const areaX = x1 + 24 + Math.max(main.runs.length, main.localEntries ? 1 : 0) * RUN_W;
    const hasEntries = L.rows.some((r) => r.entries.some((e) => e.board.upstreamId === main.board.id));
    const areaW = hasEntries ? AREA_W : AREA_MIN;
    const g: Group = { main, x, x1, x2: areaX + areaW, areaX, runX, areaW };
    x = g.x2 + GROUP_GAP;
    return g;
  });
  return { groups, right: x - GROUP_GAP };
}

interface RowGeom { top: number; h: number; encl?: Map<string, { y1: number; y2: number }>; entryY: Map<RowEntry, number> }

/** Heights and box positions of one sheet's rows, top to bottom. */
function rowGeometry(L: DbRiserLayout, page: number[], y0: number): { geom: Map<number, RowGeom>; bottom: number } {
  const geom = new Map<number, RowGeom>();
  let y = y0;
  for (const i of [...page].reverse()) {
    const r = L.rows[i];
    const stack = new Map<string, number>();
    for (const e of r.entries) stack.set(e.board.upstreamId!, (stack.get(e.board.upstreamId!) ?? 0) + entryHeight(e));
    const h = Math.max(ROW_MIN_H, Math.max(0, ...stack.values()) + (r.mainIds.length ? MAIN_H : 0) + 16);
    const g: RowGeom = { top: y, h, encl: new Map(), entryY: new Map() };
    const used = new Map<string, number>();
    for (const e of r.entries) {
      const m = e.board.upstreamId!;
      const hasMain = r.mainIds.includes(m), total = stack.get(m)!;
      const start = hasMain ? y + 6 : y + (h - total) / 2;
      const at = used.get(m) ?? 0;
      g.entryY.set(e, start + at + entryHeight(e) / 2);
      used.set(m, at + entryHeight(e));
    }
    for (const id of r.mainIds) { const y2 = y + h - 6; g.encl!.set(id, { y1: y2 - MAIN_H + 8, y2 }); }
    geom.set(i, g);
    y += h;
  }
  return { geom, bottom: y };
}

function entryBoxes(e: RowEntry, x: number, y: number, floors: number): string {
  const kidY = (i: number) => y - entryHeight(e) / 2 + ENTRY_H * (i + 0.5);
  const kidBox = (k: KindCount, i: number) => box(x + HEAD_W + 14, kidY(i) - 18, KID_W, 36, `${k.kind} ×${k.count}`, ampsText(k.ratings, k.count > 1));
  if (!e.kids.length) {
    const named = e.count === 1 && floors === 1 && e.kind !== 'DB' && e.kind !== 'EDB' && e.kind !== 'MCC';
    return box(x, y - 18, HEAD_W + 14, 36, named ? e.board.id : `${e.kind} ×${e.count}`, floors > 1 ? 'each floor' : ampsText(e.ratings, e.count > 1));
  }
  const title = e.count > 1 ? `${e.kind} ×${e.count}` : floors > 1 ? `${e.board.id} …` : e.board.id;
  let s = box(x, y - 18, HEAD_W, 36, title, ampsText(e.ratings, false));
  if (e.kids.length === 1) return s + ln(x + HEAD_W, y, x + HEAD_W + 14, y) + kidBox(e.kids[0], 0);
  const bx = x + HEAD_W + 7;
  s += ln(x + HEAD_W, y, bx, y) + ln(bx, kidY(0), bx, kidY(e.kids.length - 1));
  e.kids.forEach((k, i) => { s += ln(bx, kidY(i), x + HEAD_W + 14, kidY(i)) + kidBox(k, i); });
  return s;
}

export interface DbRiserOpts {
  /** Sheet numbers of the riser's sheets (bottom first), for the match lines and riser table. */
  sheetNos?: string[];
}

/** One sheet of the riser (part 0 = the bottom sheet). */
export function dbRiserDrawing(project: Project, buildingId: string, opts: DbRiserOpts = {}, part = 0, given?: DbRiserLayout): { svg: string; w: number; h: number; pages: number } {
  const L = given ?? dbRiserLayout(project, buildingId);
  if (L.empty) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 120" width="600" height="120" font-family="Arial" font-size="10" fill="#111"><rect width="600" height="120" fill="#fff"/>${text(20, 60, 'No panels on this building’s levels yet — set each panel’s Level.')}</svg>`;
    return { svg, w: 600, h: 120, pages: 1 };
  }
  const p = Math.min(Math.max(0, part), L.pages.length - 1), page = L.pages[p];
  const rowLo = page[0], rowHi = page[page.length - 1];
  const hasAbove = p < L.pages.length - 1, hasBelow = p > 0;
  const noOf = (i: number) => opts.sheetNos?.[i] || `sheet ${i + 1}`;
  const { groups, right } = groupsOf(L);
  const y0 = TOP + (hasAbove ? MATCH_H : 0);
  const { geom, bottom: rowsEnd } = rowGeometry(L, page, y0);
  const topMatch = TOP + MATCH_H - 8, botMatch = rowsEnd + MATCH_H - 8;
  const end = hasBelow ? botMatch + 26 : rowsEnd;

  const cols = COUNT_COLS.filter((k) => k !== 'ups' || L.rows.some((r) => r.counts.ups));
  const TX = right + 24;
  const widths = [66, 30, ...cols.map((k) => (k === 'smdb' ? 44 : 38)), 86];
  const xs = widths.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [TX]);
  const W = Math.max(xs[xs.length - 1], 980) + 20;

  const lines: string[] = [], over: string[] = [];
  lines.push(text(20, 26, `DB RISER — ${L.buildingName.toUpperCase()}${L.pages.length > 1 ? ` — SHEET ${p + 1} OF ${L.pages.length}` : ''}`, 'font-size="14" font-weight="bold"'));
  lines.push(text(20, 43, 'Boards on each level. Identical floors share a row: the counts are per floor.', 'font-size="9"'));
  lines.push(text(24, TOP - 8, 'Level', 'font-weight="bold"'));
  for (const g of groups) lines.push(text(g.x1, TOP - 8, `From ${g.main.board.id}`, 'font-weight="bold"'));
  ['Level', 'Fl.', ...cols.map((k) => COL_LABEL[k]), 'All'].forEach((h, i) => lines.push(text(xs[i] + 3, TOP - 8, h, 'font-size="9" font-weight="bold"')));
  lines.push(ln(20, TOP, xs[xs.length - 1], TOP, 0.5));

  // Level bands and the count table.
  for (const i of page) {
    const r = L.rows[i], g = geom.get(i)!, mid = g.top + g.h / 2, n = r.floors.length, per = countTotal(r.counts);
    lines.push(ln(20, g.top + g.h, xs[xs.length - 1], g.top + g.h, 0.5));
    lines.push(text(24, mid - 2, r.label, 'font-size="11" font-weight="bold"'), text(24, mid + 12, r.sub, 'font-size="8.5"'));
    [r.label, String(n), ...cols.map((k) => (r.counts[k] ? String(r.counts[k]) : '–')), n > 1 ? `${per}×${n}=${per * n}` : String(per)]
      .forEach((v, j) => lines.push(text(xs[j] + 3, mid + 4, v, `font-size="9.5"${j ? '' : ' font-weight="bold"'}`)));
  }
  const totals = (label: string, rows: DbRiserRow[], y: number) => {
    const t = rowsTotal(rows);
    const fl = rows.reduce((s, r) => s + r.floors.length, 0);
    [label, String(fl), ...cols.map((k) => (t[k] ? String(t[k]) : '–')), String(countTotal(t))].forEach((v, j) => lines.push(text(xs[j] + 3, y, v, 'font-size="9.5" font-weight="bold"')));
  };
  const tableTop = rowsEnd;
  totals('Sheet', page.map((i) => L.rows[i]), tableTop + 16);
  let tableEnd = tableTop + 26;
  if (p === L.pages.length - 1 && L.pages.length > 1) { totals('Building', L.rows, tableTop + 34); tableEnd = tableTop + 44; }
  lines.push(ln(TX, tableEnd, xs[xs.length - 1], tableEnd, 1.2));
  for (const x of xs) lines.push(ln(x, TOP, x, tableEnd, 0.5));

  const entryY = (run: DbRiserRun, i: number) => {
    const g = geom.get(i);
    const ys = [...(g?.entryY.entries() ?? [])].filter(([e]) => e.runId === run.id).map(([, y]) => y);
    for (const id of run.mains.get(i) ?? []) { const e = g?.encl?.get(id); if (e) ys.push((e.y1 + e.y2) / 2); }
    return ys;
  };

  // Riser lines: under the panels, which are drawn over them.
  for (const g of groups) {
    const main = g.main, mainGeom = geom.get(main.row), encl = mainGeom?.encl?.get(main.board.id);
    for (const run of main.runs) {
      const x = g.runX.get(run.id)!, w = run.heavy ? 3.2 : 1.2;
      if (run.rowMax < rowLo || run.rowMin > rowHi) continue;
      // A line runs up from the panel and / or down from it, or right through a sheet without it.
      const fedRows = [...run.fed.keys()];
      const stopOf = (up: boolean, from: number) => {
        const last = up ? run.rowMax : run.rowMin;
        if (up ? last > rowHi : last < rowLo) return up ? topMatch : botMatch;
        const ys = entryY(run, last);
        return !ys.length ? from : up ? Math.min(...ys) - (run.heavy ? 18 : 0) : Math.max(...ys);
      };
      const segs: [number, number][] = [];
      if (encl) {
        if (fedRows.some((r) => r >= main.row)) segs.push([encl.y1, stopOf(true, encl.y1)]);
        if (fedRows.some((r) => r < main.row)) segs.push([encl.y2, stopOf(false, encl.y2)]);
      } else if (main.row < rowLo) segs.push([botMatch, stopOf(true, botMatch)]);
      else segs.push([topMatch, stopOf(false, topMatch)]);
      for (const [a, b] of segs) {
        lines.push(ln(x, a, x, b, w));
        const lo = Math.min(a, b), hi = Math.max(a, b);
        // Omitted floors on rows the line runs through.
        for (const i of page) {
          const rg = geom.get(i)!;
          if (L.rows[i].floors.length > 1 && rg.top + rg.h - 14 > lo + 8 && rg.top + rg.h - 14 < hi - 8) over.push(zigzag(x, rg.top + rg.h - 14));
        }
        // End of a busbar or fire-rated riser.
        if (run.heavy && b !== topMatch && b !== botMatch) over.push(ln(x - 7, b, x + 7, b, 2));
        if (run.kind === 'bus' || run.heavy) {
          const mid = (lo + hi) / 2;
          if (hi - lo > 70) lines.push(text(x - 8, mid, run.name, `font-size="8.5" text-anchor="middle" transform="rotate(-90 ${x - 8} ${mid})"`));
        }
      }
      // Dots and taps.
      for (const i of page) {
        const rg = geom.get(i)!;
        for (const [e, y] of rg.entryY) if (e.runId === run.id) { lines.push(ln(x, y, g.areaX, y)); over.push(dot(x, y)); }
        for (const id of run.mains.get(i) ?? []) {
          const child = groups.find((c) => c.main.board.id === id), ce = rg.encl?.get(id);
          if (child && ce) { const y = (ce.y1 + ce.y2) / 2; lines.push(ln(x, y, child.x1, y)); over.push(dot(x, y)); }
        }
      }
      // Number of cables on the line, where it changes.
      if (run.kind === 'cable') {
        let prev = -1;
        for (const i of [...page].sort((a, b) => a - b)) {
          const n = cablesAtGap(run, i, main.row);
          const rg = geom.get(i)!;
          const y = (i >= main.row ? rg.top : rg.top + rg.h) + (i >= main.row ? 12 : -12);
          const crossing = (i >= main.row ? i < run.rowMax : i > run.rowMin);
          if (n > 1 && crossing && n !== prev) {
            over.push(ln(x - 5, y + 5, x + 5, y - 5), text(x + 7, y + 3, `${n}×`, 'font-size="8"'));
            prev = n;
          }
        }
      }
      // Flags at the match lines.
      if (run.letter) {
        if (run.rowMax > rowHi) over.push(flag(x, topMatch, run.letter, true));
        if (run.rowMin < rowLo) over.push(flag(x, botMatch, run.letter, false));
      }
    }
  }

  // Panels with busbar and one breaker per outgoing; boxes.
  for (const g of groups) {
    const main = g.main, rg = geom.get(main.row), encl = rg?.encl?.get(main.board.id);
    if (rg && encl) {
      const busY = encl.y1 + 36;
      over.push(`<rect x="${g.x1}" y="${encl.y1}" width="${g.x2 - g.x1}" height="${encl.y2 - encl.y1}" fill="#fff" stroke="#111" stroke-width="1.2"/>`, ln(g.x1 + 6, busY, g.x2 - 6, busY, 3));
      for (const run of main.runs) {
        const x = g.runX.get(run.id)!, up = [...run.fed.keys()].some((r) => r >= main.row);
        over.push(up ? ln(x, encl.y1, x, busY) : ln(x, busY, x, encl.y2));
        const by = up ? encl.y1 + 12 : busY + 6;
        over.push(`<rect x="${x - 4}" y="${by}" width="8" height="10" fill="#fff" stroke="#111" stroke-width="1"/>`, text(x + 6, by + 9, run.breaker, 'font-size="7"'));
      }
      over.push(text((g.x1 + g.x2) / 2, encl.y2 - 19, main.board.id, 'text-anchor="middle" font-weight="bold"'));
      over.push(text((g.x1 + g.x2) / 2, encl.y2 - 7, [main.board.ratedCurrentA ? `${main.board.ratedCurrentA} A` : '', main.fromLocal ? `from ${main.fromLocal}` : ''].filter(Boolean).join(' · '), 'text-anchor="middle" font-size="8"'));
      if (main.localEntries) {
        const ys = [...rg.entryY].filter(([e]) => e.board.upstreamId === main.board.id && !e.runId).map(([, y]) => y);
        const lx = g.areaX - 10;
        over.push(ln(lx, busY, lx, Math.min(...ys)), `<rect x="${lx - 4}" y="${encl.y1 + 12}" width="8" height="10" fill="#fff" stroke="#111" stroke-width="1"/>`);
        for (const y of ys) over.push(ln(lx, y, g.areaX, y));
      }
      if (main.sourceKva) {
        const cy = encl.y1 + 16, cx = g.x1 - 32;
        over.push(`<circle cx="${cx - 6}" cy="${cy}" r="10" fill="none" stroke="#111" stroke-width="1.2"/><circle cx="${cx + 6}" cy="${cy}" r="10" fill="none" stroke="#111" stroke-width="1.2"/>`, ln(cx + 16, cy, g.x1, cy), text(cx, cy + 22, `${main.sourceKva} kVA`, 'text-anchor="middle" font-size="8"'));
      }
      if (main.hasStandby) {
        const cy = encl.y1 + 58, cx = g.x1 - 32;
        over.push(`<circle cx="${cx}" cy="${cy}" r="11" fill="#fff" stroke="#111" stroke-width="1.2"/>`, text(cx, cy + 4, 'G', 'text-anchor="middle" font-weight="bold"'), ln(cx + 11, cy, g.x1, cy).replace('/>', ' stroke-dasharray="5 3"/>'));
        if (main.standbyKva) over.push(text(cx, cy + 22, `${main.standbyKva} kVA`, 'text-anchor="middle" font-size="8"'));
      }
    }
    for (const i of page) {
      const rowG = geom.get(i)!;
      for (const [e, y] of rowG.entryY) if (e.board.upstreamId === main.board.id) over.push(entryBoxes(e, g.areaX, y, L.rows[i].floors.length));
    }
    // A column with nothing on this sheet says where its riser is.
    if (p > 0 && !main.runs.some((r) => r.rowMax >= rowLo && r.rowMin <= rowHi) && main.row < rowLo)
      over.push(text(g.x1, hasBelow ? botMatch - 8 : rowsEnd - 8, `${main.board.id}: see ${noOf(L.rows[main.row].page)}`, 'font-size="8.5"'));
  }

  // Match lines.
  if (hasAbove) {
    lines.push(matchLine(20, right, topMatch));
    lines.push(text(24, topMatch - 6, `MATCH LINE ${p + 1} — CONTINUES ON ${noOf(p + 1)}`, 'font-size="9" font-weight="bold"'));
  }
  if (hasBelow) {
    lines.push(matchLine(20, right, botMatch));
    lines.push(text(24, botMatch + 16, `MATCH LINE ${p} — CONTINUED FROM ${noOf(p - 1)}`, 'font-size="9" font-weight="bold"'));
  }

  // Riser table and notes.
  let y = Math.max(end, tableEnd) + 24;
  const onPage = L.runs.filter((r) => r.rowMax >= rowLo && r.rowMin <= rowHi);
  if (onPage.length) {
    const cx = [20, 130, 230, 470, 620, 690];
    ['Riser', 'From', 'Serves', 'Type', 'Vertical', 'Continuation'].forEach((t, i) => lines.push(text(cx[i] + 3, y, t, 'font-size="9" font-weight="bold"')));
    lines.push(ln(20, y + 5, Math.max(right, 900), y + 5, 1));
    onPage.forEach((r, i) => {
      const serves = r.serves.length > 44 ? `${r.serves.slice(0, 43)}…` : r.serves;
      const cont = !r.letter ? 'This sheet' : [r.rowMax > rowHi ? `${r.letter} → ${noOf(p + 1)}` : '', r.rowMin < rowLo ? `${r.letter} ← ${noOf(p - 1)}` : ''].filter(Boolean).join(', ') || r.letter;
      [r.name, r.mainId, serves, r.type, `${r.verticalM.toFixed(0)} m`, cont].forEach((t, j) => lines.push(text(cx[j] + 3, y + 19 + i * 15, t, 'font-size="9"')));
    });
    y += 19 + onPage.length * 15 + 14;
  }
  const notes = [
    'Identical floors share one row: the counts are per floor, the last column gives the building count.',
    'A heavy line is a busbar or fire-rated riser, a thin line is cable, and a slash with a number is that many cables drawn as one.',
    'A dot is a connection; a line that crosses without a dot passes that floor and does not feed it. A T-bar is the end of a riser.',
    'The break symbol on a riser means floors are omitted, not that the riser stops.',
    ...(L.pages.length > 1 ? ['Flags with the same letter are the same riser on another sheet; the riser table gives the sheet.'] : []),
    ...(L.notOnLevel.length ? [`No level in this building, drawn on the lowest level: ${L.notOnLevel.join(', ')}.`] : []),
    ...(L.unplaced.length ? [`No level, not counted or drawn: ${L.unplaced.slice(0, 12).join(', ')}${L.unplaced.length > 12 ? ` and ${L.unplaced.length - 12} more` : ''}.`] : [])
  ];
  lines.push(text(20, y, 'NOTES', 'font-size="9" font-weight="bold"'));
  notes.forEach((t, i) => lines.push(text(20, y + 15 + i * 13, `${i + 1}. ${t}`, 'font-size="8.5"')));
  y += 15 + notes.length * 13 + 12;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${y}" width="${W}" height="${y}" font-family="Arial" font-size="10" fill="#111">
  <rect width="${W}" height="${y}" fill="#fff"/>
  ${lines.join('\n')}
  ${over.join('\n')}
</svg>`;
  return { svg, w: W, h: y, pages: L.pages.length };
}

/** Sheet numbers of the building's riser sheets, bottom first. */
export function dbRiserSheetNos(set: DrawingSet, buildingId: string): string[] | undefined {
  const nos: string[] = [];
  for (const x of set.sheets) if (x.kind === 'riser' && x.riserStyle === 'byLevel' && x.buildingId === buildingId) nos[x.part ?? 0] = x.number;
  return nos.some(Boolean) ? nos : undefined;
}
