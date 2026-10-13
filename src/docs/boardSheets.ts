import type { Project } from '../types';
import type { FeederResult } from '../calc/electrical';
import { boardsInSupplyOrder } from '../calc/summary';
import { boardSheetSvg } from '../diagram/boardSheet';
import { buildSldSheetHtml, type SheetInfo } from './sldSheet';
import { DB_PREFIX, setOf, sheetNumber } from '../model/drawingSet';

/** The board-wise SLD set: one A3 sheet per board in supply order (each main
 * board, then the boards it feeds), numbered in their own sequence with the
 * drawing set's numbering — E-DB-001, E-DB-002 … (prefix set in Drawings) —
 * each pointing to its supply's sheet. */

export interface BoardSheetPage { boardId: string; info: SheetInfo; svg: string }

export const boardSheetNo = (project: Project, i: number) => { const set = setOf(project); return sheetNumber(set, i, set.dbPrefix ?? DB_PREFIX); };

export function boardSheetPages(project: Project, results: FeederResult[], boardIds?: string[]): BoardSheetPage[] {
  const all = boardsInSupplyOrder(project);
  const noOf = new Map(all.map((b, i) => [b.id, boardSheetNo(project, i)]));
  const chosen = boardIds ? all.filter((b) => boardIds.includes(b.id)) : all;
  return chosen.map((b) => {
    const index = all.indexOf(b) + 1;
    const info: SheetInfo = { no: noOf.get(b.id)!, title: `${b.id} SINGLE LINE DIAGRAM`, count: all.length, index };
    const { svg } = boardSheetSvg(project, b, results, { fromSheet: b.upstreamId ? noOf.get(b.upstreamId) : undefined });
    return { boardId: b.id, info, svg };
  });
}

/** Printable HTML of one board sheet (frame and title block as the SLD sheets). */
export const boardSheetHtml = (project: Project, page: BoardSheetPage) => buildSldSheetHtml(project, page.svg, 'A3', page.info);
