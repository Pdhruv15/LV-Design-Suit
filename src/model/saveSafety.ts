import type { Project } from '../types';

/** What a project file is at a moment: modified time, size and a content hash (made by the desktop app's main process). */
export interface FileStamp { mtimeMs: number; size: number; hash: string }

export type SaveOutcome =
  | { conflict?: false; file: string; stamp?: FileStamp | null }
  | { conflict: true; file: string; disk?: FileStamp | null };

/** A short fingerprint of a project's content, to tell "changed" from "same again after undo". */
export function projectFingerprint(p: Project): string {
  const s = JSON.stringify(p);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${s.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

const SECTION_LABEL: Record<string, string> = {
  name: 'Project name', boards: 'Panels', feeders: 'Circuits', revisions: 'Issued revisions', drawingSet: 'Drawing sheets', drawing: 'SLD title block', info: 'Project information',
  params: 'Parameters', trays: 'Cable trays', upsSystems: 'UPS systems', pv: 'Solar PV', building: 'Building information', boq: 'BOQ changes', priceList: 'Price list', earthingPlan: 'Earthing plan',
  studyReport: 'Study report setup', status: 'Status', ties: 'Bus couplers', components: 'Own components', titleTemplates: 'Title block templates', voltageV: 'System voltage', ambientC: 'Ambient temperature'
};
const IGNORED = new Set(['updatedAt', 'updatedBy']);

export interface SectionChange { key: string; label: string; detail: string }

/** Which parts of two versions of a project differ (for "what changed on disk"). */
export function diffSections(mine: Project, theirs: Project): SectionChange[] {
  const a = mine as unknown as Record<string, unknown>, b = theirs as unknown as Record<string, unknown>;
  const out: SectionChange[] = [];
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (IGNORED.has(key)) continue;
    const x = a[key], y = b[key];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    const label = SECTION_LABEL[key] ?? key;
    let detail = 'changed';
    if (Array.isArray(x) && Array.isArray(y)) {
      const idOf = (v: unknown) => (v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : JSON.stringify(v));
      const ia = new Map(x.map((v) => [idOf(v), JSON.stringify(v)])), ib = new Map(y.map((v) => [idOf(v), JSON.stringify(v)]));
      const added = [...ib.keys()].filter((k) => !ia.has(k)).length, removed = [...ia.keys()].filter((k) => !ib.has(k)).length;
      const edited = [...ia.keys()].filter((k) => ib.has(k) && ia.get(k) !== ib.get(k)).length;
      detail = [`${x.length} → ${y.length}`, added && `${added} only in the other`, removed && `${removed} only in yours`, edited && `${edited} edited`].filter(Boolean).join(', ');
    } else if (x === undefined) detail = 'only in the other';
    else if (y === undefined) detail = 'only in yours';
    out.push({ key, label, detail });
  }
  return out;
}
