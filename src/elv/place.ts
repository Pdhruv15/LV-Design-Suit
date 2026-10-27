import { addOp, newModification, transition, withRecord } from '../model/designChanges';
import type { Project } from '../types';
import { addElvCircuits, planElvPlacement, type ElvPlacementPlan } from './placement';

/** Placing the accepted ELV loads, shared by the app and the headless tool: the planned circuits are added and a
 * changed kW becomes a proposal (Reports → Changes); removed loads and placeholders only come back as warnings. */

export interface ElvPlaced {
  project: Project;
  plan: ElvPlacementPlan;
  added: string[]; // circuit IDs, in plan.add order
  proposal?: string; // modification record ID for the kW changes
  warnings: string[];
}

export function placeElvLoads(project: Project, boards: Record<string, string>, author: string, approvedBy?: string): ElvPlaced {
  const plan = planElvPlacement(project, boards);
  if (!plan.add.length && !plan.kwChanges.length && !plan.unplaced.length && !plan.removed.length && !plan.same.length) throw new Error('No ELV loads have been accepted in this project: review and accept an ELV loads package first.');
  const { project: placed, added } = addElvCircuits(project, plan);
  let next = placed, proposal: string | undefined;
  if (plan.kwChanges.length) {
    const n = plan.kwChanges.length;
    let rec = newModification(next, { title: 'ELV load changes', reason: `The accepted ELV loads package changes the load of ${n} ELV circuit${n === 1 ? '' : 's'}${approvedBy ? ` (placement approved by ${approvedBy})` : ''}.`, author });
    for (const c of plan.kwChanges) rec = addOp(next, rec, 'feeder', c.feederId, 'loadKw', c.toKw);
    const t = transition(next, rec, 'proposed', { by: author });
    if (!t.ok) throw new Error(t.error);
    next = withRecord(next, t.record);
    proposal = t.record.id;
  }
  const warnings = [
    ...plan.unplaced.map((u) => `${u.load.id} not placed: ${u.why}. Choose its board.`),
    ...plan.removed.map((r) => `${r.feederId} (${r.name}) feeds a load no longer in the accepted package: delete it if it is not needed.`),
    ...plan.placeholders.map((r) => `${r.feederId} is the "${r.name}" placeholder: delete it now that the ELV loads are placed.`)
  ];
  return { project: next, plan, added, ...(proposal ? { proposal } : {}), warnings };
}
