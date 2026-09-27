import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { boardDemandKw } from '../calc/electrical';
import { scheduleCircuits } from '../calc/loadSchedule';
import { layoutSystem } from '../diagram/layout';
import { pasteBoard, planPaste, suggestRename } from './copyBoard';

const GF_TO_FF = { idFind: 'GF', idReplace: 'FF2', nameFind: 'Ground floor', nameReplace: 'Second floor' };

describe('copy / paste a board with everything below it', () => {
  it('suggests renaming the part after the board type', () => {
    expect(suggestRename(sampleProject, 'SMDB-GF')).toEqual({ idFind: 'GF', idReplace: '', nameFind: 'Ground floor', nameReplace: '' });
  });

  it('copies the SMDB, its DB, feeders and every schedule circuit, renamed and connected', () => {
    const r = pasteBoard(sampleProject, 'SMDB-GF', 'MDB-1', GF_TO_FF);
    const p = r.project;
    expect(r.rootId).toBe('SMDB-FF2');
    const smdb = p.boards.find((b) => b.id === 'SMDB-FF2')!;
    expect(smdb).toMatchObject({ name: 'Second floor SMDB', upstreamId: 'MDB-1', location: 'Second floor electrical room' });
    expect(p.boards.find((b) => b.id === 'DB-FF21')).toMatchObject({ upstreamId: 'SMDB-FF2', name: 'Villa second floor DB' });
    // Circuits follow their DB: DB-GF1-R3 → DB-FF21-R3, same points and phase.
    const copied = scheduleCircuits(p, 'DB-FF21');
    expect(copied).toHaveLength(21);
    expect(copied.find((f) => f.id === 'DB-FF21-R3')).toMatchObject({ room: 'Cooker', phase: 'R', way: 3, points: { cooker: 1 } });
    // A new incomer on the MDB feeds the copy; the original is untouched.
    const inc = p.feeders.find((f) => f.feedsBoardId === 'SMDB-FF2')!;
    expect(inc).toMatchObject({ boardId: 'MDB-1', cableCsaMm2: 300, breakerRatingA: 500 });
    expect(p.feeders.find((f) => f.feedsBoardId === 'DB-FF21')!.boardId).toBe('SMDB-FF2');
    expect(boardDemandKw(p, 'SMDB-FF2')).toBeCloseTo(boardDemandKw(sampleProject, 'SMDB-GF'), 9);
    expect(p.feeders.filter((f) => f.boardId === 'SMDB-GF')).toEqual(sampleProject.feeders.filter((f) => f.boardId === 'SMDB-GF'));
    expect(r.message).toBe('Pasted SMDB-FF2, DB-FF21 on MDB-1: 2 boards, 5 feeders, 21 circuits');
    expect(layoutSystem(p).boards.find((b) => b.board.id === 'SMDB-FF2')!.depth).toBe(1);
  });

  it('renames names ignoring case, keeping the first letter\'s case, and handles special characters', async () => {
    const { replaceWords } = await import('./copyBoard');
    expect(replaceWords('Ground floor SMDB / ground floor DB', 'Ground floor', 'First floor')).toBe('First floor SMDB / first floor DB');
    expect(replaceWords('Block (A) lighting', '(A)', '(B)')).toBe('Block (B) lighting');
  });

  it('without a rename, adds -2 (and -3 on the next paste) so ids never clash', () => {
    const none = { idFind: '', idReplace: '', nameFind: '', nameReplace: '' };
    const a = pasteBoard(sampleProject, 'DB-GF1', 'SMDB-FF', none);
    expect(a.rootId).toBe('DB-GF1-2');
    expect(scheduleCircuits(a.project, 'DB-GF1-2')).toHaveLength(21);
    expect(a.project.feeders.some((f) => f.id === 'DB-GF1-2-R3')).toBe(true);
    const b = pasteBoard(a.project, 'DB-GF1', 'SMDB-FF', none);
    expect(b.rootId).toBe('DB-GF1-3');
    const ids = [...b.project.boards.map((x) => x.id), ...b.project.feeders.map((x) => x.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a pasted main board loses its authority supply and transformer', () => {
    const r = pasteBoard(sampleProject, 'MDB-1', 'SMDB-FF', { idFind: '', idReplace: '', nameFind: '', nameReplace: '' });
    const b = r.project.boards.find((x) => x.id === r.rootId)!;
    expect(b.upstreamId).toBe('SMDB-FF');
    expect(b.sourceKva).toBeUndefined();
    const plan = planPaste(sampleProject, 'MDB-1', 'SMDB-FF', { idFind: '', idReplace: '', nameFind: '', nameReplace: '' });
    expect(plan.boards.size).toBe(sampleProject.boards.length);
  });
});
