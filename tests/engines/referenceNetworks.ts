import type { Feeder, Project } from '../../src/types';
import { network } from '../fixtures/networks';

/** Reference networks for the external engines (OpenDSS, pandapower).
 * Fixed on purpose — independent of the app's sample project — so a change
 * in a golden result always means the engine or its modelling changed.
 * Each one exercises a different part of the engine bridge; the first has a
 * hand-calculated answer (see engines.test.ts). */

const base = { voltageV: 400, frequencyHz: 50, ambientC: 40, vdLimitPct: 4, updatedAt: '2026-10-22T00:00:00Z' };
const load = (id: string, boardId: string, kw: number, lengthM: number, cableCsaMm2: number, extra: Partial<Feeder> = {}): Feeder => ({
  id, boardId, name: id, loadKw: kw, demandFactor: 1, powerFactor: 0.9, lengthM, cableCsaMm2, cores: 4, breakerRatingA: 100, breakerIcuKa: 36, ...extra
});
const incomer = (id: string, boardId: string, feedsBoardId: string, lengthM: number, cableCsaMm2: number, extra: Partial<Feeder> = {}): Feeder => ({
  ...load(id, boardId, 0, lengthM, cableCsaMm2, extra), feedsBoardId, demandFactor: 1
});

export const referenceNetworks: Record<string, Project> = {
  /** One 1000 kVA, 5 % transformer and one balanced 3-phase load: checked against hand calculation. */
  'single-transformer': {
    ...base, name: 'Ref single transformer',
    boards: [{ id: 'MDB', name: 'MDB', sourceKva: 1000, sourceImpedancePct: 5, sourceXr: 5 }],
    feeders: [load('L1', 'MDB', 100, 50, 95)]
  },

  /** MDB → SMDB → DB with loads at every level and a 2-run parallel main incomer. */
  'three-level': {
    ...base, name: 'Ref three level',
    boards: [
      { id: 'MDB', name: 'MDB', sourceKva: 1600, sourceImpedancePct: 6 },
      { id: 'SMDB', name: 'SMDB', upstreamId: 'MDB' },
      { id: 'DB', name: 'DB', upstreamId: 'SMDB' }
    ],
    feeders: [
      incomer('MDB-SMDB', 'MDB', 'SMDB', 60, 240, { parallel: 2, breakerRatingA: 630 }),
      incomer('SMDB-DB', 'SMDB', 'DB', 35, 70, { breakerRatingA: 200 }),
      load('MDB-CH', 'MDB', 250, 80, 185, { powerFactor: 0.85, loadType: 'motor' }),
      load('SMDB-AHU', 'SMDB', 45, 40, 25, { powerFactor: 0.8, loadType: 'motor' }),
      load('DB-LTG', 'DB', 18, 30, 10, { powerFactor: 0.95, demandFactor: 0.9 }),
      load('DB-PWR', 'DB', 30, 25, 16, { demandFactor: 0.7 })
    ]
  },

  /** PV generation at the MDB next to loads: reverse flow and voltage rise on the PV cable. */
  'pv-generation': {
    ...base, name: 'Ref PV generation',
    boards: [{ id: 'MDB', name: 'MDB', sourceKva: 500, sourceImpedancePct: 4.5 }],
    feeders: [
      load('PV', 'MDB', 120, 70, 50, { powerFactor: 1, generation: true, loadType: 'pv' }),
      load('L1', 'MDB', 80, 40, 35),
      load('L2', 'MDB', 60, 90, 25, { powerFactor: 0.85 })
    ]
  },

  /** Single-phase (2-core) circuits unevenly spread: OpenDSS sees the unbalance, pandapower skips them. */
  'single-phase': {
    ...base, name: 'Ref single phase',
    boards: [
      { id: 'MDB', name: 'MDB', sourceKva: 630, sourceImpedancePct: 4.5 },
      { id: 'DB', name: 'DB', upstreamId: 'MDB' }
    ],
    feeders: [
      incomer('MDB-DB', 'MDB', 'DB', 45, 50, { breakerRatingA: 160 }),
      load('DB-3PH', 'DB', 20, 20, 10),
      load('DB-S1', 'DB', 3, 25, 4, { cores: 2, phase: 'R', powerFactor: 0.95 }),
      load('DB-S2', 'DB', 2.5, 30, 4, { cores: 2, phase: 'R', powerFactor: 0.95 }),
      load('DB-S3', 'DB', 1.5, 18, 2.5, { cores: 2, phase: 'Y', powerFactor: 1 })
    ]
  },

  /** Two independent transformers, each with its own board tree. */
  'two-transformers': {
    ...base, name: 'Ref two transformers',
    boards: [
      { id: 'MDB-A', name: 'MDB-A', sourceKva: 1000, sourceImpedancePct: 5 },
      { id: 'MDB-B', name: 'MDB-B', sourceKva: 2000, sourceImpedancePct: 6.5, sourceXr: 8 },
      { id: 'DB-B', name: 'DB-B', upstreamId: 'MDB-B' }
    ],
    feeders: [
      load('A-L1', 'MDB-A', 300, 60, 185),
      incomer('B-DB', 'MDB-B', 'DB-B', 30, 300, { parallel: 3, breakerRatingA: 1000 }),
      load('B-L1', 'DB-B', 600, 40, 240, { parallel: 2, powerFactor: 0.88 })
    ]
  },

  /** A generated building network (31 boards, 3 levels) for scale and mixed load types, including
   * capacitor banks. Built by tests/fixtures/networks.ts: changing that file changes this golden result. */
  'building-31': network(31, 'shallow', 6)
};
