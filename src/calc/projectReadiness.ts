import type { Project } from '../types';
import type { CalcRun, StudyKey } from './runs';
import { staleStudies } from './runs';
import type { Dashboard } from './dashboard';
import type { MainView } from '../views';
import { changedSinceRevision } from '../model/revisions';
import { inScope, type ScopeId } from '../model/brief';
export interface ReadinessStage { id: string; label: string; done: boolean; detail: string; go: MainView | 'settings'; /** false when the project's scope leaves this stage out (it stays reachable, but is not counted). */ applicable: boolean }
const CALC_SCOPE: ScopeId[] = ['studies', 'sld', 'loads', 'earthing', 'ups', 'solar', 'pfc'];
const anyScope = (p: Project, ids: ScopeId[]) => ids.some((id) => inScope(p, id));
/** Readiness is derived from current inputs, never a stored approval flag. */
export function projectReadiness(p: Project, d: Dashboard, run?: CalcRun, stale: StudyKey[] = [], saved = false): ReadinessStage[] {
  const fresh = !!run && !stale.length && !staleStudies(run, p).length;
  const failures = d.todo.filter(t => t.status === 'bad').length;
  const unverified = d.todo.filter(t => t.status === 'warn').length;
  const hasLoads = p.feeders.some(f => !f.feedsBoardId && (f.loadKw ?? 0) > 0);
  const drawings = !!p.drawingSet?.sheets.length;
  const stages: Omit<ReadinessStage, 'applicable'>[] = [
    { id: 'setup', label: 'Setup', done: !!(p.info?.owner && p.info?.plotNo && p.info?.consultant), detail: 'Owner, plot and consultant', go: 'settings' },
    { id: 'design', label: 'Design', done: p.boards.length > 0 && hasLoads, detail: 'Boards and loads entered', go: 'design' },
    { id: 'calculate', label: 'Calculate', done: fresh, detail: !run ? 'Run the network calculations' : fresh ? 'Network results are current' : 'Inputs changed; run again', go: 'dashboard' },
    { id: 'resolve', label: 'Resolve issues', done: fresh && !failures && !unverified, detail: `${failures} failed · ${unverified} to check / not verified${!fresh ? ' · current results required' : ''}`, go: 'dashboard' },
    { id: 'drawings', label: 'Drawings', done: drawings && !d.todo.some(t => t.go?.view === 'drawings'), detail: drawings ? 'Resolve drawing and title-block checks' : 'Create the drawing set', go: 'drawings' },
    { id: 'issue', label: 'Save and issue', done: saved && !!p.revisions?.length && !changedSinceRevision(p), detail: !saved ? 'Save the current project' : !p.revisions?.length ? 'Record a project revision' : changedSinceRevision(p) ? 'Design changed since the last revision' : 'Current design saved and revision recorded', go: 'revisions' }
  ];
  const applicable: Record<string, boolean> = { design: anyScope(p, ['sld', 'loads']), calculate: anyScope(p, CALC_SCOPE), resolve: anyScope(p, CALC_SCOPE), drawings: anyScope(p, ['sld', 'earthing']) };
  return stages.map((s) => ({ ...s, applicable: applicable[s.id] ?? true }));
}
