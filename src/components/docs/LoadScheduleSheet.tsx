import { useMemo } from 'react';
import type { Project } from '../../types';
import { deleteCircuit } from '../../model/schedule';
import { applySheetEdits, buildDbSheet } from '../../docs/dbSheet';
import FormSheet from './FormSheet';

/** The DB load distribution schedule as an Excel-style sheet. */
export default function LoadScheduleSheet({ project, boardId, onChange, onStatus }: {
  project: Project;
  boardId: string;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
}) {
  const sheet = useMemo(() => buildDbSheet(project, boardId), [project, boardId]);
  return (
    <FormSheet
      model={sheet}
      onStatus={onStatus}
      onEdits={(edits) => {
        const { project: next, rejected } = applySheetEdits(project, sheet, edits);
        if (next !== project) onChange(next);
        return { changed: next !== project, rejected };
      }}
      menuFor={(y) => {
        const row = sheet.rows[y];
        if (row?.type !== 'circuit') return [];
        const f = row.feeder;
        return [{
          title: `Delete circuit ${f.phase}${f.way}${f.room ? ` (${f.room})` : ''}`,
          onclick: () => { if (window.confirm(`Delete circuit ${f.phase}${f.way}?`)) onChange(deleteCircuit(project, f.id)); }
        }];
      }}
    >
      <p className="ls-sheet-foot">{sheet.cableText}</p>
    </FormSheet>
  );
}
