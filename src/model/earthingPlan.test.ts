import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { applyTransformers, planTransformers } from './transformers';
import { earthingLayout } from './earthingPlan';
import { buildBom } from '../calc/bom';

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
});
