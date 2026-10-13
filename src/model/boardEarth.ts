import type { Board, Project } from '../types';
import type { Status } from '../calc/electrical';
import { evaluateEarthing } from '../calc/earthing';
import { cpcOf } from '../calc/cableTable';
import { earthingLayout, kindInfo, type EarthLayout } from './earthingPlan';

/** How a board is earthed, for its board view and board sheet: the earth bar
 * and pits it reaches (its own SMDB pits, else its main board's LV pits), the
 * pit group's test result, the earthing sheet, and the incomer's protective
 * conductor with its adiabatic (I²t) check — the same check as the circuit's
 * earth-fault results. The pit conductors themselves are not checked here: in
 * TN-S they carry no LV fault current, and an HV fault needs the authority's
 * HV earth-fault level. */

/** Drawing number of the earthing schematic sheet, from the SLD drawing number (E-EARTH-01 by default). */
export const earthSheetNo = (project: Project) => `${project.drawing?.number?.trim() || 'E'}-EARTH-01`;

export interface BoardEarth {
  /** Earth bar → pits, limit, test result and sheet. */
  text: string;
  status: 'pass' | 'fail' | 'untested' | 'none';
  /** Incomer CPC and its I²t check (sub-boards). */
  conductor?: { text: string; status: Status };
}

function mainOf(project: Project, board: Board): Board {
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  const seen = new Set<string>();
  let b = board;
  while (b.upstreamId && byId.has(b.upstreamId) && !seen.has(b.id)) { seen.add(b.id); b = byId.get(b.upstreamId)!; }
  return b;
}

export function boardEarth(project: Project, board: Board, L: EarthLayout = earthingLayout(project)): BoardEarth {
  const main = mainOf(project, board);
  const own = L.items.find((i) => i.key === `sub:${board.id}` && i.pits > 0);
  const item = own ?? L.items.find((i) => i.key === `lv:${main.id}`);
  const ids = item ? L.pits.filter((p) => p.itemKey === item.key).map((p) => p.id) : [];
  const sheet = earthSheetNo(project);
  let text: string, status: BoardEarth['status'] = 'none';
  if (!item || !ids.length) text = `No LV earth pits for ${main.id} in the earthing plan · sheet ${sheet}`;
  else {
    const limit = kindInfo(item.kind).limitOhm;
    const net = L.nets.find((n) => n.pits.includes(ids[0]));
    const result = net?.effectiveOhm === undefined ? 'not tested' : `${net.effectiveOhm.toFixed(2)} Ω ${net.ok ? '≤' : '>'} ${limit} Ω${net.ok ? '' : ' FAIL'}`;
    status = net?.effectiveOhm === undefined ? 'untested' : net.ok ? 'pass' : 'fail';
    const bar = own ? `${board.id} earth bar` : `${main.id} MET`;
    const via = board.id === main.id || own ? '' : board.upstreamId === main.id ? 'Via incomer CPC to ' : `Via incomer CPC to ${board.upstreamId}, then to `;
    text = `${via}${bar} → pit${ids.length > 1 ? 's' : ''} ${ids.join(', ')} (${result}) · sheet ${sheet}`;
  }
  const incomer = board.upstreamId ? project.feeders.find((f) => f.feedsBoardId === board.id && f.boardId === board.upstreamId) : undefined;
  if (!incomer) return { text, status };
  const e = evaluateEarthing(project, incomer);
  const verdict = e.adiabatic === 'ok' ? 'OK' : e.adiabatic === 'warn' ? 'CHECK' : 'FAIL';
  return {
    text, status,
    conductor: { text: `CPC ${e.runs > 1 ? `${e.runs} × ` : ''}${cpcOf(incomer)} mm² Cu · I²t needs ${(e.runs > 1 ? e.adiabaticMinMm2 : e.adiabaticWholeMm2).toFixed(1)} mm² — ${verdict}`, status: e.adiabatic }
  };
}
