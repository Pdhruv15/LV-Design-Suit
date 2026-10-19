import type { Project } from '../types';
import { earthRiserLayout, floorGroups, floorIndex, riserPages, type EarthRiserFloor, type EarthRiserLayout, type RiserRow } from '../model/earthRiser';
import { earthSheetNo } from '../model/boardEarth';
import { earthingLayout } from '../model/earthingPlan';
import { pitTags } from './earthingDrawing';
import type { DrawingSet } from '../model/drawingSet';

/** Earth riser and floor earthing sheets of one building (printable SVG, earthing-schematic style).
 *
 * Riser sheet (as the reference sheet): levels bottom to top, a floor earth bar
 * with two test links on every level, one earth cable looping bar to bar up the
 * riser — into one test link and out of the other, alternating sides — and the
 * cable from the LV room earth bar to the bar on the LV room's floor. Panels
 * are not drawn here. Style 'sheets': every level, split over sheets with match
 * lines; style 'typical': one sheet, runs of floors with the same earthing drawn
 * once. Legend, notes and the floor earth bar schedule on the right.
 *
 * Floor earthing sheet: the floor earth bar of one floor (or a typical floor
 * group) and each SMDB / DB earth bar on it, with its CPC size. Screen colours
 * turn black in the printed sheet (mono). */

const GREEN = '#1a7f37', MUT = '#5b6b82', RED = '#c0392b';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ln = (x1: number, y1: number, x2: number, y2: number, w = 1.3, c = '#111') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
const path = (d: string, w = 1.4, c = GREEN) => `<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
const text = (x: number, y: number, s: string, o = '') => `<text x="${x}" y="${y}"${o ? ` ${o}` : ''}>${esc(s)}</text>`;
/** Cable terminal on a bar. */
const terminal = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="3.6" fill="#fff" stroke="#111" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="1.5" fill="#111"/>`;
const BAR_W = 170, BAR_H = 28;
/** Floor earth bar with two test links (TL) and a terminal at each end, tag above. Terminals at x ± (BAR_W / 2 − 12). */
function floorBar(cx: number, y: number, tag: string) {
  const x = cx - BAR_W / 2;
  let s = `<rect x="${x}" y="${y}" width="${BAR_W}" height="${BAR_H}" fill="#fff" stroke="#111" stroke-width="1.1"/>`;
  s += `<rect x="${x + 4}" y="${y + 4}" width="${BAR_W - 8}" height="${BAR_H - 8}" fill="none" stroke="#111" stroke-width="0.6"/>`;
  for (const tx of [x + 40, x + BAR_W - 40]) s += `<rect x="${tx - 12}" y="${y + 7}" width="24" height="14" fill="#fff" stroke="#111" stroke-width="1"/>${text(tx, y + 17.5, 'TL', 'text-anchor="middle" font-size="8"')}`;
  s += terminal(x + 12, y + BAR_H / 2) + terminal(x + BAR_W - 12, y + BAR_H / 2);
  return s + text(cx, y - 6, tag, 'text-anchor="middle" font-weight="bold"');
}
const TERM = BAR_W / 2 - 12;
/** Small bar of a panel. */
const panelBar = (x: number, y: number, w: number) => {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="7" fill="#fff" stroke="#111" stroke-width="1.1"/>`;
  for (let i = 0, n = Math.max(2, Math.floor((w - 6) / 12)); i < n; i++) s += `<circle cx="${x + 6 + i * ((w - 12) / (n - 1))}" cy="${y + 3.5}" r="1.5" fill="#111"/>`;
  return s;
};
const levelMark = (x: number, y: number) => `<path d="M${x - 5} ${y - 9}h10l-5 8z" fill="#111"/>`;
const slab = (x1: number, x2: number, y: number) => ln(x1, y, x2, y, 0.6, '#999').replace('/>', ' stroke-dasharray="12 6"/>');
const matchLine = (x1: number, x2: number, y: number) => ln(x1, y, x2, y, 1, '#111').replace('/>', ' stroke-dasharray="16 4 3 4"/>');
const arrowLeft = (x: number, y: number) => `<path d="M${x} ${y}l7 -3.5v7z" fill="#111"/>`;
const arrowUp = (x: number, y: number) => `<path d="M${x} ${y}l-3.5 7h7z" fill="#111"/>`;
/** Note lines wrapped at n characters, continuation lines indented. */
const wrap = (lines: string[], n: number) => lines.flatMap((t) => {
  const out: string[] = [];
  let cur = '';
  for (const w of t.split(' ')) { if (cur && (cur + ' ' + w).length > n) { out.push(cur); cur = '    ' + w; } else cur = cur ? `${cur} ${w}` : w; }
  return [...out, cur];
});
const split2 = (s: string) => { const u = s.toUpperCase(), i = u.lastIndexOf(' EARTH'); return i > 0 ? [u.slice(0, i), u.slice(i + 1)] : [u]; };

/** Riser side of the cable leaving floor i upwards: right on even floors, left on odd (as the reference). */
const sideAbove = (i: number) => (i % 2 === 0 ? 1 : -1);

function svgOf(title: string, sub: string, w: number, h: number, body: string[], mono?: boolean) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Arial" font-size="10" fill="#111">
  <rect width="${w}" height="${h}" fill="#fff"/>
  <text x="${w / 2}" y="26" text-anchor="middle" font-size="14" font-weight="bold">${esc(title)}</text>
  <text x="${w / 2}" y="40" text-anchor="middle" font-size="9" fill="${MUT}">${esc(sub)}</text>
  ${body.join('\n')}
</svg>`;
  return { svg: mono ? svg.replace(/#(1a7f37|5b6b82|c0392b)/gi, '#111') : svg, w, h };
}

/** Rows of a table drawn at (x, y); returns the y below it. */
function table(out: string[], x: number, y: number, cols: number[], rows: string[][]): number {
  rows.forEach((cells, r) => {
    let cx = x;
    cells.forEach((c, i) => {
      out.push(`<rect x="${cx}" y="${y}" width="${cols[i]}" height="20" fill="none" stroke="#999" stroke-width="0.7"/>`, text(cx + 5, y + 14, c, `font-size="8.5"${r ? '' : ' font-weight="bold"'}`));
      cx += cols[i];
    });
    y += 20;
  });
  return y;
}

export interface EarthSheetOpts {
  mono?: boolean;
  working?: boolean;
  /** Sheet numbers of the riser's sheets (bottom first), for the match lines. */
  riserNos?: string[];
  /** Sheet number of the floor earthing sheet of a floor (by floor key). */
  floorNo?: (floorKey: string) => string | undefined;
}

/** One sheet of the earth riser (part 0 = the bottom sheet). */
export function earthRiserDrawing(project: Project, buildingId: string, opts: EarthSheetOpts = {}, part = 0, given?: EarthRiserLayout): { svg: string; w: number; h: number; pages: number } {
  const EL = earthingLayout(project);
  const L = given ?? earthRiserLayout(project, buildingId, EL);
  const pages = riserPages(L);
  const page = pages[Math.min(part, pages.length - 1)] ?? [];
  const pageIx = Math.min(part, pages.length - 1);
  const tags = pitTags(project, EL), tagOf = (id: string) => tags.get(id) ?? id;
  const schematicNo = earthSheetNo(project);
  const out: string[] = [];
  const W = 1560, CX = 660, X0 = 40, X1 = 1010, FH = 62, TOP = 120;
  const slots = pages.length > 1 ? Math.max(page.length, ...pages.map((p) => p.length)) : page.length;
  const lineY = (k: number) => TOP + (slots - k) * FH; // slab line of row k (0 = bottom of the sheet)
  const barTop = (k: number) => lineY(k) - 46;
  const termY = (k: number) => barTop(k) + BAR_H / 2;
  const first = (r: RiserRow) => floorIndex(L, r.floors[0].floor.key), last = (r: RiserRow) => floorIndex(L, r.floors[r.floors.length - 1].floor.key);
  const no = (i: number) => opts.riserNos?.[i] || `SHEET ${i + 1} OF ${pages.length}`;

  out.push(text(CX, TOP - 52, `ELECTRICAL RISER ${L.riserName.toUpperCase()}`, 'text-anchor="middle" font-weight="bold" font-size="11"'));
  page.forEach((r, k) => {
    const y = lineY(k);
    out.push(slab(X0 - 10, X1 - 30, y), levelMark(X0 + 6, y - 3), text(X0 + 18, y - 6, r.label, 'font-weight="bold"'));
    const e = r.floors[0].floor.elevationM;
    if (!r.typical) out.push(text(X0 + 18, y + 12, `FFL ${e >= 0 ? (e === 0 ? '±' : '+') : '−'}${Math.abs(e).toFixed(2)} m`, `font-size="8" fill="${MUT}"`));
    else out.push(text(X0 + 18, y + 12, `${r.floors.length} LEVELS — ONE FLOOR EARTH BAR ON EACH LEVEL`, `font-size="8" fill="${MUT}"`));
    out.push(floorBar(CX, barTop(k), r.bar));
    if (r.typical) out.push(text(CX + BAR_W / 2 + 10, termY(k) + 4, '(TYPICAL)', 'font-size="8.5" font-weight="bold"'));
  });
  // The riser cable, bar to bar.
  for (let k = 0; k + 1 < page.length; k++) {
    const x = CX + sideAbove(last(page[k])) * TERM;
    out.push(path(`M${x} ${termY(k) - 3.6} V${termY(k + 1) + 3.6}`, 1.6));
    if (page[k + 1].typical || page[k].typical) out.push(text(x + sideAbove(last(page[k])) * 10, (termY(k) + termY(k + 1)) / 2 + 4, '⋮', 'text-anchor="middle" font-size="14"'));
  }
  if (!page.length) out.push(text(CX, TOP + 60, 'No levels in this building — add them in Building information', `text-anchor="middle" fill="${RED}" font-weight="bold"`));
  // Match lines to the sheets below and above.
  const top = page.length - 1;
  if (pageIx < pages.length - 1 && page.length) {
    const my = barTop(top) - 34, x = CX + sideAbove(last(page[top])) * TERM;
    out.push(matchLine(X0 - 10, X1 - 30, my), text(CX - 120, my - 6, `MATCH LINE — CONTINUED ON ${no(pageIx + 1)}`, 'text-anchor="middle" font-size="8.5" font-weight="bold"'), path(`M${x} ${termY(top) - 3.6} V${my}`, 1.6));
  }
  if (pageIx > 0 && page.length) {
    const my = lineY(0) + 26, x = CX + sideAbove(first(page[0]) - 1) * TERM;
    out.push(matchLine(X0 - 10, X1 - 30, my), text(CX - 120, my + 14, `MATCH LINE — CONTINUED FROM ${no(pageIx - 1)}`, 'text-anchor="middle" font-size="8.5" font-weight="bold"'), path(`M${x} ${termY(0) + 3.6} V${my}`, 1.6));
  }
  // Riser cable size, on the first gap of the sheet.
  if (page.length > 1) {
    const s = sideAbove(last(page[0])), x = CX + s * TERM, y = (termY(0) + termY(1)) / 2;
    const tx = x + s * 46;
    out.push(ln(x + s * 2, y, tx, y, 0.8), s > 0 ? arrowLeft(x + 1, y) : `<path d="M${x - 1} ${y}l-7 -3.5v7z" fill="#111"/>`);
    [...split2(L.tape), '(TYPICAL)'].forEach((t, i) => out.push(text(tx + s * 4, y - 2 + i * 10, t, `font-size="8.5"${s < 0 ? ' text-anchor="end"' : ''}`)));
  }
  // LV room earth bar to the bar on its floor.
  const lvK = page.findIndex((r) => r.floors.some((f) => f.floor.key === L.lvFloor));
  let bottom = lineY(0) + (pageIx > 0 ? 40 : 20);
  if (lvK >= 0) {
    const r = page[lvK], i = first(r), y = termY(lvK);
    const atBottom = i === 0;
    const tx = atBottom ? CX - sideAbove(0) * TERM : CX; // the free terminal of the bottom bar, else the bar's middle
    const ty = atBottom ? y : barTop(lvK) + BAR_H;
    const lx = X0 + 230;
    const mebs = L.mains.map((m) => m.meb).join(', ');
    out.push(terminal(lx, y), path(atBottom ? `M${lx + 3.6} ${y} H${tx - (tx > lx ? 3.6 : -3.6)}` : `M${lx + 3.6} ${y} H${tx - 30} V${ty + 14} H${tx} V${ty}`, 1.6));
    out.push(text(lx - 6, y - 16, 'CONNECTED TO LV ROOM', 'text-anchor="end" font-size="8.5" font-weight="bold"'), text(lx - 6, y - 6, `EARTH BAR${mebs ? ` (${mebs})` : ''}`, 'text-anchor="end" font-size="8.5" font-weight="bold"'));
    out.push(text(lx - 6, y + 6, `SEE ${schematicNo.toUpperCase()}`, `text-anchor="end" font-size="8" fill="${MUT}"`));
    const ax = lx + 90, ay = y + 46;
    out.push(ln(ax, y + 2, ax, ay, 0.8), arrowUp(ax, y + 1), ln(ax, ay, ax - 20, ay, 0.8));
    split2(L.lvRoomCable).forEach((t, n) => out.push(text(ax - 24, ay + 3 + n * 10, t, 'text-anchor="end" font-size="8.5"')));
    bottom = Math.max(bottom, ay + 26);
    if (!L.mains.length) out.push(text(lx - 6, y + 18, 'NO MAIN BOARD FEEDS THIS BUILDING', `text-anchor="end" font-size="8.5" fill="${RED}" font-weight="bold"`));
  }

  // Right column: legend, notes, floor earth bar schedule.
  let ry = TOP - 60;
  if (!opts.working) {
    const RX = X1 + 10, RW = W - RX - 30;
    const legend: [string, string, number][] = [
      [`<g transform="translate(60 -8) scale(0.55)">${floorBar(0, 0, '')}</g>`, 'Floor earth bar (EB-…) with two test links (TL)', 34],
      [path('M12 0 H108', 1.6), `Riser earth cable, bar to bar — ${L.tape}`, 22],
      [terminal(60, 0), 'Cable terminal on the bar', 22]
    ];
    let body = '', ly = 30;
    for (const [sym, t, rh] of legend) {
      const cy = ly + rh / 2;
      body += `<g transform="translate(0 ${cy})">${sym}</g>${text(122, cy + 3, t, 'font-size="9"')}`;
      ly += rh;
    }
    out.push(`<g transform="translate(${RX} ${ry})"><rect x="0" y="0" width="${RW}" height="${ly + 8}" fill="#fff" stroke="#111"/>${text(10, 18, 'LEGEND', 'font-weight="bold"')}${ln(0, 24, RW, 24, 0.6)}${body}</g>`);
    ry += ly + 28;
    const pits = L.mains.map((m) => `${m.meb} → ${m.pits.map(tagOf).join(', ') || 'NO PIT'}`).join('; ');
    const notes = [
      `1. A FLOOR EARTH BAR WITH TWO TEST LINKS ON EVERY LEVEL OF RISER ${L.riserName.toUpperCase()}.`,
      `2. RISER EARTH CABLE ${L.tape.toUpperCase()}, CONTINUOUS BAR TO BAR: IN THROUGH ONE TEST LINK, OUT THROUGH THE OTHER, SO EACH BAR CAN BE ISOLATED FOR TESTING.`,
      `3. LV ROOM EARTH BAR TO THE RISER: ${L.lvRoomCable.toUpperCase()}.`,
      `4. LV EARTH PITS: SEE EARTHING SCHEMATIC ${schematicNo.toUpperCase()}${pits ? ` (${pits})` : ''}.`,
      `5. SMDB / DB EARTH BARS TO THE FLOOR EARTH BAR: SEE THE FLOOR EARTHING SHEETS.`,
      '6. CABLE CONTAINMENT, BUSBAR TRUNKING AND RISER STEELWORK BONDED TO THE FLOOR EARTH BAR.',
      ...(L.style === 'typical' ? ['7. TYPICAL LEVELS: ONE FLOOR EARTH BAR ON EACH LEVEL OF THE GROUP, CONNECTED AS SHOWN.'] : []),
      ...(L.notOnLevel.length ? [`${L.style === 'typical' ? 8 : 7}. NOT SHOWN — NO LEVEL IN THIS BUILDING: ${L.notOnLevel.join(', ')}.`] : [])
    ];
    out.push(text(RX, ry, 'NOTES', 'font-weight="bold"'));
    notes.splice(0, notes.length, ...wrap(notes, 98));
    notes.forEach((t, i) => out.push(text(RX, ry + 16 + i * 14, t, 'font-size="8.5"')));
    ry += 16 + notes.length * 14 + 24;
    out.push(text(RX, ry, 'FLOOR EARTH BAR SCHEDULE', 'font-weight="bold"'));
    const cols = [0.3, 0.3, 0.18, 0.22].map((f) => f * RW);
    const rows = [['Level', 'Floor earth bar', 'Panels', 'Floor sheet']];
    for (const r of [...page].reverse()) {
      const panels = r.floors.reduce((s, f) => s + f.boards.length, 0);
      const fno = r.floors.map((f) => opts.floorNo?.(f.floor.key)).find(Boolean);
      rows.push([r.typical ? r.label.replace(/^TYPICAL /, '') : r.label, r.bar, r.typical ? `${panels} (${r.floors.length} levels)` : String(panels), panels ? fno ?? '—' : '—']);
    }
    ry = table(out, RX, ry + 8, cols, rows) + 10;
  }

  const h = Math.max(bottom, ry) + 30;
  const sub = `Floor earth bar on every level, earth cable bar to bar${pages.length > 1 ? ` — sheet ${pageIx + 1} of ${pages.length}` : ''}${L.style === 'typical' ? ' — typical floors grouped' : ''}`;
  return { ...svgOf(`EARTHING RISER DIAGRAM — ${L.buildingName.toUpperCase()}`, sub, W, h, out, opts.mono), pages: pages.length };
}

/** Floor earthing sheet: one floor (or typical group) of the building (part = group, lowest first). */
export function earthFloorDrawing(project: Project, buildingId: string, opts: EarthSheetOpts = {}, part = 0, given?: EarthRiserLayout): { svg: string; w: number; h: number; groups: number } {
  const L = given ?? earthRiserLayout(project, buildingId);
  const groups = floorGroups(L);
  const g = groups[Math.min(part, groups.length - 1)];
  const out: string[] = [];
  const BOX_W = 150, BOX_H = 44, PITCH = 186, BX0 = 330, TOP = 80;
  const f: EarthRiserFloor | undefined = g?.floors[0];
  const boards = f?.boards ?? [];
  const W = Math.max(BX0 + boards.length * PITCH + 40, 1200);
  if (!g || !f) {
    out.push(text(W / 2, TOP + 40, 'No panels on any level of this building — set each panel’s Level in its properties', `text-anchor="middle" fill="${RED}" font-weight="bold"`));
    return { ...svgOf(`FLOOR EARTHING — ${L.buildingName.toUpperCase()}`, 'SMDB / DB earth bars to the floor earth bar', W, TOP + 80, out, opts.mono), groups: 0 };
  }
  out.push(text(40, TOP, g.label, 'font-weight="bold" font-size="12"'));
  if (g.typical) out.push(text(40, TOP + 16, `${g.floors.length} LEVELS WITH THE SAME EARTHING — DRAWN FOR ${f.feb}; PANELS OF EACH LEVEL IN THE SCHEDULE`, `font-size="8.5" fill="${MUT}"`));
  // Panels in a row, each with its earth bar.
  const by = TOP + 40, barY = by + BOX_H + 4;
  const xOf = new Map(boards.map((b, k) => [b.board.id, BX0 + k * PITCH]));
  const kidsOf = (id: string) => boards.filter((c) => c.toBoard === id);
  const kidLanes = Math.max(0, ...boards.map((b) => kidsOf(b.board.id).length));
  boards.forEach((b) => {
    const x = xOf.get(b.board.id)!;
    out.push(`<rect x="${x}" y="${by}" width="${BOX_W}" height="${BOX_H}" fill="#fff" stroke="#111" stroke-width="1.3"/>`);
    out.push(text(x + BOX_W / 2, by + 15, b.board.id, 'text-anchor="middle" font-weight="bold"'));
    out.push(text(x + BOX_W / 2, by + 27, [b.board.kind ?? 'DB', b.board.ratedCurrentA ? `${b.board.ratedCurrentA} A` : ''].filter(Boolean).join(' · '), `text-anchor="middle" font-size="8.5" fill="${MUT}"`));
    out.push(text(x + BOX_W / 2, by + 39, 'EARTH BAR', 'text-anchor="middle" font-size="8"'));
    out.push(panelBar(x + BOX_W / 2 - 30, barY, 60));
  });
  // Panel to the panels it feeds on this floor.
  boards.forEach((b) => {
    const px = xOf.get(b.board.id)! + BOX_W / 2;
    kidsOf(b.board.id).forEach((c, i) => {
      const cx = xOf.get(c.board.id)! + BOX_W / 2 - 18, ly = barY + 22 + i * 14;
      out.push(path(`M${px + 6 + i * 4} ${barY + 7} V${ly} H${cx} V${barY + 7}`, 1.2), text(cx + 4, ly - 3, `1C ${c.cpcMm2 ?? '—'} mm² G/Y`, 'font-size="8"'));
    });
  });
  // The floor earth bar and its conductors to the panels earthed from it.
  const fromFeb = boards.filter((b) => !b.toBoard);
  const laneTop = barY + 30 + kidLanes * 14;
  const febX = 150, febY = laneTop + 30 + fromFeb.length * 14;
  out.push(floorBar(febX, febY, ''), text(febX, febY + BAR_H + 14, f.feb, 'text-anchor="middle" font-weight="bold"'));
  out.push(text(febX, febY + BAR_H + 28, `TO RISER ${L.riserName.toUpperCase()}${opts.riserNos?.length ? ` — SEE ${opts.riserNos.join(', ')}` : ''}`, 'text-anchor="middle" font-size="8"'));
  fromFeb.forEach((b, j) => {
    const cx = xOf.get(b.board.id)! + BOX_W / 2 - 18, ly = laneTop + j * 14;
    const sx = febX - 24 + (fromFeb.length > 1 ? (j * 48) / (fromFeb.length - 1) : 24); // studs along the bar between the test links
    out.push(path(`M${sx} ${febY} V${ly} H${cx} V${barY + 7}`, 1.2), `<circle cx="${sx}" cy="${febY + 4}" r="1.5" fill="#111"/>`);
    out.push(text(cx + 4, ly - 3, `1C ${b.cpcMm2 ?? '—'} mm² G/Y`, 'font-size="8"'));
  });
  let y = febY + BAR_H + 60;

  if (!opts.working) {
    const notes = [
      'NOTES',
      '1. EACH SMDB / DB EARTH BAR CONNECTED TO THE FLOOR EARTH BAR WITH A SEPARATE CONDUCTOR, SIZE AS ITS INCOMING CPC (Cu/PVC G/Y).',
      '2. A PANEL FED FROM ANOTHER PANEL ON THE SAME FLOOR CONNECTS TO THAT PANEL\'S EARTH BAR.',
      `3. FLOOR EARTH BAR ON THE RISER EARTH CABLE (${L.tape.toUpperCase()}) THROUGH ITS TEST LINKS — SEE THE EARTHING RISER DIAGRAM.`,
      ...(g.typical ? ['4. TYPICAL: EACH LEVEL OF THE GROUP IS EARTHED AS DRAWN, WITH ITS OWN PANELS AND FLOOR EARTH BAR (SCHEDULE).'] : [])
    ];
    notes.forEach((t, i) => out.push(text(40, y + i * 14, t, `font-size="8.5"${i ? '' : ' font-weight="bold"'}`)));
    y += notes.length * 14 + 30;
    out.push(text(40, y - 10, 'PANEL EARTHING SCHEDULE', 'font-weight="bold" font-size="11"'));
    const lv = (fl: EarthRiserFloor) => (fl.floor.tag === 'G' ? 'GF' : fl.floor.tag === 'R' ? 'RF' : fl.floor.tag);
    if (!g.typical) {
      const rows = [['Level', 'Panel', 'Fed from', 'Incoming feeder', 'PE conductor', 'Earth bar connected to']];
      for (const b of f.boards) {
        const fd = b.feeder;
        rows.push([lv(f), b.board.id, b.board.upstreamId ?? '—', fd ? `${fd.cores}C ${fd.cableCsaMm2} mm² · ${fd.lengthM} m` : '—', b.cpcMm2 ? `1C ${b.cpcMm2} mm² Cu G/Y` : '—', b.toBoard ? `${b.toBoard} earth bar` : f.feb]);
      }
      y = table(out, 40, y, [0.08, 0.16, 0.16, 0.2, 0.16, 0.24].map((x) => x * (W - 80)), rows) + 10;
    } else {
      // Typical levels: one row per level, its panels and conductors in one line; long lists in side-by-side columns.
      const body = g.floors.map((fl) => [lv(fl), fl.feb, fl.boards.map((b) => `${b.board.id} ${b.cpcMm2 ?? '—'} mm²${b.toBoard ? ` → ${b.toBoard}` : ''}`).join(', ')]);
      const per = 50, n = Math.min(2, Math.max(1, Math.ceil(body.length / per))), rowsPer = Math.ceil(body.length / n);
      const colW = (W - 80 - (n - 1) * 20) / n, cols = [0.1, 0.24, 0.66].map((x) => x * colW);
      let yEnd = y;
      for (let c = 0; c < n; c++) yEnd = Math.max(yEnd, table(out, 40 + c * (colW + 20), y, cols, [['Level', 'Floor earth bar', 'Panel earth bars (PE conductor → bar)'], ...body.slice(c * rowsPer, (c + 1) * rowsPer)]));
      y = yEnd + 10;
    }
  }
  const h = y + 20;
  return { ...svgOf(`FLOOR EARTHING — ${L.buildingName.toUpperCase()}`, 'SMDB / DB earth bars to the floor earth bar', W, h, out, opts.mono), groups: groups.length };
}

/** Sheet numbers for the match lines and cross references, from the drawing set. */
export function earthSheetRefs(project: Project, set: DrawingSet, buildingId: string, given?: EarthRiserLayout): Pick<EarthSheetOpts, 'riserNos' | 'floorNo'> {
  const L = given ?? earthRiserLayout(project, buildingId);
  const of = (kind: 'earthRiser' | 'earthFloor') => set.sheets.filter((x) => x.kind === kind && x.buildingId === buildingId);
  const riserNos: string[] = [];
  for (const x of of('earthRiser')) riserNos[x.part ?? 0] = x.number;
  const groups = floorGroups(L), byFloor = new Map<string, string>();
  for (const x of of('earthFloor')) for (const f of groups[x.part ?? 0]?.floors ?? []) byFloor.set(f.floor.key, x.number);
  return { riserNos: riserNos.some(Boolean) ? riserNos : undefined, floorNo: (k) => byFloor.get(k) };
}
