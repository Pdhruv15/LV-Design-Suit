import type { Project, StudyReportKind } from '../types';
import type { DesignBasis } from './designBasis';
import type { Section, Table } from './studyReport';

/** The design report's appendices, in a fixed order:
 *   Detailed load schedule · Cable calculations · Short-circuit and earth fault
 *   calculations · Equipment data · Single line diagrams · Reference documents
 * Only the applicable ones are included; they are lettered A, B, C… in that
 * order, so the letters never skip. */

export type AppendixKind = 'load' | 'cable' | 'fault' | 'equipment' | 'sld' | 'refs';

export const APPENDIX_TITLE: Record<AppendixKind, string> = {
  load: 'Detailed load schedule',
  cable: 'Cable calculations',
  fault: 'Short-circuit and earth fault calculations',
  equipment: 'Equipment data',
  sld: 'Single line diagrams',
  refs: 'Reference documents'
};
const ORDER: AppendixKind[] = ['load', 'cable', 'fault', 'equipment', 'sld', 'refs'];

/** Where a section's detail tables go when the table doesn't say. */
const DEFAULT_KIND: Partial<Record<StudyReportKind, AppendixKind>> = { sc: 'fault', earth: 'fault', disc: 'fault', cable: 'cable', lf: 'cable', sizing: 'equipment', load: 'load', schedules: 'load' };
export const appendixKindOf = (s: Section, t: Table): AppendixKind | undefined =>
  !t.appendix ? undefined : t.appendix === true ? DEFAULT_KIND[s.key] ?? 'equipment' : t.appendix;

export interface Appendix {
  kind: AppendixKind;
  letter: string;
  title: string;
  /** Detail tables, with the section they come from. */
  tables: { section?: Section; table: Table }[];
  /** Single line diagram pages (study keys, in report order). */
  slds: StudyReportKind[];
  /** Reference documents: project standards and documents received. */
  refs: { title: string; headers: string[]; rows: string[][] }[];
}

export function planAppendices(project: Project, sections: Section[], sldKeys: StudyReportKind[], equipment: Table[], basis?: DesignBasis): Appendix[] {
  const tables = new Map<AppendixKind, Appendix['tables']>();
  for (const s of sections) for (const t of s.tables) {
    const k = appendixKindOf(s, t);
    if (k) tables.set(k, [...(tables.get(k) ?? []), { section: s, table: t }]);
  }
  if (equipment.length) tables.set('equipment', [...(tables.get('equipment') ?? []), ...equipment.map((table) => ({ table }))]);
  const refs: Appendix['refs'] = [];
  const std = (project.standards ?? []).filter((x) => x.trim());
  if (std.length) refs.push({ title: 'Project standards and specifications', headers: ['Document'], rows: std.map((x) => [x]) });
  if (basis?.standards.methods.length) refs.push({ title: 'Calculation basis', headers: ['Standard', 'Used for'], rows: basis.standards.methods.map((m) => [m.standard, m.used]) });
  const docs = (project.receivedDocs ?? []).filter((d) => !d.supersededBy);
  if (docs.length) refs.push({ title: 'Documents received', headers: ['Ref.', 'Title', 'Number', 'Rev.', 'Received', 'From'], rows: docs.map((d) => [d.id, d.title, d.number, d.revision, d.dateReceived ?? '—', d.originator ?? '—']) });

  const out: Appendix[] = [];
  for (const kind of ORDER) {
    const t = tables.get(kind) ?? [];
    const has = kind === 'sld' ? sldKeys.length > 0 : kind === 'refs' ? refs.length > 0 : t.length > 0;
    if (!has) continue;
    out.push({ kind, letter: String.fromCharCode(65 + out.length), title: APPENDIX_TITLE[kind], tables: t, slds: kind === 'sld' ? sldKeys : [], refs: kind === 'refs' ? refs : [] });
  }
  return out;
}

/** Equipment data from the project (what is drawn, not calculated): boards and their transformers. */
export function equipmentData(project: Project, ids: Set<string>): Table[] {
  const boards = project.boards.filter((b) => ids.has(b.id));
  const nd = 'Not defined';
  const out: Table[] = [{ title: 'Boards', headers: ['Board', 'Type', 'Rating (A)', 'Busbar', 'IP', 'Manufacturer', 'Model', 'Location'],
    rows: boards.map((b) => [b.id, b.kind ?? (b.upstreamId ? 'DB' : 'MDB'), b.ratedCurrentA ?? nd, b.busbarMaterial ?? nd, b.ipRating ?? nd, b.manufacturer ?? nd, b.model ?? nd, b.location ?? nd]) }];
  const tx = boards.filter((b) => b.sourceKva);
  if (tx.length) out.push({ title: 'Transformers', headers: ['Reference', 'Main board', 'Rating (kVA)', '%Z', 'X/R', 'Vector group', 'Substation'],
    rows: tx.map((b) => [b.txRef ?? b.id, b.id, b.sourceKva!, b.sourceImpedancePct ?? nd, b.sourceXr ?? '5 (app default)', b.vectorGroup ?? 'Dyn11 (app default)', b.substation ?? nd]) });
  return out;
}
