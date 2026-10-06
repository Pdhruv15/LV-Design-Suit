import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { issueRevision } from './revisions';
import { addOp, newModification, transition, withRecord } from './designChanges';
import { affectedEquipment, filterRegister, opView, registerRow } from './proposalRegister';
import type { Project } from '../types';

const NOW = new Date('2026-10-06T08:00:00Z');
const p0: Project = issueRevision(sampleProject, { description: 'Issued', date: '2026-10-01' });
const mk = (p: Project, id: string, field: string, v: number, feederId = 'DB-GF1-R3') => {
  let r = newModification(p, { title: `T ${feederId}`, reason: 'R' }, NOW);
  r = addOp(p, r, 'feeder', feederId, field, v);
  return { ...r, id };
};

describe('register', () => {
  const a = mk(p0, 'MOD-001', 'loadKw', 3), b0 = mk(p0, 'MOD-002', 'lengthM', 55, 'DB-GF1-R1');
  const t = transition(p0, b0, 'proposed', { now: NOW }); if (!t.ok) throw new Error(t.error);
  const p = { ...p0, modifications: [a, t.record] };

  it('names the baseline, and says when it is unavailable instead of choosing another revision', () => {
    expect(registerRow(p, a).baseline).toBe('Rev A');
    const gone = { ...p, revisions: [] };
    expect(registerRow(gone, a).baseline).toBe('Rev A unavailable');
    expect(registerRow(gone, a).baselineState).toBe('unavailable');
    expect(registerRow(p0, { ...a, baselineRevisionId: undefined }).baseline).toBe('No baseline');
  });
  it('lists affected equipment and filters by status and equipment', () => {
    expect(affectedEquipment(a)).toEqual(['DB-GF1-R3']);
    expect(filterRegister(p, p.modifications!, { status: 'proposed' }).map((r) => r.id)).toEqual(['MOD-002']);
    expect(filterRegister(p, p.modifications!, { equipment: 'r1' }).map((r) => r.id)).toEqual(['MOD-002']);
    expect(filterRegister(p, p.modifications!, { status: 'open' })).toHaveLength(2);
    expect(filterRegister(p, p.modifications!, { text: 'nothing' })).toHaveLength(0);
  });
  it('an applied record is not "open"', () => {
    const applied = { ...a, status: 'accepted' as const, applied: { at: NOW.toISOString(), source: 'applied' as const, opIds: [] } };
    expect(filterRegister(p, [applied], { status: 'open' })).toHaveLength(0);
    expect(filterRegister(p, [applied], { status: 'accepted' })).toHaveLength(1);
  });
  it('shows current, expected-before and proposed, and which of them disagree', () => {
    const v = opView(p, a.ops[0]);
    expect(v.state).toBe('matches');
    expect(v.current).toBe(v.expectedBefore);
    const edited = { ...p, feeders: p.feeders.map((f) => (f.id === 'DB-GF1-R3' ? { ...f, loadKw: 9 } : f)) };
    expect(opView(edited, a.ops[0])).toMatchObject({ state: 'changed', current: '9' });
    expect(opView({ ...p, feeders: [] }, a.ops[0])).toMatchObject({ state: 'missing', current: '—' });
    expect(withRecord(p, a).modifications).toHaveLength(2);
  });
});
