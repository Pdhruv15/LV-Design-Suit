import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Feeder, Project } from '../types';
import { PV_DEFAULTS, sizePv, type PvSystem } from '../calc/solar';
import { designCurrentA, voltageDropPct } from '../calc/electrical';
import { pvToSld } from './pvFeeder';
import { buildPvReportHtml } from '../docs/upsSolarReport';
import { cableSchedule } from '../docs/schedules';

/** ENG-006: Solar Add / Update keeps the inverter's phase system. */
const pv = (phases: 1 | 3, extra: Partial<PvSystem> = {}): PvSystem => ({ ...PV_DEFAULTS, mode: 'kwp', targetKwp: 5.5, inverter: { ...PV_DEFAULTS.inverter, acKw: 5, phases }, ...extra });
const project = (feeders: Feeder[] = []): Project => ({
  ...sampleProject, voltageV: 400, ambientC: 30, vdLimitPct: 4, vdTempC: undefined,
  boards: [{ id: 'MDB', name: 'MDB', sourceKva: 1000 }], feeders, ties: undefined, trays: undefined, busRisers: undefined, pv: undefined
} as Project);
const add = (p: Project, s: PvSystem) => pvToSld(p, s, sizePv(s, p.voltageV), 'MDB')!;

describe('ENG-006: Solar PV feeder follows the inverter phases', () => {
  it('the fixture: 10 panels / 5.5 kWp, one 5 kW one-phase inverter, 21.650635 A', () => {
    const r = sizePv(pv(1), 400);
    expect(r.panels).toBe(10);
    expect(r.kwp).toBeCloseTo(5.5, 6);
    expect(r.inverters).toBe(1);
    expect(r.acCurrentA).toBeCloseTo(21.650635, 5);
  });

  it('Add, one-phase: 2 cores, 21.650635 A, 32 A breaker, 4 mm² (3.11 % drop)', () => {
    const { project: p, feeder: f, existing } = add(project(), pv(1));
    expect(existing).toBe(false);
    expect(f.cores).toBe(2);
    expect(f.generation).toBe(true);
    expect(f.loadType).toBe('pv');
    expect(designCurrentA(f, p)).toBeCloseTo(21.650635, 5);
    expect(designCurrentA(f, p)).toBeCloseTo(sizePv(pv(1), 400).acCurrentA, 9);
    expect(f.breakerRatingA).toBe(32);
    expect(f.cableCsaMm2).toBe(4);
    expect(voltageDropPct(f, p)).toBeCloseTo(3.11175, 4);
    expect(f.phase).toBeUndefined(); // no phase invented
  });

  it('Add, three-phase: 4 cores and 7.216878 A for 5 kW at 400 V', () => {
    const { project: p, feeder: f } = add(project(), pv(3));
    expect(f.cores).toBe(4);
    expect(designCurrentA(f, p)).toBeCloseTo(7.216878, 5);
  });

  it('Update 3 → 1 and 1 → 3: cores and sizing follow; one PV feeder; other properties kept', () => {
    const first = add(project(), pv(3));
    const edited = { ...first.project, feeders: first.project.feeders.map((f) => (f.id === 'PV-MDB' ? { ...f, lengthM: 45, remarks: 'Roof east', trayRoute: 'A', breakerIcuKa: 36 } : f)) };
    const one = add(edited, pv(1, { acPhase: 'Y' }));
    expect(one.existing).toBe(true);
    expect(one.project.feeders.filter((f) => f.id === 'PV-MDB')).toHaveLength(1);
    expect(one.feeder.cores).toBe(2);
    expect(one.feeder.phase).toBe('Y');
    expect(one.feeder).toMatchObject({ lengthM: 45, remarks: 'Roof east', trayRoute: 'A', generation: true, loadType: 'pv', boardId: 'MDB' });
    expect(designCurrentA(one.feeder, one.project)).toBeCloseTo(21.650635, 5);
    expect(one.feeder.breakerRatingA).toBeGreaterThan(first.feeder.breakerRatingA);
    const three = add(one.project, pv(3, { acPhase: 'Y' }));
    expect(three.feeder.cores).toBe(4);
    expect(three.feeder.phase).toBeUndefined(); // stale Y label reconciled
    expect(designCurrentA(three.feeder, three.project)).toBeCloseTo(7.216878, 5);
    expect(three.project.feeders.filter((f) => f.id === 'PV-MDB')).toHaveLength(1);
  });

  it('several one-phase inverters: aggregate current on one connection, and the page / report say so', () => {
    const s = pv(1, { targetKwp: 11 });
    const r = sizePv(s, 400);
    expect(r.inverters).toBe(2);
    const { project: p, feeder: f } = add(project(), s);
    expect(f.cores).toBe(2);
    expect(designCurrentA(f, p)).toBeCloseTo(r.acCurrentA, 9);
    expect(buildPvReportHtml(p, s, r)).toMatch(/2 inverters counted together/);
  });

  it('report labels: 231 V phase-to-neutral for one-phase, 400 V line-to-line for three-phase', () => {
    const p = project();
    expect(buildPvReportHtml(p, pv(1), sizePv(pv(1), 400))).toMatch(/1-phase, 231 V phase-to-neutral, phase not set/);
    expect(buildPvReportHtml(p, pv(3), sizePv(pv(3), 400))).toMatch(/3-phase, 400 V line-to-line/);
  });

  it('cable schedule shows the two-core PV cable', () => {
    const { project: p } = add(project(), pv(1));
    const row = cableSchedule(p).rows.find((x) => x[0] === 'C-PV-MDB')!;
    expect(String(row[5])).toMatch(/^2C/); // cores × size
    expect(Number(row[9])).toBe(22); // Ib (A), printed to the nearest ampere (was 7)
  });
});
