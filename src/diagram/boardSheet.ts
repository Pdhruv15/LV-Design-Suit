import type { Board, Feeder, Project } from '../types';
import { incomerDeviceOf } from '../types';
import type { FeederResult } from '../calc/electrical';
import { runsOf } from '../calc/electrical';
import { circuitRef } from '../calc/loadSchedule';
import { phaseBalance, PHASE_UNBALANCE_CHECK_PCT } from '../calc/phaseBalance';
import { boardSummary } from '../calc/summary';
import { panelSummary } from '../docs/mdSheet';
import { boardLocation } from '../model/levels';
import { cableTypeOf } from '../model/cableTypes';
import { feederPhaseKw, phaseTag } from '../model/phases';
import { boardEarth, type BoardEarth } from '../model/boardEarth';
import { splitSld } from '../model/sldScope';
import { deviceKind, devicePoles } from './deviceText';
import { escapeHtmlAttr } from '../util/escape';

/** One board's single line diagram as a printable drawing (black on white,
 * SVG for the PDF sheet and the DXF): the supply and incomer, the busbar and
 * every outgoing circuit with its phase, then the panel summary (TCL, DF, MDL,
 * fault level, R / Y / B loading, unbalance, earth) beside the circuit table
 * with each circuit's load on R, Y and B. Colour-free: status is written. */

const SP = 120, MARGIN = 50, BUS_Y = 150, BOX_Y = 270, BOX_H = 46, ROW = 18, SUM_Y = 24;
const PER_ROW = 12, ROW_SPAN = 230; // circuits per busbar row; height of one row
const SUM_W = 470, GAP = 40;
const COLS: [string, number, 'start' | 'end'][] = [
  ['REF', 64, 'start'], ['DESCRIPTION', 190, 'start'], ['BREAKER', 130, 'start'], ['CABLE', 150, 'start'], ['m', 40, 'end'],
  ['R kW', 58, 'end'], ['Y kW', 58, 'end'], ['B kW', 58, 'end'], ['Ib A', 52, 'end'], ['Vd %', 52, 'end'], ['STATUS', 70, 'start']
];
const TABLE_W = COLS.reduce((s, c) => s + c[1], 0);

/** Escaped for text and quoted attributes (project data is untrusted). */
const esc = escapeHtmlAttr;
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ln = (x1: number, y1: number, x2: number, y2: number, w = 1.2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${w}"/>`;
const tx = (x: number, y: number, s: string, o: { anchor?: 'start' | 'middle' | 'end'; bold?: boolean; size?: number } = {}) =>
  `<text x="${x}" y="${y}" fill="#000" font-family="Arial, Helvetica, sans-serif" font-size="${o.size ?? 11}"${o.bold ? ' font-weight="bold"' : ''}${o.anchor && o.anchor !== 'start' ? ` text-anchor="${o.anchor}"` : ''}>${esc(s)}</text>`;
const kw = (v: number) => (v > 0.005 ? v.toFixed(2) : '—');

/** IEC 60617 switching device on a vertical line from (x, y) to (x, y + 16), as on the SLD canvas. */
function switchSym(x: number, y: number, kind: 'breaker' | 'acb' | 'isolator' | 'nonauto'): string {
  let s = ln(x, y, x, y + 3);
  if (kind === 'isolator') s += ln(x - 4, y + 3, x + 4, y + 3);
  if (kind === 'nonauto') s += ln(x - 4, y - 2, x + 4, y - 2);
  if (kind !== 'isolator') s += `<path d="M${x - 3} ${y} l6 6 M${x + 3} ${y} l-6 6" stroke="#000" stroke-width="1.2" fill="none"/>`;
  s += ln(x, y + 16, x - 7, y + 5);
  if (kind === 'acb') s += `<path d="M${x - 4} ${y - 5} l4 -3 l4 3 M${x - 4} ${y + 20} l4 3 l4 -3" stroke="#000" stroke-width="1.2" fill="none"/>`;
  return s;
}
const kindOf = (f: Feeder) => (f.device === 'ISOL' ? 'isolator' : f.device === 'ACB' || deviceKind(f) === 'ACB' ? 'acb' : 'breaker');
const deviceText = (f: Feeder) => `${f.breakerRatingA} A ${devicePoles(f)} ${deviceKind(f)}`;
const cableText = (project: Project, f: Feeder) => `${runsOf(f) > 1 ? `${runsOf(f)}×` : ''}${f.cores}C×${f.cableCsaMm2} mm² CU/${cableTypeOf(project, f).code}`;
/** The earth path, split over two summary lines when long, and the incomer CPC's I²t check. */
function earthRows(e: BoardEarth): [string, string][] {
  const [path, sheet] = e.text.split(' · sheet ');
  const lines: [string, string][] = path.length > 52 && path.includes(' → ')
    ? [['EARTH', path.slice(0, path.indexOf(' → '))], ['', `→ ${path.slice(path.indexOf(' → ') + 3)}`]]
    : [['EARTH', path]];
  if (sheet) lines.push(['', `Earthing schematic: sheet ${sheet}`]);
  if (e.conductor) lines.push(['EARTH CONDUCTOR', e.conductor.text]);
  return lines;
}
const statusText = (r?: FeederResult) => (!r ? '' : r.status === 'bad' ? 'FAIL' : r.status === 'warn' ? 'CHECK' : 'OK');

export interface BoardSheetOptions {
  /** Drawing number of the sheet showing the board above, for the "FROM" note. */
  fromSheet?: string;
}

export function boardSheetSvg(project: Project, board: Board, results: FeederResult[], opts: BoardSheetOptions = {}): { svg: string; w: number; h: number } {
  const byId = new Map(results.map((r) => [r.feeder.id, r]));
  const feeders = project.feeders.filter((f) => f.boardId === board.id);
  // The drawing stops at final circuits: feeders to boards and major equipment are drawn, the lighting
  // and power circuits are one box referring to the schedule; the circuit table still lists every way.
  const { drawn, final } = splitSld(feeders, (f) => f);
  const n = drawn.length + (final.length ? 1 : 0);
  // A long busbar wraps onto further rows (at most PER_ROW circuits each, rows evened out), so a
  // DB with many ways still prints readably on A3; the rows are joined by a dashed continuation.
  const rowsN = Math.max(1, Math.ceil(n / PER_ROW)), perRow = Math.max(3, Math.ceil(n / rowsN));
  const diagramW = perRow * SP + 2 * MARGIN;
  const cx = MARGIN + (perRow * SP) / 2;
  const rowOf = (i: number) => Math.floor(i / perRow);
  const xs = Array.from({ length: n }, (_, i) => MARGIN + SP / 2 + (i % perRow) * SP);
  const dy = (i: number) => rowOf(i) * ROW_SPAN;
  const out: string[] = [];

  // Supply and incomer.
  const s = boardSummary(project, board);
  const incomer = s.incomer;
  const dev = incomerDeviceOf(board);
  if (!board.upstreamId) {
    out.push(ln(cx, 0, cx, 18), `<circle cx="${cx}" cy="30" r="12" fill="none" stroke="#000" stroke-width="1.2"/><circle cx="${cx}" cy="44" r="12" fill="none" stroke="#000" stroke-width="1.2"/>`);
    out.push(tx(cx + 22, 30, `TRANSFORMER ${board.sourceKva ?? '—'} kVA`, { bold: true }), tx(cx + 22, 44, `11/${(project.voltageV / 1000).toFixed(3)} kV · Z ${board.sourceImpedancePct ?? '—'} %`));
    out.push(ln(cx, 56, cx, 90));
  } else {
    out.push(ln(cx, 0, cx, 90));
    out.push(tx(cx + 14, 14, `FROM ${board.upstreamId}${opts.fromSheet ? ` (SHEET ${opts.fromSheet})` : ''}`, { bold: true }));
    if (incomer) out.push(tx(cx + 14, 30, `${cableText(project, incomer)} · ${incomer.lengthM} m`), tx(cx + 14, 44, `${deviceText(incomer)} at ${board.upstreamId}`));
  }
  if (dev) {
    out.push(switchSym(cx, 96, dev === 'ISOL' ? 'isolator' : dev === 'ACB' ? 'acb' : dev === 'MCCB-NA' ? 'nonauto' : 'breaker'));
    out.push(tx(cx + 14, 108, `INCOMER ${board.ratedCurrentA ? `${board.ratedCurrentA} A ` : ''}${dev === 'MCCB-NA' ? 'MCCB (NA)' : dev}`));
    out.push(ln(cx, 112, cx, BUS_Y));
  } else out.push(ln(cx, 90, cx, BUS_Y));

  // Busbar (one line per row; later rows continue from the first).
  const x1 = MARGIN + 10, x2 = diagramW - MARGIN - 10;
  for (let r = 0; r < rowsN; r++) {
    const y = BUS_Y + r * ROW_SPAN;
    const last = Math.min(n, (r + 1) * perRow) - 1;
    out.push(`<line data-dxf-layer="BUSBAR" x1="${x1}" y1="${y}" x2="${r ? Math.max(xs[last] + 50, x1 + 120) : x2}" y2="${y}" stroke="#000" stroke-width="4"/>`);
    if (r) {
      out.push(`<path d="M${x1} ${y - ROW_SPAN} H${x1 - 20} V${y} H${x1}" stroke="#000" stroke-width="1.5" stroke-dasharray="6 4" fill="none"/>`);
      out.push(tx(x1, y - 8, `${board.id} BUSBAR (CONTINUED)`, { size: 10 }));
    }
  }
  out.push(tx(x1, BUS_Y - 8, `${board.id} · ${project.voltageV} V${board.ratedCurrentA ? ` · ${board.ratedCurrentA} A` : ''} ${board.busbarMaterial === 'aluminium' ? 'AL' : 'CU'} BUSBAR`, { bold: true }));
  out.push(tx(x2, BUS_Y - 8, `Isc ${s.faultKA.toFixed(1)} kA`, { anchor: 'end' }));

  // Outgoing circuits.
  drawn.forEach((f, i) => {
    const x = xs[i], o = dy(i);
    const BUS_Y_ = BUS_Y + o, BOX_Y_ = BOX_Y + o;
    out.push(ln(x, BUS_Y_, x, 176 + o), switchSym(x, 176 + o, kindOf(f)), ln(x, 192 + o, x, BOX_Y_));
    out.push(tx(x + 8, 188 + o, deviceText(f), { size: 10 }));
    out.push(tx(x + 8, 201 + o, `${f.breakerIcuKa ? `${f.breakerIcuKa} kA` : ''}${f.rcdMa ? ` · ${f.rcdMa} mA RCD` : ''}`, { size: 10 }));
    // Cable on two short lines, so it stays within its own column.
    out.push(tx(x + 8, 222 + o, `${runsOf(f) > 1 ? `${runsOf(f)}×` : ''}${f.cores}C×${f.cableCsaMm2} mm²`, { size: 10 }), tx(x + 8, 235 + o, cut(`CU/${cableTypeOf(project, f).code} · ${f.lengthM} m`, 18), { size: 10 }));
    out.push(`<rect x="${x - SP / 2 + 8}" y="${BOX_Y_}" width="${SP - 16}" height="${BOX_H}" fill="none" stroke="#000" stroke-width="1"/>`);
    out.push(tx(x, BOX_Y_ + 16, circuitRef(f) ?? f.id, { anchor: 'middle', bold: true, size: 10.5 }));
    out.push(tx(x, BOX_Y_ + 30, cut(f.room || f.name || '—', 17), { anchor: 'middle', size: 10 }));
    out.push(tx(x, BOX_Y_ + 42, f.feedsBoardId ? `→ ${f.feedsBoardId}` : `${(f.loadKw * f.demandFactor).toFixed(2)} kW`, { anchor: 'middle', size: 10 }));
    const tag = phaseTag(f);
    out.push(tx(x, BOX_Y_ + BOX_H + 16, tag === 'RYB' ? 'RYB' : tag ? `PH ${tag}` : 'PH —', { anchor: 'middle', bold: true, size: 10.5 }));
  });
  if (final.length) {
    const i = n - 1, x = xs[i], o = dy(i), left = x - SP / 2 + 8;
    const kwSum = final.reduce((t, f) => t + f.loadKw * f.demandFactor, 0);
    out.push(`<line x1="${x}" y1="${BUS_Y + o}" x2="${x}" y2="${BOX_Y + o}" stroke="#000" stroke-width="1.2" stroke-dasharray="6 4"/>`);
    out.push(tx(x + 8, 188 + o, `${final.length} WAYS`, { size: 10 }));
    out.push(`<rect x="${left}" y="${BOX_Y + o}" width="${SP - 16}" height="${BOX_H + 18}" fill="none" stroke="#000" stroke-width="1" stroke-dasharray="6 4"/>`);
    out.push(tx(x, BOX_Y + o + 14, 'FINAL CIRCUITS', { anchor: 'middle', bold: true, size: 10.5 }));
    out.push(tx(x, BOX_Y + o + 27, `${final.length} nos · ${kwSum.toFixed(2)} kW`, { anchor: 'middle', size: 10 }));
    out.push(tx(x, BOX_Y + o + 40, 'REFER DB LOAD', { anchor: 'middle', size: 10 }));
    out.push(tx(x, BOX_Y + o + 53, 'SCHEDULE', { anchor: 'middle', size: 10 }));
  }

  // Panel summary.
  const ps = panelSummary(project, board);
  const pb = phaseBalance(project, board.id);
  const three = (r: Record<'R' | 'Y' | 'B', number>, d: number) => `${r.R.toFixed(d)} / ${r.Y.toFixed(d)} / ${r.B.toFixed(d)}`;
  const over = pb.unbalancePct > PHASE_UNBALANCE_CHECK_PCT + 1e-9;
  const rows: [string, string][] = [
    ['BOARD', cut(`${board.id}${board.name && board.name !== board.id ? ` — ${board.name}` : ''}`, 40)],
    ['LOCATION', cut(boardLocation(project, board) || '—', 40)],
    ['SUPPLY', board.upstreamId ? `From ${board.upstreamId}${opts.fromSheet ? `, sheet ${opts.fromSheet}` : ''}` : `Transformer ${board.sourceKva ?? '—'} kVA`],
    ['TCL / DF / MDL', `${ps.tclKw.toFixed(2)} kW / ${ps.df.toFixed(2)} / ${ps.mdlKw.toFixed(2)} kW`],
    ['DEMAND CURRENT', `${s.currentA.toFixed(1)} A${board.ratedCurrentA ? ` of ${board.ratedCurrentA} A (${(s.loadingPct ?? 0).toFixed(0)} %)` : ''}`],
    ['FAULT LEVEL', `${s.faultKA.toFixed(1)} kA`],
    ['R / Y / B LOAD', `${three(pb.kw, 2)} kW`],
    ['R / Y / B CURRENT', `${three(pb.currentA, 1)} A`],
    ['NEUTRAL CURRENT', `${pb.neutralA.toFixed(1)} A`],
    ['CURRENT UNBALANCE', `${pb.unbalancePct.toFixed(1)} % (check ≤ ${PHASE_UNBALANCE_CHECK_PCT} %)${over ? ' — CHECK' : ''}`],
    ...(pb.unassigned.length ? [['NO PHASE SET', `${pb.unassigned.length} single-phase circuit${pb.unassigned.length === 1 ? '' : 's'}`] as [string, string]] : []),
    ...earthRows(boardEarth(project, board))
  ];
  const sx = diagramW - MARGIN + GAP; // beside the diagram
  out.push(tx(sx, SUM_Y - 8, 'PANEL SUMMARY', { bold: true, size: 12 }));
  out.push(`<rect x="${sx}" y="${SUM_Y}" width="${SUM_W}" height="${rows.length * ROW}" fill="none" stroke="#000" stroke-width="1"/>`);
  rows.forEach(([k, v], i) => {
    const y = SUM_Y + i * ROW;
    if (i) out.push(ln(sx, y, sx + SUM_W, y, 0.5));
    out.push(tx(sx + 6, y + 13, k, { size: 10, bold: true }), tx(sx + 150, y + 13, cut(v, 52), { size: 10 }));
  });
  out.push(ln(sx + 144, SUM_Y, sx + 144, SUM_Y + rows.length * ROW, 0.5));

  // Circuit table.
  const tx0 = MARGIN; // full width under the diagram
  const TABLE_Y = Math.max(BOX_Y + (rowsN - 1) * ROW_SPAN + BOX_H + 40, SUM_Y + rows.length * ROW) + 36;
  const lines = feeders.length + 2;
  out.push(tx(tx0, TABLE_Y - 8, 'CIRCUITS', { bold: true, size: 12 }));
  out.push(`<rect x="${tx0}" y="${TABLE_Y}" width="${TABLE_W}" height="${lines * ROW}" fill="none" stroke="#000" stroke-width="1"/>`);
  const cell = (row: number, values: string[], bold = false) => {
    let x = tx0;
    COLS.forEach(([, w, a], k) => {
      out.push(tx(a === 'end' ? x + w - 5 : x + 5, TABLE_Y + row * ROW + 13, values[k] ?? '', { anchor: a, size: 10, bold }));
      x += w;
    });
    if (row) out.push(ln(tx0, TABLE_Y + row * ROW, tx0 + TABLE_W, TABLE_Y + row * ROW, row === 1 || row === lines - 1 ? 1 : 0.5));
  };
  cell(0, COLS.map((c) => c[0]), true);
  const tot = { R: 0, Y: 0, B: 0 };
  feeders.forEach((f, i) => {
    const r = byId.get(f.id);
    const k = feederPhaseKw(project, f);
    tot.R += k.R; tot.Y += k.Y; tot.B += k.B;
    cell(i + 1, [circuitRef(f) ?? f.id, cut(f.feedsBoardId ? `${f.room || f.name || ''} → ${f.feedsBoardId}`.trim() : f.room || f.name || '—', 30), deviceText(f), cut(cableText(project, f), 25), String(f.lengthM),
      kw(k.R), kw(k.Y), kw(k.B), r ? r.ib.toFixed(1) : '', r ? r.vdTotalPct.toFixed(2) : '', statusText(r)]);
  });
  cell(lines - 1, ['', 'TOTAL', '', '', '', kw(tot.R), kw(tot.Y), kw(tot.B), '', '', ''], true);
  let cx0 = tx0;
  for (const [, w] of COLS.slice(0, -1)) { cx0 += w; out.push(ln(cx0, TABLE_Y, cx0, TABLE_Y + lines * ROW, 0.5)); }

  const W = Math.max(sx + SUM_W + MARGIN, 2 * MARGIN + TABLE_W);
  const H = TABLE_Y + lines * ROW + 20;
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" data-w="${W}" data-h="${H}">${out.join('')}</svg>`, w: W, h: H };
}
