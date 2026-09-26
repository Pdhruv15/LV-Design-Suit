export type FeederStatus = 'ok' | 'warn' | 'bad';

export type LoadType = 'general' | 'lighting' | 'sockets' | 'hvac' | 'motor' | 'fire-pump' | 'ev' | 'it' | 'pv';

export const LOAD_TYPES: { value: LoadType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'sockets', label: 'Small power / sockets' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'motor', label: 'Motor' },
  { value: 'fire-pump', label: 'Fire pump' },
  { value: 'ev', label: 'EV charging' },
  { value: 'it', label: 'IT / data' },
  { value: 'pv', label: 'Solar PV' }
];

export type BreakerType = 'B' | 'C' | 'D' | 'MCCB' | 'ACB';

export const BREAKER_TYPES: { value: BreakerType; label: string }[] = [
  { value: 'B', label: 'MCB type B (Im 3–5 In)' },
  { value: 'C', label: 'MCB type C (Im 5–10 In)' },
  { value: 'D', label: 'MCB type D (Im 10–20 In)' },
  { value: 'MCCB', label: 'MCCB (adjustable Im)' },
  { value: 'ACB', label: 'ACB (adjustable Im)' }
];

export type BoardKind = 'MDB' | 'SMDB' | 'DB' | 'MCC' | 'EMDB';

export const BOARD_KINDS: { value: BoardKind; label: string }[] = [
  { value: 'MDB', label: 'Main distribution board' },
  { value: 'SMDB', label: 'Sub-main distribution board' },
  { value: 'DB', label: 'Distribution board' },
  { value: 'MCC', label: 'Motor control centre' },
  { value: 'EMDB', label: 'Emergency distribution board' }
];

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
  loadType?: LoadType; // drives the diagram icon; defaults to 'general' ('pv' when generation)
  breakerType?: BreakerType; // default: MCB type C up to 63 A, MCCB above
  breakerImMultiple?: number; // MCCB/ACB instantaneous setting as a multiple of In (default 10)
  cpcMm2?: number; // protective (earth) conductor size; default per IEC 60364-5-54 Table 54.2
  essential?: boolean; // supplied by the standby generator (fire pump defaults to essential)
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
  sourceXr?: number; // transformer X/R ratio, only on main board (default 5)
  // Descriptive / equipment data (all optional, shown in the properties panel)
  kind?: BoardKind;
  ratedCurrentA?: number; // busbar / main device rating, used for board loading
  busbarMaterial?: 'copper' | 'aluminium';
  ipRating?: string;
  location?: string;
  manufacturer?: string;
  model?: string;
}

export interface Project {
  name: string;
  voltageV: number; // phase-phase, e.g. 415
  frequencyHz: number;
  ambientC: number;
  vdLimitPct: number; // allowable voltage drop, e.g. 4.0 per DEWA/IEC
  studySettings?: StudySettings;
  boards: Board[];
  feeders: Feeder[];
  updatedAt: string;
}

/** Design targets for the sizing studies. All optional; see STUDY_DEFAULTS. */
export interface StudySettings {
  pfTarget?: number; // power factor correction target
  futureGrowthPct?: number; // spare capacity added before sizing the transformer
  transformerMaxLoadingPct?: number; // design loading limit for the transformer
  generatorMaxLoadingPct?: number; // design loading limit for the generator
}

export const STUDY_DEFAULTS: Required<StudySettings> = {
  pfTarget: 0.95,
  futureGrowthPct: 20,
  transformerMaxLoadingPct: 80,
  generatorMaxLoadingPct: 80
};

export function newProject(name: string): Project {
  return {
    name,
    voltageV: 415,
    frequencyHz: 50,
    ambientC: 45,
    vdLimitPct: 4,
    boards: [{ id: 'MDB-1', name: 'Main Distribution Board', kind: 'MDB', sourceKva: 1000, sourceImpedancePct: 5, ratedCurrentA: 1600 }],
    feeders: [],
    updatedAt: new Date().toISOString()
  };
}
