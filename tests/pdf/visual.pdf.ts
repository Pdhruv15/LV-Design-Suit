// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import pkg from '../../package.json';
import { printDocs } from '../fixtures/printDocs';

/** Image-level layout regression: every sample document is printed through the app's Chromium call,
 * its first pages rasterised (pdf.js in Electron) and compared with the baseline images, so wrapping,
 * clipping, overlap, missing pages and shifted title blocks show up as a failed test.
 *
 *   npm run test:pdf                               compare with tests/pdf/baselines/<platform>/
 *   UPDATE_BASELINES=1 npm run test:pdf -- visual  write new baselines (after an intended layout change)
 *
 * Baselines are per platform (fonts render differently); without one for this platform the
 * comparison is skipped and says so. The date and the app version are fixed, so a new day or a
 * version bump does not change the pictures. */

const electron = createRequire(import.meta.url)('electron') as unknown as string;
const UPDATE = process.env.UPDATE_BASELINES === '1';
const SCALE = 0.75, MAX_PAGES = 3;
/** Share of a page's pixels that may differ (anti-aliasing noise), and pixelmatch's colour threshold. */
const MAX_DIFF = 0.002, THRESHOLD = 0.1;
const baseDir = path.resolve('tests/pdf/baselines', process.platform);
const work = mkdtempSync(path.join(tmpdir(), 'lvds-visual-'));
const hasBaselines = existsSync(baseDir) && readdirSync(baseDir).length > 0;

const NAMES = Object.keys(printDocs());
let docs: Record<string, string> = {};
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
  docs = Object.fromEntries(Object.entries(printDocs()).map(([k, html]) => [k, html.split(pkg.version).join('0.0.0')]));
  vi.useRealTimers();
});
afterAll(() => { if (!process.env.KEEP_VISUAL) rmSync(work, { recursive: true, force: true }); });

function run(script: string, args: string[]) {
  const r = spawnSync(electron, [path.resolve('tests/pdf', script), ...args], { encoding: 'utf-8', timeout: 180_000 });
  if (r.status !== 0) throw new Error(`${script} failed: ${r.stderr || r.error}`);
}

/** Prints and rasterises one document; returns its folder (p1.png … and pages.json). */
function picture(name: string): string {
  const html = path.join(work, `${name}.html`), pdf = path.join(work, `${name}.pdf`), out = path.join(work, name);
  writeFileSync(html, docs[name]);
  run('render.cjs', [html, pdf, path.join(work, `${name}.json`), '1016']);
  run('rasterize.cjs', [pdf, out, String(SCALE), String(MAX_PAGES)]);
  return out;
}

const read = (f: string) => PNG.sync.read(readFileSync(f));

describe('PDF layout against the baseline images', () => {
  it('has the sample documents', () => expect(Object.keys(docs).length).toBeGreaterThan(10));

  it.each(NAMES)('%s', (name) => {
    const out = picture(name);
    const target = path.join(baseDir, name);
    if (UPDATE) {
      rmSync(target, { recursive: true, force: true });
      mkdirSync(target, { recursive: true });
      for (const f of readdirSync(out)) cpSync(path.join(out, f), path.join(target, f));
      return;
    }
    if (!hasBaselines) { console.warn(`No ${process.platform} baselines: ${name} not compared (UPDATE_BASELINES=1 to create them).`); return; }
    expect(existsSync(target), `no baseline for ${name} — UPDATE_BASELINES=1 to add it`).toBe(true);
    const was = JSON.parse(readFileSync(path.join(target, 'pages.json'), 'utf-8')), now = JSON.parse(readFileSync(path.join(out, 'pages.json'), 'utf-8'));
    expect(now.count, `${name}: page count`).toBe(was.count);
    expect(now.sizes, `${name}: page sizes`).toEqual(was.sizes);
    for (const f of readdirSync(target).filter((x) => x.endsWith('.png'))) {
      const a = read(path.join(target, f)), b = read(path.join(out, f));
      expect([b.width, b.height], `${name} ${f}: image size`).toEqual([a.width, a.height]);
      const diff = new PNG({ width: a.width, height: a.height });
      const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: THRESHOLD });
      const share = n / (a.width * a.height);
      if (share > MAX_DIFF) {
        const file = path.join(work, `${name}-${f.replace('.png', '')}-diff.png`);
        writeFileSync(file, PNG.sync.write(diff));
        process.env.KEEP_VISUAL = '1';
        expect.fail(`${name} ${f}: ${(share * 100).toFixed(2)} % of pixels differ (limit ${MAX_DIFF * 100} %). Diff: ${file}`);
      }
    }
  });
});
