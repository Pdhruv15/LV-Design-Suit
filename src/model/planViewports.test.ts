import { describe, expect, it } from 'vitest';
import { alignView, arrangeBoxes, arrangementOf, arrangeViewports, boxFrom, copyViewport, fitView, keyScale, MORE_SCALES, scalesOf, VP_ARRANGEMENTS, VP_GAP_MM, VP_SCALES, withScales, insideVp, isFrozen, isLocked, patchViewport, toggleFrozen, vpId, vpName, vpToModel, vpToPaper, vpWindow, withViewports, type PlanViewport } from './planViewports';
import type { DrawingSet } from './drawingSet';

const v: PlanViewport = { id: 'vp1', box: [10, 20, 200, 100], at: [50, 30], scale: 100 };

describe('layout viewports', () => {
  it('shows the model window around its centre at its scale, and maps paper ↔ model both ways', () => {
    expect(vpWindow(v)).toEqual({ x0: 40, x1: 60, y0: 25, y1: 35 }); // 200 × 100 mm at 1:100 = 20 × 10 m
    expect(vpToPaper(v, [50, 30])).toEqual([110, 70]);
    expect(vpToPaper(v, [60, 35])).toEqual([210, 20]); // top right: y is down on paper
    expect(vpToModel(v, [210, 20])).toEqual([60, 35]);
    expect(insideVp(v, [10, 20])).toBe(true);
    expect(insideVp(v, [9, 20])).toBe(false);
    expect(boxFrom([50, 40], [10, 10])).toEqual([10, 10, 40, 30]);
  });

  it('is locked unless unlocked, names itself in order, freezes layers without case', () => {
    expect(isLocked(v)).toBe(true);
    expect(isLocked({ ...v, locked: false })).toBe(false);
    expect(vpId([v, { ...v, id: 'vp3' }])).toBe('vp2');
    expect(vpId([{ ...v, id: 'vp2' }])).toBe('vp1');
    expect(vpName([v, { ...v, id: 'vp7' }], 'vp7')).toBe('Viewport 2');
    const f = { ...v, ...toggleFrozen(v, 'E-POWER') };
    expect(isFrozen(f, 'e-power')).toBe(true);
    expect(toggleFrozen(f, 'e-POWER')).toEqual({ frozen: undefined });
  });

  it('changes a viewport, and puts them on their sheet (none: back to the worked-out one)', () => {
    expect(patchViewport([v], 'vp1', { scale: 50, frame: true, locked: undefined })).toEqual([{ ...v, scale: 50, frame: true }]);
    const set = { sheets: [{ id: 's1', number: '', title: '', kind: 'plan', boards: [], size: 'auto' }] } as unknown as DrawingSet;
    const one = withViewports(set, 's1', [v]);
    expect(one.sheets[0].viewports).toEqual([v]);
    expect(withViewports(one, 's1', []).sheets[0]).not.toHaveProperty('viewports');
  });
});

describe('viewport arrangements', () => {
  const region: [number, number, number, number] = [4, 4, 300, 200];
  const eps = 1e-6;
  it('every arrangement fits the region, keeps the gap between neighbours and touches the region edges', () => {
    for (const a of VP_ARRANGEMENTS) {
      const bs = arrangeBoxes(a, region);
      expect(bs).toHaveLength(a.boxes.length);
      for (const b of bs) {
        expect(b[0]).toBeGreaterThanOrEqual(region[0] - eps); expect(b[1]).toBeGreaterThanOrEqual(region[1] - eps);
        expect(b[0] + b[2]).toBeLessThanOrEqual(region[0] + region[2] + eps); expect(b[1] + b[3]).toBeLessThanOrEqual(region[1] + region[3] + eps);
      }
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const [p, q] = [bs[i], bs[j]];
        const gx = Math.max(q[0] - (p[0] + p[2]), p[0] - (q[0] + q[2])), gy = Math.max(q[1] - (p[1] + p[3]), p[1] - (q[1] + q[3]));
        expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(VP_GAP_MM - 0.2);
      }
      expect(Math.min(...bs.map((b) => b[0]))).toBeCloseTo(region[0], 5);
      expect(Math.min(...bs.map((b) => b[1]))).toBeCloseTo(region[1], 5);
      expect(Math.max(...bs.map((b) => b[0] + b[2]))).toBeCloseTo(region[0] + region[2], 1);
    }
    expect(arrangeBoxes(arrangementOf('1')!, region)).toEqual([[4, 4, 300, 200]]);
    expect(arrangementOf('2v')?.id).toBe('2V');
    expect(arrangementOf('zz')).toBeUndefined();
  });
  const vp = (id: string, scale: number, at: [number, number] = [5, 5]): PlanViewport => ({ id, box: [0, 0, 50, 50], at, scale, frame: true });
  it('keeps the views there, adds missing ones from the first and drops the extras', () => {
    const fb = { at: [1, 1] as [number, number], scale: 100 };
    const two = arrangeViewports([vp('vp1', 50, [9, 9])], arrangementOf('2V')!, region, fb);
    expect(two.map((v) => [v.id, v.scale, v.at])).toEqual([['vp1', 50, [9, 9]], ['vp2', 50, [9, 9]]]);
    expect(two[0].frame).toBe(true);
    const one = arrangeViewports([vp('vp1', 50), vp('vp2', 100), vp('vp3', 200)], arrangementOf('1')!, region, fb);
    expect(one.map((v) => v.id)).toEqual(['vp1']);
    const none = arrangeViewports([], arrangementOf('4')!, region, fb);
    expect(new Set(none.map((v) => v.id)).size).toBe(4);
    expect(none.every((v) => v.scale === 100)).toBe(true);
    const gap = arrangeViewports([vp('vp2', 100), vp('vp5', 100)], arrangementOf('3L')!, region, fb);
    expect(new Set(gap.map((v) => v.id)).size).toBe(3);
  });
  it('a key plan is at a much smaller scale, centred where asked', () => {
    expect([keyScale(100), keyScale(50), keyScale(200), keyScale(5000)]).toEqual([500, 500, 1000, 25000]);
    expect(keyScale(40)).toBe(200);
    const k = arrangeViewports([vp('vp1', 100)], arrangementOf('KEY')!, region, { at: [0, 0], scale: 100 }, [20, 30]);
    expect([k[1].scale, k[1].at]).toEqual([500, [20, 30]]);
  });
  it('copies a viewport beside it, inside the area', () => {
    const l = [{ ...vp('vp1', 100), box: [10, 10, 50, 50] as PlanViewport['box'] }];
    expect(copyViewport(l, 'vp1', { w: 200, h: 200 })[1]).toMatchObject({ id: 'vp2', box: [20, 20, 50, 50], scale: 100 });
    expect(copyViewport(l, 'vp1', { w: 65, h: 62 })[1].box).toEqual([15, 12, 50, 50]);
    expect(copyViewport(l, 'nope', { w: 65, h: 62 })).toBe(l);
  });
  it('fits a whole extent at the smallest scale of the list that holds it', () => {
    const v: PlanViewport = { id: 'vp1', box: [0, 0, 200, 100], at: [0, 0], scale: 20 };
    expect(fitView(v, { x0: 0, y0: 0, x1: 18, y1: 9 }, VP_SCALES)).toEqual({ at: [9, 4.5], scale: 100 });
    expect(fitView(v, { x0: 0, y0: 0, x1: 30, y1: 10 }, [500, 100, 200])).toEqual({ at: [15, 5], scale: 200 });
    expect(fitView(v, { x0: 0, y0: 0, x1: 450, y1: 10 }, VP_SCALES).scale).toBe(2300);
  });
  it('lines a view up with the base viewport on the same paper line or column', () => {
    const base: PlanViewport = { id: 'vp1', box: [0, 0, 100, 100], at: [10, 20], scale: 100 };
    const v: PlanViewport = { id: 'vp2', box: [120, 30, 80, 80], at: [50, 60], scale: 200 };
    const h = { ...v, at: alignView(base, v, 'h') };
    expect(vpToPaper(h, [0, 20])[1]).toBeCloseTo(vpToPaper(base, [0, 20])[1], 6);
    expect(h.at[0]).toBe(50);
    const base2: PlanViewport = { ...base, box: [0, 0, 100, 100] }, v2: PlanViewport = { ...v, box: [20, 130, 80, 80] };
    const w = { ...v2, at: alignView(base2, v2, 'v') };
    expect(vpToPaper(w, [10, 0])[0]).toBeCloseTo(vpToPaper(base2, [10, 0])[0], 6);
    expect(w.at[1]).toBe(60);
  });
  it('the project scale list: its own, sorted, else the standard; the default list removes the entry', () => {
    expect(scalesOf({})).toEqual(VP_SCALES);
    expect(scalesOf({ plot: { scales: [200, 75, 75, 0, 100] } })).toEqual([75, 100, 200]);
    const p = withScales({ plot: { defaults: {} } } as never, [100, 75, 75]);
    expect(p.plot).toEqual({ defaults: {}, scales: [75, 100] });
    expect(withScales(p, [...VP_SCALES]).plot).toEqual({ defaults: {} });
    expect('plot' in withScales({ plot: { scales: [75] } } as never, VP_SCALES)).toBe(false);
    expect(MORE_SCALES).toContain(75);
  });
});
