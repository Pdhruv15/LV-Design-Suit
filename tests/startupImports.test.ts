import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The modules the app loads at start-up: static imports from src/main.tsx (not `import type`,
// not import()). Heavy export-only code must stay out of this set, or the main bundle grows past 1 MB.
const root = resolve(__dirname, '..');

function startupModules(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [join(root, 'src/main.tsx')];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const src = readFileSync(file, 'utf8');
    const specs = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => m[1]);
    specs.push(...[...src.matchAll(/^import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]));
    seen.set(file, specs);
    for (const s of specs) {
      if (!s.startsWith('.')) continue;
      const base = resolve(dirname(file), s);
      const hit = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((e) => base + e).find((p) => existsSync(p) && /\.tsx?$/.test(p));
      if (hit) queue.push(hit);
    }
  }
  return seen;
}

describe('start-up imports', () => {
  const modules = startupModules();

  it('finds the app shell', () => {
    expect(modules.has(join(root, 'src/App.tsx'))).toBe(true);
  });

  it('does not load ExcelJS at start-up (only when a workbook is exported)', () => {
    const importers = [...modules].filter(([, specs]) => specs.includes('exceljs')).map(([f]) => f.slice(root.length + 1));
    expect(importers).toEqual([]);
  });

  it('does not load the calculation or concept report code at start-up', () => {
    for (const f of ['src/docs/calcReport.ts', 'src/docs/studyReport.ts', 'src/docs/conceptReport.ts']) expect(modules.has(join(root, f)), f).toBe(false);
  });
});
