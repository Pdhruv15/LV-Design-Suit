import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { UPS_DEFAULTS } from '../calc/ups';
import { issueRevision } from './revisions';
import { addOp, newModification, withRecord } from './designChanges';
import { isPreviewStale, previewProposal } from './proposalPreview';
import { newPriceList } from './priceList';
import type { Project } from '../types';

const NOW = new Date('2026-10-06T08:00:00Z');
const f0 = 'DB-GF1-R3';
const base = (): Project => issueRevision({ ...sampleProject, upsSystems: [{ ...UPS_DEFAULTS, id: 'u1', name: 'UPS-1', boardId: 'DB-GF1', chem: 'li-ion', blockV: 51.2, startSocPct: 100, minSocPct: 10, loads: [] }] }, { description: 'Issued', date: '2026-10-01' });
const feeder = (p: Project) => p.feeders.find((f) => f.id === f0)!;
const rec = (p: Project, ...ops: [string, string | undefined, string, number][]) => ops.reduce((r, [t, id, field, v]) => addOp(p, r, t as 'feeder', id, field, v), newModification(p, { title: 'T', reason: 'R' }, NOW));

describe('M3 — proposal preview', () => {
  it('(1) a cable-size change is previewed with fresh before/after results and changes nothing', () => {
    const p = base(), r = rec(p, ['feeder', f0, 'cableCsaMm2', feeder(p).cableCsaMm2 + 10]);
    const before = JSON.stringify(withRecord(p, r));
    const prev = previewProposal(withRecord(p, r), r);
    expect(prev.label).toBe('Proposed');
    expect(prev.circuits.some((c) => c.id === f0 && c.metric === 'Cable rating Iz' && c.to > c.from)).toBe(true);
    expect(prev.impact.studies.length).toBeGreaterThan(0);
    expect(JSON.stringify(withRecord(p, r))).toBe(before);
    expect(JSON.stringify(p.revisions)).toBe(JSON.stringify(base().revisions));
  });
  it('(9) a minimum-SOC change shows the battery result and the UPS in the impact, with no network study changed', () => {
    const p = base(), r = rec(p, ['ups', 'u1', 'minSocPct', 30]);
    const prev = previewProposal(withRecord(p, r), r);
    expect(prev.circuits).toEqual([]);
    expect(prev.impact.studies.some((s) => s.id === 'ups')).toBe(true);
    const u = prev.ups[0];
    expect(u.rows.some((x) => x.metric === 'Usable fraction' && x.from !== x.to)).toBe(true);
    expect(u.rows.some((x) => x.metric.includes('Battery capacity'))).toBe(true);
    expect(u.unverified.join(' ')).toContain('not verified');
  });
  it('(10) the preview is computed fresh and goes stale when the design or proposal changes', () => {
    const p = base(), r = rec(p, ['feeder', f0, 'lengthM', feeder(p).lengthM + 5]);
    const q = withRecord(p, r), prev = previewProposal(q, r);
    expect(isPreviewStale(q, r, prev)).toBe(false);
    const edited = { ...q, feeders: q.feeders.map((f) => (f.id === f0 ? { ...f, loadKw: f.loadKw + 1 } : f)) };
    expect(isPreviewStale(edited, r, prev)).toBe(true);
    expect(isPreviewStale(q, addOp(q, r, 'feeder', f0, 'loadKw', 1), prev)).toBe(true);
    const renamed = { ...q, name: 'Renamed project', feeders: q.feeders.map((f) => (f.id === f0 ? { ...f, remarks: 'note' } : f)) };
    expect(isPreviewStale(renamed, r, prev)).toBe(false); // metadata does not stale it
  });
  it('(11) missing rates show Unpriced and unmeasured routes show Not determined, never zero', () => {
    const p = base(), r = rec(p, ['feeder', f0, 'cableCsaMm2', 70]);
    const prev = previewProposal(withRecord(p, r), r, newPriceList('empty'));
    expect(prev.quantities.length).toBeGreaterThan(0);
    for (const q of prev.quantities) expect(['Unpriced', 'Not determined'].includes(q.cost as string) || typeof q.cost === 'number').toBe(true);
    const unpriced = prev.quantities.filter((q) => q.cost === 'Unpriced');
    expect(unpriced.every((q) => q.note)).toBe(true);
    const unknownRoute = { ...p, feeders: p.feeders.map((f) => (f.id === f0 ? { ...f, lengthToCheck: true } : f)) };
    const r2 = rec(unknownRoute, ['feeder', f0, 'cableCsaMm2', 70]);
    const prev2 = previewProposal(withRecord(unknownRoute, r2), r2, newPriceList('empty'));
    expect(prev2.quantities.some((q) => q.cost === 'Not determined')).toBe(true);
  });
  it('flags BOQ quantity adjustments on moved keys and drawings as known or for manual review', () => {
    const p = base(), r = rec(p, ['feeder', f0, 'cableCsaMm2', 70]);
    const prev0 = previewProposal(withRecord(p, r), r);
    const key = prev0.quantities[0].key;
    const adj = { ...p, boq: { ...(p.boq ?? {}), overrides: { [key]: { qty: 999 } } } } as Project;
    const prev = previewProposal(withRecord(adj, r), r);
    expect(prev.adjustments.length).toBe(1);
    expect(prev.documents.every((d) => d.certainty === 'known' || d.certainty === 'manual review')).toBe(true);
  });
  it('a target that no longer exists is reported, not silently dropped', () => {
    const p = base(), r = rec(p, ['feeder', f0, 'lengthM', 77]);
    const gone = { ...p, feeders: p.feeders.filter((f) => f.id !== f0) };
    const prev = previewProposal(withRecord(gone, r), r);
    expect(prev.skipped).toHaveLength(1);
  });
});
