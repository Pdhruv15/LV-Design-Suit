import type { Project } from '../types';
import { deliverableCatalog, type Deliverable, type ProjectBrief, type ProjectRole, type ScopeId } from './brief';

/** A setup template: how a kind of job is set up — your role, authority, scope, suggested deliverables and the system
 * defaults (voltage, frequency, ambient, voltage-drop limit). It carries no party names, dates, ticks, revisions, drawings,
 * equipment or anything from the project it was made from. It is not an equipment or model template. It is applied once, when
 * a project is created; changing or deleting the template later never touches projects already made from it. */
export interface SetupTemplate {
  id: string; name: string; note?: string; savedAt: string;
  role: ProjectRole; authority: string; scope: ScopeId[];
  /** Suggested deliverables (titles only: no dates or ticks). */
  deliverables: Pick<Deliverable, 'id' | 'title' | 'scope'>[];
  boqType?: ProjectBrief['boqType'];
  system: { voltageV?: number; frequencyHz?: number; ambientC?: number; vdLimitPct?: number };
}

export const SYSTEM_LABEL: Record<keyof SetupTemplate['system'], string> = { voltageV: 'System voltage (V)', frequencyHz: 'Frequency (Hz)', ambientC: 'Ambient temperature (°C)', vdLimitPct: 'Voltage drop limit (%)' };

export function templateFrom(p: Project, name: string, note?: string, now = new Date()): SetupTemplate {
  const b = p.brief;
  const role: ProjectRole = b?.role ?? 'consultant', authority = b?.authority ?? 'DEWA';
  const scope = b?.scope ?? [];
  return {
    id: `tpl-${now.getTime().toString(36)}`, name: name.trim(), note: note?.trim() || undefined, savedAt: now.toISOString(), role, authority, scope: [...scope],
    deliverables: (b?.deliverables ?? deliverableCatalog(role, scope, authority)).map(({ id, title, scope: s }) => ({ id, title, ...(s ? { scope: s } : {}) })),
    ...(b?.boqType ? { boqType: b.boqType } : {}),
    system: { voltageV: p.voltageV, frequencyHz: p.frequencyHz, ambientC: p.ambientC, vdLimitPct: p.vdLimitPct }
  };
}

/** The brief a template starts a project with: no party names except your own company. */
export function briefFromTemplate(t: SetupTemplate, company?: string): ProjectBrief {
  const parties = (['owner', 'consultant', 'contractor', 'authority'] as const).map((r) => ({ role: r, name: r === 'authority' ? t.authority : r === t.role ? company ?? '' : '' }));
  return { role: t.role, authority: t.authority, scope: [...t.scope], parties, deliverables: t.deliverables.map((d) => ({ ...d })), ...(t.boqType ? { boqType: t.boqType } : {}) };
}

/** The new project with the template's system defaults. Applied after the app, database and profile defaults and before the
 * user's own entries, so the template wins over defaults but never over what was typed. */
export function applyTemplateSystem(p: Project, t: SetupTemplate): Project {
  const next = { ...p };
  for (const k of Object.keys(t.system) as (keyof SetupTemplate['system'])[]) { const v = t.system[k]; if (typeof v === 'number' && Number.isFinite(v)) (next as Record<string, unknown>)[k] = v; }
  return next;
}

/** What differs from the defaults the project would otherwise get (for the review step). */
export function templateOverrides(base: Project, t: SetupTemplate): { label: string; from: string; to: string }[] {
  return (Object.keys(t.system) as (keyof SetupTemplate['system'])[]).flatMap((k) => {
    const to = t.system[k], from = (base as unknown as Record<string, unknown>)[k];
    return typeof to === 'number' && to !== from ? [{ label: SYSTEM_LABEL[k], from: String(from ?? '—'), to: String(to) }] : [];
  });
}

const KEY = 'lvds.setupTemplates';
export function loadTemplates(): SetupTemplate[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.scope)) : []; } catch { return []; }
}
export function saveTemplates(list: SetupTemplate[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
