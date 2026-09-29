import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { newRiser } from '../calc/busbar';
import { buildRiserForm } from './riserForm';
import { buildFormWorkbook } from './formWorkbook';
import type { Project } from '../types';

const p: Project = { ...sampleProject, busRisers: [{ ...newRiser('BR-1', 'MDB-1'), name: 'BR-TA', floors: [{ id: 'a', name: 'L10', boardId: 'SMDB-FF' }, { id: 'b', name: 'Typ', kw: 30, count: 2 }] }] };

describe('bus bar riser form', () => {
  it('incomer from the riser, a row per tap-off, totals and DF', () => {
    const f = buildRiserForm(p, 'BR-1')!;
    expect(f.ref).toBe('BR-TA');
    expect(f.fedFrom).toBe('MDB-1');
    expect(f.incomer.busway).toMatch(/A TPN\+E DISTRIBUTED BUS RISER$/);
    expect(f.rows.map((r) => r.name)).toEqual(['SMDB-FF', 'Typ (1/2)', 'Typ (2/2)']);
    expect(f.rows[0].size).toBeDefined(); // the SMDB's incomer cable
    expect(f.totals.tcl).toBeCloseTo(f.rows.reduce((a, r) => a + r.tcl, 0));
    expect(f.df).toBeCloseTo(f.totals.md / f.totals.tcl);
  });
  it('Excel sheet only when there are risers', () => {
    expect(buildFormWorkbook(p).worksheets.map((w) => w.name)).toContain('BR-TA RISER');
    expect(buildFormWorkbook(sampleProject).worksheets.some((w) => w.name.endsWith('RISER'))).toBe(false);
  });
});
