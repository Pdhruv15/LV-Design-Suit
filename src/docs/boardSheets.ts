import type { Project } from '../types';
import type { FeederResult } from '../calc/electrical';
import { boardsInSupplyOrder } from '../calc/summary';
import { boardSheetSvg } from '../diagram/boardSheet';
import { buildSldSheetHtml, type SheetInfo } from './sldSheet';

/** The board-wise SLD set: one A3 sheet per board in supply order (each main
 * board, then the boards it feeds), numbered from the project's SLD drawing
 * number — E-SLD-01, E-SLD-02 … — each pointing to its supply's sheet. */

export interface BoardSheetPage { boardId: string; info: SheetInfo; svg: string }

export const boardSheetNo = (base: string, i: number) => `${base}-${String(i + 1).padStart(2, '0')}`;

export function boardSheetPages(project: Project, results: FeederResult[], boardIds?: string[]): BoardSheetPage[] {
  const all = boardsInSupplyOrder(project);
  const base = project.drawing?.number?.trim() || 'E-SLD';
  const noOf = new Map(all.map((b, i) => [b.id, boardSheetNo(base, i)]));
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
