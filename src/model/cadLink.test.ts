import { describe, expect, it } from 'vitest';
import { cadTagLabel, cadUpdateSummary } from './cadLink';
import { sampleProject } from '../data/sampleProject';

const p = sampleProject;
const f = p.feeders[0];

describe('CAD update summary', () => {
  it('names boards by ID, feeders by board and name, and sheet furniture plainly', () => {
    expect(cadTagLabel('board:MDB-1', p)).toBe('MDB-1');
    expect(cadTagLabel(`feeder:${f.id}`, p)).toBe(`${f.boardId} ${f.name}`);
    expect(cadTagLabel('feeder:gone', p)).toBe('gone');
    expect(cadTagLabel('sheet:1', p)).toBe('title block and notes');
  });

  it('reports what was redrawn, added and removed, and that CAD work was kept', () => {
    const m = cadUpdateSummary({ changed: [`feeder:${f.id}`, 'sheet:1'], added: ['board:SMDB-9'], removed: ['feeder:old'], unchanged: 7 }, p);
    expect(m).toBe(`Updated in OpenCADStudio: redrew ${f.boardId} ${f.name}, title block and notes; added SMDB-9; removed old (7 unchanged; your own CAD work kept)`);
  });

  it('shortens long lists and says when nothing changed', () => {
    const many = Array.from({ length: 6 }, (_, i) => `board:B${i}`);
    expect(cadUpdateSummary({ changed: many, added: [], removed: [], unchanged: 0 }, p)).toContain('redrew B0, B1, B2, B3 and 2 more');
    expect(cadUpdateSummary({ changed: [], added: [], removed: [], unchanged: 5 }, p)).toBe('OpenCADStudio drawing is already up to date — nothing changed');
  });
});
