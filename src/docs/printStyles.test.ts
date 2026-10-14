import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { readFileSync } from 'node:fs';
import { PLAIN_CSS, REPORT_CSS } from './report';
import { REPORT_DOC_CSS } from './reportFrame';
import { printDoc } from './printDoc';
import { PRINT_BASE_CSS, statusSpan } from './printStyles';
import { printDocs } from '../../tests/fixtures/printDocs';

const colours = (html: string) => [...new Set(html.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi) ?? [])];
const grey = (h: string) => {
  const x = h.length === 4 ? h.slice(1).split('').map((c) => c + c) : [h.slice(1, 3), h.slice(3, 5), h.slice(5, 7)];
  return x.every((c) => c.toLowerCase() === x[0].toLowerCase());
};

describe('shared print styles', () => {
  it('are black and white, with every token filled in', () => {
    for (const css of [PRINT_BASE_CSS, REPORT_CSS, REPORT_DOC_CSS, PLAIN_CSS]) {
      expect(colours(css).filter((c) => !grey(c))).toEqual([]);
      expect(css).not.toContain('${');
    }
  });

  it('boxes a FAIL round the word, not the whole cell', () => {
    expect(statusSpan('FAIL')).toBe('<span class="st">FAIL</span>');
    expect(PRINT_BASE_CSS).toMatch(/\.bad > \.st \{ border:/);
  });
});

describe('every PDF document is black and white', () => {
  const docs = printDocs();
  for (const [name, html] of Object.entries(docs)) {
    it(`${name}: no colour and no unfilled tokens`, () => {
      expect(colours(html).filter((c) => !grey(c))).toEqual([]);
      expect(html).not.toContain('${');
    });
  }

  it('prints the running header / footer in the report font', () => {
    expect(printDoc(sampleProject, { title: 'T', headRight: 'H', footer: 'F', body: '' })).toMatch(/@top-right \{ content: [^}]*font: 7\.5pt Arial/);
  });

  // Builders the fixture does not construct: their print styles, read from the source.
  it.each([['buildingSummary.ts', 'src/docs/buildingSummary.ts'], ['EnclosureSizing.tsx (PDF style)', 'src/components/EnclosureSizing.tsx']])('%s', (_, file) => {
    const src = readFileSync(file, 'utf-8');
    const css = file.endsWith('.tsx') ? src.slice(src.indexOf('async function exportSheet()'), src.indexOf('</style>', src.indexOf('async function exportSheet()'))) : src;
    expect(colours(css).filter((c) => !grey(c))).toEqual([]);
  });
});
