import type { Project } from '../types';
import type { CalcRun } from '../calc/runs';
import type { TodoItem } from '../calc/dashboard';
import { appliedFollowUp, conflictsOf, STATUS_LABEL } from './designChanges';
import { baselineMessage, baselineStatus, validateRecord } from './proposalRules';

/** What is outstanding on modification records, for the Overview and readiness. Accepting a proposal is a recorded decision,
 * not a finding that the design is acceptable or the calculations pass, so only things that need technical action count as
 * checks: a record that cannot be applied as it stands, and an applied record whose studies have not been run again. */
export interface ProposalOutstanding {
  /** Needs action: counted with the other to-do checks. */
  todo: TodoItem[];
  /** For information on the Overview: waiting for a decision, or accepted and waiting to be applied. */
  pending: { id: string; text: string }[];
  counts: { draft: number; awaitingDecision: number; acceptedNotApplied: number; conflicts: number; needRerun: number; unsound: number };
}

export function proposalOutstanding(p: Project, run?: CalcRun): ProposalOutstanding {
  const out: ProposalOutstanding = { todo: [], pending: [], counts: { draft: 0, awaitingDecision: 0, acceptedNotApplied: 0, conflicts: 0, needRerun: 0, unsound: 0 } };
  const go = { view: 'modifications' as const };
  for (const r of p.modifications ?? []) {
    const bad = validateRecord(r);
    if (bad.length) { out.counts.unsound++; out.todo.push({ status: 'warn', text: `${r.id} is not a sound record (${bad[0]}) and cannot be advanced`, go }); continue; }
    if (r.status === 'rejected' || r.status === 'superseded') continue;
    if (r.applied?.source === 'applied') {
      const f = appliedFollowUp(p, r, run);
      if (f && f.studies !== 'current') { out.counts.needRerun++; out.todo.push({ status: 'warn', text: `${r.id} was applied — ${f.studies === 'not run' ? 'run the studies' : 'the study results are out of date; run them again'} and review the results`, go }); }
      continue;
    }
    if (r.applied) continue; // recorded from edits already made in the draft
    const bm = baselineMessage(baselineStatus(p, r), r);
    if (r.status === 'draft') out.counts.draft++;
    else if (r.status === 'accepted') out.counts.acceptedNotApplied++;
    else out.counts.awaitingDecision++;
    out.pending.push({ id: r.id, text: `${r.id} ${r.title} — ${STATUS_LABEL[r.status].toLowerCase()}${r.status === 'accepted' ? ', not yet applied' : ''}` });
    if (bm) out.todo.push({ status: 'warn', text: `${r.id}: ${bm}`, go });
    if (r.status !== 'draft') {
      const c = conflictsOf(p, r);
      if (c.length) { out.counts.conflicts++; out.todo.push({ status: 'warn', text: `${r.id}: ${c.length} value${c.length === 1 ? '' : 's'} changed since it was proposed — reconcile before ${r.status === 'accepted' ? 'applying' : 'deciding'}`, go }); }
    }
  }
  return out;
}
