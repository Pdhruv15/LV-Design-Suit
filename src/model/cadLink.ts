import type { Project } from '../types';

/** Result of updating the drawing open in CAD: tags ("feeder:<id>", "board:<id>", "sheet:<n>") per outcome. */
export interface CadUpdate { changed: string[]; added: string[]; removed: string[]; unchanged: number }

/** A readable name for a CAD tag: the board or feeder name from the project (by its stable ID). */
export function cadTagLabel(tag: string, project: Project): string {
  const [kind, id] = [tag.slice(0, tag.indexOf(':')), tag.slice(tag.indexOf(':') + 1)];
  if (kind === 'board') return id; // board IDs are the names engineers use (MDB-1, SMDB-GF)
  if (kind === 'feeder') {
    const f = project.feeders.find((x) => x.id === id);
    return f ? `${f.boardId} ${f.name || f.id}` : id;
  }
  if (kind === 'sheet') return 'title block and notes';
  return tag;
}

const list = (tags: string[], project: Project) => {
  const names = tags.map((t) => cadTagLabel(t, project));
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ');
};

/** One-line status after an update, naming what was redrawn. */
export function cadUpdateSummary(u: CadUpdate, project: Project): string {
  const parts = [
    u.changed.length ? `redrew ${list(u.changed, project)}` : '',
    u.added.length ? `added ${list(u.added, project)}` : '',
    u.removed.length ? `removed ${list(u.removed, project)}` : ''
  ].filter(Boolean);
  if (!parts.length) return 'OpenCADStudio drawing is already up to date — nothing changed';
  return `Updated in OpenCADStudio: ${parts.join('; ')} (${u.unchanged} unchanged; your own CAD work kept)`;
}
