import { CURRENT_SCHEMA, newProjectId } from './model/projectMigrate';
export type FeederStatus = 'ok' | 'warn' | 'bad';

export type LoadType = 'general' | 'lighting' | 'sockets' | 'hvac' | 'motor' | 'fire-pump' | 'ev' | 'it' | 'pv' | 'capacitor';

export const LOAD_TYPES: { value: LoadType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'lighting', label: 'Lighting' },
  { value: 'sockets', label: 'Small power / sockets' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'motor', label: 'Motor' },
  { value: 'fire-pump', label: 'Fire pump' },
  { value: 'ev', label: 'EV charging' },
  { value: 'it', label: 'IT / data' },
  { value: 'pv', label: 'Solar PV' },
  { value: 'capacitor', label: 'Capacitor bank' }
];

export type BreakerType = 'B' | 'C' | 'D' | 'MCCB' | 'ACB';

export const BREAKER_TYPES: { value: BreakerType; label: string }[] = [
  { value: 'B', label: 'MCB type B (Im 3–5 In)' },
  { value: 'C', label: 'MCB type C (Im 5–10 In)' },
  { value: 'D', label: 'MCB type D (Im 10–20 In)' },
  { value: 'MCCB', label: 'MCCB (adjustable Im)' },
  { value: 'ACB', label: 'ACB (adjustable Im)' }
];

export type BoardKind = 'MC' | 'MDB' | 'SMDB' | 'DB' | 'MCC' | 'EMDB' | 'UPS';

export const BOARD_KINDS: { value: BoardKind; label: string }[] = [
  { value: 'MC', label: 'Meter cabinet (authority supply)' },
  { value: 'MDB', label: 'Main distribution board' },
  { value: 'SMDB', label: 'Sub-main distribution board' },
  { value: 'DB', label: 'Distribution board' },
  { value: 'MCC', label: 'Motor control centre' },
  { value: 'EMDB', label: 'Emergency distribution board' },
  { value: 'UPS', label: 'UPS output board' }
];

/** Point types from the DEWA load distribution schedule, in form order. */
export type PointType =
  | 'ltg' | 'cfan' | 'exfan' | 'shaver' | 's13' | 'wh' | 'hd' | 'cooker' | 's15' | 'wac' | 'sac' | 'pump' | 'spare1' | 'spare2'
  | 's13t' | 'fcu' | 'spur' | 'isol';

export const POINT_TYPES: { value: PointType; label: string; title: string }[] = [
  { value: 'ltg', label: 'LTG', title: 'Lighting point' },
  { value: 'cfan', label: 'C.FAN', title: 'Ceiling fan' },
  { value: 'exfan', label: 'EX.FAN', title: 'Exhaust fan' },
  { value: 'shaver', label: 'SH.S/O', title: 'Shaver socket-outlet' },
  { value: 's13', label: '13A S/O', title: '13 A socket-outlet' },
  { value: 'wh', label: 'W/H', title: 'Water heater' },
  { value: 'hd', label: 'H/D', title: 'Hand dryer' },
  { value: 'cooker', label: 'COOKER', title: 'Cooker' },
  { value: 's15', label: '15A S/O', title: '15 A socket-outlet' },
  { value: 'wac', label: "'W' A/C", title: 'Window type A/C' },
  { value: 'sac', label: "'S' A/C", title: 'Split type A/C' },
  { value: 'pump', label: 'WAT.PUMP', title: 'Water pump' },
  { value: 'spare1', label: 'OTHER 1', title: 'Other load (spare column)' },
  { value: 'spare2', label: 'OTHER 2', title: 'Other load (spare column)' },
  { value: 's13t', label: '13A T.S/O', title: '13 A twin socket-outlet' },
  { value: 'fcu', label: 'FCU', title: 'Fan coil unit' },
  { value: 'spur', label: 'SPUR O/L', title: 'Fused spur outlet' },
  { value: 'isol', label: 'ISOL', title: 'Isolator (equipment connection)' }
];

/** Point columns of a load schedule form, in order, with the form's own
 * headings. Point types used on a DB but not in its template are still
 * shown (after these), so nothing entered is ever hidden. */
export interface PointTemplate {
  id: string;
  name: string;
  columns: PointType[];
  labels?: Partial<Record<PointType, string>>;
}

export const POINT_TEMPLATES: PointTemplate[] = [
  {
    id: 'dewa-villa',
    name: 'DEWA villa (LTG, EX.FAN … FCU, SPUR, ISOL, OTH)',
    columns: ['ltg', 'exfan', 'shaver', 's13', 's13t', 'wh', 'fcu', 'spur', 'isol', 'cooker', 'sac', 'pump', 'spare1'],
    labels: { s13: '13A S.S/O', sac: 'S A/C', spare1: 'OTH' }
  },
  {
    id: 'dewa-standard',
    name: 'DEWA standard (LTG, C.FAN … W A/C, S A/C, OTHER 1–2)',
    columns: ['ltg', 'cfan', 'exfan', 'shaver', 's13', 'wh', 'hd', 'cooker', 's15', 'wac', 'sac', 'pump', 'spare1', 'spare2']
  }
];

/** Template for projects that don't name one (older projects). */
export const DEFAULT_POINT_TEMPLATE = 'dewa-standard';
/** Template for new projects: the DEWA villa submission form. */
export const NEW_PROJECT_POINT_TEMPLATE = 'dewa-villa';

export const pointTemplateOf = (p: Pick<Project, 'pointTemplate'>): PointTemplate =>
  POINT_TEMPLATES.find((t) => t.id === p.pointTemplate) ?? POINT_TEMPLATES.find((t) => t.id === DEFAULT_POINT_TEMPLATE)!;

/** Watts per point are user input (the schedule's WATT/UNIT row, per DB);
 * nothing is assumed, so a new DB starts at 0 W for every point type. */
export const DEFAULT_POINT_WATTS: Record<PointType, number> = {
  ltg: 0, cfan: 0, exfan: 0, shaver: 0, s13: 0, wh: 0, hd: 0, cooker: 0,
  s15: 0, wac: 0, sac: 0, pump: 0, spare1: 0, spare2: 0, s13t: 0, fcu: 0, spur: 0, isol: 0
};

/** Point types that make a circuit a lighting circuit (if it has only these). */
export const LIGHTING_POINTS: PointType[] = ['ltg', 'cfan', 'exfan'];

/** Motor starter: direct on line, star-delta, soft starter, VFD. */
export type StarterType = 'DOL' | 'SD' | 'SS' | 'VFD';

/** Surge protection device class: Type 1 (lightning current, at the origin),
 * Type 2 (distribution boards), or a combined Type 1+2. */
export type RelayType = 'ELR' | 'EFR' | 'UVR' | 'OVR';
export const RELAY_TYPES: { value: RelayType; label: string }[] = [
  { value: 'ELR', label: 'Earth leakage relay (ELR)' },
  { value: 'EFR', label: 'Earth fault relay (EFR)' },
  { value: 'UVR', label: 'Under-voltage relay (UVR)' },
  { value: 'OVR', label: 'Over-voltage relay (OVR)' }
];
export type SpdType = 'T1' | 'T2' | 'T1+2';
export const SPD_TYPES: { value: SpdType; label: string }[] = [
  { value: 'T1', label: 'Type 1 (lightning current)' },
  { value: 'T2', label: 'Type 2 (overvoltage)' },
  { value: 'T1+2', label: 'Type 1+2 (combined)' }
];
/** Earth leakage sensitivities (mA). */
export const RCD_MA = [10, 30, 100, 300, 500];

/** Switching device column of the connected load / MD form. */
export type IncomerDevice = 'MCCB' | 'MCCB-NA' | 'ISOL' | 'ACB' | 'NONE';
export const INCOMER_DEVICES: { value: IncomerDevice; label: string }[] = [
  { value: 'MCCB', label: 'Breaker (automatic)' },
  { value: 'MCCB-NA', label: 'Non-automatic breaker (isolating, no trip)' },
  { value: 'ISOL', label: 'Isolator (switch-disconnector)' },
  { value: 'ACB', label: 'ACB (withdrawable)' },
  { value: 'NONE', label: 'Not shown' }
];

/** The incomer device drawn on a board: its own setting, else an isolator for a DB (DEWA form) and a
 * non-automatic breaker for larger boards (UAE practice); boards fed straight from the authority supply
 * show that supply's device instead. */
export const incomerDeviceOf = (b: Board): Exclude<IncomerDevice, 'NONE'> | undefined => {
  const d = b.incomerDevice ?? (b.supply ? 'NONE' : b.kind === 'DB' || !b.kind ? 'ISOL' : 'MCCB-NA');
  return d === 'NONE' ? undefined : d;
};

export type SwitchDevice = 'ACB' | 'MCCB' | 'ISOL';
export const SWITCH_DEVICES: SwitchDevice[] = ['ACB', 'MCCB', 'ISOL'];

/** kWh meter types of the form: (1) 1-phase up to 60 A, (2) 3-phase up to
 * 125 A, (3) LV / HV CT metering. */
export type MeterType = '1-PH' | '3-PH' | 'CT';
export const METER_TYPES: MeterType[] = ['1-PH', '3-PH', 'CT'];

export const DEFAULT_CABLE_TYPE = 'XLPE/PVC/SWA';
/** Cable constructions (see model/cableTypes.ts for codes and fire rating). */
export const CABLE_TYPES = ['XLPE/PVC/SWA', 'XLPE/SWA/PVC', 'XLPE/SWA/LSZH', 'XLPE/LSF/SWA', 'XLPE/PVC', 'XLPE 1C', 'PVC/PVC', 'FR BS 8491', 'FR BS 6387 CWZ', 'FR IEC 60331', 'MICC', 'H1Z2Z2-K'];

/** Supply phase of a final circuit; 'RYB' is a 3-phase circuit using all
 * three phases of its way. */
export type Phase = 'R' | 'Y' | 'B' | 'RYB';

export interface Feeder {
  id: string;
  boardId: string;
  name: string;
  loadKw: number;
  demandFactor: number; // 0-1
  powerFactor: number; // 0-1
  lengthM: number;
  cableCsaMm2: number; // conductor cross section, must exist in the cable data
  parallel?: number; // cable runs in parallel (default 1), e.g. 2 × 4C × 240 mm²
  cores: 2 | 3 | 4;
  breakerRatingA: number;
  breakerIcuKa: number; // breaking capacity
  generation?: boolean; // true for PV / generator feeders
  loadType?: LoadType; // drives the diagram icon; defaults to 'general' ('pv' when generation)
  breakerType?: BreakerType; // default: MCB type C up to 63 A, MCCB above
  breakerImMultiple?: number; // MCCB/ACB instantaneous setting as a multiple of In (default 10)
  cpcMm2?: number; // protective (earth) conductor size; default per IEC 60364-5-54 Table 54.2
  componentId?: string; // made from a user component (edits to the component update it)
  componentValues?: Record<string, number>; // this copy's values of the component's inputs
  standbyUnit?: boolean;
  /** Made by Building → Generate DBs (room or unit key); regenerating replaces it. */
  fromRoom?: string; // a standby unit (e.g. standby pump): not in the TCL (duty)
  essential?: boolean; // supplied by the standby generator (fire pump defaults to essential)
  // DB load schedule fields (final circuits entered from the load schedule)
  phase?: Phase; // R / Y / B single-phase circuit, or RYB 3-phase
  way?: number; // DB way number: circuit reference = phase + way, e.g. R3
  room?: string;
  points?: Partial<Record<PointType, number>>; // number of points of each type
  remarks?: string;
  manualSize?: boolean; // MCB / wire / ECC set by hand — don't auto-size on load changes
  starter?: StarterType; // motors: default direct on line
  kvar?: number; // capacitor bank rating (loadType 'capacitor'); its current comes from this, not loadKw
  // Connected load & maximum demand form (authority submission)
  device?: SwitchDevice; // ACB / MCCB / ISOL column; default from the breaker type
  cableType?: string; // e.g. "XLPE/PVC/SWA" (default)
  kwhMeter?: MeterType; // kWh meter on this feeder: 1-PH / 3-PH direct, or CT-operated
  /** What the final circuit supplies, for the earth-fault disconnection time: socket-outlets (any), or
   * fixed equipment only. Unset: socket-outlet points on the circuit say 'sockets'; otherwise unknown,
   * treated as sockets (the stricter case). The load type alone never makes it 'fixed'. */
  circuitPurpose?: 'sockets' | 'fixed';
  rcdMa?: number; // earth leakage protection (RCD / ELCB / RCBO) on this feeder, IΔn in mA
  localIsolator?: boolean; // isolator at the equipment end (e.g. AC unit, pump)
  capSteps?: number; // capacitor bank: number of steps
  detunedPct?: number; // capacitor bank: detuning reactor, % (e.g. 7)
  trayRoute?: string; // cable tray routes the cable runs on, in order, e.g. "A-B-C"
  /** The board was moved to another source: the route changed, so the length needs checking. */
  lengthToCheck?: boolean;
  /** Made as a placeholder (e.g. by Build hierarchy): cable and breaker not sized yet. */
  sizingPending?: boolean;
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
  vectorGroup?: string; // transformer vector group, e.g. "Dyn11" (default)
  // Descriptive / equipment data (all optional, shown in the properties panel)
  kind?: BoardKind;
  ratedCurrentA?: number; // busbar / main device rating, used for board loading
  busbarMaterial?: 'copper' | 'aluminium';
  ipRating?: string;
  location?: string; // room / place, e.g. "Elec. room 3.01" (the level is `level`)
  level?: import('./model/levels').LevelRef; // the floor, from Building information
  manufacturer?: string;
  model?: string;
  /** Standby generator feeding this board through an ATS: everything on
   * and below the board is then essential load for generator sizing. */
  standby?: { kva: number; changeover?: 'ATS' | 'ACB' }; // ACB: mains and generator ACBs, interlocked
  /** Incomer protection and metering drawn on the SLD: CT ratio, long-time
   * setting and protection relays (earth leakage, earth fault, under / over voltage). */
  /** Incomer switching device drawn above the board name box: auto breaker, non-auto breaker (isolating; the default), isolator or ACB. */
  incomerDevice?: IncomerDevice;
  protection?: { ctRatio?: string; irSetting?: number; relays?: RelayType[]; apfc?: boolean };
  /** Ammeter and voltmeter with selector switches and R-Y-B indicating lamps (default: on for main boards). */
  instruments?: boolean;
  /** Main earthing detail on the SLD (default: on for main boards): pits and earth conductor. */
  earthing?: { show?: boolean; pits?: number; conductorMm2?: number; electrodeM?: number; spacingM?: number };
  /** RMU (11 kV ring main unit) feeding this main board's transformer. */
  rmu?: string;
  /** UPS rating for a UPS output board (kind 'UPS'). */
  upsKva?: number;
  /** Surge protection device on the busbar. */
  spd?: SpdType;
  /** Incoming supply of a board fed by the authority (meter cabinet / MDB
   * with no upstream board): the INCOMER row of the connected load form. */
  supply?: {
    fedFrom?: string; // e.g. "DEWA"
    device?: SwitchDevice;
    ratingA?: number;
    faultKa?: number;
    cable?: string; // e.g. "BY DEWA"
    ecc?: string; // e.g. "2X1CX35"
    meter?: MeterType;
    irSetting?: number; // main breaker long-time setting, × In (e.g. 0.85)
    ctRatio?: string; // main meter CT, e.g. "2400/5A" (else from the setting)
  };
  /** Made by Building → Generate DBs: building / floor / unit key. */
  generated?: string;
  /** Enclosure chosen in Design → Enclosure sizing: a frozen copy with the catalogue revision used. */
  enclosure?: import('./calc/enclosure').EnclosureSelection;
  /** Substation this main board's transformer is in (transformer summary form). */
  substation?: string;
  /** Demand factor of this transformer on the summary form (else the project's). */
  mdDemandFactor?: number;
  /** Transformer reference on the summary form, e.g. "SS1-LV-MDB-01" (else the board id). */
  txRef?: string;
  /** Typed on the summary form while nothing is drawn below this board. */
  summaryLoad?: { R: number; Y: number; B: number };
  summaryMeters?: Partial<Record<MeterType, number>>;
  // DB load schedule settings
  pointWatts?: Partial<Record<PointType, number>>; // WATT/UNIT row overrides for this DB
  pointItems?: Partial<Record<PointType, string>>; // library item chosen per column (kept in sync with Loads.xlsx)
  spareNames?: { spare1?: string; spare2?: string }; // headings of the two spare columns
  elcbGroupSize?: 0 | 3 | 6; // circuits per ELCB: 3 = one per way, 6 = one per two ways, 0 = none
  elcbRatingA?: number; // override; default from the group's load
  elcbSensitivityMa?: number; // override; default by circuit type (lighting 100 mA, power 30 mA)
}

export interface Project {
  /** Stable identity: survives renaming, copying elsewhere and moving files (set on first open / creation). */
  id?: string;
  /** File format version (src/model/projectMigrate.ts). Files from a newer app open read-only. */
  schemaVersion?: number;
  createdAt?: string;
  /** Set when the project is archived (kept, hidden from the active list; cleared to restore). */
  archivedAt?: string;
  /** Free labels for finding projects (e.g. "villa", "DEWA", "2026"). */
  tags?: string[];
  /** Notes about the project as a whole (not a design value). */
  notes?: string;
  /** Proposed, reviewed and applied design modifications (Reports → Changes). */
  modifications?: import('./model/designChanges').ModificationRecord[];
  /** Design review comments (Reports → Review). */
  reviewComments?: import('./model/reviewComments').ReviewComment[];
  /** Saved setup of the design review report (sections, names, recorded reviewer decision). */
  reviewReport?: import('./docs/reviewReport').ReviewReportSetup;
  /** Documents received from others (Reports → Received documents). */
  receivedDocs?: import('./model/receivedDocs').ReceivedDoc[];
  /** The issued revision this working draft is measured against (Revisions → Use as baseline). */
  baseline?: import('./model/designBaseline').DesignBaseline;
  /** Who it is for and by whom, what it covers and what is to be delivered (New project wizard). */
  brief?: import('./model/brief').ProjectBrief;
  /** Where this project was copied from (Save as / Duplicate). */
  origin?: { copiedFromId?: string; copiedFromName?: string; copiedAt: string; kind: 'save-as' | 'duplicate' };
  name: string;
  voltageV: number; // phase-phase, e.g. 415
  frequencyHz: number;
  ambientC: number;
  vdLimitPct: number;
  /** Project / authority rule stricter than IEC 60364-4-41: every final circuit up to 63 A disconnects
   * in 0.4 s, fixed equipment too. Shown as an override wherever the required time is shown. */
  strictFinalDisconnection?: boolean;
  /** Panel naming table: prefix per panel role (default the role itself, e.g. EDB). */
  panelPrefixes?: Partial<Record<import('./model/emergency').PanelRole, string>>;
  vdTempC?: number; // conductor temperature for voltage drop (°C); blank = R20 × 1.2
  vdFinalCircuits?: boolean; // voltage drop page: include each DB's worst final circuit // allowable voltage drop, e.g. 4.0 per DEWA/IEC
  vdSelection?: string[]; // feeder ids chosen for the voltage drop calculation
  pointTemplate?: string; // load schedule point columns (POINT_TEMPLATES id)
  info?: ProjectInfo; // header data of the authority submission forms
  revisions?: Revision[]; // issued revisions, oldest first (A, B, C…)
  drawing?: DrawingInfo; // SLD drawing title block
  ties?: BusTie[]; // normally-open bus couplers between main boards
  earthingPlan?: EarthingPlan; // earthing schematic: pits per equipment, links, measured values
  earthPitIds?: Record<string, string[]>; // persistent pit IDs; retired slots stay reserved
  spacePlan?: SpacePlan; // areas → panels → transformers → RMUs (power density planning)
  upsSystems?: import('./calc/ups').UpsSystem[]; // UPS and battery sizing
  feederPresets?: import('./model/presets').FeederPreset[]; // copy of the user's feeder presets, so they travel with the project
  pv?: import('./calc/solar').PvSystem; // solar PV array and inverter sizing
  trays?: TrayPlan; // cable tray routes (A, B, C…) with the cables on each and the tray size
  substations?: DmSubstationRoom[]; // DM-D-013 minimum substation / LV room areas
  studyReport?: StudyReportSetup; // the study report being prepared (Reports → Study reports)
  studyReportPresets?: StudyReportPreset[]; // saved scopes / study sets for repeat submissions
  calc?: { autoRun?: boolean }; // run the network studies on every change (default: on Run / F5 only)
  studySettings?: StudySettings;
  /** Project standards and specifications listed in the design report (Codes and standards). Never assumed when empty. */
  standards?: string[];
  /** People, dates and your own values used as {Name} in title blocks, notes and labels. */
  params?: ProjectParams;
  /** Title block templates (the SLD sheet uses drawing.titleTemplateId). */
  titleTemplates?: import('./model/titleBlock').TitleTemplate[];
  /** The SLD as a set of drawing sheets (Reports → Drawing set). */
  drawingSet?: import('./model/drawingSet').DrawingSet;
  cableRefs?: import('./model/cableRefs').CableRef[]; // the project's own cable reference numbers (after the standard list)
  /** Your own equipment, with parameters and formulas (palette → My components). */
  components?: import('./model/components').UserComponent[];
  building?: BuildingInfo; // architectural information: buildings, levels, rooms, room types
  boq?: import('./model/priceList').BoqCustom; // manual BOQ lines, your sections, quantity changes, wastage
  priceList?: import('./model/priceList').PriceList;
  pfcCalc?: import('./calc/pfcCalc').PfcCalcInput;
  containmentCalc?: import('./calc/containment').ContainmentInput; // custom tray / trunking / conduit / buried calculation // standalone power factor calculator (existing installation) // rates used for this project's BOQ (a copy)
  busRisers?: import('./calc/busbar').BusRiser[]; // busbar trunking risers (high-rise)
  busbarData?: import('./calc/busbar').BusbarData; // manufacturer busway data (typical when absent)
  txGen?: Partial<import('./calc/txGen').TxGenPlan>; // transformer & generator sizing choices
  pfc?: Partial<import('./calc/pfc').PfcPlan>; // power factor correction: strategy, boards, bank design
  status?: ProjectStatus; // where the job is (projects dashboard)
  createdBy?: string;
  updatedBy?: string; // who saved it last (the user profile's name)
  boards: Board[];
  feeders: Feeder[];
  updatedAt: string;
}

export type ProjectStatus = 'design' | 'review' | 'submitted' | 'comments' | 'approved' | 'ifc' | 'hold' | 'completed';
export const PROJECT_STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'design', label: 'Design' },
  { value: 'review', label: 'Internal review' },
  { value: 'submitted', label: 'Submitted (DEWA / DM)' },
  { value: 'comments', label: 'Comments to address' },
  { value: 'approved', label: 'Approved' },
  { value: 'ifc', label: 'Issued for construction' },
  { value: 'hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' }
];

/** Architectural information, entered once and used by the calculations:
 * buildings with their levels (typical floors repeated), the rooms on each
 * level with their type and area, and the DB that serves them. */
export type LevelKind = 'basement' | 'ground' | 'podium' | 'typical' | 'roof' | 'other';

export interface BuildingLevel {
  id: string;
  name: string; // e.g. "L1–L20 (typical)"
  kind: LevelKind;
  heightM: number; // floor to floor
  grossM2?: number; // gross floor area of one floor
  count?: number; // identical floors (typical), default 1
  /** Flats / tenants on each of these floors: unit type and how many per floor. */
  units?: { unitTypeId: string; count: number }[];
}

export interface ProjectBuilding {
  id: string;
  name: string; // e.g. "Tower A"
  use?: string; // e.g. "Residential tower"
  plotAreaM2?: number;
  buaM2?: number; // built-up area (DEWA forms); the GFA when absent
  gfaM2?: number; // typed in; else the sum of the levels
  levels: BuildingLevel[]; // bottom to top
  /** Riser: where the DBs are fed from and the cable route, for the incomer lengths. */
  riser?: { fromBoardId?: string; horizontalM?: number; perDbM?: number };
}

export interface RoomType {
  id: string;
  label: string;
  wPerM2: number; // connected load density
  demandFactor: number;
  lux?: number;
  /** How the load schedule is generated for rooms of this type. */
  rules?: RoomRules;
  /** Lighting power density limit (W/m²), e.g. ASHRAE 90.1 — flagged when exceeded. */
  lpdMax?: number;
  /** Typical total W/m² (density check benchmark). */
  benchWPerM2?: number;
}

/** Generation rules of a room type: points from the area, fixed points per room. */
export interface RoomRules {
  ltgM2PerPoint?: number; // one lighting point per … m²
  s13M2PerPoint?: number; // one 13 A socket per … m²
  acM2PerUnit?: number; // one split A/C per … m² (0 = none)
  acKwPerUnit?: number; // electrical kW of each A/C unit
  wh?: number; // water heaters per room
  cooker?: number;
  exfan?: number; // exhaust fans per room
}

/** A flat / tenant layout, placed on levels as many times as needed. */
export interface UnitType {
  id: string;
  name: string; // e.g. "2BR apartment"
  rooms: { name: string; type: string; areaM2: number }[];
  meter?: MeterType; // kWh meter on the unit's incomer (default by size)
}

export interface BuildingRoom {
  id: string;
  buildingId: string;
  levelId: string;
  name: string;
  type: string; // RoomType id
  areaM2: number;
  count?: number; // identical rooms on the level (e.g. 8 × 2BR apartments)
  boardId?: string; // the DB that serves it
}

export interface BuildingInfo {
  buildings: ProjectBuilding[];
  rooms: BuildingRoom[];
  roomTypes?: RoomType[]; // the project's copy; defaults when absent
  unitTypes?: UnitType[];
}

export interface ProjectParams {
  designedBy?: string;
  drawnBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  submissionDate?: string;
  authorityRef?: string; // e.g. DEWA reference
  discipline?: string;
  custom?: { name: string; value: string }[];
}

/** Space planning (power density): areas are fed from panels, panels
 * from transformers (or a parent panel), transformers from RMUs. */
export interface SpaceUse {
  id: string;
  label: string;
  wPerM2: number;
  demandFactor: number;
}

export interface SpaceArea {
  id: string;
  building: string;
  floor?: string;
  level?: import('./model/levels').LevelRef; // linked to Building information (floor/building follow it)
  name: string;
  use: string; // SpaceUse id
  areaM2?: number;
  wPerM2?: number; // overrides the use's W/m²
  kw?: number; // specific load (chiller, lift…) instead of area × W/m²
  demandFactor?: number; // overrides the use's
  panel?: string; // PlanPanel id
}

export interface PlanPanel {
  id: string;
  building: string;
  kind: 'MDB' | 'SMDB';
  location?: string;
  transformer?: string; // MDB: PlanTransformer id
  parent?: string; // SMDB: panel id
}

export interface PlanTransformer {
  id: string;
  kva: number;
  rmu?: string;
}

export interface SpacePlanSettings {
  /** Transformer size: 1000, 1500, or 0 = the one giving fewer units. */
  transformerKva: number;
  maxLoadingPct: number;
  maxTransformersPerRmu: number;
  powerFactor: number;
  growthPct: number;
}

export interface SpacePlan {
  areas: SpaceArea[];
  panels: PlanPanel[];
  transformers: PlanTransformer[];
  settings: SpacePlanSettings;
  /** Use types with W/m² and demand factor; defaults when absent. */
  uses?: SpaceUse[];
}

/** A substation sized to Dubai Municipality form DM-D-013. */
export interface DmSubstationRoom {
  id: string;
  name: string; // e.g. "SS-1" or the RMU name
  type: import('./calc/dmSubstation').DmSubstationType;
  transformers: number;
  kva?: number; // transformer rating, for reference
  building?: string;
  remarks?: string; // consultant / contractor remarks on the form
}

/** A submission report for chosen studies on chosen boards. */
export type StudyReportKind = 'load' | 'dist' | 'sc' | 'lf' | 'cable' | 'earth' | 'disc' | 'phase' | 'sizing' | 'pfc' | 'busbar' | 'schedules';

export interface StudyReportSetup {
  boards: string[]; // selected boards
  /** Whole installation, or only the selected boards (none ticked = nothing,
   * never a silent switch to everything). Older reports: all when no boards. */
  mode?: 'all' | 'selected';
  downstream: boolean; // include everything below the selected boards
  studies: StudyReportKind[];
  sld: boolean; // an SLD of the scope with each study's results
  separate: boolean; // one PDF per study
  title?: string;
  docNo?: string;
  projectNo?: string;
  preparedBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  issueStatus?: ReportIssueStatus;
  /** Executive summary and design basis sections before the studies (default on). */
  designBasis?: boolean;
  /** Results and compliance summaries after the studies (default on). */
  resultsSummary?: boolean;
  /** The report type last chosen (docs/reportTypes.ts); the setup may since have been customised. */
  reportType?: import('./docs/reportTypes').ReportType;
}

/** Issue status printed on the design report cover and document control. */
export type ReportIssueStatus = 'For information' | 'For review' | 'For approval' | 'For construction' | 'As built';

export interface StudyReportPreset extends StudyReportSetup {
  id: string;
  name: string;
}

/** Cable tray sizing. Each route (A, B, C…) carries cables from one or
 * more panels; the tray width comes from the cables' outer diameters,
 * spacing (or fill %) and spare capacity. Blank route settings use the
 * plan defaults. */
export type TrayMethod = 'spacing' | 'fill';
/** Clearance between cables: touching, a fraction / multiple of the
 * larger cable's diameter, or a fixed distance in mm. */
export type TraySpacing = 'touching' | 'quarter' | 'half' | 'one' | 'two' | 'mm';

export interface TrayCable {
  id: string;
  /** A cable of the SLD: size, from and to follow the design, and the
   * feeder's trayRoute says which routes it is on — this entry only holds
   * overrides (qty, OD) for this route. */
  feederId?: string;
  // Manual cable (not on the SLD), or overrides of a feeder's text:
  from?: string;
  to?: string;
  cores?: number; // 1–4
  csaMm2?: number;
  qty?: number; // number of cables (feeders: parallel runs)
  odMm?: number; // outer diameter override
  kgPerM?: number; // weight override
}

export interface TrayRoute {
  id: string;
  name: string; // "A", "B"…
  from?: string; // where the route starts, e.g. "Substation"
  to?: string; // where it ends, e.g. "Block A riser"
  lengthM?: number;
  cables: TrayCable[];
  // Blank = the plan default
  method?: TrayMethod;
  spacing?: TraySpacing;
  spacingMm?: number;
  sparePct?: number;
  fillPct?: number;
  depthMm?: number;
  /** Chosen tray, instead of the automatic one. */
  widthMm?: number;
  tiers?: number;
  /** Fittings on the route (per tier), for the tray BOQ. */
  fittings?: { bends?: number; tees?: number; reducers?: number; risers?: number };
}

export interface TraySettings {
  method: TrayMethod;
  spacing: TraySpacing;
  spacingMm: number;
  sparePct: number;
  fillPct: number; // fill method: cable area / tray area limit
  depthMm: number; // side height
  widths: number[]; // standard widths, mm
  maxWidthMm: number; // wider than this → more tiers
  includeEcc: boolean; // separate 1C earth cable with each feeder
  trayType: string; // e.g. "Perforated tray", "Cable ladder"
  /** Construction, for the grouping factors (IEC 60364-5-52 Table B.52.20). */
  kind?: 'perforated' | 'ladder';
  /** Derate the cables on each route for grouping (default on). */
  applyGrouping?: boolean;
  supportSpacingM?: number; // tray supports, default 1.5 m
  lengthM?: number; // standard tray length (joints / coupler sets), default 3 m
  covers?: boolean; // tray covers on every route
}

/** Cable outer diameter and weight by cores × size. */
export interface CableOd {
  cores: number;
  csaMm2: number;
  odMm: number;
  kgPerM: number;
  bendMm?: number; // minimum bending radius, when the brand gives it
}

export interface TrayPlan {
  routes: TrayRoute[];
  settings: TraySettings;
  /** Cable brand for the diameters (default DUCAB). */
  brand?: string;
  /** Your own edited cable data; the brand's when absent. */
  ods?: CableOd[];
}

/** Normally-open bus coupler (tie breaker) between two main boards: closed
 * when one of their transformers is out, so the other carries both. */
/** Earthing schematic settings. The layout itself is worked out from the transformers, RMUs and main boards. */
export interface EarthingPlan {
  /** Pits per equipment key (rmu:…, txn:…, txb:…, lv:…), where the user changed the default. */
  pits?: Record<string, number>;
  /** Equipment whose pits are NOT linked to the others of the same kind. */
  unlinked?: string[];
  /** Measured resistance per pit (Ω), from site tests. */
  measured?: Record<string, number>;
  electrodeM?: number; // electrode length (m), default 3
  conductorMm2?: number; // pit link / earth conductor (mm² Cu), default 70
  /** Metal parts bonded to each main earth bar (shown on the schematic); default room earth bar, containment, pipework, ductwork. */
  bonding?: string[];
}

export interface BusTie {
  id: string;
  a: string; // board ids
  b: string;
  ratingA: number;
}

/** Title block of the SLD drawing. */
export interface DrawingInfo {
  company?: string;
  title?: string; // default "SINGLE LINE DIAGRAM"
  number?: string; // drawing no.
  drawnBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  sheet?: 'A4' | 'A3' | 'A2' | 'A1';
  symbols?: 'iec' | 'simple'; // IEC 60617 symbols (default) or simple icons
  cableLabels?: 'auto' | 'ref' | 'full'; // SLD cable text: auto = reference numbers when the sheet is crowded
  legend?: boolean; // symbol legend on the drawing sheets and SLD exports, not the design canvas (default on with IEC symbols)
  logo?: string; // company logo (data: URL) in the title block and on report covers
  titleTemplateId?: string; // a custom title block (else the standard one)
  notes?: string[]; // text notes on the SLD sheet; {Parameters} are filled in
  abbreviations?: boolean;
  sldStyle?: 'standard' | 'dewa'; // default DEWA submission style (blank or 'dewa'): panel frames, summary boxes (LOC, TCL, DF, MDL), DEWA wording // abbreviations table on the sheets (default on)
}

/** An issued revision: a frozen copy of the design (without the revision
 * history), with when, what and who. */
export interface Revision {
  id: string; // "A", "B", …
  date: string; // YYYY-MM-DD
  description: string;
  by?: string;
  snapshot: Omit<Project, 'revisions'>;
}

/** Header / footer fields of the DEWA submission forms. All optional. */
export interface ProjectInfo {
  owner?: string;
  consultant?: string;
  contractor?: string; // consultant / contractor line of the form footer
  tel?: string;
  fax?: string;
  plotNo?: string;
  area?: string; // e.g. "VILLA, UAE"
  plannedCompletion?: string;
  builtUpAreaM2?: number;
  /** Demand factor for maximum demand on the connected load / MD forms. */
  mdDemandFactor?: number;
}

/** Design targets for the sizing studies. All optional; see STUDY_DEFAULTS. */
export interface StudySettings {
  pfTarget?: number; // power factor correction target
  futureGrowthPct?: number; // spare capacity added before sizing the transformer
  transformerMaxLoadingPct?: number; // design loading limit for the transformer
  generatorMaxLoadingPct?: number; // design loading limit for the generator
  // DB load schedule defaults, by circuit type
  minWireLightingMm2?: number;
  minWirePowerMm2?: number;
  elcbLightingMa?: number;
  elcbPowerMa?: number;
}

export const STUDY_DEFAULTS: Required<StudySettings> = {
  pfTarget: 0.95,
  futureGrowthPct: 20,
  transformerMaxLoadingPct: 80,
  generatorMaxLoadingPct: 80,
  minWireLightingMm2: 2.5,
  minWirePowerMm2: 4,
  elcbLightingMa: 100,
  elcbPowerMa: 30
};

export const settingsOf = (p: Project): Required<StudySettings> => ({ ...STUDY_DEFAULTS, ...p.studySettings });

export function newProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    id: newProjectId(),
    schemaVersion: CURRENT_SCHEMA,
    createdAt: now,
    name,
    voltageV: 415,
    frequencyHz: 50,
    ambientC: 45,
    vdLimitPct: 4,
    pointTemplate: NEW_PROJECT_POINT_TEMPLATE,
    info: { mdDemandFactor: 0.8 },
    boards: [{ id: 'MDB-1', name: 'Main Distribution Board', kind: 'MDB', sourceKva: 1000, sourceImpedancePct: 5, ratedCurrentA: 1600 }],
    feeders: [],
    updatedAt: new Date().toISOString()
  };
}
