import type { Project } from '../types';
import type { CalcRun, StudyKey } from './runs';
import { staleStudies } from './runs';
import type { Dashboard } from './dashboard';
import type { MainView } from '../views';
import { changedSinceRevision } from '../model/revisions';
import { inScope, viewInScope, type ScopeId } from '../model/brief';
import type { TodoItem } from './dashboard';
import { openTenderQueries, reviewSummary } from '../model/reviewComments';
import { gateOf, ifcIssued, splitByStage, STAGE_INFO, stageIndex, stagesOf, viewStage, type DesignStage, type StageGate } from '../model/designStage';
export interface ReadinessStage { id: string; label: string; done: boolean; detail: string; go: MainView | 'settings'; /** false when the project's scope leaves this stage out (it stays reachable, but is not counted). */ applicable: boolean }
const CALC_SCOPE: ScopeId[] = ['studies', 'sld', 'loads', 'earthing', 'ups', 'solar', 'pfc'];
const anyScope = (p: Project, ids: ScopeId[]) => ids.some((id) => inScope(p, id));
/** Readiness is derived from current inputs, never a stored approval flag. */
/** The to-do findings split by the project's scope: what counts, and what belongs to systems left out of the scope
 * (still listed, so a UPS problem is not hidden just because UPS is not part of this job). */
export function splitTodo(p: Project, todo: TodoItem[]): { counted: TodoItem[]; outside: TodoItem[] } {
  const counted: TodoItem[] = [], outside: TodoItem[] = [];
  for (const t of todo) (viewInScope(p, t.go?.view) ? counted : outside).push(t);
  return { counted, outside };
}
export function projectReadiness(p: Project, d: Dashboard, run?: CalcRun, stale: StudyKey[] = [], saved = false): ReadinessStage[] {
  const fresh = !!run && !stale.length && !staleStudies(run, p).length;
  const { counted, outside } = splitTodo(p, d.todo);
  const failures = counted.filter(t => t.status === 'bad').length;
  const unverified = counted.filter(t => t.status === 'warn').length;
  const rv = reviewSummary(p);
  const blocking = rv.critical + rv.reReview;
  const hasLoads = p.feeders.some(f => !f.feedsBoardId && (f.loadKw ?? 0) > 0);
  const drawings = !!p.drawingSet?.sheets.length;
  const stages: Omit<ReadinessStage, 'applicable'>[] = [
    { id: 'setup', label: 'Setup', done: !!(p.info?.owner && p.info?.plotNo && p.info?.consultant), detail: 'Owner, plot and consultant', go: 'settings' },
    { id: 'design', label: 'Design', done: p.boards.length > 0 && hasLoads, detail: 'Boards and loads entered', go: 'design' },
    { id: 'calculate', label: 'Calculate', done: fresh, detail: !run ? 'Run the network calculations' : fresh ? 'Network results are current' : 'Inputs changed; run again', go: 'dashboard' },
    { id: 'resolve', label: 'Resolve issues', done: fresh && !failures && !unverified && !blocking, detail: `${failures} failed · ${unverified} to check / not verified${rv.critical ? ` · ${rv.critical} critical review comment${rv.critical === 1 ? '' : 's'} open` : ''}${rv.reReview ? ` · ${rv.reReview} closed comment${rv.reReview === 1 ? '' : 's'} to re-review` : ''}${!fresh ? ' · current results required' : ''}${outside.length ? ` · ${outside.length} outside this project’s scope (listed in To do)` : ''}`, go: 'dashboard' },
    { id: 'drawings', label: 'Drawings', done: drawings && !counted.some(t => t.go?.view === 'drawings'), detail: drawings ? 'Resolve drawing and title-block checks' : 'Create the drawing set', go: 'drawings' },
    { id: 'issue', label: 'Save and issue', done: saved && !!p.revisions?.length && !changedSinceRevision(p), detail: !saved ? 'Save the current project' : !p.revisions?.length ? 'Record a project revision' : changedSinceRevision(p) ? 'Design changed since the last revision' : 'Current design saved and revision recorded', go: 'revisions' }
  ];
  const applicable: Record<string, boolean> = { design: anyScope(p, ['sld', 'loads']), calculate: anyScope(p, CALC_SCOPE), resolve: anyScope(p, CALC_SCOPE), drawings: anyScope(p, ['sld', 'earthing']) };
  return stages.map((s) => ({ ...s, applicable: applicable[s.id] ?? true }));
}

/** One check of a design stage's checklist (Overview → stage bar). */
export interface StageCheck { label: string; done: boolean; go: MainView | 'settings' }
export interface StageCard { stage: DesignStage; label: string; does: string; state: 'done' | 'current' | 'next'; checks: StageCheck[]; gate?: StageGate }
const MAIN_KINDS = new Set(['MDB', 'LV-MDB', 'SMDB', 'EMDB', 'MCC']);

/** The checklist of every stage the project goes through: what each stage needs before its package is issued.
 * Derived from the inputs, never stored; a stage is done when its gate has been passed. */
export function stageChecklist(p: Project, d: Dashboard, run?: CalcRun, stale: StudyKey[] = [], saved = false): StageCard[] {
  const ready = projectReadiness(p, d, run, stale, saved);
  const r = (id: string) => ready.find((s) => s.id === id)!;
  const { counted } = splitByStage(p, d.todo);
  const upTo = (s: DesignStage) => counted.filter((t) => { const v = viewStage(t.go?.view); return !v || STAGE_ORDER.indexOf(v) <= STAGE_ORDER.indexOf(s); });
  const rv = reviewSummary(p);
  const sheets = p.drawingSet?.sheets ?? [];
  const checks: Record<DesignStage, StageCheck[]> = {
    concept: [
      { label: 'Building and GFA', done: !!p.building?.buildings.length || (p.loadAssessment?.gfaM2 ?? 0) > 0, go: 'building' },
      { label: 'Load assessment', done: !!p.loadAssessment, go: 'load-assessment' },
      { label: 'Transformers and generator', done: !!p.txGen, go: 'sizing' },
      { label: 'Substation and room areas', done: !!p.substations?.length, go: 'substation-area' }
    ],
    schematic: [
      { label: 'Main boards entered', done: p.boards.filter((b) => MAIN_KINDS.has(b.kind ?? '')).length > 0 && p.boards.length > 1, go: 'panels' },
      { label: 'Board loads entered', done: r('design').done, go: 'design' },
      { label: 'Riser / schematic drawing', done: sheets.some((s) => (s.kind as string) === 'riser' || (s.kind as string) === 'system'), go: 'drawings' },
      { label: 'Main checks clear', done: !upTo('schematic').some((t) => t.status === 'bad'), go: 'dashboard' }
    ],
    detailed: [
      { label: 'All DBs and circuits', done: r('design').done, go: 'design' },
      { label: 'Calculations current', done: r('calculate').done, go: 'dashboard' },
      { label: 'All checks pass', done: r('resolve').done, go: 'dashboard' },
      { label: 'Drawing set', done: r('drawings').done, go: 'drawings' }
    ],
    tender: [
      { label: 'BOQ revision issued', done: !!p.boqRevisions?.length, go: 'boq' },
      { label: 'Tender queries closed', done: openTenderQueries(p) === 0, go: 'review' },
      { label: 'Logged for tender', done: (p.submissions ?? []).some((s) => s.purpose === 'For tender'), go: 'submissions' }
    ],
    ifc: [
      { label: 'Review comments closed', done: rv.open === 0 && rv.reReview === 0, go: 'review' },
      { label: 'Checks re-run and pass', done: r('resolve').done, go: 'dashboard' },
      { label: 'IFC issued', done: ifcIssued(p), go: 'revisions' },
      { label: 'No change since IFC', done: ifcIssued(p) && !changedSinceRevision(p), go: 'modifications' }
    ]
  };
  const now = stageIndex(p);
  return stagesOf(p).map((s, i) => ({
    stage: s, label: STAGE_INFO[s].label, does: STAGE_INFO[s].does, checks: checks[s], gate: gateOf(p, s),
    state: i < now || (s === 'ifc' && ifcIssued(p)) ? 'done' : i === now ? 'current' : 'next'
  }));
}
const STAGE_ORDER: DesignStage[] = ['concept', 'schematic', 'detailed', 'tender', 'ifc'];
