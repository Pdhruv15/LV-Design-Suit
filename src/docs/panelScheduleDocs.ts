import type { Board, Project } from '../types';
import { scheduleCircuits } from '../calc/loadSchedule';
import { buildFormWorkbook } from './formWorkbook';
import { buildLoadScheduleHtml } from './loadScheduleDoc';
import { hasMdSheet } from './mdSheet';
import { workbookHtml } from './sheetPdf';

export interface PanelScheduleDoc {
  boardId: string;
  kind: 'md' | 'db';
  title: string;
  html: string;
}

/** Printable panel schedules for an issue package. Larger distribution and
 * package panels use the connected-load / MD form; DBs and EDBs with final
 * circuits use the load-distribution schedule. A mixed panel may have both. */
export function panelScheduleDocs(project: Project, boards: Board[]): PanelScheduleDoc[] {
  return boards.flatMap((board) => {
    const docs: PanelScheduleDoc[] = [];
    if (hasMdSheet(project, board.id)) {
      const title = `Connected load / MD — ${board.id}`;
      docs.push({ boardId: board.id, kind: 'md', title, html: workbookHtml(project, buildFormWorkbook(project, { boardIds: [board.id], forms: ['md'] }), title) });
    }
    if (scheduleCircuits(project, board.id).length) {
      docs.push({ boardId: board.id, kind: 'db', title: `Load schedule — ${board.id}`, html: buildLoadScheduleHtml(project, board.id) });
    }
    return docs;
  });
}
