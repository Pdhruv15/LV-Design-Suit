import type { Project } from '../types';
import { removeDanglingReferences } from './integrity';
import { applyDrop } from './sldEdit';

/** Adding and deleting outgoing feeders from a panel's "connected load,
 * maximum demand & kWh metering" form (MDB, SMDB, MCC …). Adding works
 * like dropping a general load on the panel's busbar on the SLD, so the
 * id, name and breaker / cable sizing are the same as there. */

export interface FeederEditResult {
  project: Project;
  message: string;
  /** The new feeder's id (add only). */
  id?: string;
}

/** Adds an outgoing feeder (a general load, sized by the app) at the end of the panel. */
export function addOutgoingFeeder(project: Project, boardId: string): FeederEditResult {
  if (!project.boards.some((b) => b.id === boardId)) return { project, message: `${boardId} is no longer in the project` };
  const r = applyDrop(project, { kind: 'load', preset: 'general' }, { type: 'bus', boardId });
  return { project: r.project, message: r.message, id: r.select?.type === 'feeder' ? r.select.id : undefined };
}

/** Why an outgoing feeder can't be deleted from the form, or undefined when
 * it can: a feeder that supplies a panel would leave that panel (and all
 * below it) with no supply. */
export function feederDeleteBlock(project: Project, feederId: string): string | undefined {
  const f = project.feeders.find((x) => x.id === feederId);
  if (!f?.feedsBoardId) return undefined;
  const fed = project.boards.find((b) => b.id === f.feedsBoardId);
  if (!fed) return undefined;
  const below = project.boards.filter((b) => b.upstreamId === fed.id).length;
  return `${f.id} supplies ${fed.id}${below ? ` and the ${below} panel${below === 1 ? '' : 's'} fed from it` : ''} — deleting the feeder would leave ${fed.id} with no supply. Delete ${fed.id} on the SLD instead (that removes its feeder too), or move it to another panel first.`;
}

/** Deletes an outgoing feeder, unless it supplies a panel (see feederDeleteBlock). */
export function deleteOutgoingFeeder(project: Project, feederId: string): FeederEditResult {
  const f = project.feeders.find((x) => x.id === feederId);
  if (!f) return { project, message: `${feederId} is no longer in the project` };
  const block = feederDeleteBlock(project, feederId);
  if (block) return { project, message: block };
  return {
    project: removeDanglingReferences({ ...project, feeders: project.feeders.filter((x) => x.id !== feederId) }),
    message: `Deleted ${f.id}${f.name && f.name !== f.id ? ` (${f.name})` : ''} from ${f.boardId}`
  };
}
