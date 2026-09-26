export type FeederStatus = 'ok' | 'warn' | 'bad';

export interface Feeder {
  id: string;
  boardId: string;
  name: string;
  loadKw: number;
  demandFactor: number; // 0-1
  powerFactor: number; // 0-1
  lengthM: number;
  cableCsaMm2: number; // conductor cross section, must exist in CABLE_TABLE
  cores: 2 | 3 | 4;
  breakerRatingA: number;
  breakerIcuKa: number; // breaking capacity
  generation?: boolean; // true for PV / generator feeders
  feedsBoardId?: string; // if set, this feeder is the incomer to a downstream board —
  // its loadKw/demandFactor are ignored and its current is derived from that
  // board's total demand instead
}

export interface Board {
  id: string;
  name: string;
  upstreamId?: string; // parent board id, or undefined for the main board
  sourceKva?: number; // only set on the main board (transformer rating)
  sourceImpedancePct?: number; // transformer impedance %, only on main board
}

export interface Project {
  name: string;
  voltageV: number; // phase-phase, e.g. 415
  frequencyHz: number;
  ambientC: number;
  vdLimitPct: number; // allowable voltage drop, e.g. 4.0 per DEWA/IEC
  boards: Board[];
  feeders: Feeder[];
  updatedAt: string;
}

export function newProject(name: string): Project {
  return {
    name,
    voltageV: 415,
    frequencyHz: 50,
    ambientC: 45,
    vdLimitPct: 4,
    boards: [{ id: 'MDB-1', name: 'Main Distribution Board', sourceKva: 1000, sourceImpedancePct: 5 }],
    feeders: [],
    updatedAt: new Date().toISOString()
  };
}
