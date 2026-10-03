import type { Board, Feeder, Phase, Project } from '../../src/types';

/** Generated LV networks for scale tests — synthetic, not real projects.
 * - shallow: MDB → 10 SMDBs → DBs (3 levels), the usual building layout;
 * - deep: a balanced binary tree under the MDB (≈ log2(n) levels), to stress
 *   downstream traversal.
 * Each board gets `perBoard` final circuits: mixed power factors, single-phase
 * circuits on R / Y / B (one in twelve with no phase set), 3-phase motors,
 * some parallel runs. Each SMDB has a 4-step capacitor bank; the MDB has a
 * PV feeder. Sizes are plausible, not designed — results may fail checks;
 * this is about calculation work, not compliance. */
export type Shape = 'shallow' | 'deep';

export function network(boards: number, shape: Shape, perBoard = 10): Project {
  const list: Board[] = [{ id: 'MDB', name: 'MDB', sourceKva: 2500, sourceImpedancePct: 6 }];
  const feeders: Feeder[] = [];
  const parent = (i: number) => (shape === 'shallow' ? (i <= 10 ? 'MDB' : `B${((i - 1) % 10) + 1}`) : i <= 2 ? 'MDB' : `B${Math.floor(i / 2)}`);
  for (let i = 1; i < boards; i++) {
    const up = parent(i);
    list.push({ id: `B${i}`, name: `B${i}`, upstreamId: up });
    feeders.push({ id: `INC-B${i}`, boardId: up, feedsBoardId: `B${i}`, name: `To B${i}`, loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 20 + (i % 7) * 10,
      cableCsaMm2: up === 'MDB' ? 240 : 70, cores: 4, ...(up === 'MDB' ? { parallel: 2 } : {}), breakerRatingA: up === 'MDB' ? 630 : 200, breakerIcuKa: up === 'MDB' ? 50 : 36 });
  }
  const phases: Phase[] = ['R', 'Y', 'B'];
  for (const b of list) {
    for (let k = 0; k < perBoard; k++) {
      const single = k % 3 !== 0;
      feeders.push({
        id: `${b.id}-C${k + 1}`, boardId: b.id, name: `${b.id} circuit ${k + 1}`, loadKw: single ? 1 + (k % 4) * 0.5 : 5 + (k % 5) * 3,
        demandFactor: 0.7 + (k % 3) * 0.1, powerFactor: [0.95, 0.9, 0.85, 0.8][k % 4], lengthM: 15 + (k % 6) * 8,
        cableCsaMm2: single ? 4 : 10, cores: single ? 2 : 4, ...(single && k % 12 !== 1 ? { phase: phases[k % 3] } : {}),
        ...(k === 9 ? { parallel: 2 } : {}), loadType: single ? 'sockets' : 'motor', breakerRatingA: single ? 20 : 40, breakerIcuKa: 10
      });
    }
    if (b.upstreamId === 'MDB') feeders.push({ id: `${b.id}-CAP`, boardId: b.id, name: 'Capacitor bank', loadKw: 0, kvar: 50, capSteps: 4, demandFactor: 1, powerFactor: 0, lengthM: 5, cableCsaMm2: 35, cores: 4, loadType: 'capacitor', breakerRatingA: 100, breakerIcuKa: 36 });
  }
  feeders.push({ id: 'MDB-PV', boardId: 'MDB', name: 'PV inverter', loadKw: 50, demandFactor: 1, powerFactor: 1, lengthM: 40, cableCsaMm2: 35, cores: 4, generation: true, loadType: 'pv', breakerRatingA: 100, breakerIcuKa: 36 });
  return { name: `bench ${shape} ${boards}`, voltageV: 400, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '2026-10-03T00:00:00Z', boards: list, feeders };
}
