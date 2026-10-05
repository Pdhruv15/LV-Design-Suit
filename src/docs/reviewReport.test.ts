import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { issueRevision } from '../model/revisions';
import { moveComment, newComment, withComment } from '../model/reviewComments';
import { buildReviewDoc, defaultSetup, reviewHtml, SECTION_IDS, type ReportEvidence } from './reviewReport';
import { buildReviewDocx } from './reviewWord';
import { docxBytes } from './studyWord';

const ev: ReportEvidence = { ran: true, stale: [], findings: [] };
const base = issueRevision(sampleProject, { description: 'A', date: '2026-10-01' });
const withC = withComment(base, newComment(base, { category: 'protection', severity: 'critical', finding: '<script>alert(1)</script> & "x"', ref: { kind: 'feeder', id: base.feeders[0].id } }));

describe('review report', () => {
  it('has every selected section and only those', () => {
    expect(buildReviewDoc(withC, defaultSetup(), ev).sections.map((s) => s.id)).toEqual([...SECTION_IDS]);
    expect(buildReviewDoc(withC, { ...defaultSetup(), sections: ['comments', 'control'] }, ev).sections.map((s) => s.id)).toEqual(['control', 'comments']);
  });
  it('escapes user text and shows comment status', () => {
    const html = reviewHtml(buildReviewDoc(withC, defaultSetup(), ev));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Open');
  });
  it('states no approval without a recorded decision, and the decision when there is one', () => {
    const none = JSON.stringify(buildReviewDoc(withC, defaultSetup(), ev));
    expect(none).toContain('makes no statement of approval');
    const d = buildReviewDoc(withC, { ...defaultSetup(), decision: { outcome: 'Accepted with conditions', by: 'R. Reviewer', at: '2026-10-05T00:00:00Z' } }, ev);
    expect(JSON.stringify(d)).toContain('Accepted with conditions');
    expect(JSON.stringify(d)).not.toContain('makes no statement of approval');
  });
  it('marks missing evidence and stale results instead of omitting them', () => {
    expect(JSON.stringify(buildReviewDoc(withC, defaultSetup(), { ran: false, stale: [], findings: [] }))).toContain('have not been run');
    expect(JSON.stringify(buildReviewDoc(withC, defaultSetup(), { ran: true, stale: ['Earthing'], findings: ['Fail: x'] }))).toContain('out of date for: Earthing');
    expect(JSON.stringify(buildReviewDoc(withC, defaultSetup(), ev))).toContain('Not recorded');
  });
  it('is frozen: editing the project afterwards does not alter the built report', () => {
    const d = buildReviewDoc(withC, defaultSetup(), ev), before = JSON.stringify(d);
    withC.reviewComments![0].finding = 'changed'; // mutation after build
    expect(JSON.stringify(d)).toBe(before);
  });
  it('flags a closed comment whose design changed', () => {
    const c = withC.reviewComments![0];
    const closed = withComment(withC, moveComment(withC, { ...c, finding: 'f' }, 'closed', { by: 'R' }));
    const changed = { ...closed, feeders: closed.feeders.map((f, i) => (i ? f : { ...f, breakerRatingA: f.breakerRatingA + 10 })) };
    expect(JSON.stringify(buildReviewDoc(changed, defaultSetup(), ev))).toContain('re-review');
  });
  it('produces a Word file', async () => {
    const bytes = await docxBytes(buildReviewDocx(buildReviewDoc(withC, defaultSetup(), ev)));
    expect(bytes.length).toBeGreaterThan(1000);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
  });
});
