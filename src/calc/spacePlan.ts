import type { PlanPanel, PlanTransformer, SpaceArea, SpacePlan, SpacePlanSettings, SpaceUse } from '../types';

/** Power density planning: area × W/m² (or a specific kW) × demand factor
 * per area; areas are fed from panels, panels from transformers (or a
 * parent panel), transformers from RMUs (at most N per RMU). */

/** PLACEHOLDER power densities and demand factors — not DEWA figures.
 * Replace them with your authority / company values (Space planning →
 * Use types). */
export const DEFAULT_USES: SpaceUse[] = [
  { id: 'residential', label: 'Residential (apartments)', wPerM2: 80, demandFactor: 0.7 },
  { id: 'villa', label: 'Villa', wPerM2: 70, demandFactor: 0.7 },
  { id: 'office', label: 'Office', wPerM2: 100, demandFactor: 0.8 },
  { id: 'retail', label: 'Retail', wPerM2: 120, demandFactor: 0.8 },
  { id: 'fnb', label: 'F&B / restaurant', wPerM2: 150, demandFactor: 0.8 },
  { id: 'hotel', label: 'Hotel rooms', wPerM2: 90, demandFactor: 0.7 },
  { id: 'common', label: 'Common areas / lobbies', wPerM2: 40, demandFactor: 0.9 },
  { id: 'parking', label: 'Car park', wPerM2: 10, demandFactor: 0.9 },
  { id: 'services', label: 'Plant / services (specific kW)', wPerM2: 0, demandFactor: 1 }
];

export const DEFAULT_PLAN_SETTINGS: SpacePlanSettings = {
  transformerKva: 0,
  maxLoadingPct: 80,
  maxTransformersPerRmu: 2,
  powerFactor: 0.9,
  growthPct: 0
};

/** DEWA's usual distribution transformer sizes. */
export const PLAN_TRANSFORMER_SIZES = [1000, 1500];

export const emptyPlan = (): SpacePlan => ({ areas: [], panels: [], transformers: [], settings: { ...DEFAULT_PLAN_SETTINGS } });

export const usesOf = (plan: SpacePlan): SpaceUse[] => plan.uses ?? DEFAULT_USES;

export interface AreaLoad {
  area: SpaceArea;
  wPerM2: number;
  demandFactor: number;
  connectedKw: number;
  demandKw: number;
}

export function areaLoad(plan: SpacePlan, a: SpaceArea): AreaLoad {
  const use = usesOf(plan).find((u) => u.id === a.use);
  const wPerM2 = a.wPerM2 ?? use?.wPerM2 ?? 0;
  const demandFactor = a.demandFactor ?? use?.demandFactor ?? 1;
  const connectedKw = a.kw ?? ((a.areaM2 ?? 0) * wPerM2) / 1000;
  return { area: a, wPerM2, demandFactor, connectedKw, demandKw: connectedKw * demandFactor };
}

/** Demand kVA with the plan's growth allowance, at the plan's PF. */
const kvaOf = (plan: SpacePlan, kw: number) => (kw / plan.settings.powerFactor) * (1 + plan.settings.growthPct / 100);

export interface PanelLoad {
  panel: PlanPanel;
  connectedKw: number;
  demandKw: number;
  demandKva: number;
  areas: SpaceArea[];
  children: PlanPanel[];
}

/** A panel's load: its own areas plus every SMDB below it. */
export function panelLoad(plan: SpacePlan, id: string, seen = new Set<string>()): PanelLoad {
  const panel = plan.panels.find((p) => p.id === id) ?? { id, building: '', kind: 'MDB' as const };
  const areas = plan.areas.filter((a) => a.panel === id);
  const children = plan.panels.filter((p) => p.kind === 'SMDB' && p.parent === id && !seen.has(p.id));
  seen.add(id);
  let connectedKw = 0;
  let demandKw = 0;
  for (const a of areas) {
    const l = areaLoad(plan, a);
    connectedKw += l.connectedKw;
    demandKw += l.demandKw;
  }
  for (const c of children) {
    const l = panelLoad(plan, c.id, seen);
    connectedKw += l.connectedKw;
    demandKw += l.demandKw;
  }
  return { panel, connectedKw, demandKw, demandKva: kvaOf(plan, demandKw), areas, children };
}

export interface TransformerLoad {
  transformer: PlanTransformer;
  panels: PlanPanel[];
  demandKva: number;
  loadingPct: number;
  status: 'ok' | 'warn' | 'bad';
}

export function transformerLoad(plan: SpacePlan, t: PlanTransformer): TransformerLoad {
  const panels = plan.panels.filter((p) => p.kind === 'MDB' && p.transformer === t.id);
  const demandKva = panels.reduce((s, p) => s + panelLoad(plan, p.id).demandKva, 0);
  const loadingPct = t.kva ? (demandKva / t.kva) * 100 : 0;
  const status = loadingPct > 100 ? 'bad' : loadingPct > plan.settings.maxLoadingPct ? 'warn' : 'ok';
  return { transformer: t, panels, demandKva, loadingPct, status };
}

export interface PlanSummary {
  connectedKw: number;
  demandKw: number;
  demandKva: number;
  /** Size used for the count: the setting, or the one giving fewer units. */
  transformerKva: number;
  /** Transformers needed for the whole demand at the loading limit. */
  requiredTransformers: number;
  requiredRmus: number;
  transformers: TransformerLoad[];
  rmus: { id: string; transformers: string[] }[];
  /** Areas with no panel, panels with no supply. */
  unassignedAreas: SpaceArea[];
  unfedPanels: PlanPanel[];
}

/** How many transformers of a size carry `kva` at the loading limit. */
export const transformersFor = (kva: number, size: number, maxLoadingPct: number) => (kva > 0 ? Math.ceil(kva / (size * (maxLoadingPct / 100)) - 1e-9) : 0);

/** The size to plan with: the setting, or the DEWA size that needs fewer
 * units — the smaller one when both need the same number. */
export function planTransformerKva(plan: SpacePlan, demandKva: number): number {
  if (plan.settings.transformerKva) return plan.settings.transformerKva;
  const n = (s: number) => transformersFor(demandKva, s, plan.settings.maxLoadingPct);
  return n(1500) < n(1000) ? 1500 : 1000;
}

export function summarize(plan: SpacePlan): PlanSummary {
  const loads = plan.areas.map((a) => areaLoad(plan, a));
  const connectedKw = loads.reduce((s, l) => s + l.connectedKw, 0);
  const demandKw = loads.reduce((s, l) => s + l.demandKw, 0);
  const demandKva = kvaOf(plan, demandKw);
  const size = planTransformerKva(plan, demandKva);
  const required = transformersFor(demandKva, size, plan.settings.maxLoadingPct);
  const rmuIds = [...new Set(plan.transformers.map((t) => t.rmu).filter((x): x is string => !!x))];
  return {
    connectedKw,
    demandKw,
    demandKva,
    transformerKva: size,
    requiredTransformers: required,
    requiredRmus: Math.ceil(required / Math.max(1, plan.settings.maxTransformersPerRmu)),
    transformers: plan.transformers.map((t) => transformerLoad(plan, t)),
    rmus: rmuIds.map((id) => ({ id, transformers: plan.transformers.filter((t) => t.rmu === id).map((t) => t.id) })),
    unassignedAreas: plan.areas.filter((a) => !a.panel || !plan.panels.some((p) => p.id === a.panel)),
    unfedPanels: plan.panels.filter((p) => (p.kind === 'MDB' ? !plan.transformers.some((t) => t.id === p.transformer) : !plan.panels.some((x) => x.id === p.parent)))
  };
}

const slug = (s: string) => s.replace(/building/i, '').replace(/[^a-z0-9]+/gi, '').toUpperCase().slice(0, 6) || 'X';

/** Fills in what's missing, keeping everything already assigned:
 *  1. areas with no panel go to their building's MDB — a new MDB per
 *     building, split into more MDBs when one would be too big for a
 *     transformer at the loading limit;
 *  2. MDBs with no transformer are packed onto transformers of the plan
 *     size (largest first; a building's MDBs stay together when they fit;
 *     a new transformer when none has room);
 *  3. transformers with no RMU are grouped N per RMU. */
export function autoAssign(plan: SpacePlan): SpacePlan {
  const p: SpacePlan = structuredClone(plan);
  const s = p.settings;
  const total = kvaOf(p, p.areas.reduce((sum, a) => sum + areaLoad(p, a).demandKw, 0));
  const size = planTransformerKva(p, total);
  const cap = size * (s.maxLoadingPct / 100);
  const taken = new Set([...p.panels.map((x) => x.id), ...p.transformers.map((x) => x.id)]);
  const fresh = (base: string) => {
    let n = 1;
    while (taken.has(`${base}${n}`)) n++;
    taken.add(`${base}${n}`);
    return `${base}${n}`;
  };

  // 1. Areas → MDBs, per building.
  const valid = new Set(p.panels.map((x) => x.id));
  const loose = p.areas.filter((a) => !a.panel || !valid.has(a.panel));
  for (const building of [...new Set(loose.map((a) => a.building || 'Site'))]) {
    const areas = loose.filter((a) => (a.building || 'Site') === building).sort((x, y) => areaLoad(p, y).demandKw - areaLoad(p, x).demandKw);
    const bins: { id: string; kva: number }[] = [];
    for (const a of areas) {
      const kva = kvaOf(p, areaLoad(p, a).demandKw);
      let bin = bins.find((b) => b.kva + kva <= cap);
      if (!bin) {
        bin = { id: fresh(`MDB-${slug(building)}`), kva: 0 };
        bins.push(bin);
        p.panels.push({ id: bin.id, building, kind: 'MDB' });
      }
      bin.kva += kva;
      a.panel = bin.id;
    }
  }

  // 2. MDBs → transformers.
  const txKva = new Map(p.transformers.map((t) => [t.id, transformerLoad(p, t).demandKva]));
  const txBuildings = new Map(p.transformers.map((t) => [t.id, new Set(p.panels.filter((x) => x.transformer === t.id).map((x) => x.building))]));
  const unfed = p.panels
    .filter((x) => x.kind === 'MDB' && !p.transformers.some((t) => t.id === x.transformer))
    .map((x) => ({ panel: x, kva: panelLoad(p, x.id).demandKva }))
    .sort((a, b) => b.kva - a.kva);
  for (const { panel, kva } of unfed) {
    const fits = p.transformers.filter((t) => (txKva.get(t.id) ?? 0) + kva <= t.kva * (s.maxLoadingPct / 100));
    const sameBuilding = fits.find((t) => txBuildings.get(t.id)?.has(panel.building));
    // Otherwise the fullest one it still fits in (keeps transformers few).
    let t = sameBuilding ?? fits.sort((a, b) => (txKva.get(b.id) ?? 0) - (txKva.get(a.id) ?? 0))[0];
    if (!t) {
      t = { id: fresh('TX-'), kva: size };
      p.transformers.push(t);
      txBuildings.set(t.id, new Set());
    }
    panel.transformer = t.id;
    txKva.set(t.id, (txKva.get(t.id) ?? 0) + kva);
    txBuildings.get(t.id)!.add(panel.building);
  }

  // 3. Transformers → RMUs, N per RMU.
  const per = Math.max(1, s.maxTransformersPerRmu);
  const count = new Map<string, number>();
  for (const t of p.transformers) if (t.rmu) count.set(t.rmu, (count.get(t.rmu) ?? 0) + 1);
  for (const t of p.transformers.filter((x) => !x.rmu)) {
    let rmu = [...count.entries()].find(([, n]) => n < per)?.[0];
    if (!rmu) {
      rmu = fresh('RMU-');
      count.set(rmu, 0);
    }
    t.rmu = rmu;
    count.set(rmu, count.get(rmu)! + 1);
  }
  return p;
}
