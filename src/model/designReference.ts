import { pushLibrary } from '../database/librarySync';
import { STUDY_DEFAULTS, type Project, type StudySettings } from '../types';
import { normaliseRules, ruleIssues, ruleKey, type DesignRule } from './designRules';

/** Design references: named sets of design values (voltage drop limit,
 * ambient, ELCB sensitivity …) from an authority, a standard or your own
 * company practice, each value with its clause and a note, plus free
 * reference entries of your own. Built-in references are read only; duplicate
 * one to customise it. Your references are kept in LV Database/Library.json,
 * so they sync through Google Drive to every computer. A project applies one:
 * the values go into its settings and the project records which reference
 * (and version) it used. A reference may extend another ("Company DEWA"
 * extends "DEWA") and store only what differs; it inherits the rest, and
 * later edits of the base, when applied. */

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
  /** Design rule rows (min wire, ELCB …) by circuit type and load. */
  rules?: DesignRule[];
  /** Id of the reference this one builds on: its values and rules apply unless set here. */
  extends?: string;
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
/** The app's (DEWA) values for fields a regulation does not set, each flagged in its note. */
const fromDewa = (keys: RefKey[], who: string) => Object.fromEntries(keys.map((k) => [k, { ...APP_VALUES[k]!, note: `App value (as DEWA) — not set by the ${who} regulations` }])) as Partial<Record<RefKey, RefValue>>;
const UAE = '2026-10-27';

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
    id: 'builtin-addc', name: 'ADDC (Abu Dhabi)', kind: 'authority', region: 'Abu Dhabi', status: 'to-verify', builtIn: true, version: 2, updatedAt: UAE,
    edition: 'DoE Electricity Wiring Regulations (2020), DoE/PD/R01/001, effective 01/04/2020',
    source: 'Department of Energy, Abu Dhabi — The Electricity Wiring Regulations (2020)',
    notes: 'Basic values from the 2020 Wiring Regulations. The regulations size final circuits by connected load (7.6.1) and set no minimum wire: the minimum wire sizes and the sizing targets are the app\'s values. Check against the current regulations and ADDC / AADC requirements.',
    values: {
      ...fromDewa(['futureGrowthPct', 'transformerMaxLoadingPct', 'generatorMaxLoadingPct', 'mdDemandFactor'], 'Abu Dhabi'),
      voltageV: { value: 400, clause: '4.1.2', note: '230 V single-phase, 400 V three-phase' },
      frequencyHz: { value: 50, clause: '4.1.4' },
      ambientC: { value: 50, clause: '3.7.1(f)', note: 'Outdoor (shaded) 50 °C; indoor not air conditioned 40 °C; air conditioned 30 °C; ground 35 °C at 1 m' },
      vdLimitPct: { value: 4, clause: '7.5.10', note: 'Connection point to the remote end of any final circuit' },
      pfTarget: { value: 0.9, clause: '4.1.7', note: 'Kept between 0.9 lagging and unity at the connection point' },
      elcbLightingMa: { value: 100, clause: '5.4.8', note: 'Domestic: no greater than 100 mA for fixed equipment (lighting, air conditioning)' },
      elcbPowerMa: { value: 30, clause: '5.4.8', note: 'Domestic: no greater than 30 mA where appliances may be used by persons, and all bathroom circuits' },
      minWireLightingMm2: { value: APP_VALUES.minWireLightingMm2!.value, note: 'Not set by the regulations (7.6.1: size by connected load); app value' },
      minWirePowerMm2: { value: APP_VALUES.minWirePowerMm2!.value, note: 'Not set by the regulations (7.6.1: size by connected load); app value' }
    },
    rules: [
      { id: 'addc-elcb-hvac', kind: 'elcbMa', when: { loadType: 'hvac' }, value: 100, clause: '5.4.8', note: 'Air conditioning is fixed equipment' },
      { id: 'addc-elcb-sockets', kind: 'elcbMa', when: { loadType: 'sockets' }, value: 30, clause: '5.4.8' }
    ],
    entries: [
      { id: 'addc-gnd', topic: 'Maximum ground temperature at 1 m depth', value: '35', unit: '°C', clause: '3.7.1(a)' },
      { id: 'addc-indoor', topic: 'Ambient — indoor, not air conditioned', value: '40', unit: '°C', clause: '3.7.1(f)' },
      { id: 'addc-bath', topic: 'RCD for all bathroom circuits', value: '30', unit: 'mA', clause: '5.4.8' }
    ]
  },
  {
    id: 'builtin-etihadwe', name: 'EtihadWE (Northern Emirates)', kind: 'authority', region: 'Northern Emirates', status: 'to-verify', builtIn: true, version: 2, updatedAt: UAE,
    edition: 'Wiring Regulation, 06.07.2020',
    source: 'Etihad Water & Electricity (formerly FEWA) — Wiring Regulation (2020)',
    notes: 'Basic values from the 2020 Wiring Regulation. Sizing targets (growth, loading, demand factor) are the app\'s values. Check against the current regulation and EtihadWE circulars.',
    values: {
      ...fromDewa(['futureGrowthPct', 'transformerMaxLoadingPct', 'generatorMaxLoadingPct', 'mdDemandFactor'], 'EtihadWE'),
      voltageV: { value: 415, clause: '5.1', note: '240/415 V ±10 % (IEC 60038)' },
      frequencyHz: { value: 50, clause: '5.1' },
      ambientC: { value: 48, clause: '5.2', note: 'Max. ambient air 48 °C; max. outdoor (shade) 50 °C' },
      vdLimitPct: { value: 4.8, clause: '9.2', note: 'Stated as 20 V from the customer connection point to the remote end of any final circuit: 4.8 % of 415 V (8.3 % of 240 V)' },
      pfTarget: { value: 0.92, clause: '5.3', note: '0.92 lagging or higher at the connection point' },
      elcbLightingMa: { value: 100, clause: '11.2.2', note: 'Domestic: 100 mA for fixed equipment (lighting, air conditioning)' },
      elcbPowerMa: { value: 30, clause: '11.2.2', note: 'Domestic: 30 mA where appliances may be used by persons, and all bathroom circuits' },
      minWireLightingMm2: { value: 2.5, clause: '10.1', note: '10 A MCB up to 1200 W, 16 A for 1200–2000 W, 2.5 mm² up to 2000 W; above 2000 W as per load' },
      minWirePowerMm2: { value: 4, clause: '10.2', note: 'Radial socket circuit: up to four 13 A sockets, 20 A MCB, 4 mm²' }
    },
    rules: [
      { id: 'ewe-elcb-hvac', kind: 'elcbMa', when: { loadType: 'hvac' }, value: 100, clause: '10.6, 11.2.2', note: 'Up to three air-conditioning units on one 100 mA ELCB' },
      { id: 'ewe-elcb-sockets', kind: 'elcbMa', when: { loadType: 'sockets' }, value: 30, clause: '10.2, 11.2.2', note: 'Up to ten sockets on one 30 mA ELCB' }
    ],
    entries: [
      { id: 'ewe-ac-elcb', topic: 'Air-conditioning units per 100 mA ELCB', value: '3', clause: '10.6' },
      { id: 'ewe-skt-elcb', topic: 'Sockets per 30 mA ELCB', value: '10', clause: '10.2' },
      { id: 'ewe-ring', topic: '13 A sockets per 32 A ring circuit', value: '8', clause: '10.2' },
      { id: 'ewe-cooker', topic: 'Cooker control unit — min. MCB / wire', value: '32 A / 6', unit: 'mm²', clause: '10.3' },
      { id: 'ewe-led', topic: 'Minimum load per point — normal light / LED', value: '100 / 35', unit: 'W', clause: '10.1' }
    ]
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
    rules: normaliseRules(r.rules),
    extends: typeof r.extends === 'string' && r.extends ? r.extends : undefined,
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
  if (r.extends && extendsChain(r, [...BUILT_IN_REFERENCES, ...others]).cycle) issues.push('The reference it builds on leads back to itself.');
  else if (others.some((o) => o.id !== r.id && o.name.trim().toLowerCase() === r.name.trim().toLowerCase())) issues.push(`Another reference is already called "${r.name.trim()}".`);
  for (const f of REF_FIELDS) {
    const v = r.values[f.key];
    if (!v) continue;
    const range = f as RefField;
    if (!Number.isFinite(v.value) || (range.min !== undefined && v.value < range.min) || (range.max !== undefined && v.value > range.max))
      issues.push(`${f.label}: ${v.value} is outside ${range.min ?? '…'}–${range.max ?? '…'}${f.unit ? ` ${f.unit}` : ''}.`);
  }
  issues.push(...ruleIssues(r.rules));
  return issues;
}

// ---- Layering ------------------------------------------------------------------

/** The reference and the ones it builds on, nearest first. */
function extendsChain(r: DesignReference, list: DesignReference[]): { chain: DesignReference[]; cycle: boolean; missing?: string } {
  const chain = [r];
  const seen = new Set([r.id]);
  for (let id = r.extends; id; id = chain[chain.length - 1].extends) {
    if (seen.has(id)) return { chain, cycle: true };
    const base = list.find((x) => x.id === id);
    if (!base) return { chain, cycle: false, missing: id };
    seen.add(id);
    chain.push(base);
  }
  return { chain, cycle: false };
}

export interface ResolvedReference extends DesignReference {
  rules: DesignRule[];
  /** Which reference in the chain set each value. */
  sources: Partial<Record<RefKey, string>>;
  /** Id of a base reference that is no longer in the library. */
  missingBase?: string;
}

/** Values and rules after layering the reference over the ones it builds on.
 * Rows with the same rule and condition replace the base's; each row records
 * the reference it came from. */
export function resolveReference(r: DesignReference, list: DesignReference[] = loadReferences()): ResolvedReference {
  const { chain, missing } = extendsChain(r, list);
  const values: Partial<Record<RefKey, RefValue>> = {};
  const sources: Partial<Record<RefKey, string>> = {};
  const rules = new Map<string, DesignRule>();
  for (const ref of [...chain].reverse()) {
    for (const [k, v] of Object.entries(ref.values) as [RefKey, RefValue][]) if (v) { values[k] = v; sources[k] = ref.name; }
    for (const rule of ref.rules ?? []) {
      const key = ruleKey(rule);
      rules.delete(key); // keep the nearest row last, so it also wins ties
      rules.set(key, { ...rule, from: `${ref.name} v${ref.version}` });
    }
  }
  return { ...r, values, rules: [...rules.values()], sources, ...(missing && { missingBase: missing }) };
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
export function referenceChanges(p: Project, ref: DesignReference, list: DesignReference[] = loadReferences()): RefChange[] {
  const r = resolveReference(ref, list);
  const out: RefChange[] = [];
  for (const f of REF_FIELDS) {
    const v = r.values[f.key];
    if (!v) continue;
    const from = projectValue(p, f.key);
    if (from !== v.value) out.push({ key: f.key, label: f.label, unit: f.unit, from, to: v.value });
  }
  return out;
}

/** Writes the reference's values and rule rows (with those of the
 * references it builds on) into the project and records the reference used.
 * Rows from an earlier reference are replaced; the project's own rows stay
 * and win a tie with a reference row. */
export function applyReference(p: Project, ref: DesignReference, at = new Date().toISOString(), list: DesignReference[] = loadReferences()): Project {
  const r = resolveReference(ref, list);
  const next: Project = { ...p, studySettings: { ...p.studySettings }, info: { ...p.info } };
  const own = (p.designRules ?? []).filter((x) => !x.from);
  const rules = [...r.rules, ...own];
  if (rules.length) next.designRules = rules;
  else delete next.designRules;
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
