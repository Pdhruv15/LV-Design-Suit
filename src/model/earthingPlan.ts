import type { Project } from '../types';
import { mainBoards, txTag } from './transformers';

/** Earthing schematic (DEWA practice, no lightning protection).
 *
 * Four kinds of earth, never mixed with each other:
 *   RMU body · transformer neutral · transformer body · LV (main board MET).
 * Defaults: RMU 2 pits; each transformer 1 pit for the neutral and 1 for the
 * body (neutral and body never interconnected); main boards 2 pits when the
 * site has one, 1 pit each when it has several (as agreed with DEWA). Pits of
 * the same kind are linked in a loop (RMUs with RMUs, transformer neutrals
 * with neutrals …) unless the user unlinks a piece of equipment. Limits:
 * substation earths below 2 Ω, the LV earth 1 Ω per incoming supply / MDB
 * (DEWA Regulations 2017). Pits at least 6 m apart — a layout check. */

export type EarthKind = 'rmu' | 'txn' | 'txb' | 'lv' | 'sub';
export const EARTH_KINDS: { kind: EarthKind; label: string; limitOhm: number }[] = [
  { kind: 'rmu', label: 'RMU body earth', limitOhm: 2 },
  { kind: 'txn', label: 'Transformer neutral earth', limitOhm: 2 },
  { kind: 'txb', label: 'Transformer body earth', limitOhm: 2 },
  { kind: 'lv', label: 'LV earth (main board MET)', limitOhm: 1 },
  { kind: 'sub', label: 'SMDB earth (own pits)', limitOhm: 1 }
];
export const kindInfo = (k: EarthKind) => EARTH_KINDS.find((x) => x.kind === k)!;

export interface EarthItem { key: string; kind: EarthKind; group: string; equipment: string; point: string; pits: number; defaultPits: number; linked: boolean }
export interface EarthPit { id: string; kind: EarthKind; itemKey: string; measured?: number }
export interface EarthNet { kind: EarthKind; group: string; pits: string[]; items: string[]; effectiveOhm?: number; ok?: boolean }
export interface EarthCheck { level: 'ok' | 'warn' | 'bad'; text: string }
export interface EarthLayout { items: EarthItem[]; pits: EarthPit[]; links: [string, string][]; nets: EarthNet[]; checks: EarthCheck[]; electrodeM: number; conductorMm2: number }

/** The equipment that needs an earth, from the project. */
function equipment(project: Project): Omit<EarthItem, 'pits' | 'linked'>[] {
  const mains = mainBoards(project);
  const txs = mains.filter((b) => b.sourceKva);
  const out: Omit<EarthItem, 'pits' | 'linked'>[] = [];
  const lv = mains.filter((b) => (b.kind ?? 'MDB') !== 'MC');
  const subOf = (b: { substation?: string }) => b.substation?.trim() || 'SUBSTATION';
  const rmuOf = (b: { id: string; rmu?: string }) => b.rmu?.trim() || `RMU (${txTag(project, b.id)})`;
  // Substation by substation, so pits are numbered and drawn together: RMUs, transformers, then their LV.
  const groups = [...new Set(lv.map(subOf))];
  for (const g of groups) {
    const gTx = txs.filter((b) => subOf(b) === g);
    for (const r of [...new Set(gTx.map(rmuOf))]) out.push({ key: `rmu:${g}:${r}`, kind: 'rmu', group: g, equipment: r, point: 'Body', defaultPits: 2 });
    // Neutral then body of each transformer, so its pits are numbered together (E3 neutral, E4 body …).
    for (const b of gTx) {
      out.push({ key: `txn:${b.id}`, kind: 'txn', group: g, equipment: `${txTag(project, b.id)} ${b.sourceKva} kVA`, point: 'Neutral (star point)', defaultPits: 1 });
      out.push({ key: `txb:${b.id}`, kind: 'txb', group: g, equipment: `${txTag(project, b.id)} ${b.sourceKva} kVA`, point: 'Tank / body', defaultPits: 1 });
    }
    const gLv = lv.filter((b) => subOf(b) === g);
    for (const b of gLv) out.push({ key: `lv:${b.id}`, kind: 'lv', group: g, equipment: b.id, point: 'Main earth bar (MET)', defaultPits: lv.length === 1 ? 2 : 1 });
    // SMDBs may have their own pits where the design asks for it (none by default).
    for (const b of project.boards.filter((x) => x.kind === 'SMDB' && gLv.some((m) => m.id === mainOfId(project, x.id)))) out.push({ key: `sub:${b.id}`, kind: 'sub', group: g, equipment: b.id, point: 'Earth bar', defaultPits: 0 });
  }
  return out;
}

const mainOfId = (project: Project, id: string): string => {
  const byId = new Map(project.boards.map((b) => [b.id, b]));
  const seen = new Set<string>();
  let b = byId.get(id);
  while (b?.upstreamId && !seen.has(b.id)) { seen.add(b.id); b = byId.get(b.upstreamId); }
  return b?.id ?? id;
};

/** Parallel resistance of measured pits — an estimate (no mutual resistance between pits). */
const last = <T>(a: T[]): T => a[a.length - 1];
const parallel = (rs: number[]) => (rs.length ? 1 / rs.reduce((s, r) => s + 1 / r, 0) : undefined);

export function earthingLayout(project: Project): EarthLayout {
  const plan = project.earthingPlan ?? {};
  const unlinked = new Set(plan.unlinked ?? []);
  const items: EarthItem[] = equipment(project).map((e) => ({ ...e, pits: Math.max(0, Math.round(plan.pits?.[e.key] ?? e.defaultPits)), linked: !unlinked.has(e.key) }));
  const pits: EarthPit[] = [];
  const links: [string, string][] = [];
  const nets: EarthNet[] = [];
  let n = 0;
  const byItem = new Map<string, string[]>();
  for (const it of items) {
    const ids = Array.from({ length: it.pits }, () => `E${++n}`);
    byItem.set(it.key, ids);
    for (const id of ids) pits.push({ id, kind: it.kind, itemKey: it.key, ...(plan.measured?.[id] !== undefined ? { measured: plan.measured[id] } : {}) });
    for (let i = 1; i < ids.length; i++) links.push([ids[i - 1], ids[i]]); // pits of one equipment are always linked
  }
  // Pits are interconnected per kind within one substation; different substations are never linked.
  for (const sub of [...new Set(items.map((i) => i.group))]) for (const { kind, limitOhm } of EARTH_KINDS) {
    const ofKind = items.filter((i) => i.kind === kind && i.group === sub && i.pits > 0);
    const joined = ofKind.filter((i) => i.linked);
    // Linked equipment of one kind: a loop through their pits (a chain for two).
    if (joined.length > 1) {
      for (let i = 1; i < joined.length; i++) links.push([last(byItem.get(joined[i - 1].key)!), byItem.get(joined[i].key)![0]]);
      if (joined.length > 2) links.push([last(byItem.get(last(joined).key)!), byItem.get(joined[0].key)![0]]);
    }
    const groups = [...(joined.length ? [joined] : []), ...ofKind.filter((i) => !joined.includes(i)).map((i) => [i])];
    for (const g of groups) {
      const ids = g.flatMap((i) => byItem.get(i.key)!);
      const measured = ids.map((id) => plan.measured?.[id]).filter((x): x is number => x !== undefined && x > 0);
      const eff = measured.length === ids.length && ids.length ? parallel(measured) : undefined;
      nets.push({ kind, group: sub, pits: ids, items: g.map((i) => i.key), ...(eff !== undefined ? { effectiveOhm: eff, ok: eff <= limitOhm + 1e-9 } : {}) });
    }
  }

  const checks: EarthCheck[] = [];
  for (const it of items) if (it.pits === 0 && it.kind !== 'sub') checks.push({ level: 'bad', text: `${it.equipment} — ${it.point}: no earth pit` });
  const lv = items.filter((i) => i.kind === 'lv');
  if (lv.length === 1 && lv[0].pits < 2) checks.push({ level: 'warn', text: `${lv[0].equipment} is the only main board: DEWA asks for 2 pits` });
  const multi = new Set(items.map((i) => i.group)).size > 1;
  for (const net of nets) {
    const k = kindInfo(net.kind);
    if (net.effectiveOhm === undefined) continue;
    checks.push({ level: net.ok ? 'ok' : 'bad', text: `${multi ? `${net.group} · ` : ''}${k.label} ${net.pits.join(', ')}: ${net.effectiveOhm.toFixed(2)} Ω ${net.ok ? '≤' : '>'} ${k.limitOhm} Ω${net.ok ? '' : ' — add pits or improve the electrodes'}` });
  }
  if (!items.length) checks.push({ level: 'warn', text: 'No transformers or main boards yet — add them in Panels → Transformers' });
  else if (!items.some((i) => i.kind === 'txn')) checks.push({ level: 'warn', text: 'No transformer on any main board — only the LV earth is shown' });
  if (pits.length) checks.push({ level: 'ok', text: 'Transformer neutral and body earths are separate (never interconnected)' });
  if (pits.length > 1) checks.push({ level: 'warn', text: 'Layout: keep earth pits at least 6 m apart' });
  return { items, pits, links, nets, checks, electrodeM: plan.electrodeM ?? 3, conductorMm2: plan.conductorMm2 ?? 70 };
}

/** Change one setting of the plan (pits, link, measured value). */
export function patchEarthing(project: Project, fn: (p: NonNullable<Project['earthingPlan']>) => NonNullable<Project['earthingPlan']>): Project {
  return { ...project, earthingPlan: fn({ ...project.earthingPlan }) };
}
