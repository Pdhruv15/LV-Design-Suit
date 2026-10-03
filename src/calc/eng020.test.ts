import { describe, expect, it } from 'vitest';
import { disconnectionBasis, disconnectionLabel, evaluateEarthing, requiredDisconnectionS } from './earthing';
import type { Feeder, Project } from '../types';

const F = (over: Partial<Feeder> = {}): Feeder => ({
  id: 'F', boardId: 'MDB', name: 'F', loadKw: 5, demandFactor: 1, powerFactor: 0.9, lengthM: 50, cableCsaMm2: 4, cores: 4, breakerRatingA: 40, breakerIcuKa: 36, ...over
});
const P = (feeders: Feeder[], over: Partial<Project> = {}): Project => ({
  name: 'T', voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '',
  boards: [{ id: 'MDB', name: 'M', sourceKva: 1000, sourceImpedancePct: 5 }, { id: 'SUB', name: 'S', upstreamId: 'MDB' }], feeders, ...over
});
const proj = P([]);

describe('ENG-020 required disconnection time by circuit purpose', () => {
  it('review cases (TN 230 V)', () => {
    expect(requiredDisconnectionS(F({ loadType: 'motor', circuitPurpose: 'fixed' }), proj)).toBe(5); // was 0.4
    expect(requiredDisconnectionS(F({ loadType: 'sockets', circuitPurpose: 'sockets' }), proj)).toBe(0.4);
    expect(requiredDisconnectionS(F({ circuitPurpose: 'fixed', breakerRatingA: 32 }), proj)).toBe(0.4);
    expect(requiredDisconnectionS(F({ feedsBoardId: 'SUB' }), proj)).toBe(5);
  });

  it('32 / 63 A boundaries', () => {
    expect(requiredDisconnectionS(F({ circuitPurpose: 'fixed', breakerRatingA: 32 }), proj)).toBe(0.4);
    expect(requiredDisconnectionS(F({ circuitPurpose: 'fixed', breakerRatingA: 33 }), proj)).toBe(5);
    expect(requiredDisconnectionS(F({ circuitPurpose: 'sockets', breakerRatingA: 63 }), proj)).toBe(0.4);
    expect(requiredDisconnectionS(F({ circuitPurpose: 'sockets', breakerRatingA: 80 }), proj)).toBe(5);
  });

  it('unknown purpose and a load icon alone never relax the requirement; socket points mean sockets', () => {
    const motorIcon = disconnectionBasis(F({ loadType: 'motor' }), proj);
    expect(motorIcon).toMatchObject({ requiredS: 0.4, purpose: 'unknown' });
    expect(motorIcon.basis).toMatch(/purpose not set — treated as socket-outlets/);
    expect(disconnectionBasis(F({ points: { s13: 2, ltg: 4 } }), proj).purpose).toBe('sockets');
  });

  it('stricter project rule is applied and disclosed', () => {
    const b = disconnectionBasis(F({ circuitPurpose: 'fixed' }), { voltageV: 400, strictFinalDisconnection: true });
    expect(b.requiredS).toBe(0.4);
    expect(b.basis).toMatch(/^Project rule \(stricter than IEC 60364-4-41\)/);
  });

  it('unsupported U0 is not verified, never a time-based pass or fail', () => {
    const f = F({ circuitPurpose: 'sockets', lengthM: 300 }); // far below magnetic trip
    const r = evaluateEarthing(P([f], { voltageV: 690 }), f); // U0 398 V
    expect(r.basisSupported).toBe(false);
    expect(r.disconnection).toBe('warn');
    expect(r.requiredBasis).toMatch(/not verified/);
    expect(disconnectionLabel(r)).toMatch(/not determined/);
  });

  it('fixed 40 A below the magnetic trip: 5 s allowed, but still a curve check, not a pass', () => {
    const f = F({ circuitPurpose: 'fixed', lengthM: 200 });
    const r = evaluateEarthing(P([f]), f);
    expect(r.faultA).toBeLessThan(r.tripA);
    expect(r.requiredS).toBe(5);
    expect(r.disconnection).toBe('warn');
    expect(r.status).not.toBe('ok');
    expect(disconnectionLabel(r)).toBe('Thermal — check curve for 5 s');
  });

  it('ENG-019 still holds with the new basis', () => {
    const f = F({ circuitPurpose: 'fixed' });
    const p = P([f]); p.boards = [{ id: 'MDB', name: 'M' }];
    expect(evaluateEarthing(p, f).sourceMissing).toBeTruthy();
  });
});
