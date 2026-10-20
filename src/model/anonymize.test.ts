import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { runCalculations } from '../calc/runs';
import { checkProjectShape } from './projectValidate';
import { ANONYMIZED_NAME, anonymizeProject } from './anonymize';
import type { Project } from '../types';

/** Identifying text planted everywhere a real project could carry it: header data, people, logos, revisions,
 * comments, free text on panels and circuits, nested plans and fields this version does not know about. */
const SECRET = ['Real Client LLC', 'Plot 987-654', '+971 50 000 0000', 'client@corp.example', 'Jane Engineer', 'Secret Tower', '/Users/someone/clients', 'ACME Consultants'];
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function richProject(): Project {
  const p = structuredClone(sampleProject) as Project & Record<string, unknown>;
  p.id = 'client-project-id-123';
  p.name = 'Secret Tower — Real Client LLC';
  p.info = { owner: 'Real Client LLC', consultant: 'ACME Consultants', contractor: 'Jane Engineer', tel: '+971 50 000 0000', fax: '04 000', plotNo: 'Plot 987-654', area: 'Secret Tower district', plannedCompletion: '2027-01-01', builtUpAreaM2: 1234, mdDemandFactor: 0.8 };
  p.notes = 'Call client@corp.example about Plot 987-654';
  p.tags = ['Real Client LLC'];
  p.createdBy = 'Jane Engineer';
  p.updatedBy = 'Jane Engineer';
  p.drawing = { company: 'ACME Consultants', drawnBy: 'Jane Engineer', checkedBy: 'Jane Engineer', approvedBy: 'Jane Engineer', number: 'Secret Tower-E-001', logo: LOGO, notes: ['Saved in /Users/someone/clients'] };
  p.params = { designedBy: 'Jane Engineer', checkedBy: 'Jane Engineer' };
  p.revisions = [{ id: 'A', date: '2026-01-01', description: 'For Real Client LLC', by: 'Jane Engineer', snapshot: { ...structuredClone(sampleProject), name: 'Secret Tower' } }];
  p.reviewComments = [{ id: 'c1', text: 'client@corp.example asked', by: 'Jane Engineer' }] as unknown as Project['reviewComments'];
  p.origin = { copiedFromName: 'Secret Tower', copiedAt: '2026-01-01', kind: 'save-as' };
  p.customExtension = { client: { name: 'Real Client LLC', phone: '+971 50 000 0000', signature: LOGO } };
  p.boards = p.boards.map((b) => ({ ...b, location: 'Secret Tower level 3', manufacturer: 'ACME Consultants', rmu: 'Secret Tower RMU', supply: { fedFrom: 'Real Client LLC substation', cable: 'BY Real Client LLC', ratingA: 1600, ctRatio: '2400/5A' }, spareWays: [{ id: 'Jane Engineer spare', kind: 'spare', phase: 'R', ratingA: 16, remarks: 'Real Client LLC' }] }));
  p.feeders = p.feeders.map((f, i) => ({ ...f, room: 'Secret Tower room', remarks: 'client@corp.example', ...(i === 0 ? { loadItems: [{ reference: 'Real Client LLC L1', name: 'Jane Engineer lamp', pointType: 'ltg' as const, quantity: 2, unitWatts: 10 }] } : {}) }));
  p.trays = { routes: [{ id: 'r1', name: 'A', from: 'Secret Tower', to: 'Plot 987-654', lengthM: 20, cables: [{ id: 'c', feederId: p.feeders[0].id, from: 'Jane Engineer', to: 'ACME Consultants' }] }], settings: { method: 'spacing', spacing: 'one', spacingMm: 0, sparePct: 25, fillPct: 40, depthMm: 50, widths: [100, 200], maxWidthMm: 600, includeEcc: false, trayType: 'Real Client LLC spec tray' } };
  p.feeders[0] = { ...p.feeders[0], trayRoute: 'A' };
  return p;
}

describe('anonymizeProject', () => {
  it('never changes the original project', () => {
    const p = richProject();
    const before = structuredClone(p);
    const r = anonymizeProject(p);
    expect(p).toEqual(before);
    // The copy shares no objects with the original.
    r.project.boards[0].ratedCurrentA = 1;
    expect(p.boards[0].ratedCurrentA).toBe(before.boards[0].ratedCurrentA);
  });

  it('removes identifying data at every level, including fields it does not know', () => {
    const r = anonymizeProject(richProject());
    const text = JSON.stringify(r.project);
    for (const s of SECRET) expect(text).not.toContain(s);
    expect(text).not.toContain('data:image');
    expect(text).not.toContain('client-project-id-123');
    for (const k of ['info', 'drawing', 'params', 'revisions', 'reviewComments', 'notes', 'tags', 'createdBy', 'updatedBy', 'origin', 'customExtension']) {
      if (k === 'info') expect(r.project.info).toEqual({ mdDemandFactor: 0.8 });
      else expect(r.project).not.toHaveProperty(k);
    }
    expect(r.project.name).toBe(ANONYMIZED_NAME);
    expect(r.removed).toEqual(expect.arrayContaining(['project.drawing', 'project.revisions', 'project.customExtension', 'panel.location', 'circuit.room', 'circuit.remarks', 'panel names', 'circuit names']));
    // Original ids appear nowhere in the sample (only in the map kept for the person sharing it).
    for (const id of Object.keys(r.boardIds)) expect(text).not.toContain(`"${id}"`);
    expect(r.warnings.join(' ')).toMatch(/can still be recognised/);
  });

  it('keeps every reference valid: panels, incomers, ties, voltage drop selection and tray routes', () => {
    const p = richProject();
    p.ties = [{ id: 'tie', a: 'MDB-1', b: 'SMDB-GF', ratingA: 630 }];
    p.vdSelection = ['GF-LTG'];
    const r = anonymizeProject(p);
    const ids = new Set(r.project.boards.map((b) => b.id));
    for (const b of r.project.boards) if (b.upstreamId) expect(ids.has(b.upstreamId)).toBe(true);
    for (const f of r.project.feeders) {
      expect(ids.has(f.boardId)).toBe(true);
      if (f.feedsBoardId) expect(ids.has(f.feedsBoardId)).toBe(true);
    }
    expect(r.project.ties).toEqual([{ id: 'T1', a: r.boardIds['MDB-1'], b: r.boardIds['SMDB-GF'], ratingA: 630 }]);
    expect(r.project.vdSelection).toEqual([r.feederIds['GF-LTG']]);
    expect(r.project.trays?.routes[0].cables[0].feederId).toBe(r.project.feeders[0].id);
    expect(r.project.feeders[0].trayRoute).toBe('A');
    expect(r.project.feeders[0].loadItems).toEqual([{ name: 'Item 1', pointType: 'ltg', quantity: 2, unitWatts: 10 }]);
    // It opens like any project file.
    expect(() => checkProjectShape(JSON.parse(JSON.stringify(r.project)))).not.toThrow();
  });

  it('gives the same calculation results, circuit by circuit', () => {
    const p = richProject();
    const r = anonymizeProject(p);
    const a = runCalculations(p), b = runCalculations(r.project);
    expect(b.results).toHaveLength(a.results.length);
    const pick = (x: { ib: number; ampacity: number; loadingPct: number; vdPct: number; vdTotalPct: number; vdStatus: string; ampacityStatus: string; protectionStatus: string }) =>
      ({ ib: x.ib, ampacity: x.ampacity, loadingPct: x.loadingPct, vdPct: x.vdPct, vdTotalPct: x.vdTotalPct, vdStatus: x.vdStatus, ampacityStatus: x.ampacityStatus, protectionStatus: x.protectionStatus });
    a.results.forEach((x, i) => {
      expect(b.results[i].feeder.id).toBe(r.feederIds[x.feeder.id]);
      expect(pick(b.results[i])).toEqual(pick(x));
    });
    a.earthing.forEach((x, i) => {
      const y = b.earthing.find((e) => e.feeder.id === r.feederIds[x.feeder.id])!;
      expect([y.zsOhm, y.faultA, y.maxZsOhm, y.requiredS, y.status]).toEqual([x.zsOhm, x.faultA, x.maxZsOhm, x.requiredS, x.status]);
      expect(i).toBeGreaterThanOrEqual(0);
    });
    expect(b.selectivity.map((s) => s.status)).toEqual(a.selectivity.map((s) => s.status));
  });

  it('leaves out circuits on a missing panel instead of keeping their panel id', () => {
    const p = richProject();
    p.feeders.push({ ...p.feeders[0], id: 'orphan', boardId: 'Real Client LLC DB' });
    const r = anonymizeProject(p);
    expect(JSON.stringify(r.project)).not.toContain('Real Client LLC');
    expect(r.project.feeders).toHaveLength(p.feeders.length - 1);
    expect(r.removed).toContain('circuits on a missing panel');
  });
});
