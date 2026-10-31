import type { Project } from '../types';
import type { DrawingSet } from '../model/drawingSet';
import { cablesAtGap, COUNT_COLS, countTotal, dbRiserLayout, entryHeight, ENTRY_H, hasSourceBand, MAIN_H, refLines, ROW_MIN_H, rowsTotal, SOURCE_H, type CountCol, type DbRiserLayout, type DbRiserMain, type DbRiserRow, type DbRiserRun, type KindCount, type RowEntry } from '../model/dbRiser';

/** One sheet of a building's "Boards by level" riser (printable SVG, black and white).
 * Levels top to bottom, one column group per main panel with its busbar and one
 * breaker per outgoing, the same columns on every sheet so the risers line up
 * across a break. Boxes give the real board references and each busbar tap-off
 * has its own box. Below: the riser table, notes and, when chosen, a table of
 * boards per level. */

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

const LEFT = 110, RUN_W = 58, GROUP_GAP = 22, TIE_GAP = 104, AREA_MIN = 120, TOB_W = 44, BOX_GAP = 14, MIN_HEAD_W = 76, MIN_KID_W = 88, FEED_W = 44, GEN_DX = 124;
const textW = (lines: string[], size = 9) => Math.max(0, ...lines.map((l) => l.length)) * size * 0.56 + 12;
/** A box with its references. */
const refBox = (x: number, y: number, w: number, lines: string[], sub = '') => {
  const h = Math.max(30, 10 + lines.length * 12 + (sub ? 10 : 0)), top = y - h / 2, first = y - ((lines.length - 1) * 12 + (sub ? 10 : 0)) / 2 + 3;
  return `<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="#fff" stroke="#111" stroke-width="1.2"/>` +
    lines.map((l, i) => text(x + w / 2, first + i * 12, l, 'text-anchor="middle" font-size="9" font-weight="bold"')).join('') +
    (sub ? text(x + w / 2, first + lines.length * 12 - 2, sub, 'text-anchor="middle" font-size="8"') : '');
};
const tapBox = (x: number, y: number, amps?: number) => box(x, y - 13, TOB_W, 26, 'TOB', amps ? `${amps} A` : '');
const breakerBox = (x: number, y: number) => `<rect x="${x - 4}" y="${y}" width="8" height="10" fill="#fff" stroke="#111" stroke-width="1"/>`;
const transformer = (cx: number, cy: number) => `<circle cx="${cx}" cy="${cy - 6}" r="10" fill="none" stroke="#111" stroke-width="1.2"/><circle cx="${cx}" cy="${cy + 6}" r="10" fill="none" stroke="#111" stroke-width="1.2"/>`;
const generator = (cx: number, cy: number) => `<circle cx="${cx}" cy="${cy}" r="11" fill="#fff" stroke="#111" stroke-width="1.2"/>${text(cx, cy + 4, 'G', 'text-anchor="middle" font-weight="bold"')}`;
const dashed = (x1: number, y1: number, x2: number, y2: number) => ln(x1, y1, x2, y2, 1.4).replace('/>', ' stroke-dasharray="5 3"/>');
const COL_LABEL: Record<CountCol, string> = { mdb: 'MDB', smdb: 'SMDB', db: 'DB', edb: 'EDB', mcc: 'MCC', ups: 'UPS' };
const TOP = 92, MATCH_H = 34;

interface Group { main: DbRiserMain; x1: number; x2: number; areaX: number; runX: Map<string, number>; headW: number; kidW: number; tobW: number }

/** The same columns on every sheet. */
function groupsOf(L: DbRiserLayout): { groups: Group[]; right: number } {
  let x = LEFT;
  const tieWith = (a: string, b: string | undefined) => L.ties.some((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a));
  const groups = L.mains.map((main, gi) => {
    const x1 = x;
    const runX = new Map(main.runs.map((r, i) => [r.id, x1 + 24 + i * RUN_W]));
    const entries = L.rows.flatMap((r) => r.entries).filter((e) => e.board.upstreamId === main.board.id);
    const kids = entries.flatMap((e) => e.kids);
    const headW = Math.max(MIN_HEAD_W, textW(entries.flatMap((e) => (e.kids.length ? [headTitle(e)] : refLines(e))), 10));
    const kidW = kids.length ? Math.max(MIN_KID_W, textW(kids.flatMap((k) => refLines(k)))) : 0;
    const tobW = entries.some((e) => e.tapOff) ? TOB_W + BOX_GAP : 0;
    const areaX = x1 + 24 + Math.max(main.runs.length, main.localEntries ? 1 : 0) * RUN_W;
    const areaW = entries.length ? tobW + headW + (kidW ? BOX_GAP + kidW : 0) : AREA_MIN;
    const g: Group = { main, x1, x2: Math.max(areaX + areaW + main.feedsChangeover.length * FEED_W + 8, main.hasStandby ? areaX + GEN_DX + 70 : 0), areaX, runX, headW, kidW, tobW };
    x = g.x2 + (tieWith(main.board.id, L.mains[gi + 1]?.board.id) ? TIE_GAP : GROUP_GAP);
    return g;
  });
  return { groups, right: Math.max(...groups.map((g) => g.x2)) };
}

/** Name of a box that feeds others: one floor's board, or the first of a typical row. */
const headTitle = (e: RowEntry) => (e.lastIds ? `${e.board.id} …` : e.board.id);

interface RowGeom { top: number; h: number; encl?: Map<string, { y1: number; y2: number }>; entryY: Map<RowEntry, number> }

/** Heights and box positions of one sheet's rows, top to bottom. */
function rowGeometry(L: DbRiserLayout, page: number[], y0: number): { geom: Map<number, RowGeom>; bottom: number } {
  const geom = new Map<number, RowGeom>();
  let y = y0;
  for (const i of [...page].reverse()) {
    const r = L.rows[i];
    const stack = new Map<string, number>();
    for (const e of r.entries) stack.set(e.board.upstreamId!, (stack.get(e.board.upstreamId!) ?? 0) + entryHeight(e));
    const hasBand = L.mains.some((m) => r.mainIds.includes(m.board.id) && hasSourceBand(m.board));
    const h = Math.max(ROW_MIN_H, Math.max(0, ...stack.values()) + (r.mainIds.length ? MAIN_H : 0) + (hasBand ? SOURCE_H : 0) + 16);
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
    for (const id of r.mainIds) { const y2 = y + h - 6 - (hasBand ? SOURCE_H : 0); g.encl!.set(id, { y1: y2 - MAIN_H + 8, y2 }); }
    geom.set(i, g);
    y += h;
  }
  return { geom, bottom: y };
}

function entryBoxes(e: RowEntry, g: Group, y: number): string {
  let x = g.areaX, s = '';
  if (e.tapOff) { s += tapBox(x, y, e.tapOffA) + ln(x + TOB_W, y, x + TOB_W + BOX_GAP, y); x += TOB_W + BOX_GAP; } else x += g.tobW;
  const kidY = (i: number) => y - entryHeight(e) / 2 + ENTRY_H * (i + 0.5);
  if (!e.kids.length) return s + refBox(x, y, g.headW, refLines(e), ampsText(e.ratings, e.ids.length > 1));
  s += box(x, y - 18, g.headW, 36, headTitle(e), ampsText(e.ratings, false));
  const kx = x + g.headW + BOX_GAP;
  const kid = (k: KindCount, i: number) => refBox(kx, kidY(i), g.kidW, refLines(k));
  if (e.kids.length === 1) return s + ln(x + g.headW, y, kx, y) + kid(e.kids[0], 0);
  const bx = x + g.headW + BOX_GAP / 2;
  s += ln(x + g.headW, y, bx, y) + ln(bx, kidY(0), bx, kidY(e.kids.length - 1));
  e.kids.forEach((k, i) => { s += ln(bx, kidY(i), kx, kidY(i)) + kid(k, i); });
  return s;
}

export interface DbRiserOpts {
  /** Sheet numbers of the riser's sheets (bottom first), for the match lines and riser table. */
  sheetNos?: string[];
  /** A table of boards per level on the sheet. */
  countTable?: boolean;
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

  const W = Math.max(right, 900) + 20;

  const lines: string[] = [], over: string[] = [];
  lines.push(text(20, 26, `DB RISER — ${L.buildingName.toUpperCase()}${L.pages.length > 1 ? ` — SHEET ${p + 1} OF ${L.pages.length}` : ''}`, 'font-size="14" font-weight="bold"'));
  lines.push(text(20, 43, 'Boards on each level. Identical floors share a row.', 'font-size="9"'));
  lines.push(text(24, TOP - 8, 'Level', 'font-weight="bold"'));
  for (const g of groups) lines.push(text(g.x1, TOP - 8, `From ${g.main.board.id}`, 'font-weight="bold"'));
  lines.push(ln(20, TOP, W - 20, TOP, 0.5));

  // Level bands.
  for (const i of page) {
    const r = L.rows[i], g = geom.get(i)!, mid = g.top + g.h / 2;
    lines.push(ln(20, g.top + g.h, W - 20, g.top + g.h, 0.5));
    lines.push(text(24, mid - 2, r.label, 'font-size="11" font-weight="bold"'), text(24, mid + 12, r.sub, 'font-size="8.5"'));
  }

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
        for (const [e, y] of rg.entryY) if (e.runId === run.id) { lines.push(ln(x, y, g.areaX + (e.tapOff ? 0 : g.tobW), y)); over.push(dot(x, y)); }
        for (const id of run.mains.get(i) ?? []) {
          const child = groups.find((c) => c.main.board.id === id), ce = rg.encl?.get(id);
          if (child && ce) {
            const y = (ce.y1 + ce.y2) / 2;
            lines.push(ln(x, y, child.x1, y));
            over.push(dot(x, y));
            if (run.kind === 'bus') over.push(tapBox(x + 8, y, run.tapOffA.get(id)));
          }
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
      const nameX = g.x2 - 8;
      over.push(text(nameX, encl.y2 - 19, main.board.id, 'text-anchor="end" font-weight="bold"'));
      over.push(text(nameX, encl.y2 - 7, [main.board.ratedCurrentA ? `${main.board.ratedCurrentA} A` : '', main.fromLocal ? `from ${main.fromLocal}` : ''].filter(Boolean).join(' · '), 'text-anchor="end" font-size="8"'));
      if (main.localEntries) {
        const ys = [...rg.entryY].filter(([e]) => e.board.upstreamId === main.board.id && !e.runId).map(([, y]) => y);
        const lx = g.areaX - 10;
        over.push(ln(lx, busY, lx, Math.min(...ys)), breakerBox(lx, encl.y1 + 12));
        for (const y of ys) over.push(ln(lx, y, g.areaX + g.tobW, y));
      }
      // Incomers: transformer, mains from another panel and generator, through the changeover.
      const inX = g.areaX + 12, genX = g.areaX + GEN_DX, top = encl.y2, srcY = top + 44;
      const mainsLabel = main.mainsFrom ? `Mains from ${main.mainsFrom}` : '';
      const source = (x: number, y: number) => {
        if (main.sourceKva) over.push(transformer(x, y + 4), text(x + 14, y, `TX-${main.board.id}`, 'font-size="9" font-weight="bold"'), text(x + 14, y + 11, `${main.sourceKva} kVA`, 'font-size="8"'));
      };
      const gen = (x: number, y: number) => {
        over.push(generator(x, y), text(x + 15, y - 2, 'GEN', 'font-size="9" font-weight="bold"'));
        if (main.standbyKva) over.push(text(x + 15, y + 9, `${main.standbyKva} kVA`, 'font-size="8"'));
      };
      if (main.changeover === 'ATS') {
        const boxW = 92, bx = inX - 12, by = top + 12, cx = bx + boxW / 2, mx = bx + 16, gx = bx + boxW - 16;
        over.push(ln(cx, busY, cx, by), box(bx, by, boxW, 20, `ATS ${main.changeoverA ? `${main.changeoverA} A ` : ''}4P`));
        if (main.sourceKva) { over.push(ln(mx, by + 20, mx, srcY - 10)); source(mx, srcY); }
        else { lines.push(ln(mx, by + 20, mx, top + 62, 1.6)); over.push(text(mx + 4, top + 58, mainsLabel, 'font-size="8"')); }
        over.push(dashed(gx, by + 20, genX, by + 20), dashed(genX, by + 20, genX, srcY - 11));
        gen(genX, srcY);
      } else if (main.changeover === 'ACB') {
        over.push(ln(inX, busY, inX, top + (main.sourceKva ? 34 - 10 : 62), main.sourceKva ? 1.2 : 1.6), breakerBox(inX, busY + 8), text(inX - 7, busY + 16, 'ACB', 'font-size="7.5" text-anchor="end"'));
        over.push(dashed(genX, busY, genX, srcY - 11), breakerBox(genX, busY + 8), text(genX + 7, busY + 16, 'ACB', 'font-size="7.5"'));
        over.push(ln(inX + 4, busY + 13, genX - 4, busY + 13, 1).replace('/>', ' stroke-dasharray="2 2"/>'), text((inX + genX) / 2, busY + 11, 'interlock', 'text-anchor="middle" font-size="8"'));
        if (main.sourceKva) source(inX, srcY); else over.push(text(inX + 4, top + 58, mainsLabel, 'font-size="8"'));
        gen(genX, srcY);
      } else if (main.sourceKva) {
        over.push(ln(inX, busY, inX, srcY - 10), breakerBox(inX, busY + 8));
        if (main.incomer) over.push(text(inX + 7, busY + 16, main.incomer, 'font-size="7.5"'));
        source(inX, srcY);
      }
      // Mains cable from this busbar to the changeover of a panel on this floor.
      main.feedsChangeover.forEach((f, n) => {
        const child = groups.find((c) => c.main.board.id === f.boardId), ce = child && rg.encl?.get(f.boardId);
        if (!child || !ce) return;
        const fx = g.x2 - 14 - n * FEED_W, ry = encl.y2 + 62 + n * 5, tx = child.areaX + 16;
        lines.push(ln(fx, busY, fx, ry, 1.6), ln(fx, ry, tx, ry, 1.6));
        over.push(breakerBox(fx, busY + 8), text(fx - 6, busY + 16, f.breaker, 'font-size="7.5" text-anchor="end"'));
      });
      // Couplers: between panels side by side, else named on the panel.
      for (const t of L.ties.filter((x) => x.a === main.board.id || x.b === main.board.id)) {
        const other = t.a === main.board.id ? t.b : t.a, ix = L.mains.findIndex((m) => m.board.id === other), here = L.mains.indexOf(main);
        const state = t.closed ? 'N.C.' : 'N.O.';
        if (ix === here + 1 && L.mains[ix].row === main.row) {
          const nx = groups[ix].x1, mx = (g.x2 + nx) / 2;
          over.push(ln(g.x2 - 6, busY, nx + 6, busY, 1.6), `<rect x="${mx - 14}" y="${busY - 9}" width="28" height="18" fill="#fff" stroke="#111" stroke-width="1.2"/>`);
          over.push(t.closed ? ln(mx - 8, busY, mx + 8, busY, 1.4) : ln(mx - 8, busY + 4, mx + 8, busY - 4, 1.4));
          over.push(text(mx, busY - 14, t.id, 'text-anchor="middle" font-weight="bold"'), text(mx, busY + 21, `${t.ratingA} A · ${state}`, 'text-anchor="middle" font-size="8"'));
        } else if (!(ix === here - 1 && L.mains[ix].row === main.row)) over.push(text(g.areaX, encl.y1 - 4, `Coupler ${t.id} to ${other} · ${t.ratingA} A · ${state}`, 'font-size="8"'));
      }
    }
    for (const i of page) {
      const rowG = geom.get(i)!;
      for (const [e, y] of rowG.entryY) if (e.board.upstreamId === main.board.id) over.push(entryBoxes(e, g, y));
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
  let y = end + 24;
  const onPage = L.runs.filter((r) => r.rowMax >= rowLo && r.rowMin <= rowHi);
  if (onPage.length) {
    const cx = [20, 130, 230, 470, 620, 690];
    ['Riser', 'From', 'Serves', 'Type', 'Vertical', 'Continuation'].forEach((t, i) => lines.push(text(cx[i] + 3, y, t, 'font-size="9" font-weight="bold"')));
    lines.push(ln(20, y + 5, W - 20, y + 5, 1));
    onPage.forEach((r, i) => {
      const serves = r.serves.length > 44 ? `${r.serves.slice(0, 43)}…` : r.serves;
      const cont = !r.letter ? 'This sheet' : [r.rowMax > rowHi ? `${r.letter} → ${noOf(p + 1)}` : '', r.rowMin < rowLo ? `${r.letter} ← ${noOf(p - 1)}` : ''].filter(Boolean).join(', ') || r.letter;
      [r.name, r.mainId, serves, r.type, `${r.verticalM.toFixed(0)} m`, cont].forEach((t, j) => lines.push(text(cx[j] + 3, y + 19 + i * 15, t, 'font-size="9"')));
    });
    y += 19 + onPage.length * 15 + 14;
  }
  const notes = [
    'Boxes give the board references: a typical row shows its first and last floors; a long list shortens to first … last.',
    'A heavy line is a busbar or fire-rated riser, a thin line is cable, and a slash with a number is that many cables drawn as one.',
    'TOB is a tap-off box: one for each tap-off. A dot is a connection; a line that crosses without a dot passes that floor. A T-bar is the end of a riser.',
    'The break symbol on a riser means floors are omitted, not that the riser stops. A dashed line is the generator feed.',
    ...(L.ties.length ? ['N.O. is a normally open coupler, N.C. normally closed.'] : []),
    ...(L.pages.length > 1 ? ['Flags with the same letter are the same riser on another sheet; the riser table gives the sheet.'] : []),
    ...(L.notOnLevel.length ? [`No level in this building, drawn on the lowest level: ${L.notOnLevel.join(', ')}.`] : []),
    ...(L.unplaced.length ? [`No level, not counted or drawn: ${L.unplaced.slice(0, 12).join(', ')}${L.unplaced.length > 12 ? ` and ${L.unplaced.length - 12} more` : ''}.`] : []),
    ...(L.looseTapOffs.length ? [`Tap-offs with a load and no board, not drawn: ${L.looseTapOffs.join(', ')}.`] : [])
  ];
  lines.push(text(20, y, 'NOTES', 'font-size="9" font-weight="bold"'));
  notes.forEach((t, i) => lines.push(text(20, y + 15 + i * 13, `${i + 1}. ${t}`, 'font-size="8.5"')));
  y += 15 + notes.length * 13 + 12;

  // Boards per level, when chosen.
  if (opts.countTable) {
    const cols = COUNT_COLS.filter((k) => k !== 'ups' || L.rows.some((r) => r.counts.ups));
    const widths = [78, 34, 38, ...cols.map((k) => (k === 'smdb' ? 44 : 38)), 90];
    const xs = widths.reduce<number[]>((a, w) => [...a, a[a.length - 1] + w], [20]);
    const row = (cells: string[], bold: boolean) => {
      cells.forEach((v, j) => lines.push(text(xs[j] + 3, y + 13, v, `font-size="9"${bold || !j ? ' font-weight="bold"' : ''}`)));
      for (const x of xs) lines.push(ln(x, y, x, y + 18, 0.5));
      lines.push(ln(20, y + 18, xs[xs.length - 1], y + 18, 0.5));
      y += 18;
    };
    const dash = (n: number) => (n ? String(n) : '–');
    const totalRow = (label: string, rows: DbRiserRow[]) => {
      const t = rowsTotal(rows);
      row([label, String(rows.reduce((s, r) => s + r.floors.length, 0)), dash(rows.reduce((s, r) => s + r.tapOffs * r.floors.length, 0)), ...cols.map((k) => dash(t[k])), String(countTotal(t))], true);
    };
    lines.push(text(20, y, 'BOARDS PER LEVEL', 'font-size="9" font-weight="bold"'));
    y += 6;
    lines.push(ln(20, y, xs[xs.length - 1], y, 0.5));
    row(['Level', 'Fl.', 'TOB', ...cols.map((k) => COL_LABEL[k]), 'All boards'], true);
    for (const i of [...page].reverse()) {
      const r = L.rows[i], n = r.floors.length, per = countTotal(r.counts);
      row([r.label, String(n), dash(r.tapOffs), ...cols.map((k) => dash(r.counts[k])), n > 1 ? `${per}×${n}=${per * n}` : String(per)], false);
    }
    totalRow('Sheet', page.map((i) => L.rows[i]));
    if (L.pages.length > 1 && p === L.pages.length - 1) totalRow('Building', L.rows);
    y += 14;
  }

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
