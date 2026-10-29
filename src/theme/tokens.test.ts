import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');

/** `--name: value` pairs inside the first block whose selector matches. */
function block(selector: string): Record<string, string> {
  const start = tokens.indexOf(selector + ' {');
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = tokens.slice(tokens.indexOf('{', start) + 1, tokens.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const dark = block(':root');
const light = { ...dark, ...block(':root[data-theme="light"]') };

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []; });
/** `a` at `k` over `b`, as #rrggbb. */
const over = (a: string, b: string, k: number) =>
  '#' + [1, 3, 5].map((i) => Math.round(k * parseInt(a.slice(i, i + 2), 16) + (1 - k) * parseInt(b.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');

describe('design tokens', () => {
  it('keeps the dark theme exactly as the app looked before tokens moved here', () => {
    // Values from the original :root of src/styles.css (v1.68.0).
    expect(dark).toMatchObject({
      '--bg': '#0a1120', '--panel': '#0f1a2f', '--p2': '#14233f', '--line': '#20304f', '--tx': '#dbe4f5', '--mut': '#8093b5',
      '--acc': '#4aa8ff', '--bus': '#ffb347', '--ok': '#37d67a', '--warn': '#f5c04a', '--bad': '#ff5d6c',
      '--line-strong': '#2f4570', '--on-acc': '#04101f', '--field-line': '#52709f', '--field-line-hover': '#7590c0',
      '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px', '--space-5': '24px',
      '--control-h': '32px', '--control-h-sm': '26px', '--radius-sm': '6px', '--radius-md': '9px', '--radius-lg': '12px',
      '--fs-xs': '11px', '--fs-sm': '12px', '--fs-md': '13px'
    });
  });

  it.each([['dark', dark], ['light', light]] as const)('meets WCAG AA contrast in the %s theme', (_, t) => {
    for (const fg of ['--tx', '--mut', '--acc', '--ok', '--warn', '--bad']) {
      for (const bg of ['--bg', '--panel', '--p2']) expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(t['--on-acc'], t['--acc']), 'text on accent').toBeGreaterThanOrEqual(4.5);
    for (const bg of ['--panel', '--p2']) expect(contrast(t['--field-line'], t[bg]), `field edge on ${bg}`).toBeGreaterThanOrEqual(3);
  });

  it('gives the light theme the same token names as the dark one', () => {
    const lightOnly = block(':root[data-theme="light"]');
    const colourish = Object.keys(dark).filter((k) => /^#|^rgba|^0 /.test(dark[k]));
    expect(colourish.filter((k) => !(k in lightOnly))).toEqual([]);
  });

  it('defines every custom property the stylesheet uses, with or without a fallback', () => {
    const defined = new Set<string>([...tokens.matchAll(/(--[\w-]+)\s*:/g), ...styles.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    // Properties set from components (style={{ '--side-w': … }}) also count.
    for (const f of walk(root)) for (const m of readFileSync(f, 'utf8').matchAll(/['"](--[\w-]+)['"]\s*[:\]]/g)) defined.add(m[1]);
    const used = [...styles.matchAll(/var\((--[\w-]+)[,)]/g)].map((m) => m[1]);
    expect([...new Set(used.filter((u) => !defined.has(u)))]).toEqual([]);
  });

  it.each([['dark', dark], ['light', light]] as const)('keeps the SLD grid when it moves to the shared drawing surface (%s)', (_, t) => {
    // The SLD drew its minor grid as --line at 55 % over --bg; the shared token is that colour, solid.
    expect(t['--canvas-grid']).toBe(over(t['--line'], t['--bg'], 0.55));
    expect([dark['--canvas-bg'], dark['--canvas-ink'], dark['--canvas-grid-major']]).toEqual(['var(--bg)', 'var(--tx)', 'var(--line)']);
  });

  it('keeps fixed colours to paper, print and text on a status fill', () => {
    // Screens take their colours from the tokens, so they follow both themes. A new fixed colour needs a reason here.
    const paper = new Set([
      '.chip.primary:hover:not(:disabled)', 'td.ec .ec-err', '.tray-section', '.tray-section figcaption', '.logo-box', '.logo-box .m',
      '.tbd-preview-wrap', '.tbd-preview', '.tbd-cell', '.tbd-cell:hover', '.tbd-cell.on', '.tbd-cap', '.tbd-print', '.ds-paper', '.ds-sheet',
      '.sg-thumb', '.sg-thumb iframe', '.sg-badge', '.sg-size', '.sld-print .cable-ref-c,.sheet .cable-ref-c', '.sheet-page', '.sheet-paper',
      '.hc-st', '.earth-drawing', '.paper-sheet', '.paper-sheet iframe', '.paper-guides'
    ]);
    const fixed = [...styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(m[2])).map((m) => m[1].trim());
    expect(fixed.filter((sel) => !paper.has(sel))).toEqual([]);
    // Components: print CSS, paper markup and fallbacks for colours read from CSS. No more than today in each file.
    const known: Record<string, number> = {
      'components/BriefEditor.tsx': 1, 'components/EarthingView.tsx': 10, 'components/EnclosureSizing.tsx': 12, 'components/FileDialogs.tsx': 1,
      'components/Form4Sizing.tsx': 10, 'components/PaperPreview.tsx': 1, 'components/ProjectsDashboard.tsx': 1, 'components/cad/CadCanvas.tsx': 19,
      'components/docs/sheetRender.tsx': 1, 'components/sld/SheetMarkupLayer.tsx': 6, 'components/sld/SheetWorkspace.tsx': 8, 'diagram/symbolLibrary.tsx': 8
    };
    for (const f of walk(root).filter((p) => p.endsWith('.tsx') && !/\.test\./.test(p))) {
      const n = (readFileSync(f, 'utf8').match(/['"`(:\s]#[0-9a-f]{3,8}\b/gi) ?? []).length;
      const name = relative(root, f).split(sep).join('/');
      expect(n, name).toBeLessThanOrEqual(known[name] ?? 0);
    }
  });

  it('declares the segmented control once', () => {
    expect(styles.match(/(^|\n)\.seg\{/g)?.length).toBe(1);
  });
});
