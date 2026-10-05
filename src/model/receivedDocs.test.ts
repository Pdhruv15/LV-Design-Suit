import { describe, expect, it } from 'vitest';
import { sampleProject as p0 } from '../data/sampleProject';
import { addDoc, baselineDoc, DocError, docIssues, removeDoc, setBaselineDoc, type DocInput } from './receivedDocs';

const doc = (o: Partial<DocInput> = {}): DocInput => ({ title: 'SLD', number: 'E-001', revision: 'A', discipline: 'electrical', use: 'reference', link: '/x/a.pdf', ...o });

describe('received documents', () => {
  it('requires title, number and revision, and rejects a repeated number and revision', () => {
    expect(() => addDoc(p0, doc({ title: ' ' }))).toThrow(DocError);
    expect(() => addDoc(p0, doc({ revision: '' }))).toThrow(DocError);
    expect(() => addDoc(p0, doc({ dateReceived: '5/10/2026' }))).toThrow(DocError);
    const { project } = addDoc(p0, doc());
    expect(() => addDoc(project, doc())).toThrow(/already/);
  });
  it('a later revision supersedes the earlier one and cannot be a baseline while superseded', () => {
    let p = addDoc(p0, doc()).project;
    p = setBaselineDoc(p, 'RD-001');
    p = addDoc(p, doc({ revision: 'B' })).project;
    expect(p.receivedDocs![0].supersededBy).toBe('RD-002');
    expect(docIssues(p).join(' ')).toContain('superseded');
    expect(() => setBaselineDoc(p, 'RD-001')).toThrow();
    p = setBaselineDoc(p, 'RD-002');
    expect(baselineDoc(p)?.id).toBe('RD-002');
    expect(p.receivedDocs!.filter((d) => d.use === 'baseline')).toHaveLength(1);
  });
  it('reports missing baseline and links, and removing clears supersession', () => {
    let p = addDoc(p0, doc({ link: undefined })).project;
    expect(docIssues(p)).toHaveLength(2);
    p = addDoc(p, doc({ revision: 'B' })).project;
    p = removeDoc(p, 'RD-002');
    expect(p.receivedDocs![0].supersededBy).toBeUndefined();
    expect(removeDoc(removeDoc(p0, 'x'), 'y').receivedDocs).toBeUndefined();
  });
});
