import { describe, expect, it } from 'vitest';
import { calcContainment, CONTAINMENT_DEFAULT, CONTAINMENT_LABEL, containmentSvg, type ContainmentCable, type ContainmentInput, type ContainmentResult } from './containment';
import { containmentReportHtml } from '../docs/containmentReport';
import type { Project } from '../types';

const one = (odMm: number, qty = 1): ContainmentCable[] => [{ name: 'oversize', cores: 4, csaMm2: 95, qty, odMm }];
const run = (i: Partial<ContainmentInput>) => { const inp = { ...CONTAINMENT_DEFAULT, ...i }; return { inp, r: calcContainment(inp) }; };
const circle = (d: number) => (Math.PI * d * d) / 4;
/** Independent check of every run: each cable once, through the bore / under the lid, within its own fill rule. */
function checkConduit(r: ContainmentResult, laid: number[], fixed?: number) {
  const a = r.allocation!;
  expect(a).toHaveLength(r.runs);
  expect(a.flat().sort((x, y) => x - y)).toEqual([...laid].sort((x, y) => x - y));
  for (const c of a) {
    expect(c.length).toBeGreaterThan(0);
    const lim = fixed ?? (c.length === 1 ? 53 : c.length === 2 ? 31 : 40);
    expect(c.reduce((s, d) => s + circle(d), 0) / circle(r.widthMm)).toBeLessThanOrEqual(lim / 100 + 1e-9);
    for (const d of c) expect(r.widthMm).toBeGreaterThanOrEqual(d * 1.1);
  }
}

describe('ENG-015 containment: whole cables, no fictitious fit', () => {
  it('70 mm cable: no conduit fits, no success, no "10 conduits"', () => {
    const { inp, r } = run({ type: 'conduit', cables: one(70) });
    expect(r.status).toBe('fail');
    expect(r.runs).toBe(0);
    expect(r.noFit).toMatch(/can't split one cable/);
    expect(r.notes.join(' ')).not.toMatch(/10 conduits/);
    expect(containmentSvg(r, inp)).toBe('');
  });

  it('300 mm cable: no trunking fits', () => {
    const { inp, r } = run({ type: 'trunking', cables: one(300), sparePct: 0 });
    expect(r.status).toBe('fail');
    expect(containmentSvg(r, inp)).toBe('');
  });

  it('a valid single cable keeps a bore it passes through, ≤ 53 %', () => {
    const { r } = run({ type: 'conduit', cables: one(30) });
    expect(r.status).toBe('ok');
    expect(r.runs).toBe(1);
    checkConduit(r, [30]);
  });

  it('average area would fit, whole-cable allocation needs more', () => {
    // Three 28 mm cables: total area / 2 conduits = 37 % of Ø63 (≤ 40 %), but one conduit would get two cables = 49 % against 31 %.
    const { r } = run({ type: 'conduit', cables: one(28, 3) });
    expect((3 * circle(28)) / 2 / circle(56.4)).toBeLessThan(0.4); // the old averaged estimate
    expect((2 * circle(28)) / circle(56.4)).toBeGreaterThan(0.31);
    expect(r.status).toBe('ok');
    expect(r.runs).toBe(3);
    checkConduit(r, [28, 28, 28]);
  });

  it('exact and just-over the single-cable limit, and a fixed override', () => {
    const exact = Math.sqrt(0.53) * 56.4; // 53 % of Ø63 bore exactly
    expect(run({ type: 'conduit', cables: one(exact) }).r.status).toBe('ok');
    expect(run({ type: 'conduit', cables: one(exact * 1.001) }).r.status).toBe('fail');
    const fixed = run({ type: 'conduit', cables: one(20), conduitFillPct: 20 }).r;
    expect(fixed.size).toContain('Ø 63');
    checkConduit(fixed, [20], 20);
    expect(fixed.notes.join(' ')).toMatch(/20 % \(entered\)/);
  });

  it('true multi-run: every cable once, every run within its constraint', () => {
    const laid = [...Array(4).fill(30), ...Array(6).fill(20)];
    const { r } = run({ type: 'conduit', cables: [{ name: 'a', cores: 4, csaMm2: 0, qty: 4, odMm: 30 }, { name: 'b', cores: 4, csaMm2: 0, qty: 6, odMm: 20 }] });
    expect(r.status).toBe('ok');
    expect(r.runs).toBeGreaterThan(1);
    checkConduit(r, laid);
    const t = run({ type: 'trunking', fillPct: 45, sparePct: 0, cables: one(140, 3) }).r;
    expect(t.status).toBe('ok');
    expect(t.allocation!.flat()).toHaveLength(3);
    for (const c of t.allocation!) expect(c.reduce((s, d) => s + circle(d), 0)).toBeLessThanOrEqual(t.widthMm * t.heightMm * 0.45 + 1e-6);
  });

  it('report: no-fit stated, no cross-section, no size claimed', () => {
    const { inp, r } = run({ type: 'conduit', cables: one(70) });
    const html = containmentReportHtml({ name: 'P' } as Project, inp, r);
    expect(html).toContain('No standard size fits');
    expect(html).not.toContain('Cross-section');
    expect(html).not.toContain('<svg');
    expect(CONTAINMENT_LABEL.conduit).toBe('Conduit');
  });

  it('tray / ladder unchanged', () => {
    const { r } = run({ type: 'tray', cables: one(70), layout: 'touching', sparePct: 0 });
    expect(r.status).not.toBe('fail');
    expect(r.widthMm).toBeGreaterThanOrEqual(70);
  });
});
