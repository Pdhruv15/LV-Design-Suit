import { describe, expect, it } from 'vitest';
import { newProject } from '../types';
import { addDoc, setBaselineDoc } from '../model/receivedDocs';
import { newComment, withComment } from '../model/reviewComments';
import { buildClarificationDoc } from './clarificationReport';
import { reviewHtml } from './reviewReport';

const base = () => {
  let p = addDoc(newProject('Tower'), { title: 'Consultant SLD', number: 'E-100', revision: 'C', discipline: 'electrical', use: 'reference' }).project;
  p = setBaselineDoc(p, 'RD-001');
  p = withComment(p, newComment(p, { category: 'drawing', severity: 'major', finding: 'Cable on <DB-1> missing' }));
  p = withComment(p, newComment(p, { kind: 'question', category: 'equipment', severity: 'minor', finding: 'Which breaker make?', assignedTo: 'Consultant' }));
  return p;
};

describe('clarification report', () => {
  it('splits discrepancies from questions and names the reference design', () => {
    const d = buildClarificationDoc(base(), {});
    const json = JSON.stringify(d);
    expect(d.sections.map((s) => s.id)).toEqual(['control', 'reference', 'discrepancies', 'changes', 'questions', 'conclusion']);
    expect(json).toContain('E-100 revision C');
    const disc = JSON.stringify(d.sections.find((s) => s.id === 'discrepancies'));
    expect(disc).toContain('missing'); expect(disc).not.toContain('breaker make');
    expect(JSON.stringify(d.sections.find((s) => s.id === 'questions'))).toContain('breaker make');
  });
  it('states a missing reference design, contains no pricing and escapes text', () => {
    const none = buildClarificationDoc(newProject('X'), {});
    expect(JSON.stringify(none)).toContain('No received document is marked');
    expect(none.sections.map((x) => x.id)).not.toContain('boq');
    expect(reviewHtml(buildClarificationDoc(base(), {}))).toContain('&lt;DB-1&gt;');
  });
  it('is not affected by later edits', () => {
    const p = base(), d = JSON.stringify(buildClarificationDoc(p, {}));
    expect(JSON.stringify(buildClarificationDoc(JSON.parse(JSON.stringify(p)), {}))).toBe(d);
  });
});
