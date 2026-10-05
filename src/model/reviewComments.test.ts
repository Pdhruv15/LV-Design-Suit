import { describe, expect, it } from 'vitest';
import { sampleProject as p0 } from '../data/sampleProject';
import { CommentError, moveComment, needsReReview, newComment, refState, reviewSummary, withComment } from './reviewComments';

const fid = p0.feeders[0].id;
const raise = () => { const c = newComment(p0, { category: 'protection', severity: 'critical', finding: 'Breaker too small', ref: { kind: 'feeder', id: fid }, raisedBy: 'Rev' }); return { c, p: withComment(p0, c) }; };

describe('review comments', () => {
  it('a response never closes a comment; the reviewer must', () => {
    const { c, p } = raise();
    const r = moveComment(p, c, 'responded', { response: 'Upsized', by: 'Des' });
    expect(r.status).toBe('responded');
    expect(() => moveComment(p, r, 'closed')).toThrow(CommentError);
    expect(moveComment(p, r, 'closed', { by: 'Rev' }).status).toBe('closed');
  });
  it('needs a reason to withdraw or reopen and rejects impossible moves', () => {
    const { c, p } = raise();
    expect(() => moveComment(p, c, 'withdrawn')).toThrow();
    const closed = moveComment(p, c, 'closed', { by: 'Rev' });
    expect(() => moveComment(p, closed, 'responded', { response: 'x' })).toThrow();
    expect(() => moveComment(p, closed, 'open')).toThrow();
    expect(moveComment(p, closed, 'open', { note: 'Found again' }).status).toBe('open');
  });
  it('flags a closed comment only when engineering values change, not for a rename or note', () => {
    const { c, p } = raise();
    const closed = withComment(p, moveComment(p, c, 'closed', { by: 'Rev' }));
    const cc = closed.reviewComments![0];
    const renamed = { ...closed, feeders: closed.feeders.map((f) => (f.id === fid ? { ...f, name: 'New label', remarks: 'note' } : f)) };
    expect(needsReReview(renamed, cc)).toBe(false);
    const changed = { ...closed, feeders: closed.feeders.map((f) => (f.id === fid ? { ...f, breakerRatingA: f.breakerRatingA + 20 } : f)) };
    expect(refState(changed, cc)).toBe('changed');
    expect(needsReReview(changed, cc)).toBe(true);
    expect(reviewSummary(changed).reReview).toBe(1);
  });
  it('flags a deleted subject and rejects a reference that does not exist', () => {
    const { c, p } = raise();
    expect(refState({ ...p, feeders: p.feeders.filter((f) => f.id !== fid) }, c)).toBe('missing');
    expect(() => newComment(p0, { category: 'other', severity: 'minor', finding: 'x', ref: { kind: 'feeder', id: 'NOPE' } })).toThrow();
  });
  it('counts only unresolved critical comments as blocking', () => {
    const { p } = raise();
    expect(reviewSummary(p)).toMatchObject({ open: 1, critical: 1 });
  });
});
