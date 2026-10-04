/** Enclosure sizing — PHYSICAL space only (separate from current ratings).
 *
 *   equipment + future spare ≤ usable capacity of the enclosure
 *
 * Usable capacity comes from the supplier's catalogue for the case that
 * applies (ELCB count, incomer current). Where the supplier states capacity
 * after its allowances (terminals, incoming cable space), that figure is used
 * as it is — never deducted again. A blank catalogue cell means "not offered /
 * not stated for that case": never selected automatically. Cases where the
 * supplier's rules overlap or leave a gap are flagged for confirmation.
 *
 * A module count is a preliminary space fit. Depth, wiring access, busbars,
 * device compatibility and temperature rise (IEC TR 60890) are separate checks. */

export type Mounting = 'flush' | 'surface';
export interface Dims { h: number; w: number; d: number }

/** A supplier allowance case: when it applies and what it costs. */
export interface AllowanceRule {
  id: string;
  label: string; // as the supplier writes it
  deductModules: number; // already taken off the catalogue's usable figure
  elcbMin?: number;
  elcbMax?: number;
  incomerMinA?: number;
  incomerMaxA?: number;
  extra?: string; // e.g. "800 mm (12×5) busbar to add in the estimate"
}

export interface EnclosureConfig {
  id: string;
  ref: string; // "5 × 16", "800 × 600 × 200"
  rows?: number;
  modulesPerRow?: number;
  grossModules: number;
  dims: Partial<Record<Mounting, Dims>> & { fabricated?: Dims };
  /** Usable modules after the supplier's allowance, per rule id; null = blank in the catalogue. */
  usable: Record<string, number | null>;
}

export interface EnclosureCatalogue {
  id: string;
  supplier: string;
  range: string;
  family: 'modular' | 'fabricated';
  source: string;
  revision: string;
  notes: string[];
  rules: AllowanceRule[];
  /** Rule ids whose conditions overlap and need the supplier to say which governs. */
  overlaps: string[][];
  configs: EnclosureConfig[];
}

const SRC = 'Distribution board selection chart (photograph supplied by the owner)';
const BASE_NOTES = ['Blank cells in the chart are treated as not offered for that case (not selected automatically) until the supplier confirms.'];

/** The owner's supplier chart, family 1: modular distribution boards. */
const MODULAR: EnclosureCatalogue = {
  id: 'chart-modular', supplier: 'Supplier chart', range: 'Modular DB', family: 'modular', source: SRC, revision: '1',
  notes: [...BASE_NOTES, 'Up to 12 ELCB: 8 modules (4 terminal + 4 incoming cable space) off the actual modules; up to 15 ELCB: 12 (8 terminal + 4 incoming).'],
  rules: [
    { id: 'elcb12', label: 'Up to 12 ELCB — 4 terminal + 4 incoming cable space', deductModules: 8, elcbMax: 12 },
    { id: 'elcb15', label: 'Up to 15 ELCB — 8 terminal + 4 incoming cable space', deductModules: 12, elcbMin: 13, elcbMax: 15 }
  ],
  overlaps: [],
  configs: ([
    [1, 16, 16, null, null, [325, 465], [305, 445]], [2, 16, 32, null, null, [475, 465], [455, 445]], [3, 16, 48, null, null, [625, 465], [605, 445]],
    [4, 16, 64, null, null, [775, 465], [755, 445]], [5, 16, 80, 72, null, [925, 465], [905, 445]], [6, 16, 96, 88, 84, [1075, 465], [1055, 445]],
    [4, 24, 96, 88, 84, [775, 609], [755, 589]], [5, 24, 120, 112, 108, [925, 609], [905, 589]], [6, 24, 144, 136, 132, [1075, 609], [1055, 589]]
  ] as [number, number, number, number | null, number | null, [number, number], [number, number]][]).map(([rows, per, gross, a, b, fl, su]) => ({
    id: `m${rows}x${per}`, ref: `${rows} × ${per}`, rows, modulesPerRow: per, grossModules: gross,
    dims: { flush: { h: fl[0], w: fl[1], d: 115 }, surface: { h: su[0], w: su[1], d: 115 } }, usable: { elcb12: a, elcb15: b }
  }))
};

/** Family 2: fabricated enclosures (H × W × D). */
const FABRICATED: EnclosureCatalogue = {
  id: 'chart-fabricated', supplier: 'Supplier chart', range: 'Fabricated enclosure', family: 'fabricated', source: SRC, revision: '1',
  notes: [...BASE_NOTES,
    'More than 12 ELCB, up to 125 A: 48 modules off the actual modules and an 800 mm (12×5) busbar added in the estimate; 160–250 A: 64 modules and an 800 mm (20×10) busbar.',
    '13–15 ELCB is covered by both "up to 15 ELCB" and "more than 12 ELCB": the supplier must confirm which governs — both are shown, none selected automatically.',
    'Incomers above 125 A and below 160 A, and above 250 A, are not covered by the chart.',
    'To confirm with the supplier: 500 × 400 and 600 × 400 have no usable figure for any case; 600 × 500 shows 6 usable modules for more than 12 ELCB, which cannot hold 13 ELCBs.'],
  rules: [
    { id: 'elcb12', label: 'Up to 12 ELCB — 4 terminal + 4 incoming cable space', deductModules: 8, elcbMax: 12 },
    { id: 'elcb15', label: 'Up to 15 ELCB — 8 terminal + 4 incoming cable space', deductModules: 12, elcbMin: 13, elcbMax: 15 },
    { id: 'gt12-125', label: 'More than 12 ELCB, up to 125 A — 48 modules + 800 mm (12×5) busbar', deductModules: 48, elcbMin: 13, incomerMaxA: 125, extra: '800 mm (12×5) busbar to add in the estimate' },
    { id: 'gt12-250', label: 'More than 12 ELCB, 160–250 A — 64 modules + 800 mm (20×10) busbar', deductModules: 64, elcbMin: 13, incomerMinA: 160, incomerMaxA: 250, extra: '800 mm (20×10) busbar to add in the estimate' }
  ],
  overlaps: [['elcb15', 'gt12-125'], ['elcb15', 'gt12-250']],
  configs: ([
    [500, 400, 200, 24, null, null, null, null], [600, 400, 200, 36, null, null, null, null], [600, 500, 200, 54, null, null, 6, null],
    [800, 600, 200, 96, 88, 84, 48, 32], [800, 800, 200, 128, 120, 116, 80, 64], [1000, 600, 200, 120, 112, 108, 72, 56],
    [1000, 800, 200, 160, 152, 148, 112, 96], [1000, 1000, 200, 210, 202, 198, 162, 146], [1200, 800, 250, 224, 216, 212, 176, 160], [1200, 1000, 250, 294, 286, 282, 246, 230]
  ] as number[][]).map(([h, w, d, gross, a, b, c, e]) => ({
    id: `f${h}x${w}x${d}`, ref: `${h} × ${w} × ${d}`, grossModules: gross, dims: { fabricated: { h, w, d } },
    usable: { elcb12: a ?? null, elcb15: b ?? null, 'gt12-125': c ?? null, 'gt12-250': e ?? null }
  }))
};

export const BUILTIN_CATALOGUES: EnclosureCatalogue[] = [MODULAR, FABRICATED];

export interface SizingInput {
  equipmentModules: number;
  spareModules: number;
  elcbCount: number;
  incomerA?: number;
  /** Spare entered as a percentage of the equipment space (spareModules is then worked out from it). */
  sparePct?: number;
}

/** Default future spare: 20 % of the equipment space. */
export const DEFAULT_SPARE_PCT = 20;
/** Spare modules for a percentage of the equipment space, rounded up to whole modules. */
export const spareFromPct = (equipmentModules: number, pct: number) => Math.max(0, Math.ceil((equipmentModules * pct) / 100 - 1e-9));

/** Which allowance cases apply. `confirm` when the supplier's cases overlap; empty `rules` when none covers the input. */
export function applicableRules(cat: EnclosureCatalogue, i: SizingInput): { rules: AllowanceRule[]; confirm: boolean; why?: string } {
  const rules = cat.rules.filter((r) =>
    (r.elcbMin === undefined || i.elcbCount >= r.elcbMin) && (r.elcbMax === undefined || i.elcbCount <= r.elcbMax) &&
    (r.incomerMinA === undefined || (i.incomerA !== undefined && i.incomerA >= r.incomerMinA)) &&
    (r.incomerMaxA === undefined || (i.incomerA !== undefined && i.incomerA <= r.incomerMaxA)));
  const overlap = cat.overlaps.some((o) => o.every((id) => rules.some((r) => r.id === id)));
  // A case that depends on the incomer and matches the ELCB count can't be ruled out without the incomer current.
  const unknown = i.incomerA === undefined
    ? cat.rules.filter((r) => (r.incomerMinA !== undefined || r.incomerMaxA !== undefined) && !rules.includes(r) &&
      (r.elcbMin === undefined || i.elcbCount >= r.elcbMin) && (r.elcbMax === undefined || i.elcbCount <= r.elcbMax))
    : [];
  if (rules.length) return unknown.length
    ? { rules, confirm: true, why: `Enter the incomer current — "${unknown[0].label}" may govern for ${i.elcbCount} ELCB` }
    : { rules, confirm: overlap };
  const needsA = cat.rules.some((r) => (r.incomerMinA !== undefined || r.incomerMaxA !== undefined) && (r.elcbMin === undefined || i.elcbCount >= r.elcbMin));
  return { rules, confirm: false, why: needsA && i.incomerA === undefined ? 'Enter the incomer current — the chart depends on it for this many ELCBs' : `The ${cat.range} chart has no case for ${i.elcbCount} ELCB${i.incomerA !== undefined ? ` at ${i.incomerA} A` : ''}` };
}

export type CandidateResult = 'fits' | 'too-small' | 'not-listed' | 'confirm';
export interface Candidate { config: EnclosureConfig; rule: AllowanceRule; usable: number | null; spareAfter: number | null; result: CandidateResult; dims?: Dims }

export interface SizingResult {
  required: number;
  rules: AllowanceRule[];
  confirm: boolean;
  why?: string;
  /** Every configuration × applicable rule: fitting ones first (smallest usable first), then the rest. */
  candidates: Candidate[];
  invalid?: string;
}

export function sizeEnclosure(cat: EnclosureCatalogue, i: SizingInput, mounting: Mounting = 'surface'): SizingResult {
  const nums = [i.equipmentModules, i.spareModules, i.elcbCount, ...(i.incomerA !== undefined ? [i.incomerA] : [])];
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return { required: NaN, rules: [], confirm: false, candidates: [], invalid: 'Enter module counts, ELCB count and incomer current as 0 or more' };
  const required = i.equipmentModules + i.spareModules;
  const { rules, confirm, why } = applicableRules(cat, i);
  const dimsOf = (c: EnclosureConfig) => (cat.family === 'fabricated' ? c.dims.fabricated : c.dims[mounting]);
  const candidates: Candidate[] = cat.configs.flatMap((config) => rules.map((rule) => {
    const usable = config.usable[rule.id] ?? null;
    const result: CandidateResult = usable === null ? 'not-listed' : usable < required ? 'too-small' : confirm ? 'confirm' : 'fits';
    return { config, rule, usable, spareAfter: usable === null ? null : usable - required, result, dims: dimsOf(config) };
  }));
  const rank: Record<CandidateResult, number> = { fits: 0, confirm: 1, 'too-small': 2, 'not-listed': 3 };
  candidates.sort((a, b) => rank[a.result] - rank[b.result] || (a.result === 'too-small' ? (b.usable ?? 0) - (a.usable ?? 0) : (a.usable ?? 0) - (b.usable ?? 0)));
  return { required, rules, confirm, why, candidates };
}

/** What a panel keeps of its selection: a frozen copy, so library edits never resize it silently. */
export interface EnclosureSelection {
  catalogueId: string;
  supplier: string;
  range: string;
  revision: string;
  config: EnclosureConfig;
  ruleId: string;
  ruleLabel: string;
  extra?: string;
  mounting?: Mounting;
  dims?: Dims;
  input: SizingInput;
  /** How the equipment space was found. */
  method?: 'manual' | 'schedule';
  required: number;
  usable: number;
  confirmNeeded: boolean;
  selectedOn: string;
}

export function selectionFrom(cat: EnclosureCatalogue, c: Candidate, input: SizingInput, mounting: Mounting | undefined, required: number, method?: 'manual' | 'schedule'): EnclosureSelection {
  return {
    ...(method ? { method } : {}),
    catalogueId: cat.id, supplier: cat.supplier, range: cat.range, revision: cat.revision, config: structuredClone(c.config), ruleId: c.rule.id, ruleLabel: c.rule.label,
    ...(c.rule.extra ? { extra: c.rule.extra } : {}), ...(cat.family === 'modular' && mounting ? { mounting } : {}), ...(c.dims ? { dims: c.dims } : {}),
    input: { ...input }, required, usable: c.usable!, confirmNeeded: c.result === 'confirm', selectedOn: new Date().toISOString().slice(0, 10)
  };
}
