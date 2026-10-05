import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { sampleProject } from '../data/sampleProject';
import { applyTransformers, planTransformers, setRmu } from './transformers';
import { earthingLayout, patchEarthing, withEarthPitIds } from './earthingPlan';
import { buildBom } from '../calc/bom';
import { earthingDrawing } from '../diagram/earthingDrawing';

const withTx = (n: number) => applyTransformers(sampleProject, planTransformers(sampleProject, Array.from({ length: n }, () => ({ kva: 1500 })), false));

describe('earthing schematic', () => {
  it('migrates legacy IDs without moving readings and preserves IDs when earlier pits grow', () => {
    const legacy = withTx(1);
    const old = earthingLayout(legacy);
    const tested = old.pits.find((p) => p.kind === 'lv')!;
    const initial = withEarthPitIds({ ...legacy, earthingPlan: { measured: { [tested.id]: 0.65 } } });
    expect(earthingLayout(initial).pits.map((p) => p.id)).toEqual(old.pits.map((p) => p.id));
    expect(withEarthPitIds(initial)).toBe(initial);
    const bookkeeping = withEarthPitIds(sampleProject);
    expect(bookkeeping.earthingPlan).toBe(sampleProject.earthingPlan);
    expect(buildBom(bookkeeping)).toEqual(buildBom(sampleProject));
    const rmu = old.items.find((i) => i.kind === 'rmu')!;
    const grown = patchEarthing(initial, (p) => ({ ...p, pits: { [rmu.key]: 3 } }));
    const after = earthingLayout(grown);
    for (const pit of old.pits) expect(after.pits.find((p) => p.id === pit.id)?.itemKey).toBe(pit.itemKey);
    expect(after.pits.find((p) => p.id === tested.id)?.measured).toBe(0.65);
    expect(new Set(after.pits.map((p) => p.id)).size).toBe(after.pits.length);
  });

  it('reserves removed equipment IDs and retains them across save/reload and board reorder', () => {
    const initial = withEarthPitIds(withTx(1));
    const original = earthingLayout(initial);
    const removed = initial.boards.find((b) => b.sourceKva)!;
    const fewer = withEarthPitIds({ ...initial, boards: initial.boards.filter((b) => b.id !== removed.id) }, initial);
    const replacement = withEarthPitIds({ ...fewer, boards: [...fewer.boards, { ...removed, id: 'NEW-MDB' }] });
    const reserved = new Set(original.pits.map((p) => p.id));
    const newPits = earthingLayout(replacement).pits.filter((p) => p.itemKey.includes('NEW-MDB'));
    expect(newPits.length).toBeGreaterThan(0);
    expect(newPits.every((p) => !reserved.has(p.id))).toBe(true);
    const restored = withEarthPitIds({ ...JSON.parse(JSON.stringify(fewer)), boards: [...initial.boards].reverse() });
    const after = earthingLayout(restored);
    for (const pit of original.pits) expect(after.pits.find((p) => p.id === pit.id)?.itemKey).toBe(pit.itemKey);
    const reduced = patchEarthing(initial, (p) => ({ ...p, pits: { [original.items[0].key]: 1 } }));
    const regrown = patchEarthing(reduced, (p) => ({ ...p, pits: {} }));
    expect(earthingLayout(regrown).pits.map((p) => p.id)).toEqual(original.pits.map((p) => p.id));
  });

  it('migrates legacy automatic RMU overrides to stable equipment keys before reorder', () => {
    const project = withTx(1);
    const rmu = earthingLayout(project).items.find((it) => it.kind === 'rmu')!;
    const saved = withEarthPitIds({ ...project, earthingPlan: { pits: { [rmu.legacyKey!]: 4 }, unlinked: [rmu.legacyKey!] } });
    const reordered = withEarthPitIds({ ...saved, boards: [...saved.boards].reverse() });
    expect(earthingLayout(reordered).items.find((it) => it.key === rmu.key)).toMatchObject({ pits: 4, linked: false });
  });

  it('includes the complete schedule in SVG and editable DXF without losing measured units', async () => {
    const { DOMParser } = await import('@xmldom/xmldom');
    const { svgToDxf } = await import('../diagram/exportSvg');
    const { toDxf } = await import('../docs/dxf');
    const { vi } = await import('vitest');
    const initial = withEarthPitIds(sampleProject);
    const id = earthingLayout(initial).pits[0].id;
    const project = patchEarthing(initial, (p) => ({ ...p, measured: { [id]: 0.75 } }));
    const drawing = earthingDrawing(project);
    expect(drawing.svg).toContain('EARTH PIT SCHEDULE');
    expect(drawing.svg).toContain('0.75 ohm');
    expect(drawing.svg).toContain('Not tested');
    expect(drawing.svg).toContain('Cu-bonded rod');
    expect(earthingDrawing(project, undefined, false).svg).not.toContain('EARTH PIT SCHEDULE');
    vi.stubGlobal('DOMParser', DOMParser);
    try {
      const dxf = toDxf(svgToDxf(drawing.svg, drawing.h));
      expect(dxf).toContain('EARTH PIT SCHEDULE');
      expect(dxf).toContain('0.75 ohm');
      for (const pit of earthingLayout(project).pits) expect(dxf).toContain(`\r\n${pit.id}\r\n`);
    } finally { vi.unstubAllGlobals(); }
  });
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
