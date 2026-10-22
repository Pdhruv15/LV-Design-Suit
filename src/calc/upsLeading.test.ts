import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { checkUpsLeading, sizeUps, UPS_DEFAULTS, type UpsSystem } from './ups';
import { buildDashboard } from './dashboard';
import type { Project } from '../types';

const ups = (id: string, boardId: string, patch: Partial<UpsSystem> = {}): UpsSystem => ({ ...UPS_DEFAULTS, id, name: id, boardId, ...patch });

/** A 100 kVA standby generator on SMDB-GF, with UPS boards below it (and one on MCC-1, not on the generator). */
function project(upsKva: number[], systems: UpsSystem[], genKva = 100): Project {
  const boards = sampleProject.boards.map((b) => (b.id === 'SMDB-GF' ? { ...b, standby: { kva: genKva } } : b));
  upsKva.forEach((kva, i) => boards.push({ id: `UPS-${i + 1}`, name: `UPS ${i + 1}`, kind: 'UPS', upstreamId: 'SMDB-GF', upsKva: kva }));
  boards.push({ id: 'UPS-M', name: 'UPS on mains', kind: 'UPS', upstreamId: 'MCC-1', upsKva: 200 });
  return { ...sampleProject, boards, upsSystems: systems };
}

describe('UPS leading kvar on the standby generator', () => {
  it('estimates the input filter at 10 % of the UPS kVA and passes within 10 % of the generator', () => {
    const s = ups('u1', 'UPS-1');
    const r = checkUpsLeading(project([60], [s]), s);
    expect(r).toMatchObject({ status: 'pass', kvar: 6, estimate: true, genBoardId: 'SMDB-GF', genKva: 100, totalKvar: 6, limitKvar: 10 });
    expect(r.issue).toContain('enter the datasheet value');
  });

  it('adds every UPS on the same generator and fails above its limit', () => {
    const a = ups('u1', 'UPS-1'), b = ups('u2', 'UPS-2', { inputFilterKvar: 7 }), m = ups('um', 'UPS-M');
    const p = project([60, 40], [a, b, m]);
    const r = checkUpsLeading(p, a);
    expect(r.status).toBe('fail');
    expect(r.totalKvar).toBeCloseTo(13, 6); // 6 (estimate) + 7 (datasheet); the mains UPS is not on the generator
    expect(r.issue).toContain('may lose voltage control');
    expect(checkUpsLeading(p, b)).toMatchObject({ kvar: 7, estimate: false, status: 'fail' });
    expect(sizeUps(p, a).notes.some((n) => n.includes('13 kvar leading'))).toBe(true);
    expect(buildDashboard(p).todo.some((t) => t.text.includes('u1: input filters 13 kvar leading'))).toBe(true);
  });

  it('uses the generator capability when entered', () => {
    const s = ups('u1', 'UPS-1', { inputFilterKvar: 12, genLeadingPct: 15 });
    expect(checkUpsLeading(project([60], [s]), s)).toMatchObject({ status: 'pass', limitKvar: 15 });
  });

  it('is not checked on the mains only, or without a linked board', () => {
    const m = ups('um', 'UPS-M');
    expect(checkUpsLeading(project([], [m]), m).status).toBe('not checked');
    expect(sizeUps(project([], [m]), m).notes.some((n) => n.includes('leading'))).toBe(false);
    const list = { ...UPS_DEFAULTS, id: 'l', name: 'l', loads: [{ id: 'x', name: 'Load', qty: 1, w: 5000 }] };
    expect(checkUpsLeading(project([], [list]), list).status).toBe('not checked');
  });
});
