import type { Project } from '../types';
import type { MainView } from '../views';
import type { TodoItem } from '../calc/dashboard';
import { issueRevision } from './revisions';
import { setBaseline } from './designBaseline';
import { SHEET_STATUSES } from './drawingSet';

/** Design stages: the job moves Concept → Schematic → Detailed design → (Tender) → IFC, adding detail at each step.
 * The stage decides which checks count (a missing cable length is normal at concept, an error at IFC), the status
 * printed on the drawings, and the ribbon tab the project opens on. Moving on is a gate: the stage's package is
 * issued as a revision and becomes the baseline, so later changes are tracked against it. */
export type DesignStage = 'concept' | 'schematic' | 'detailed' | 'tender' | 'ifc';
/** Tender before IFC (design-bid-build), or the IFC package used for tender (no separate tender stage). */
export type TenderRoute = 'before-ifc' | 'from-ifc';

export interface StageGate { stage: DesignStage; date: string; revisionId: string; by?: string }
export interface ProjectStage { current: DesignStage; route?: TenderRoute; gates?: StageGate[] }

export const STAGE_INFO: Record<DesignStage, { label: string; short: string; sheetStatus: string; issue: string; does: string }> = {
  concept: { label: 'Concept', short: 'Concept', sheetStatus: 'FOR CONCEPT REVIEW', issue: 'Concept design issue', does: 'Total load from area and building type, transformers, generator and room sizes' },
  schematic: { label: 'Schematic', short: 'Schematic', sheetStatus: 'FOR SCHEMATIC REVIEW', issue: 'Schematic design issue', does: 'Main boards, risers, main cables, earthing and back-up concept' },
  detailed: { label: 'Detailed design', short: 'Detailed', sheetStatus: 'FOR AUTHORITY SUBMISSION', issue: 'Detailed design issue', does: 'Every DB and circuit, then all calculations must pass' },
  tender: { label: 'Tender', short: 'Tender', sheetStatus: 'FOR TENDER', issue: 'Issued for tender', does: 'Tender drawings, BOQ, tender queries and addenda' },
  ifc: { label: 'IFC', short: 'IFC', sheetStatus: 'FOR CONSTRUCTION', issue: 'Issued for construction', does: 'Close comments, re-run checks, freeze and issue' }
};

const ALL: DesignStage[] = ['concept', 'schematic', 'detailed', 'tender', 'ifc'];
/** Projects made before stages existed carry on as detailed design, so their checks do not change. */
export const stageOf = (p: Project): DesignStage => p.stage?.current ?? 'detailed';
export const tenderRoute = (p: Project): TenderRoute => p.stage?.route ?? 'from-ifc';
/** The stages this project goes through (Tender only on the tender-before-IFC route). */
export const stagesOf = (p: Project): DesignStage[] => ALL.filter((s) => s !== 'tender' || tenderRoute(p) === 'before-ifc');
export const stageIndex = (p: Project, s: DesignStage = stageOf(p)) => Math.max(0, stagesOf(p).indexOf(s === 'tender' && tenderRoute(p) === 'from-ifc' ? 'ifc' : s));
export const nextStage = (p: Project): DesignStage | undefined => stagesOf(p)[stageIndex(p) + 1];
export const ifcIssued = (p: Project) => !!p.stage?.gates?.some((g) => g.stage === 'ifc');
export const gateOf = (p: Project, s: DesignStage) => [...(p.stage?.gates ?? [])].reverse().find((g) => g.stage === s);

/** The stage whose work a screen belongs to; its findings count from that stage on. Screens not listed count always. */
const VIEW_STAGE: Partial<Record<MainView, DesignStage>> = {
  building: 'concept', 'load-assessment': 'concept', sizing: 'concept', 'substation-area': 'concept', 'space-planning': 'concept',
  busbar: 'schematic', pfc: 'schematic', ups: 'schematic', solar: 'schematic', 'earth-schematic': 'schematic', panels: 'schematic',
  design: 'detailed', 'load-schedule': 'detailed', enclosure: 'detailed', selection: 'detailed', 'voltage-drop': 'detailed', earthing: 'detailed',
  coordination: 'detailed', engines: 'detailed', drawings: 'detailed', 'cable-schedule': 'detailed', 'cable-tray': 'detailed', 'db-schedule': 'detailed',
  database: 'detailed'
};
const rank = (s: DesignStage) => ALL.indexOf(s);
export const viewStage = (v?: MainView): DesignStage | undefined => (v ? VIEW_STAGE[v] : undefined);

/** The to-do findings split by stage: what counts now, and what belongs to a later stage (still listed, not counted).
 * Results out of date and project inputs with no screen always count. */
export function splitByStage(p: Project, todo: TodoItem[]): { counted: TodoItem[]; later: TodoItem[] } {
  const now = rank(stageOf(p));
  const counted: TodoItem[] = [], later: TodoItem[] = [];
  for (const t of todo) {
    const s = viewStage(t.go?.view);
    (s && rank(s) > now ? later : counted).push(t);
  }
  return { counted, later };
}

const STAGE_STATUSES = new Set<string>([...ALL.map((s) => STAGE_INFO[s].sheetStatus), 'PRELIMINARY']);
/** Sheets that follow the stage: those with no status of their own, PRELIMINARY, or a stage's status.
 * A status typed by hand (e.g. AS-BUILT) is kept. */
function stampSheets(p: Project, status: string): Project {
  const set = p.drawingSet;
  if (!set) return p;
  return { ...p, drawingSet: { ...set, status, sheets: set.sheets.map((s) => (!s.status || STAGE_STATUSES.has(s.status) ? { ...s, status: undefined } : s)) } };
}

/** Sets the stage being worked on (no gate, nothing issued): the drawings take its status. */
export function setStage(p: Project, current: DesignStage): Project {
  return stampSheets({ ...p, stage: { ...(p.stage ?? {}), current } }, STAGE_INFO[current].sheetStatus);
}

export function setTenderRoute(p: Project, route: TenderRoute): Project {
  const current = stageOf(p) === 'tender' && route === 'from-ifc' ? 'ifc' : stageOf(p);
  return { ...p, stage: { ...(p.stage ?? { current }), current, route } };
}

/** The stage gate: issues the current stage's package as a revision, makes it the baseline and moves to the next
 * stage (its drawings take the next status). At IFC it records the IFC issue and stays at IFC. */
export function advanceStage(p: Project, o: { by?: string; date?: string; now?: Date } = {}): Project {
  const from = stageOf(p);
  const date = o.date ?? (o.now ?? new Date()).toISOString().slice(0, 10);
  const stamped = stampSheets({ ...p, stage: { ...(p.stage ?? {}), current: from } }, STAGE_INFO[from].sheetStatus);
  const issued = issueRevision(stamped, { description: STAGE_INFO[from].issue, by: o.by, date });
  const rev = issued.revisions![issued.revisions!.length - 1];
  const based = setBaseline(issued, rev.id, o.by, o.now);
  const gates = [...(p.stage?.gates ?? []), { stage: from, date, revisionId: rev.id, ...(o.by?.trim() ? { by: o.by.trim() } : {}) }];
  const to = nextStage(p) ?? from;
  const moved: Project = { ...based, stage: { ...(based.stage ?? { current: from }), current: to, gates } };
  return to === from ? moved : stampSheets(moved, STAGE_INFO[to].sheetStatus);
}

/** Whether the stage statuses are in the sheet status list (they are added there for the drawings page). */
export const stageStatusesListed = () => ALL.every((s) => SHEET_STATUSES.includes(STAGE_INFO[s].sheetStatus));

export const prevStage = (p: Project): DesignStage | undefined => stagesOf(p)[stageIndex(p) - 1];

/** Undoes a stage gate issued by mistake: back to the previous stage (or, after the IFC issue, IFC is reopened).
 * The issued revision stays in the history and stays the baseline, so what changes from here is still tracked;
 * only the gate record is removed and the drawings take the stage's status again. */
export function stepBackStage(p: Project): Project {
  const gates = p.stage?.gates ?? [];
  if (stageOf(p) === 'ifc' && ifcIssued(p)) {
    const i = gates.map((g) => g.stage).lastIndexOf('ifc');
    return { ...p, stage: { ...p.stage!, gates: gates.filter((_, k) => k !== i) } };
  }
  const to = prevStage(p);
  if (!to) return p;
  const i = gates.map((g) => g.stage).lastIndexOf(to);
  return stampSheets({ ...p, stage: { ...(p.stage ?? { current: to }), current: to, gates: i < 0 ? gates : gates.filter((_, k) => k !== i) } }, STAGE_INFO[to].sheetStatus);
}
