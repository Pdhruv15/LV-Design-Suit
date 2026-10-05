import type { Board, Feeder, Project } from '../types';
import { buildBom } from '../calc/bom';
import { fingerprint, STUDY_KEYS, STUDY_LABEL } from '../calc/runs';
import { DESIGN_CLASSES } from './changeClass';
import { boardAndDescendants } from './edit';
import { diffProjects, type Change, type Diff, type Snapshot } from './revisions';
import type { MainView } from '../views';

/** What a design change touches: the panels, the studies that must be run again, the drawings and schedules that show
 * the equipment, and the BOQ design quantities. Everything here is derived from the model itself. It never states a
 * new result (a stale or hypothetical study result is not used to claim an improvement): it says what to run again. */
export interface ImpactPanel { id: string; why: 'changed' | 'upstream' | 'downstream' }
export interface ImpactStudy { id: string; label: string; reason: string; view?: MainView }
export interface ImpactDocument { label: string; reason: string; view?: MainView }
export interface QuantityChange { key: string; description: string; unit: string; from: number; to: number }

export interface DesignImpact {
  /** Before → after per item, with units, as in the revision comparison (engineering and drawing changes). */
  changes: Change[];
  panels: ImpactPanel[];
  /** Maximum demand per panel whose figure changed (kW), computed from the loads — not a study result. */
  demand: Diff['boardKw'];
  studies: ImpactStudy[];
  documents: ImpactDocument[];
  /** Design quantities (no rates, no manual lines, overrides or wastage) that change. */
  quantities: QuantityChange[];
  /** What this preview does not determine. */
  assumptions: string[];
  empty: boolean;
}

const LOAD = new Set(['Load (kW)', 'Demand factor', 'PF', 'Points', 'Phase', 'Way', 'Load type', 'Starter', 'Capacitor (kvar)', 'Room', 'Name', 'On board', 'Essential (generator)', 'Standby unit', 'Circuit purpose']);
const CABLE = new Set(['Cable (mm²)', 'Cores', 'Cable type', 'ECC (mm²)', 'Length (m)', 'Parallel runs', 'Tray route']);
const BREAKER = new Set(['Breaker (A)', 'Breaker type', 'Breaking capacity (kA)', 'Device', 'Instantaneous (× In)', 'RCD (mA)']);

const asProject = (s: Snapshot | Project): Project => s as Project;

function chainUp(p: Project, id: string): string[] {
  const by = new Map(p.boards.map((b: Board) => [b.id, b]));
  const out: string[] = [];
  const seen = new Set<string>();
  let b = by.get(id);
  while (b?.upstreamId && !seen.has(b.id)) { seen.add(b.id); out.push(b.upstreamId); b = by.get(b.upstreamId); }
  return out;
}

/** The impact of going from one version of the design to another (the working draft against its baseline, or the
 * working design against the design with a proposed modification applied). */
export function impactBetween(before: Snapshot | Project, after: Snapshot | Project): DesignImpact {
  const a = asProject(before), b = asProject(after);
  const diff = diffProjects(before, after);
  const changes = diff.changes.filter((c) => DESIGN_CLASSES.includes(c.class));

  // Panels: those that changed, what feeds them (their demand and voltage drop), and what they feed.
  const feederOf = (id: string): Feeder | undefined => b.feeders.find((f) => f.id === id) ?? a.feeders.find((f) => f.id === id);
  const panelsOfChanges = (list: Change[]) => {
    const why = new Map<string, ImpactPanel['why']>();
    const mark = (id: string, w: ImpactPanel['why']) => { const cur = why.get(id); if (!cur || (cur !== 'changed' && w === 'changed') || (cur === 'upstream' && w === 'downstream')) why.set(id, w); };
    const seeds = new Set<string>();
    for (const c of list) {
      if (c.what === 'board') { seeds.add(c.id); mark(c.id, 'changed'); for (const d of boardAndDescendants(c.kind === 'removed' ? a : b, c.id)) if (d !== c.id) mark(d, 'downstream'); }
      else if ((c.what === 'feeder' || c.what === 'circuit') && c.boardId) {
        seeds.add(c.boardId); mark(c.boardId, 'changed');
        const fed = feederOf(c.id)?.feedsBoardId;
        if (fed) for (const d of boardAndDescendants(c.kind === 'removed' ? a : b, fed)) mark(d, 'downstream');
      }
    }
    for (const s of seeds) for (const u of [...chainUp(b, s), ...chainUp(a, s)]) mark(u, 'upstream');
    return why;
  };
  const why = panelsOfChanges(changes);
  // What the loads and ratings reach: only engineering changes (a renamed panel does not change a UPS or a study).
  const engineeringWhy = panelsOfChanges(changes.filter((c) => c.class === 'engineering'));
  const known = new Set([...a.boards.map((x) => x.id), ...b.boards.map((x) => x.id)]);
  const panels = [...why].filter(([id]) => known.has(id)).map(([id, w]) => ({ id, why: w })).sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
  const affected = new Set(panels.map((p) => p.id));
  const demand = diff.boardKw.filter((k) => Math.abs(k.to - k.from) > 1e-6);

  // Studies: those whose inputs differ, by the same fingerprints that mark results out of date.
  const studies: ImpactStudy[] = [];
  const views: Record<string, MainView> = { vd: 'voltage-drop', fault: 'selection', checks: 'selection', earthing: 'earthing', protection: 'coordination', sizing: 'sizing' };
  for (const k of STUDY_KEYS) if (fingerprint(a, k) !== fingerprint(b, k)) studies.push({ id: k, label: STUDY_LABEL[k], reason: 'its inputs changed', view: views[k] });
  const upsChanged = changes.filter((c) => c.what === 'ups');
  const upsB = [...(a.upsSystems ?? []), ...(b.upsSystems ?? [])];
  const fed = upsB.filter((u) => u.boardId && engineeringWhy.has(u.boardId) && engineeringWhy.get(u.boardId) !== 'upstream');
  if (upsChanged.length || fed.length) studies.push({ id: 'ups', label: 'UPS and battery', view: 'ups', reason: upsChanged.length ? 'UPS data changed' : `${[...new Set(fed.map((u) => u.name || u.id))].join(', ')} is fed from a panel whose load changed` });
  if (diff.changes.some((c) => c.what === 'project' && c.fields.some((f) => f.field.startsWith('Solar PV')))) studies.push({ id: 'solar', label: 'Solar PV', view: 'solar', reason: 'its data changed' });
  if (changes.some((c) => c.what === 'earthing')) studies.push({ id: 'earthing-plan', label: 'Earthing plan checks', view: 'earth-schematic', reason: 'pits, links or measurements changed' });

  // Drawings and schedules that show the affected equipment.
  const documents: ImpactDocument[] = [];
  const set = b.drawingSet ?? a.drawingSet;
  for (const s of set?.sheets ?? []) {
    const hit = s.boards.find((id) => affected.has(id));
    if (s.kind === 'earthing') { if (changes.some((c) => c.what === 'earthing' || (c.what === 'board' && !(b.boards.find((x) => x.id === c.id)?.upstreamId)))) documents.push({ label: `${s.number} ${s.title}`, reason: 'earthing or main board data changed', view: 'drawings' }); }
    else if (s.kind === 'riser') { if (panels.some((p) => b.boards.find((x) => x.id === p.id)?.level)) documents.push({ label: `${s.number} ${s.title}`, reason: 'a panel on the riser changed', view: 'drawings' }); }
    else if (hit) documents.push({ label: `${s.number} ${s.title}`, reason: `shows ${hit}${panels.find((p) => p.id === hit)!.why === 'changed' ? '' : ' (affected)'}`, view: 'drawings' });
  }
  const fieldLabels = new Set(changes.filter((c) => c.what === 'feeder' || c.what === 'circuit').flatMap((c) => c.fields.map((f) => f.field)));
  const touches = (set: Set<string>) => [...fieldLabels].some((l) => set.has(l)) || changes.some((c) => (c.what === 'feeder' || c.what === 'circuit') && c.kind !== 'changed');
  if (touches(LOAD) || touches(BREAKER) || changes.some((c) => c.what === 'board')) { documents.push({ label: 'Load schedule', reason: 'loads or devices changed', view: 'load-schedule' }, { label: 'DB schedule', reason: 'devices or panels changed', view: 'db-schedule' }); }
  if (touches(CABLE)) documents.push({ label: 'Cable schedule', reason: 'cable data changed', view: 'cable-schedule' });
  if (fieldLabels.has('Tray route') || fieldLabels.has('Length (m)') || fieldLabels.has('Cable (mm²)')) documents.push({ label: 'Cable tray schedule', reason: 'cables on a route changed', view: 'cable-tray' });
  if (changes.some((c) => c.what === 'ups')) documents.push({ label: 'UPS and solar report', reason: 'UPS data changed', view: 'ups' });
  if (studies.length) documents.push({ label: 'Calculation report and study reports', reason: 'must be regenerated after the studies are run again', view: 'report' });

  // BOQ design quantities.
  const qa = new Map(buildBom(a).map((i) => [i.key, i])), qb = new Map(buildBom(b).map((i) => [i.key, i]));
  const quantities: QuantityChange[] = [];
  for (const key of new Set([...qa.keys(), ...qb.keys()])) {
    const x = qa.get(key), y = qb.get(key);
    const from = x?.qty ?? 0, to = y?.qty ?? 0;
    if (Math.abs(from - to) > 1e-9) quantities.push({ key, description: (y ?? x)!.description, unit: (y ?? x)!.unit, from, to });
  }
  quantities.sort((p, q) => p.description.localeCompare(q.description));
  if (quantities.length) documents.push({ label: 'Bill of quantities', reason: `${quantities.length} design quantit${quantities.length === 1 ? 'y' : 'ies'} change`, view: 'boq' });

  const assumptions: string[] = [];
  if (studies.length) assumptions.push('No new study results are shown. The studies listed must be run again; until then no result is claimed to improve or worsen.');
  if (quantities.length) assumptions.push('Quantities come from the design model only. Manual BOQ lines, quantity changes, wastage and rates are not included, so no cost is shown.');
  if (upsChanged.length || fed.length) assumptions.push('UPS runtime and battery size are not recomputed here; open the UPS study.');
  if (changes.some((c) => c.what === 'earthing')) assumptions.push('Earth pit measurements are not re-evaluated; check that the measured values still apply to the changed plan.');
  if ([...fieldLabels].some((l) => CABLE.has(l))) assumptions.push('Cable lengths are the design lengths, not site-measured; confirm routes and lengths on site.');
  if (!changes.length) assumptions.length = 0;

  return { changes, panels, demand, studies, documents, quantities, assumptions, empty: !changes.length };
}
