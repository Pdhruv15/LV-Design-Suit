import { pushLibrary } from '../database/librarySync';
import { LAYER_ROLES } from './cadRooms';
import type { CadLayerMap } from '../types';

/** A layer mapping saved for an architect or consultant ("ABC Architects"), kept in the LV Database
 * (Library.json) so their plans are mapped the same way in every project. */
export interface CadLayerTemplate { id: string; name: string; layers: CadLayerMap[]; savedAt: string }

export const CAD_LAYER_TEMPLATES_KEY = 'lvds.cadLayerTemplates';
const ROLES = new Set(LAYER_ROLES.map((r) => r.value));
const isTemplate = (t: unknown): t is CadLayerTemplate =>
  !!t && typeof t === 'object' && typeof (t as CadLayerTemplate).id === 'string' && typeof (t as CadLayerTemplate).name === 'string' && Array.isArray((t as CadLayerTemplate).layers);
const clean = (t: CadLayerTemplate): CadLayerTemplate => ({
  ...t,
  layers: t.layers.filter((m) => m && typeof m.layer === 'string' && m.layer.trim() && ROLES.has(m.role))
});

export function loadLayerTemplates(): CadLayerTemplate[] {
  try {
    const v = JSON.parse(localStorage.getItem(CAD_LAYER_TEMPLATES_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter(isTemplate).map(clean).sort((a, b) => a.name.localeCompare(b.name)) : [];
  } catch { return []; }
}
export function saveLayerTemplates(list: CadLayerTemplate[]): boolean {
  try { localStorage.setItem(CAD_LAYER_TEMPLATES_KEY, JSON.stringify(list)); void pushLibrary(); return true; } catch { return false; }
}

/** The list with this plan's mapping saved under a name; the same name (any case) is replaced. */
export function withTemplate(list: CadLayerTemplate[], name: string, layers: CadLayerMap[], now = new Date()): CadLayerTemplate[] {
  const n = name.trim();
  const old = list.find((t) => t.name.toLowerCase() === n.toLowerCase());
  const t: CadLayerTemplate = { id: old?.id ?? `lt-${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n, layers: layers.map((m) => ({ layer: m.layer, role: m.role })), savedAt: now.toISOString() };
  return [...list.filter((x) => x !== old), t].sort((a, b) => a.name.localeCompare(b.name));
}

/** The plan's layer roles with a template's roles for the layers it knows (any case); other layers keep theirs. */
export function applyTemplate(roles: CadLayerMap[], template: CadLayerTemplate): CadLayerMap[] {
  return roles.map((m) => ({ ...m, role: template.layers.find((t) => t.layer.toLowerCase() === m.layer.toLowerCase())?.role ?? m.role }));
}

/** The template that knows most of the plan's layers — offered when it knows at least two and half of them. */
export function bestTemplate(layers: string[], list: CadLayerTemplate[]): { template: CadLayerTemplate; matched: number; of: number } | undefined {
  const names = new Set(layers.map((l) => l.toLowerCase()));
  const scored = list
    .map((template) => ({ template, matched: template.layers.filter((t) => names.has(t.layer.toLowerCase())).length, of: names.size }))
    .filter((s) => s.matched >= 2 && s.matched >= s.of / 2)
    .sort((a, b) => b.matched - a.matched);
  return scored[0];
}
