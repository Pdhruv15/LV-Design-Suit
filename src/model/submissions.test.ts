import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { buildSubmissionRegisterHtml, buildSubmissionWorkbook, buildTransmittalHtml } from '../docs/submissionReport';
import type { Project } from '../types';
import { draftFromOffer, dueOf, isOverdue, nextSubmissionId, recipientGroup, resubmit, saveSubmission, submissionCounts, submissionsOf, timeText, type Submission } from './submissions';

const base: Project = { ...sampleProject, submissions: undefined, submissionDays: undefined, drawingSet: undefined };
const sub = (id: string, patch: Partial<Submission> = {}): Submission => ({ id, kind: 'BOQ', title: `Doc ${id}`, docs: [{ number: 'VC-ELE-BOQ-001', title: 'BOQ', rev: '0' }], to: 'Consultant', purpose: 'For approval', date: '2026-10-01', status: 'submitted', comments: [], ...patch });

describe('submissions', () => {
  it('takes the response due date from the recipient unless one is entered', () => {
    expect(recipientGroup('Authority (DEWA)')).toBe('Authority');
    expect(recipientGroup('ABC Engineering Consultants')).toBe('Consultant');
    expect(dueOf(base, sub('a', { to: 'DEWA' }))).toBe('2026-10-15');
    expect(dueOf(base, sub('a'))).toBe('2026-10-08');
    expect(dueOf({ ...base, submissionDays: { Consultant: 10 } }, sub('a'))).toBe('2026-10-11');
    expect(dueOf(base, sub('a', { due: '2026-10-20' }))).toBe('2026-10-20');
    expect(dueOf(base, sub('a', { purpose: 'For information', status: 'info' }))).toBeUndefined();
  });

  it('marks open submissions past their due date as overdue, and states the time taken', () => {
    expect(isOverdue(base, sub('a'), '2026-10-13')).toBe(true);
    expect(timeText(base, sub('a'), '2026-10-13')).toBe('Overdue 5 d');
    expect(timeText(base, sub('a', { to: 'DEWA' }), '2026-10-13')).toBe('12 d open');
    expect(timeText(base, sub('a', { status: 'approved', responseDate: '2026-10-07' }), '2026-10-13')).toBe('6 d');
    expect(isOverdue(base, sub('a', { status: 'approved', responseDate: '2026-10-20' }), '2026-10-30')).toBe(false);
  });

  it('links a resubmission both ways; an unanswered one is superseded, an answered one keeps its response', () => {
    let p = saveSubmission(base, sub('SUB-001', { status: 'resubmit', responseDate: '2026-10-07', responseRef: 'DEWA/LS/1187' }));
    const r = resubmit(p, p.submissions![0], '2026-10-11');
    p = r.project;
    expect(r.next).toMatchObject({ id: 'SUB-002', resubmissionOf: 'SUB-001', yourRef: 'DEWA/LS/1187', status: 'submitted' });
    expect(p.submissions![0]).toMatchObject({ status: 'resubmit', resubmittedAs: 'SUB-002' });
    const q = resubmit(p, p.submissions![1], '2026-10-12').project;
    expect(q.submissions!.find((s) => s.id === 'SUB-002')?.status).toBe('superseded');
    expect(nextSubmissionId(q)).toBe('SUB-004');
  });

  it('lists drawing transmittals until a response is recorded for them', () => {
    const issue = { id: 'T-001', date: '2026-09-30', purpose: 'FOR APPROVAL', description: 'SLD sheets', to: 'DEWA', sheets: [{ id: 's1', number: 'E-SLD-001', title: 'MDB-1', rev: 'A' }] };
    const p = { ...base, drawingSet: { prefix: 'E-SLD-', sheets: [], issues: [issue] } } as Project;
    expect(submissionsOf(p)[0]).toMatchObject({ id: 'T-001', kind: 'Drawings', purpose: 'For approval', transmittal: 'T-001', docs: [{ number: 'E-SLD-001', rev: 'A' }] });
    const answered = saveSubmission(p, { ...submissionsOf(p)[0], status: 'approved', responseDate: '2026-10-10' });
    expect(submissionsOf(answered).map((s) => [s.id, s.status])).toEqual([['T-001', 'approved']]);
  });

  it('counts the register and prints it, the comments log and a transmittal', () => {
    let p = saveSubmission(base, sub('SUB-001', { status: 'approved-comments', responseDate: '2026-10-04', responseRef: 'ABC/L/038', comments: [{ id: '1', text: 'Add T&C', action: 'Added J.1', closed: '2026-10-13' }, { id: '2', text: 'Confirm <MCC> scope' }] }));
    p = saveSubmission(p, sub('SUB-002', { kind: 'Report', to: 'Consultant', date: '2026-10-02' }));
    p = saveSubmission(p, draftFromOffer(p, { kind: 'Variation', title: 'VO-001', docs: [{ number: 'VO-001', title: 'Sockets', rev: '—' }] }, '2026-10-13'));
    expect(p.submissions![2]).toMatchObject({ id: 'SUB-003', kind: 'Variation', status: 'submitted' });
    expect(submissionCounts(p, '2026-10-13')).toMatchObject({ total: 3, open: 2, overdue: 1, withComments: 1, openComments: 1 });
    const html = buildSubmissionRegisterHtml(p, '2026-10-13');
    expect(html).toContain('size: A4 landscape');
    expect(html).toMatch(/<tr class="chg"><td>SUB-002<\/td>[^]*?<b>Overdue 4 d<\/b>/);
    expect(html).toContain('Confirm &lt;MCC&gt; scope');
    expect(html).not.toContain('<MCC>');
    const t = buildTransmittalHtml(p, { ...p.submissions![0], to: 'Dubai Electricity and Water Authority (DEWA)', yourRef: 'DEWA/LS/1187' });
    expect(t).toContain('Document transmittal SUB-001');
    expect(t).toContain('<td>VC-ELE-BOQ-001</td><td>BOQ</td><td class="c">0</td>');
    expect(buildSubmissionWorkbook(p, '2026-10-13').worksheets.map((w) => w.name)).toEqual(['Submission register', 'Comments']);
  });

  it('keeps submissions out of design revision snapshots', async () => {
    const { snapshotOf } = await import('./revisions');
    expect('submissions' in snapshotOf(saveSubmission(base, sub('SUB-001')))).toBe(false);
  });
});
