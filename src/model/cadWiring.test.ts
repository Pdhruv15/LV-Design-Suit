import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { placeBoard, placeLvPoint } from './cadDevices';
import { updateSchedules } from './cadPlanSchedules';
import { arcLength, levelWiring, toggleWiring, wireLevel, wiringLengthM, wiringOrder, wiringTag } from './cadWiring';
import type { Project } from '../types';

const gf = { building: 'V', level: 'GF' };
const ff = { building: 'V', level: 'FF' };
const base: Project = {
  ...sampleProject, lvPoints: undefined, cadWiring: undefined, cadSketch: undefined, cadLength: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }, { id: 'FF', name: 'First', kind: 'typical', heightM: 4 }] }], rooms: [] }
};
const circuit = base.feeders.find((f) => f.id === 'DB-GF1-Y1')!; // Majlis lighting on DB-GF1

/** Three lights in a row 4 m apart, from 10 m right of the DB, which sits at the origin. */
function villa(): Project {
  let p = placeBoard(base, 'DB-GF1', gf, 0, 0);
  for (const x of [18, 10, 14]) p = placeLvPoint(p, gf, 'ltg', circuit.id, x, 0).project;
  return p;
}

describe('circuit wiring on the CAD plan', () => {
  it('wires the devices nearest-first from the DB, unless an order was saved', () => {
    const points = villa().lvPoints!;
    expect(wiringOrder(points, undefined, [0, 0]).map((d) => d.x)).toEqual([10, 14, 18]);
    expect(wiringOrder(points, ['P1'], [0, 0]).map((d) => d.x)).toEqual([18, 14, 10]);
    expect(wiringOrder(points, ['P9', 'P2'], [0, 0]).map((d) => d.x)).toEqual([10, 14, 18]); // a removed point is skipped
  });

  it('draws arcs between the devices and a home run to the DB, and measures along them', () => {
    const p = wireLevel(villa(), gf).project;
    const [w] = levelWiring(p, gf);
    expect(w.arcs).toHaveLength(2);
    expect(w.home).toMatchObject({ a: [10, 0], b: [0, 0] });
    // A quadratic arc bowing 15 % of its chord is about 6 % longer than the chord: 4 + 4 + 10 m of chords.
    expect(arcLength(w.arcs[0])).toBeCloseTo(4.23, 1);
    expect(w.routeM).toBeCloseTo(19.05, 1);
    // (19.05 m + 3 × 1.5 m drops) × 1.1, rounded up.
    expect(wiringLengthM(p, w.routeM, 3)).toBe(26);
    expect(w.tag).toBe(wiringTag(circuit, 26));
    expect(w.tag).toMatch(/^DB-GF1\/Y1 · \dC × [\d.]+ mm² · 26 m$/);
    expect(w.warning).toBeUndefined();
  });

  it('warns instead of a home run when the DB is not on the level, and adds the levels together', () => {
    let p = villa();
    p = placeLvPoint(p, ff, 'ltg', circuit.id, 10, 0).project;
    p = wireLevel(p, ff).project;
    const [up] = levelWiring(p, ff);
    expect(up.home).toBeUndefined();
    expect(up.warning).toBe('DB-GF1 is on another level: no home run here');
    // 19.05 m on the ground floor and none upstairs; four drops: (19.05 + 6) × 1.1 → 28 m.
    expect(up.tag).toMatch(/ · 28 m$/);
    const unplaced = levelWiring({ ...p, boards: p.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, planPoint: undefined } : b)) }, gf)[0];
    expect(unplaced.warning).toBe('DB-GF1 is not placed on the plan: no home run');
  });

  it('wires every circuit on the level once; Wire one switches a circuit on and off', () => {
    const { project, added } = wireLevel(villa(), gf);
    expect(added).toEqual([circuit.id]);
    expect(wireLevel(project, gf).added).toEqual([]);
    const off = toggleWiring(project, circuit.id);
    expect(off.wired).toBe(false);
    expect(off.project.cadWiring).toBeUndefined();
    expect(levelWiring(off.project, gf)).toEqual([]);
    expect(toggleWiring(off.project, circuit.id).wired).toBe(true);
  });

  it('Update schedules gives a wired circuit its wiring length; a drawn cable route takes precedence', () => {
    const p = wireLevel(villa(), gf).project;
    const u = updateSchedules(p, []);
    expect(u.project.feeders.find((f) => f.id === circuit.id)!.lengthM).toBe(26);
    expect(u.lengths).toBe(1);
    expect(updateSchedules(u.project, []).lengths).toBe(0);
    const routed = updateSchedules(p, [{ file: 'gf.dxf', mPerUnit: 1, items: [{ id: 'k', kind: 'pline', layer: 'E-LV-CABLE', pts: [[0, 0], [5, 0]], cable: { feederId: circuit.id } }] }]);
    expect(routed.project.feeders.find((f) => f.id === circuit.id)!.lengthM).not.toBe(26);
  });

  it('takes the drop and allowance from the project', () => {
    const p = { ...villa(), cadLength: { dropM: 0, allowancePct: 0 } };
    expect(wiringLengthM(p, 19.05, 3)).toBe(20);
  });
});
