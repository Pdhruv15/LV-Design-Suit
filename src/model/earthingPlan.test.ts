import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { sampleProject } from '../data/sampleProject';
import { applyTransformers, planTransformers, setRmu } from './transformers';
import { earthingLayout } from './earthingPlan';
import { buildBom } from '../calc/bom';
import { earthingDrawing } from '../diagram/earthingDrawing';

const withTx = (n: number) => applyTransformers(sampleProject, planTransformers(sampleProject, Array.from({ length: n }, () => ({ kva: 1500 })), false));

describe('earthing schematic', () => {
  it('defaults: RMU 2 pits, transformer 1 neutral + 1 body, MDBs 1 pit each when several', () => {
    const p = withTx(2); // sample MDB-1 (1000 kVA) + 2 new → 3 transformers, 3 main boards
    const L = earthingLayout(p);
    const count = (k: string) => L.pits.filter((x) => x.kind === k).length;
    expect(count('txn')).toBe(3);
    expect(count('txb')).toBe(3);
    expect(count('rmu')).toBe(6); // one RMU per transformer unless named, 2 pits each
    expect(count('lv')).toBe(3);
    // never a link between kinds (neutral ≠ body ≠ RMU ≠ LV)
    const kind = new Map(L.pits.map((x) => [x.id, x.kind]));
    expect(L.links.every(([a, b]) => kind.get(a) === kind.get(b))).toBe(true);
    // three LV pits linked in a loop
    expect(L.links.filter(([a]) => kind.get(a) === 'lv')).toHaveLength(3);
  });

  it('single MDB gets 2 pits; user can change pits and unlink; measured values checked against the limit', () => {
    const one = earthingLayout(sampleProject);
    expect(one.pits.filter((x) => x.kind === 'lv')).toHaveLength(2);
    const lvKey = one.items.find((i) => i.kind === 'lv')!.key;
    const p = { ...withTx(1), earthingPlan: { pits: { [`lv:${sampleProject.boards[0].id}`]: 2 }, unlinked: [] as string[] } };
    const L = earthingLayout(p);
    expect(L.items.find((i) => i.key === `lv:${sampleProject.boards[0].id}`)!.pits).toBe(2);
    const lvPits = L.pits.filter((x) => x.kind === 'lv').map((x) => x.id);
    const bad = earthingLayout({ ...p, earthingPlan: { ...p.earthingPlan, measured: Object.fromEntries(lvPits.map((id) => [id, 4])) } });
    expect(bad.checks.some((c) => c.level === 'bad' && /LV earth/.test(c.text))).toBe(true); // 3 × 4 Ω in parallel ≈ 1.33 Ω > 1 Ω
    const unlinked = earthingLayout({ ...p, earthingPlan: { unlinked: [lvKey] } });
    expect(unlinked.nets.filter((n) => n.kind === 'lv')).toHaveLength(2);
  });

  it('BOQ counts the schematic pits instead of the per-board default', () => {
    const p = { ...withTx(1), earthingPlan: {} };
    const pits = buildBom(p).filter((i) => i.key.startsWith('earth-pit')).reduce((s, i) => s + i.qty, 0);
    expect(pits).toBe(earthingLayout(p).pits.length);
  });

  it('one RMU for two transformers: one RMU earth; the drawing has earth bars and every pit', () => {
    const p = applyTransformers(sampleProject, planTransformers(sampleProject, [{ kva: 1500 }, { kva: 1500 }], false, 2));
    expect(new Set(p.boards.filter((b) => b.rmu).map((b) => b.rmu)).size).toBe(1);
    const L = earthingLayout(p);
    expect(L.items.filter((i) => i.kind === 'rmu').map((i) => i.equipment)).toContain('RMU-1');
    const d = earthingDrawing(p);
    expect(d.svg).toContain('EARTH BAR');
    expect(d.svg).not.toContain('NO PIT');
    for (const pit of L.pits) expect(d.svg).toContain(`>${pit.id}</text>`);
    expect(d.svg).not.toMatch(/NaN|undefined/);
  });

  it('large site: 10 transformers on 5 RMUs, 10 MDBs, SMDBs with their own pits — two-row drawing', () => {
    let p = applyTransformers(sampleProject, planTransformers(sampleProject, Array.from({ length: 9 }, () => ({ kva: 1500 })), false, 2));
    p = setRmu(p, 'MDB-1', 'RMU-5'); // RMU-5 feeds the 9th new one and the existing TX-1
    const smdbs = p.boards.filter((b) => b.kind === 'SMDB').map((b) => b.id);
    p = { ...p, earthingPlan: { pits: Object.fromEntries(smdbs.map((id) => [`sub:${id}`, 1])) } };
    const L = earthingLayout(p);
    expect(L.items.filter((i) => i.kind === 'rmu')).toHaveLength(5);
    expect(L.items.filter((i) => i.kind === 'txn')).toHaveLength(10);
    expect(L.items.filter((i) => i.kind === 'lv')).toHaveLength(10);
    expect(L.pits.filter((x) => x.kind === 'sub')).toHaveLength(smdbs.length);
    expect(L.pits).toHaveLength(5 * 2 + 10 * 2 + 10 + smdbs.length);
    const d = earthingDrawing(p);
    expect(d.svg).not.toMatch(/NaN|undefined|NO PIT/);
    for (const pit of L.pits) expect(d.svg).toContain(`>${pit.id}</text>`);
    expect(d.h).toBeGreaterThan(900); // LV room on a second row
    expect(d.w).toBeLessThan(3000);
  });

  it('two substations, 5 transformers and 3 RMUs each: separate bands, pits never linked across substations', () => {
    let p: Project = { ...sampleProject, boards: [], feeders: [], ties: [] };
    p = applyTransformers(p, planTransformers(p, Array.from({ length: 5 }, () => ({ kva: 1500 })), false, 2, 'SS-01'));
    p = applyTransformers(p, planTransformers(p, Array.from({ length: 5 }, () => ({ kva: 1000 })), false, 2, 'SS-02'));
    const L = earthingLayout(p);
    for (const g of ['SS-01', 'SS-02']) {
      expect(L.items.filter((i) => i.group === g && i.kind === 'rmu')).toHaveLength(3);
      expect(L.items.filter((i) => i.group === g && i.kind === 'txn')).toHaveLength(5);
      expect(L.items.filter((i) => i.group === g && i.kind === 'lv')).toHaveLength(5);
    }
    const group = new Map(L.pits.map((x) => [x.id, L.items.find((i) => i.key === x.itemKey)!.group]));
    expect(L.links.every(([a, b]) => group.get(a) === group.get(b))).toBe(true);
    expect(L.pits).toHaveLength(2 * (3 * 2 + 5 * 2 + 5));
    const d = earthingDrawing(p);
    expect(d.svg).toContain('LV ROOM — SS-01');
    expect(d.svg).toContain('LV ROOM — SS-02');
    expect(d.svg).toContain('LEGEND');
    expect(d.svg).not.toMatch(/NaN|undefined|NO PIT/);
  });
});
