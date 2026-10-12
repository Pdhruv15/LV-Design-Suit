import { pushLibrary } from '../database/librarySync';
import { STUDY_DEFAULTS, type Project, type StudySettings } from '../types';

/** Design references: named sets of design values (voltage drop limit,
 * ambient, ELCB sensitivity …) from an authority, a standard or your own
 * company practice, each value with its clause and a note, plus free
 * reference entries of your own. Built-in references are read only; duplicate
 * one to customise it. Your references are kept in LV Database/Library.json,
 * so they sync through Google Drive to every computer. A project applies one:
 * the values go into its settings and the project records which reference
 * (and version) it used. */

export type RefKind = 'authority' | 'standard' | 'company';
export type RefStatus = 'verified' | 'to-verify';

export const REF_KINDS: [RefKind, string][] = [['authority', 'Authority'], ['standard', 'Standard'], ['company', 'Company practice']];
export const REF_STATUSES: [RefStatus, string][] = [['to-verify', 'To verify'], ['verified', 'Verified']];

/** Where a value lives in the project. */
type Target = 'project' | 'study' | 'info';
export interface RefField { key: RefKey; label: string; unit: string; target: Target; step?: number; min?: number; max?: number }

export const REF_FIELDS = [
  { key: 'voltageV', label: 'System voltage (phase-phase)', unit: 'V', target: 'project', min: 200, max: 1000 },
  { key: 'frequencyHz', label: 'Frequency', unit: 'Hz', target: 'project', min: 50, max: 60 },
  { key: 'ambientC', label: 'Design ambient temperature', unit: '°C', target: 'project', min: 20, max: 70 },
  { key: 'vdLimitPct', label: 'Voltage drop limit, source to load', unit: '%', target: 'project', step: 0.5, min: 1, max: 10 },
  { key: 'pfTarget', label: 'Power factor target', unit: '', target: 'study', step: 0.01, min: 0.8, max: 1 },
  { key: 'futureGrowthPct', label: 'Future load growth', unit: '%', target: 'study', min: 0, max: 100 },
  { key: 'transformerMaxLoadingPct', label: 'Transformer max loading', unit: '%', target: 'study', min: 10, max: 100 },
  { key: 'generatorMaxLoadingPct', label: 'Generator max loading', unit: '%', target: 'study', min: 10, max: 100 },
  { key: 'minWireLightingMm2', label: 'Lighting circuits — min wire', unit: 'mm²', target: 'study', min: 1, max: 10 },
  { key: 'minWirePowerMm2', label: 'Power circuits — min wire', unit: 'mm²', target: 'study', min: 1, max: 10 },
  { key: 'elcbLightingMa', label: 'Lighting circuits — ELCB', unit: 'mA', target: 'study', min: 10, max: 300 },
  { key: 'elcbPowerMa', label: 'Power circuits — ELCB', unit: 'mA', target: 'study', min: 10, max: 300 },
  { key: 'mdDemandFactor', label: 'Demand factor for maximum demand', unit: '', target: 'info', step: 0.05, min: 0.1, max: 1 }
] as const satisfies readonly { key: string; label: string; unit: string; target: Target; step?: number; min?: number; max?: number }[];

export type RefKey = (typeof REF_FIELDS)[number]['key'];

export interface RefValue { value: number; clause?: string; note?: string }
/** A free reference line: anything you want to look up (e.g. "Sockets per circuit", "6", "", "DEWA Reg. 5.3"). */
export interface RefEntry { id: string; topic: string; value: string; unit?: string; clause?: string; note?: string }

export interface DesignReference {
  id: string;
  name: string;
  kind: RefKind;
  region?: string; // e.g. Dubai, Abu Dhabi, International
  edition?: string; // e.g. "BS 7671:2018+A3:2024"
  source?: string; // document title or link
  status: RefStatus;
  notes?: string;
  values: Partial<Record<RefKey, RefValue>>;
  entries: RefEntry[];
  builtIn?: boolean;
  basedOn?: string; // id of the reference it was duplicated from
  version: number; // raised on every save
  updatedAt: string; // ISO date
}

/** What a project records when a reference is applied. */
export interface AppliedReference {
  id: string;
  name: string;
  version: number;
  appliedAt: string;
  values: Partial<Record<RefKey, number>>; // the values written into the project
}

// ---- Built-in references -------------------------------------------------------

const D = '2026-10-12';
const app = STUDY_DEFAULTS;
/** The values the app has used for new projects so far (DEWA practice). */
const APP_VALUES: Partial<Record<RefKey, RefValue>> = {
  voltageV: { value: 415 }, frequencyHz: { value: 50 }, ambientC: { value: 45 }, vdLimitPct: { value: 4 },
  pfTarget: { value: app.pfTarget }, futureGrowthPct: { value: app.futureGrowthPct },
  transformerMaxLoadingPct: { value: app.transformerMaxLoadingPct }, generatorMaxLoadingPct: { value: app.generatorMaxLoadingPct },
  minWireLightingMm2: { value: app.minWireLightingMm2 }, minWirePowerMm2: { value: app.minWirePowerMm2 },
  elcbLightingMa: { value: app.elcbLightingMa }, elcbPowerMa: { value: app.elcbPowerMa }, mdDemandFactor: { value: 0.8 }
};
const copiedFromDewa = (who: string) => Object.fromEntries(Object.entries(APP_VALUES).map(([k, v]) => [k, { ...v, note: `Copied from the DEWA values — check against the ${who} regulations` }])) as Partial<Record<RefKey, RefValue>>;

export const BUILT_IN_REFERENCES: DesignReference[] = [
  {
    id: 'builtin-dewa', name: 'DEWA (Dubai)', kind: 'authority', region: 'Dubai', status: 'to-verify', builtIn: true, version: 1, updatedAt: D,
    source: 'DEWA Regulations for Electrical Installations',
    notes: 'The values the app has used for new projects. Check them against the current DEWA regulations and circulars, then duplicate and mark your copy as verified.',
    values: APP_VALUES, entries: []
  },
  {
    id: 'builtin-iec', name: 'IEC 60364', kind: 'standard', region: 'International', edition: 'IEC 60364 series', status: 'to-verify', builtIn: true, version: 1, updatedAt: D,
    source: 'IEC 60364-4-41, IEC 60364-5-52',
    notes: 'Only the values the standard itself sets. Sizing targets (PF, growth, loading) are project or authority choices and are left blank.',
    values: {
      voltageV: { value: 400, note: '230/400 V (IEC 60038)' },
      frequencyHz: { value: 50 },
      ambientC: { value: 30, clause: 'IEC 60364-5-52 Annex B', note: 'Reference ambient for cables in air; use the site ambient for design' },
      vdLimitPct: { value: 5, clause: 'IEC 60364-5-52 Annex G', note: 'Informative: 3 % lighting, 5 % other uses from a public LV supply (6 % / 8 % from a private supply)' },
      elcbPowerMa: { value: 30, clause: 'IEC 60364-4-41, 411.3.3', note: 'Socket-outlets up to 32 A' }
    },
    entries: [
      { id: 'iec-vd-ltg', topic: 'Voltage drop — lighting (public LV supply)', value: '3', unit: '%', clause: 'IEC 60364-5-52 Annex G' },
      { id: 'iec-vd-oth', topic: 'Voltage drop — other uses (public LV supply)', value: '5', unit: '%', clause: 'IEC 60364-5-52 Annex G' },
      { id: 'iec-disc', topic: 'Disconnection time, final circuits ≤ 32 A, TN 230 V', value: '0.4', unit: 's', clause: 'IEC 60364-4-41 Table 41.1' }
    ]
  },
  {
    id: 'builtin-bs7671', name: 'BS 7671', kind: 'standard', region: 'United Kingdom', edition: 'BS 7671:2018+A3:2024', status: 'to-verify', builtIn: true, version: 1, updatedAt: D,
    source: 'BS 7671 Requirements for Electrical Installations (IET Wiring Regulations)',
    notes: 'Check the amendment in force for the project.',
    values: {
      voltageV: { value: 400, note: '230/400 V' },
      frequencyHz: { value: 50 },
      ambientC: { value: 30, clause: 'Appendix 4', note: 'Reference ambient of the current-rating tables; use the site ambient for design' },
      vdLimitPct: { value: 5, clause: 'Appendix 4, 6.4', note: '3 % lighting, 5 % other uses from a public LV supply' },
      elcbLightingMa: { value: 30, clause: 'Reg. 411.3.4', note: 'Luminaires in domestic (household) premises' },
      elcbPowerMa: { value: 30, clause: 'Reg. 411.3.3', note: 'Socket-outlets up to 32 A' }
    },
    entries: [
      { id: 'bs-vd-ltg', topic: 'Voltage drop — lighting (public LV supply)', value: '3', unit: '%', clause: 'Appendix 4, 6.4' },
      { id: 'bs-vd-oth', topic: 'Voltage drop — other uses (public LV supply)', value: '5', unit: '%', clause: 'Appendix 4, 6.4' },
      { id: 'bs-disc', topic: 'Disconnection time, final circuits ≤ 32 A, TN 230 V', value: '0.4', unit: 's', clause: 'Table 41.1' }
    ]
  },
  {
    id: 'builtin-addc', name: 'ADDC (Abu Dhabi)', kind: 'authority', region: 'Abu Dhabi', status: 'to-verify', builtIn: true, version: 1, updatedAt: D,
    source: 'Abu Dhabi Electricity Wiring Regulations',
    notes: 'Starting values only, copied from DEWA. Check every value against the current Abu Dhabi regulations before use.',
    values: copiedFromDewa('Abu Dhabi'), entries: []
  },
  {
    id: 'builtin-etihadwe', name: 'EtihadWE (Northern Emirates)', kind: 'authority', region: 'Northern Emirates', status: 'to-verify', builtIn: true, version: 1, updatedAt: D,
    source: 'Etihad Water & Electricity regulations',
    notes: 'Starting values only, copied from DEWA. Check every value against the current EtihadWE regulations before use.',
    values: copiedFromDewa('EtihadWE'), entries: []
  }
];

// ---- Library -------------------------------------------------------------------

export const REFERENCES_KEY = 'lvds.designReferences';

const isRef = (x: unknown): x is DesignReference =>
  !!x && typeof x === 'object' && typeof (x as DesignReference).id === 'string' && typeof (x as DesignReference).name === 'string';

/** Cleans a reference read from a file: unknown keys and non-numbers dropped. */
export function normaliseReference(r: DesignReference): DesignReference {
  const values: Partial<Record<RefKey, RefValue>> = {};
  for (const f of REF_FIELDS) {
    const v = r.values?.[f.key];
    if (v && Number.isFinite(Number(v.value))) values[f.key] = { value: Number(v.value), ...(v.clause && { clause: String(v.clause) }), ...(v.note && { note: String(v.note) }) };
  }
  return {
    ...r,
    kind: REF_KINDS.some(([k]) => k === r.kind) ? r.kind : 'company',
    status: r.status === 'verified' ? 'verified' : 'to-verify',
    values,
    entries: Array.isArray(r.entries) ? r.entries.filter((e) => e && typeof e.topic === 'string').map((e, i) => ({ ...e, id: e.id || `e-${i}`, value: String(e.value ?? '') })) : [],
    builtIn: undefined,
    version: Number.isFinite(r.version) && r.version > 0 ? r.version : 1,
    updatedAt: r.updatedAt || new Date().toISOString().slice(0, 10)
  };
}

/** Your references on this computer (synced from Library.json). */
export function loadUserReferences(): DesignReference[] {
  try {
    const v = JSON.parse(localStorage.getItem(REFERENCES_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isRef).map(normaliseReference) : [];
  } catch { return []; }
}
export function saveUserReferences(list: DesignReference[]): void {
  try { localStorage.setItem(REFERENCES_KEY, JSON.stringify(list.filter((r) => !r.builtIn))); void pushLibrary(); } catch { /* storage full or blocked */ }
}
/** Built-in references, then yours. */
export const loadReferences = (): DesignReference[] => [...BUILT_IN_REFERENCES, ...loadUserReferences()];

const newId = () => `ref-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const today = () => new Date().toISOString().slice(0, 10);

export function newReference(name = 'My reference'): DesignReference {
  return { id: newId(), name, kind: 'company', status: 'to-verify', values: {}, entries: [], version: 1, updatedAt: today() };
}

/** An editable copy (built-in or not), version 1, linked to the original. */
export function duplicateReference(r: DesignReference, name = `${r.name} (copy)`): DesignReference {
  return { ...structuredClone(r), id: newId(), name, builtIn: undefined, basedOn: r.id, version: 1, updatedAt: today() };
}

/** Stores an edited reference: version raised, date stamped. */
export function saveReference(list: DesignReference[], r: DesignReference): DesignReference[] {
  if (r.builtIn) return list;
  const prev = list.find((x) => x.id === r.id);
  const next = { ...r, version: prev ? prev.version + 1 : r.version, updatedAt: today() };
  return prev ? list.map((x) => (x.id === r.id ? next : x)) : [...list, next];
}

/** Problems that stop a reference being saved. */
export function referenceIssues(r: DesignReference, others: DesignReference[] = []): string[] {
  const issues: string[] = [];
  if (!r.name.trim()) issues.push('Give the reference a name.');
  else if (others.some((o) => o.id !== r.id && o.name.trim().toLowerCase() === r.name.trim().toLowerCase())) issues.push(`Another reference is already called "${r.name.trim()}".`);
  for (const f of REF_FIELDS) {
    const v = r.values[f.key];
    if (!v) continue;
    const range = f as RefField;
    if (!Number.isFinite(v.value) || (range.min !== undefined && v.value < range.min) || (range.max !== undefined && v.value > range.max))
      issues.push(`${f.label}: ${v.value} is outside ${range.min ?? '…'}–${range.max ?? '…'}${f.unit ? ` ${f.unit}` : ''}.`);
  }
  return issues;
}

// ---- Export / import -------------------------------------------------------------

export function exportReferences(list: DesignReference[]): string {
  return JSON.stringify({ kind: 'lvds-design-references', exportedAt: new Date().toISOString(), references: list.map((r) => ({ ...r, builtIn: undefined })) }, null, 2);
}

/** Reads an exported file. Imported references become yours; one whose id or
 * name is already taken is imported as a new copy rather than replacing it. */
export function importReferences(text: string, existing: DesignReference[]): { added: DesignReference[]; error?: string } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { added: [], error: 'The file is not valid JSON.' }; }
  const raw = Array.isArray(data) ? data : (data as { references?: unknown })?.references;
  if (!Array.isArray(raw)) return { added: [], error: 'No design references found in the file.' };
  const names = new Set(existing.map((r) => r.name.trim().toLowerCase()));
  const ids = new Set(existing.map((r) => r.id));
  const added: DesignReference[] = [];
  for (const x of raw.filter(isRef)) {
    const r = normaliseReference(x);
    let name = r.name.trim();
    while (names.has(name.toLowerCase())) name = `${name} (imported)`;
    names.add(name.toLowerCase());
    const id = ids.has(r.id) ? newId() : r.id;
    ids.add(id);
    added.push({ ...r, id, name });
  }
  return added.length ? { added } : { added, error: 'No design references found in the file.' };
}

// ---- Project -----------------------------------------------------------------------

/** The project's value for a reference field. */
export function projectValue(p: Project, key: RefKey): number | undefined {
  const f = REF_FIELDS.find((x) => x.key === key)!;
  if (f.target === 'project') return p[key as 'voltageV' | 'frequencyHz' | 'ambientC' | 'vdLimitPct'];
  if (f.target === 'info') return p.info?.mdDemandFactor;
  return p.studySettings?.[key as keyof StudySettings] ?? STUDY_DEFAULTS[key as keyof StudySettings];
}

export interface RefChange { key: RefKey; label: string; unit: string; from?: number; to: number }

/** What applying the reference would change (blank reference values change nothing). */
export function referenceChanges(p: Project, r: DesignReference): RefChange[] {
  const out: RefChange[] = [];
  for (const f of REF_FIELDS) {
    const v = r.values[f.key];
    if (!v) continue;
    const from = projectValue(p, f.key);
    if (from !== v.value) out.push({ key: f.key, label: f.label, unit: f.unit, from, to: v.value });
  }
  return out;
}

/** Writes the reference's values into the project and records the reference used. */
export function applyReference(p: Project, r: DesignReference, at = new Date().toISOString()): Project {
  const next: Project = { ...p, studySettings: { ...p.studySettings }, info: { ...p.info } };
  const values: Partial<Record<RefKey, number>> = {};
  for (const f of REF_FIELDS) {
    const v = r.values[f.key];
    if (!v) continue;
    values[f.key] = v.value;
    if (f.target === 'project') (next as unknown as Record<string, number>)[f.key] = v.value;
    else if (f.target === 'info') next.info = { ...next.info, mdDemandFactor: v.value };
    else next.studySettings = { ...next.studySettings, [f.key]: v.value };
  }
  next.designReference = { id: r.id, name: r.name, version: r.version, appliedAt: at, values };
  return next;
}

/** Fields whose project value no longer matches the applied reference. */
export function changedSinceApplied(p: Project): RefKey[] {
  const a = p.designReference;
  if (!a) return [];
  return (Object.keys(a.values) as RefKey[]).filter((k) => projectValue(p, k) !== a.values[k]);
}

/** "Design reference: DEWA (Dubai) v2" when the project's value still comes from the applied reference. */
export function referenceSourceOf(p: Project, key: RefKey): string | undefined {
  const a = p.designReference;
  if (!a || a.values[key] === undefined || projectValue(p, key) !== a.values[key]) return undefined;
  return `Design reference: ${a.name} v${a.version}`;
}

/** The library reference a project applied, and whether it has been edited since. */
export function appliedStatus(p: Project, list: DesignReference[]): { ref?: DesignReference; newer: boolean; missing: boolean } {
  const a = p.designReference;
  if (!a) return { newer: false, missing: false };
  const ref = list.find((r) => r.id === a.id);
  return { ref, newer: !!ref && ref.version > a.version, missing: !ref };
}
