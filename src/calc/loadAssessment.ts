import type { Project } from '../types';
import { catalog } from '../database/catalog';
import { buildingInfoOf, summarizeBuilding } from './building';

/** Early-stage load assessment: building type → area schedule (W/m² per
 * space) → service requirements → maximum demand, transformers and the
 * standby generator. Everything is editable: the space mix, the densities,
 * the service factors, each category's diversity and the supply rules.
 * Your own figures are kept as a library on this computer ("Save as my
 * type" / "Save as my library"); the built-in values are PLACEHOLDERS. */

export type CoolSystem = 'none' | 'split' | 'vrf' | 'chw' | 'wcc' | 'dc';
export type DhwSystem = 'none' | 'local' | 'elec' | 'central' | 'solar';
export type CategoryKey = 'ltg' | 'pwr' | 'hvac' | 'dhw' | 'cook' | 'lift' | 'pump' | 'ev' | 'spec';

export const COOL_SYSTEMS: { value: CoolSystem; label: string }[] = [
  { value: 'none', label: 'No mechanical cooling' },
  { value: 'split', label: 'Split units' },
  { value: 'vrf', label: 'VRF / VRV' },
  { value: 'chw', label: 'Chilled water — air-cooled chiller' },
  { value: 'wcc', label: 'Chilled water — water-cooled chiller' },
  { value: 'dc', label: 'District cooling (FCU / AHU + pumps only)' }
];
export const DHW_SYSTEMS: { value: DhwSystem; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'local', label: 'Local point heaters' },
  { value: 'elec', label: 'Electric heater per unit' },
  { value: 'central', label: 'Central plant (electric)' },
  { value: 'solar', label: 'Solar + electric backup' }
];

/** A space in the area schedule: its share of the GFA (or m²) and densities. */
export interface LaSpace {
  id: string;
  label: string;
  ltg: number; // lighting W/m²
  pwr: number; // small power W/m²
  clg: number; // cooling W/m² (thermal)
  dwelling?: boolean; // counts for water heating and cooking
}
export interface LaRow extends LaSpace { pct?: number; areaM2?: number }

export interface LaServices {
  cool: CoolSystem;
  dhw: DhwSystem;
  cook: 'none' | 'elec';
  lifts: 'none' | 'auto' | 'custom';
  liftCount?: number;
  fire: boolean;
  evPct: number; // % of parking bays with chargers
  itKw: number;
  pool: boolean;
  kitchen: boolean;
  laundry: boolean;
  medical: boolean;
  facade: boolean;
}

/** How each service turns into kW. */
export interface LaFactors {
  cool: Record<CoolSystem, number>; // kW electrical per kW thermal
  dhw: Record<DhwSystem, number>; // W/m² (dwelling areas; point heaters: whole GFA)
  cook: number; // W/m² of dwelling areas
  liftKw: number; // each, up to 12 floors
  liftKwHigh: number; // each, above 12 floors
  floorsPerLift: number;
  evKw: number; // per charger
  m2PerBay: number;
  carParkLtg: number; // W/m² of car park
  carParkFanKwPerM2: number;
  boosterKw: number; // duty pumps (2 sets)
  transferKw: number;
  poolKw: number;
  kitchen: number; // W/m² of GFA
  laundry: number;
  medical: number;
  facadeKwPerFloor: number;
  firePumpKw: number;
  jockeyKw: number;
  stairFanKw: number;
}

export type LaDiversity = Record<CategoryKey, number>;

export interface LaCustomLoad { id: string; label: string; qty: number; kw: number; diversity: number; onGenerator: boolean }

export interface LaSupply {
  coincidence: number;
  pf: number;
  voltage: number;
  maxLoadingPct: number;
  maxTxKva: number;
  redundancy: 'N' | 'N+1';
  genMargin: number;
  sparePct: number;
  txSizes?: number[]; // blank: the Transformers catalogue, else standard sizes
}

/** A building type: the starting point of an assessment. */
export interface LaBuildingType {
  id: string;
  label: string;
  rows: LaRow[]; // pct of GFA
  vaBand: [number, number]; // typical VA/m² of GFA
  essentialPct: number; // share of HVAC and special services on the generator
  services: LaServices;
  diversity?: Partial<LaDiversity>;
  mine?: boolean; // saved by you
}

/** The project's assessment (a full copy — library changes never move it). */
export interface LoadAssessment {
  typeId: string;
  typeLabel: string;
  vaBand: [number, number];
  essentialPct: number;
  gfaM2: number;
  floors: number;
  parkingM2: number;
  areaMode: 'pct' | 'm2';
  rows: LaRow[];
  services: LaServices;
  factors: LaFactors;
  diversity: LaDiversity;
  custom: LaCustomLoad[];
  supply: LaSupply;
  /** Printed as a section of the Design Basis report. */
  inReport?: boolean;
}

// ---- PLACEHOLDER library — not authority figures; replace with yours.

export const DEFAULT_SPACES: LaSpace[] = [
  { id: 'apt', label: 'Apartment', ltg: 8, pwr: 35, clg: 110, dwelling: true },
  { id: 'villa', label: 'Villa', ltg: 8, pwr: 35, clg: 110, dwelling: true },
  { id: 'office', label: 'Office', ltg: 9, pwr: 25, clg: 130 },
  { id: 'retail', label: 'Retail / shop', ltg: 15, pwr: 20, clg: 160 },
  { id: 'fnb', label: 'F&B / restaurant', ltg: 12, pwr: 60, clg: 200 },
  { id: 'hotel', label: 'Hotel room', ltg: 8, pwr: 20, clg: 110, dwelling: true },
  { id: 'lobby', label: 'Lobby / corridor', ltg: 6, pwr: 5, clg: 80 },
  { id: 'gym', label: 'Gym / amenity', ltg: 10, pwr: 20, clg: 150 },
  { id: 'plant', label: 'Plant / electrical', ltg: 5, pwr: 10, clg: 0 },
  { id: 'ward', label: 'Ward / patient room', ltg: 9, pwr: 30, clg: 140, dwelling: true },
  { id: 'theatre', label: 'Operating / ICU', ltg: 20, pwr: 120, clg: 250 },
  { id: 'class', label: 'Classroom', ltg: 9, pwr: 10, clg: 120 },
  { id: 'store', label: 'Warehouse / store', ltg: 5, pwr: 5, clg: 0 },
  { id: 'bo', label: 'Back of house', ltg: 7, pwr: 25, clg: 90 }
];

export const DEFAULT_FACTORS: LaFactors = {
  cool: { none: 0, split: 0.33, vrf: 0.3, chw: 0.36, wcc: 0.25, dc: 0.08 },
  dhw: { none: 0, local: 4, elec: 15, central: 12, solar: 5 },
  cook: 18, liftKw: 15, liftKwHigh: 22, floorsPerLift: 4, evKw: 7.4, m2PerBay: 25, carParkLtg: 3, carParkFanKwPerM2: 0.006,
  boosterKw: 7.5, transferKw: 5.5, poolKw: 15, kitchen: 12, laundry: 6, medical: 20, facadeKwPerFloor: 2,
  firePumpKw: 55, jockeyKw: 3, stairFanKw: 7.5
};

export const DEFAULT_DIVERSITY: LaDiversity = { ltg: 0.9, pwr: 0.5, hvac: 0.85, dhw: 0.35, cook: 0.3, lift: 0.6, pump: 0.7, ev: 0.6, spec: 0.7 };

export const DEFAULT_SUPPLY: LaSupply = { coincidence: 0.9, pf: 0.9, voltage: 400, maxLoadingPct: 80, maxTxKva: 1500, redundancy: 'N', genMargin: 1.25, sparePct: 0 };

export const STANDARD_TX_KVA = [500, 630, 800, 1000, 1250, 1500, 2000, 2500];
export const STANDARD_GEN_KVA = [100, 200, 250, 350, 500, 750, 1000, 1250, 1500, 2000, 2500];

const sp = (id: string, pct: number): LaRow => ({ ...DEFAULT_SPACES.find((s) => s.id === id)!, pct });
const svc = (s: Partial<LaServices>): LaServices => ({ cool: 'vrf', dhw: 'local', cook: 'none', lifts: 'auto', fire: true, evPct: 0, itKw: 0, pool: false, kitchen: false, laundry: false, medical: false, facade: false, ...s });

export const DEFAULT_TYPES: LaBuildingType[] = [
  { id: 'res', label: 'Residential tower', rows: [sp('apt', 78), sp('lobby', 10), sp('gym', 3), sp('retail', 4), sp('plant', 5)], vaBand: [50, 90], essentialPct: 15,
    services: svc({ dhw: 'elec', cook: 'elec', evPct: 10, pool: true, facade: true }) },
  { id: 'villa', label: 'Villa compound', rows: [sp('villa', 92), sp('lobby', 2), sp('gym', 3), sp('plant', 3)], vaBand: [60, 110], essentialPct: 5,
    services: svc({ cool: 'split', dhw: 'elec', cook: 'elec', lifts: 'none', fire: false, evPct: 20, pool: true }) },
  { id: 'office', label: 'Office', rows: [sp('office', 75), sp('lobby', 12), sp('retail', 5), sp('plant', 8)], vaBand: [70, 120], essentialPct: 20, diversity: { pwr: 0.6 },
    services: svc({ cool: 'chw', evPct: 10, itKw: 20, facade: true }) },
  { id: 'mall', label: 'Retail mall', rows: [sp('retail', 62), sp('fnb', 12), sp('lobby', 18), sp('bo', 3), sp('plant', 5)], vaBand: [110, 180], essentialPct: 15, diversity: { ltg: 1, pwr: 0.7 },
    services: svc({ cool: 'chw', cook: 'elec', evPct: 5, kitchen: true, facade: true }) },
  { id: 'hotel', label: 'Hotel', rows: [sp('hotel', 58), sp('lobby', 14), sp('fnb', 8), sp('gym', 4), sp('bo', 10), sp('plant', 6)], vaBand: [80, 130], essentialPct: 30,
    services: svc({ cool: 'chw', dhw: 'central', cook: 'elec', evPct: 5, itKw: 10, pool: true, kitchen: true, laundry: true, facade: true }) },
  { id: 'hosp', label: 'Hospital', rows: [sp('ward', 45), sp('theatre', 10), sp('office', 12), sp('lobby', 18), sp('bo', 8), sp('plant', 7)], vaBand: [120, 200], essentialPct: 60, diversity: { pwr: 0.7, hvac: 0.9 },
    services: svc({ cool: 'chw', dhw: 'central', cook: 'elec', evPct: 5, itKw: 30, kitchen: true, laundry: true, medical: true }) },
  { id: 'school', label: 'School', rows: [sp('class', 60), sp('office', 10), sp('lobby', 18), sp('gym', 7), sp('plant', 5)], vaBand: [40, 80], essentialPct: 10,
    services: svc({ cook: 'elec', itKw: 10, kitchen: true }) },
  { id: 'wh', label: 'Warehouse', rows: [sp('store', 85), sp('office', 10), sp('plant', 5)], vaBand: [15, 40], essentialPct: 10,
    services: svc({ cool: 'none', lifts: 'none', evPct: 10 }) }
];

// ---- Your library (this computer)

export interface LaLibrary { types: LaBuildingType[]; spaces?: LaSpace[]; factors?: LaFactors; diversity?: LaDiversity; supply?: LaSupply }
const LIB_KEY = 'lvds.loadAssessmentLibrary';

export function loadLaLibrary(): LaLibrary {
  try {
    const v = JSON.parse(localStorage.getItem(LIB_KEY) ?? 'null');
    return v && Array.isArray(v.types) ? v : { types: [] };
  } catch { return { types: [] }; }
}
export function saveLaLibrary(lib: LaLibrary): boolean {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); return true; } catch { return false; }
}

/** Building types offered: the placeholders with your own types over them (same id) and after them. */
export function laTypes(lib: LaLibrary = loadLaLibrary()): LaBuildingType[] {
  const mine = new Map(lib.types.map((t) => [t.id, t]));
  return [...DEFAULT_TYPES.map((t) => mine.get(t.id) ?? t), ...lib.types.filter((t) => !DEFAULT_TYPES.some((d) => d.id === t.id))];
}
export const laSpaces = (lib: LaLibrary = loadLaLibrary()): LaSpace[] => lib.spaces?.length ? lib.spaces : DEFAULT_SPACES;
export const laFactors = (lib: LaLibrary = loadLaLibrary()): LaFactors => ({ ...DEFAULT_FACTORS, ...lib.factors, cool: { ...DEFAULT_FACTORS.cool, ...lib.factors?.cool }, dhw: { ...DEFAULT_FACTORS.dhw, ...lib.factors?.dhw } });

/** Saves the assessment's current set-up as one of your building types. */
export function typeFromAssessment(a: LoadAssessment, id: string, label: string): LaBuildingType {
  const g = a.gfaM2 || 1;
  return {
    id, label, mine: true, vaBand: [...a.vaBand], essentialPct: a.essentialPct, services: { ...a.services }, diversity: { ...a.diversity },
    rows: a.rows.map((r) => ({ ...r, pct: rowPct(a, r, g), areaM2: undefined }))
  };
}

// ---- Starting an assessment

/** GFA above ground, floors above ground and car park area from the project's first building. */
export function buildingFigures(project: Project): { gfaM2?: number; floors?: number; parkingM2?: number } {
  const info = buildingInfoOf(project);
  const b = info.buildings[0];
  if (!b) return {};
  const s = summarizeBuilding(info, b);
  const above = s.levels.filter((l) => l.level.kind !== 'basement').reduce((a, l) => a + (l.level.grossM2 ?? 0) * l.count, 0);
  const parkingM2 = info.rooms.filter((r) => r.buildingId === b.id && r.type === 'parking').reduce((a, r) => a + r.areaM2 * (r.count ?? 1), 0);
  return { gfaM2: above || s.gfaM2 || undefined, floors: s.aboveGround || undefined, parkingM2: parkingM2 || undefined };
}

export function newAssessment(t: LaBuildingType, base: Partial<LoadAssessment> = {}, lib: LaLibrary = loadLaLibrary()): LoadAssessment {
  return {
    gfaM2: 24000, floors: 20, parkingM2: 8000, supply: { ...DEFAULT_SUPPLY, ...lib.supply }, custom: [],
    ...base,
    typeId: t.id, typeLabel: t.label, vaBand: [...t.vaBand], essentialPct: t.essentialPct, areaMode: 'pct',
    rows: t.rows.map((r) => ({ ...r })), services: { ...t.services },
    factors: laFactors(lib), diversity: { ...DEFAULT_DIVERSITY, ...lib.diversity, ...t.diversity }
  };
}

/** The assessment's area schedule from the Building rooms (m² per room type, above ground). */
export function rowsFromRooms(project: Project, spaces: LaSpace[] = laSpaces()): LaRow[] {
  const info = buildingInfoOf(project);
  const b = info.buildings[0];
  if (!b) return [];
  const below = new Set(b.levels.filter((l) => l.kind === 'basement').map((l) => l.id));
  const s = summarizeBuilding(info, b);
  const levelCount = new Map(s.levels.map((l) => [l.level.id, l.count]));
  const types = new Map((info.roomTypes ?? catalog().roomTypes).map((t) => [t.id, t]));
  const byType = new Map<string, number>();
  for (const r of info.rooms) {
    if (r.buildingId !== b.id || below.has(r.levelId) || r.type === 'parking') continue;
    byType.set(r.type, (byType.get(r.type) ?? 0) + r.areaM2 * (r.count ?? 1) * (levelCount.get(r.levelId) ?? 1));
  }
  return [...byType].map(([type, areaM2]) => {
    const known = spaces.find((x) => x.id === type || x.label.toLowerCase() === (types.get(type)?.label ?? type).toLowerCase());
    if (known) return { ...known, areaM2: Math.round(areaM2) };
    const rt = types.get(type);
    const w = rt?.wPerM2 ?? 30;
    // Unknown space: the room type's W/m² split into lighting and power — review the cooling.
    return { id: type, label: rt?.label ?? type, ltg: Math.min(10, Math.round(w * 0.2)), pwr: Math.round(w * 0.8), clg: 100, areaM2: Math.round(areaM2) };
  });
}

// ---- The calculation

export const rowPct = (a: LoadAssessment, r: LaRow, gfa = a.gfaM2): number => (a.areaMode === 'pct' ? r.pct ?? 0 : gfa ? ((r.areaM2 ?? 0) / gfa) * 100 : 0);
export const rowArea = (a: LoadAssessment, r: LaRow): number => (a.areaMode === 'pct' ? (a.gfaM2 * (r.pct ?? 0)) / 100 : r.areaM2 ?? 0);

/** Switches between % of GFA and m², keeping each row's area. */
export function setAreaMode(a: LoadAssessment, mode: 'pct' | 'm2'): LoadAssessment {
  if (mode === a.areaMode) return a;
  return { ...a, areaMode: mode, rows: a.rows.map((r) => (mode === 'm2' ? { ...r, areaM2: Math.round(rowArea(a, r)), pct: undefined } : { ...r, pct: +rowPct(a, r).toFixed(2), areaM2: undefined })) };
}

export interface LaCategory {
  key: string; // a CategoryKey, 'life', or 'custom:<id>'
  label: string;
  connectedKw: number;
  diversity: number; // 0 = not in the normal MD (generator only)
  demandKw: number;
  generatorShare: number; // share of it on the standby generator
  editable: boolean; // diversity editable in the table
}

export interface LaResult {
  areaM2: number; // rows total
  pctTotal: number;
  dwellingM2: number;
  services: Record<string, number>; // kW per service, for the service cards
  liftCount: number;
  categories: LaCategory[];
  connectedKw: number;
  sumDemandKw: number;
  mdKw: number;
  mdKva: number;
  vaPerM2: number;
  inBand: boolean;
  tx?: { count: number; kva: number; duty: number }; // count includes the N+1 unit
  txSizes: number[];
  generatorKw: number; // essential demand
  generatorKvaRequired: number;
  generatorKva?: number;
  generatorCount: number;
  incomerA?: number;
}

const txSizesOf = (s: LaSupply): number[] => {
  const own = s.txSizes?.filter((x) => x > 0);
  const cat = catalog().transformers.map((t) => t.kva).filter((x) => x > 0);
  return [...new Set(own?.length ? own : cat.length ? cat : STANDARD_TX_KVA)].sort((a, b) => a - b);
};
const genSizes = (): number[] => {
  const cat = catalog().generators.map((g) => g.kva).filter((x) => x > 0);
  return [...new Set(cat.length ? cat : STANDARD_GEN_KVA)].sort((a, b) => a - b);
};

export function assess(a: LoadAssessment): LaResult {
  const f = a.factors, s = a.services, d = a.diversity, ess = a.essentialPct / 100;
  const floors = Math.max(1, a.floors || 1), park = Math.max(0, a.parkingM2 || 0), gfa = Math.max(0, a.gfaM2 || 0);
  let ltg = 0, pwr = 0, clg = 0, area = 0, pct = 0, dwell = 0;
  for (const r of a.rows) {
    const m2 = rowArea(a, r);
    area += m2; pct += rowPct(a, r);
    ltg += (m2 * r.ltg) / 1000; pwr += (m2 * r.pwr) / 1000; clg += (m2 * r.clg) / 1000;
    if (r.dwelling) dwell += m2;
  }
  ltg += (park * f.carParkLtg) / 1000;

  const hvac = clg * (f.cool[s.cool] ?? 0);
  const dhw = s.dhw === 'local' ? (gfa * f.dhw.local) / 1000 : (dwell * (f.dhw[s.dhw] ?? 0)) / 1000;
  const cook = s.cook === 'elec' ? (dwell * f.cook) / 1000 : 0;
  const liftCount = s.lifts === 'none' ? 0 : s.lifts === 'custom' ? Math.max(0, Math.round(s.liftCount ?? 0))
    : Math.max(floors > 2 ? 1 : 0, Math.ceil((floors / Math.max(1, f.floorsPerLift)) * Math.max(1, gfa / floors / 6000)));
  const lift = liftCount * (floors > 12 ? f.liftKwHigh : f.liftKw);
  const pool = s.pool ? f.poolKw : 0;
  const carFans = park ? Math.max(11, park * f.carParkFanKwPerM2) : 0;
  const pump = 2 * f.boosterKw + (floors > 2 ? 2 * f.transferKw : 0) + pool + carFans;
  const ev = (park / Math.max(1, f.m2PerBay)) * (s.evPct / 100) * f.evKw;
  const kitchen = s.kitchen ? (gfa * f.kitchen) / 1000 : 0;
  const laundry = s.laundry ? (gfa * f.laundry) / 1000 : 0;
  const medical = s.medical ? (gfa * f.medical) / 1000 : 0;
  const facade = s.facade ? floors * f.facadeKwPerFloor : 0;
  const spec = kitchen + laundry + medical + facade + (s.itKw || 0);
  const life = s.fire ? f.firePumpKw + f.jockeyKw + (floors > 4 ? 2 * f.stairFanKw : 0) : 0;
  const coolLabel = COOL_SYSTEMS.find((c) => c.value === s.cool)?.label ?? s.cool;

  const cat = (key: CategoryKey, label: string, kw: number, gen: number): LaCategory => ({ key, label, connectedKw: kw, diversity: d[key], demandKw: kw * d[key], generatorShare: gen, editable: true });
  const categories: LaCategory[] = [
    cat('ltg', 'Lighting', ltg, 1),
    cat('pwr', 'Small power', pwr, 0.3),
    cat('hvac', `HVAC — ${coolLabel}`, hvac, ess),
    cat('dhw', 'Water heating', dhw, 0),
    cat('cook', 'Cooking', cook, 0),
    cat('lift', `Lifts (${liftCount})`, lift, 1),
    cat('pump', 'Pumps / ventilation', pump, 0.5),
    cat('ev', 'EV charging', ev, 0),
    cat('spec', 'Special services', spec, ess),
    { key: 'life', label: 'Fire & life safety (generator only)', connectedKw: life, diversity: 0, demandKw: 0, generatorShare: 1, editable: false },
    ...a.custom.map((c) => ({ key: `custom:${c.id}`, label: c.label || 'Custom load', connectedKw: c.qty * c.kw, diversity: c.diversity, demandKw: c.qty * c.kw * c.diversity, generatorShare: c.onGenerator ? 1 : 0, editable: false }))
  ].filter((c) => c.connectedKw > 0);

  const connectedKw = categories.reduce((x, c) => x + c.connectedKw, 0);
  const sumDemandKw = categories.reduce((x, c) => x + c.demandKw, 0);
  const sup = a.supply;
  const mdKw = sumDemandKw * (sup.coincidence || 1) * (1 + (sup.sparePct || 0) / 100);
  const pf = sup.pf > 0 && sup.pf <= 1 ? sup.pf : 0.9;
  const mdKva = mdKw / pf;
  const vaPerM2 = gfa ? (mdKva * 1000) / gfa : 0;

  const txSizes = txSizesOf(sup);
  const load = (sup.maxLoadingPct || 100) / 100;
  const allowed = txSizes.filter((z) => z <= (sup.maxTxKva || Infinity));
  let tx: LaResult['tx'];
  if (mdKva > 0 && allowed.length) {
    for (let n = 1; n <= 20 && !tx; n++) {
      const kva = allowed.find((z) => z * n * load >= mdKva);
      if (kva) tx = { count: sup.redundancy === 'N+1' ? n + 1 : n, kva, duty: n };
    }
  }
  // Generator: each category's demand (life safety at full load) times its share on the generator.
  const generatorKw = categories.reduce((x, c) => x + c.connectedKw * (c.diversity || 1) * c.generatorShare, 0);
  const generatorKvaRequired = (generatorKw / pf) * (sup.genMargin || 1);
  const gs = genSizes();
  let generatorKva: number | undefined, generatorCount = 0;
  if (generatorKvaRequired > 0) {
    for (let n = 1; n <= 6 && !generatorKva; n++) {
      generatorKva = gs.find((z) => z * n >= generatorKvaRequired);
      if (generatorKva) generatorCount = n;
    }
  }
  return {
    areaM2: area, pctTotal: pct, dwellingM2: dwell, liftCount, categories, connectedKw, sumDemandKw, mdKw, mdKva, vaPerM2,
    inBand: vaPerM2 >= a.vaBand[0] && vaPerM2 <= a.vaBand[1],
    services: { cool: hvac, dhw, cook, lifts: lift, ev, it: s.itKw || 0, fire: life, pool, kitchen, laundry, medical, facade },
    tx, txSizes, generatorKw, generatorKvaRequired, generatorKva, generatorCount,
    incomerA: tx ? (tx.kva * 1000) / (Math.sqrt(3) * (sup.voltage || 400)) : undefined
  };
}
