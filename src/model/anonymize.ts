import { LOAD_TYPES, CABLE_TYPES, type Board, type BusTie, type CircuitLoadItem, type Feeder, type Project, type SpareWay, type StudySettings, type TrayCable, type TrayPlan, type TrayRoute } from '../types';

/** Export anonymized sample: a copy of a project that keeps the electrical model (panels, circuits, cables,
 * breakers, loads and the settings the calculations use) and nothing that names a client, a site or a person.
 *
 * Built from an allowlist: every field that is copied is named below, so a field this file does not know
 * about (a new feature, an extension, a value added by hand) is left out rather than shared by accident.
 * Panel and circuit ids are replaced (P01…, C001…) and every reference to them is rewritten with the same map.
 * The original project is never changed. */

export const ANONYMIZED_NAME = 'Anonymized sample — not for construction';

export interface AnonymizeResult {
  project: Project;
  /** Old id → new id, panels and circuits (for the person sharing it; never written into the sample). */
  boardIds: Record<string, string>;
  feederIds: Record<string, string>;
  /** What was in the project and is not in the sample (top-level sections and per-item fields). */
  removed: string[];
  /** What the sample can still give away, for the person to check before sharing. */
  warnings: string[];
}

/** Project fields kept as they are (numbers, flags and enums the calculations use). */
const KEEP_PROJECT = ['schemaVersion', 'voltageV', 'frequencyHz', 'ambientC', 'vdLimitPct', 'strictFinalDisconnection', 'strictCableData', 'vdTempC', 'groundTempC', 'soilResistivityKmW', 'vdFinalCircuits', 'pointTemplate'] as const;
/** Project fields rebuilt below (with ids rewritten or text removed). Everything else is dropped and listed. */
const REBUILT_PROJECT = new Set<string>(['name', 'boards', 'feeders', 'ties', 'vdSelection', 'studySettings', 'calc', 'info', 'trays', 'updatedAt', 'id']);

const BOARD_KEEP = ['sourceKva', 'sourceImpedancePct', 'sourceXr', 'kind', 'ratedCurrentA', 'busbarMaterial', 'incomerDevice', 'instruments', 'upsKva', 'spd', 'mdDemandFactor', 'pointWatts', 'elcbGroupSize', 'elcbRatingA', 'elcbSensitivityMa', 'summaryLoad', 'summaryMeters'] as const;
const BOARD_REBUILT = new Set<string>(['id', 'name', 'upstreamId', 'vectorGroup', 'ipRating', 'standby', 'protection', 'earthing', 'supply', 'spareWays']);
const FEEDER_KEEP = ['loadKw', 'demandFactor', 'powerFactor', 'lengthM', 'cableCsaMm2', 'parallel', 'cores', 'breakerRatingA', 'breakerIcuKa', 'generation', 'loadType', 'breakerType', 'breakerImMultiple', 'cpcMm2', 'installMethod', 'standbyUnit', 'essential', 'phase', 'way', 'points', 'manualSize', 'starter', 'kvar', 'device', 'kwhMeter', 'circuitPurpose', 'rcdMa', 'localIsolator', 'capSteps', 'detunedPct', 'lengthToCheck', 'sizingPending'] as const;
const FEEDER_REBUILT = new Set<string>(['id', 'boardId', 'feedsBoardId', 'name', 'cableType', 'loadItems', 'trayRoute']);

/** Short technical codes that cannot carry a name: vector group, IP rating, CT ratio, cable codes. */
const VECTOR_GROUP = /^[DYZdyz]{1,2}[n]?\d{0,2}[dyzn]{0,2}\d{0,2}$/;
const IP_RATING = /^IP\s?\d{2}[A-Z]?$/i;
const CT_RATIO = /^\d{1,5}\s?\/\s?\d{1,2}\s?A?$/i;
const ECC = /^[0-9xX ×.,+C]{1,20}(mm2|mm²)?$/i;
const TRAY_NAME = /^[A-Z]{1,2}\d{0,2}$/;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pick = <T extends object>(src: T, keys: readonly string[]): Partial<T> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (src as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = structuredClone(v);
  }
  return out as Partial<T>;
};
const onlyIf = (v: unknown, re: RegExp): string | undefined => (typeof v === 'string' && re.test(v.trim()) ? v.trim() : undefined);
const prune = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function newId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return 'anon-' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The anonymized copy of a project, with what was removed and what still needs a human check. */
export function anonymizeProject(source: Project): AnonymizeResult {
  // Work on a deep copy: nothing below can reach the caller's objects.
  const p = structuredClone(source) as Project & Record<string, unknown>;
  const removed = new Set<string>();
  const note = (what: string) => removed.add(what);

  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || (KEEP_PROJECT as readonly string[]).includes(k) || REBUILT_PROJECT.has(k)) continue;
    note(`project.${k}`);
  }
  if (p.info && Object.keys(p.info).some((k) => k !== 'mdDemandFactor' && (p.info as Record<string, unknown>)[k] !== undefined)) note('project.info (owner, consultant, contractor, contacts, plot, area, dates)');
  if (p.name) note('project.name');

  const boards = Array.isArray(p.boards) ? p.boards : [];
  const feeders = Array.isArray(p.feeders) ? p.feeders : [];
  const width = (n: number, min: number) => Math.max(min, String(n).length);
  const boardIds: Record<string, string> = {};
  boards.forEach((b, i) => { boardIds[b.id] = `P${String(i + 1).padStart(width(boards.length, 2), '0')}`; });
  const feederIds: Record<string, string> = {};
  feeders.forEach((f, i) => { feederIds[f.id] = `C${String(i + 1).padStart(width(feeders.length, 3), '0')}`; });
  const bid = (id: string | undefined) => (id !== undefined ? boardIds[id] : undefined);

  // Tray routes: letter names (A, B, AA1) are kept; anything else becomes R1, R2… and feeder paths follow.
  const routeNames: Record<string, string> = {};
  (p.trays?.routes ?? []).forEach((r, i) => { routeNames[r.name] = TRAY_NAME.test(r.name) ? r.name : `R${i + 1}`; });

  const kindLabel = (b: Board) => b.kind ?? 'Panel';
  const outBoards: Board[] = boards.map((b) => {
    for (const k of Object.keys(b)) if (!(BOARD_KEEP as readonly string[]).includes(k) && !BOARD_REBUILT.has(k) && (b as unknown as Record<string, unknown>)[k] !== undefined) note(`panel.${k}`);
    const id = boardIds[b.id];
    const supply = b.supply ? prune({ device: b.supply.device, ratingA: num(b.supply.ratingA), faultKa: num(b.supply.faultKa), meter: b.supply.meter, irSetting: num(b.supply.irSetting), ctRatio: onlyIf(b.supply.ctRatio, CT_RATIO), ecc: onlyIf(b.supply.ecc, ECC) }) : undefined;
    if (b.supply && (b.supply.fedFrom || b.supply.cable)) note('panel.supply text (fed from, cable)');
    const spareWays = b.spareWays?.map((s, i): SpareWay => prune({ id: `S${i + 1}`, kind: s.kind, phase: s.phase, way: num(s.way), ratingA: s.ratingA, device: s.device, icuKa: num(s.icuKa) }));
    if (b.spareWays?.some((s) => s.remarks)) note('panel.spareWays remarks');
    if (b.name) note('panel names');
    return prune({
      ...pick(b, BOARD_KEEP),
      id,
      name: `${kindLabel(b)} ${id}`,
      upstreamId: bid(b.upstreamId),
      vectorGroup: onlyIf(b.vectorGroup, VECTOR_GROUP),
      ipRating: onlyIf(b.ipRating, IP_RATING),
      standby: b.standby ? prune({ kva: b.standby.kva, changeover: b.standby.changeover }) : undefined,
      protection: b.protection ? prune({ ctRatio: onlyIf(b.protection.ctRatio, CT_RATIO), irSetting: num(b.protection.irSetting), relays: b.protection.relays ? [...b.protection.relays] : undefined, apfc: b.protection.apfc }) : undefined,
      earthing: b.earthing ? prune({ show: b.earthing.show, pits: num(b.earthing.pits), conductorMm2: num(b.earthing.conductorMm2), electrodeM: num(b.earthing.electrodeM), spacingM: num(b.earthing.spacingM) }) : undefined,
      supply: supply && Object.keys(supply).length ? supply : undefined,
      spareWays
    }) as Board;
  });

  const typeLabel = (f: Feeder) => LOAD_TYPES.find((t) => t.value === (f.loadType ?? (f.generation ? 'pv' : 'general')))?.label ?? 'Load';
  // A circuit on a panel that does not exist cannot be drawn or calculated, and its panel id could be a name.
  if (feeders.some((f) => !boardIds[f.boardId])) note('circuits on a missing panel');
  const outFeeders: Feeder[] = feeders.filter((f) => boardIds[f.boardId]).map((f) => {
    for (const k of Object.keys(f)) if (!(FEEDER_KEEP as readonly string[]).includes(k) && !FEEDER_REBUILT.has(k) && (f as unknown as Record<string, unknown>)[k] !== undefined) note(`circuit.${k}`);
    if (f.name) note('circuit names');
    const id = feederIds[f.id];
    const feeds = bid(f.feedsBoardId);
    const loadItems = f.loadItems?.map((it, i): CircuitLoadItem => ({ name: `Item ${i + 1}`, pointType: it.pointType, quantity: it.quantity, unitWatts: it.unitWatts }));
    if (f.loadItems?.some((it) => it.reference)) note('circuit.loadItems references and names');
    const trayRoute = f.trayRoute?.split('-').map((s) => routeNames[s.trim()]).filter(Boolean).join('-') || undefined;
    return prune({
      ...pick(f, FEEDER_KEEP),
      id,
      boardId: boardIds[f.boardId],
      feedsBoardId: feeds,
      name: feeds ? `Incomer to ${feeds}` : `${typeLabel(f)} ${id}`,
      cableType: typeof f.cableType === 'string' && CABLE_TYPES.includes(f.cableType) ? f.cableType : undefined,
      loadItems,
      trayRoute
    }) as Feeder;
  });

  const ties: BusTie[] | undefined = p.ties?.filter((t) => bid(t.a) && bid(t.b)).map((t, i) => ({ id: `T${i + 1}`, a: bid(t.a)!, b: bid(t.b)!, ratingA: t.ratingA }));
  const vdSelection = p.vdSelection?.map((id) => feederIds[id]).filter(Boolean);
  const study = p.studySettings ? prune(Object.fromEntries(Object.entries(p.studySettings).map(([k, v]) => [k, num(v)]))) as StudySettings : undefined;
  const trays = p.trays ? anonymizeTrays(p.trays, routeNames, feederIds, note) : undefined;

  const project = prune({
    ...pick(p, KEEP_PROJECT),
    id: newId(),
    name: ANONYMIZED_NAME,
    info: num(p.info?.mdDemandFactor) !== undefined ? { mdDemandFactor: p.info!.mdDemandFactor } : undefined,
    boards: outBoards,
    feeders: outFeeders,
    ties: ties?.length ? ties : undefined,
    vdSelection: vdSelection?.length ? vdSelection : undefined,
    studySettings: study && Object.keys(study).length ? study : undefined,
    calc: p.calc?.autoRun !== undefined ? { autoRun: !!p.calc.autoRun } : undefined,
    trays,
    updatedAt: new Date(0).toISOString()
  }) as Project;

  const warnings = [
    'Panel and circuit names, locations, notes, people, logos, revisions, comments, drawings and documents are removed. The electrical layout itself is kept: a distinctive network (unusual ratings, cable lengths or circuit counts) can still be recognised by someone who knows the project.',
    'Check the sample before sharing it. The removed sections are listed; only the panels, circuits, cable trays and the calculation settings are in the file.'
  ];
  return { project, boardIds, feederIds, removed: [...removed].sort(), warnings };
}

function anonymizeTrays(t: TrayPlan, routeNames: Record<string, string>, feederIds: Record<string, string>, note: (s: string) => void): TrayPlan {
  const s = t.settings;
  if (s?.trayType) note('trays.settings.trayType (text)');
  if (t.routes.some((r) => r.from || r.to)) note('trays.routes from / to');
  if (t.routes.some((r) => r.cables.some((c) => c.from || c.to))) note('trays.routes.cables from / to');
  const routes = t.routes.map((r, i): TrayRoute => prune({
    id: `R${i + 1}`, name: routeNames[r.name], lengthM: num(r.lengthM), method: r.method, spacing: r.spacing, spacingMm: num(r.spacingMm), sparePct: num(r.sparePct), fillPct: num(r.fillPct), depthMm: num(r.depthMm), widthMm: num(r.widthMm), tiers: num(r.tiers),
    fittings: r.fittings ? prune({ bends: num(r.fittings.bends), tees: num(r.fittings.tees), reducers: num(r.fittings.reducers), risers: num(r.fittings.risers) }) : undefined,
    cables: r.cables
      .filter((c) => c.feederId === undefined || feederIds[c.feederId])
      .map((c, j): TrayCable => prune({ id: `R${i + 1}-${j + 1}`, feederId: c.feederId !== undefined ? feederIds[c.feederId] : undefined, cores: num(c.cores), csaMm2: num(c.csaMm2), qty: num(c.qty), odMm: num(c.odMm), kgPerM: num(c.kgPerM) }))
  }));
  return prune({
    routes,
    settings: prune({ method: s.method, spacing: s.spacing, spacingMm: s.spacingMm, sparePct: s.sparePct, fillPct: s.fillPct, depthMm: s.depthMm, widths: [...(s.widths ?? [])], maxWidthMm: s.maxWidthMm, includeEcc: s.includeEcc, trayType: 'Cable tray', kind: s.kind, applyGrouping: s.applyGrouping, supportSpacingM: num(s.supportSpacingM), lengthM: num(s.lengthM), covers: s.covers }),
    brand: t.brand,
    ods: t.ods?.map((o) => ({ ...o }))
  });
}

/** A neutral file name for the sample: never the project's name. */
export const anonymizedFileName = (ext: string, what?: string) => `anonymized-sample${what ? `-${what}` : ''}.${ext}`;
