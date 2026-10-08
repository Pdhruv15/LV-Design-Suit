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

export type EarthKind = 'rmu' | 'txn' | 'txb' | 'lv' | 'sub' | 'gn' | 'gb';
export const EARTH_KINDS: { kind: EarthKind; label: string; limitOhm: number }[] = [
  { kind: 'rmu', label: 'RMU body earth', limitOhm: 2 },
  { kind: 'txn', label: 'Transformer neutral earth', limitOhm: 2 },
  { kind: 'txb', label: 'Transformer body earth', limitOhm: 2 },
  { kind: 'lv', label: 'LV earth (main board MET)', limitOhm: 1 },
  { kind: 'sub', label: 'SMDB earth (own pits)', limitOhm: 1 },
  { kind: 'gn', label: 'Generator neutral earth', limitOhm: 1 },
  { kind: 'gb', label: 'Generator body earth', limitOhm: 1 }
];
export const kindInfo = (k: EarthKind) => EARTH_KINDS.find((x) => x.kind === k)!;

export interface EarthItem { key: string; legacyKey?: string; kind: EarthKind; group: string; equipment: string; point: string; pits: number; defaultPits: number; linked: boolean }
export interface EarthPit { id: string; kind: EarthKind; itemKey: string; measured?: number }
export interface EarthNet { kind: EarthKind; group: string; pits: string[]; items: string[]; effectiveOhm?: number; ok?: boolean }
export interface EarthCheck { level: 'ok' | 'warn' | 'bad'; text: string }
export interface EarthLayout { items: EarthItem[]; pits: EarthPit[]; links: [string, string][]; nets: EarthNet[]; checks: EarthCheck[]; electrodeM: number; conductorMm2: number; bonding: string[] }

/** Metal parts bonded to each main earth bar unless the project lists its own. */
export const DEFAULT_BONDING = ['Room earth bar', 'Cable containment', 'Sprinkler / pipework', 'Ductwork / mechanical'];

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
    for (const r of [...new Set(gTx.map(rmuOf))]) {
      const owner = gTx.find((b) => rmuOf(b) === r)!;
      const legacyKey = `rmu:${g}:${r}`;
      // An automatic RMU label follows the transformer display number, which
      // can change when boards are reordered; ownership uses the board ID.
      out.push({ key: owner.rmu?.trim() ? legacyKey : `rmu:${g}:@${owner.id}`, legacyKey, kind: 'rmu', group: g, equipment: r, point: 'Body', defaultPits: 2 });
    }
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
  // Standby generators (a board fed through an ATS): neutral and frame earths, each to its own pit, never joined.
  // Listed after everything else, so adding a generator never renumbers pits that already have IDs.
  project.boards.filter((b) => b.standby).forEach((b, n) => {
    const main = mains.find((m) => m.id === mainOfId(project, b.id));
    const g = main ? subOf(main) : 'SUBSTATION';
    const name = `${genTag(n)} ${b.standby!.kva} kVA`;
    out.push({ key: `gn:${b.id}`, kind: 'gn', group: g, equipment: name, point: 'Neutral (star point)', defaultPits: 1 });
    out.push({ key: `gb:${b.id}`, kind: 'gb', group: g, equipment: name, point: 'Frame / body', defaultPits: 1 });
  });
  return out;
}

/** Generator display name, in board order: GEN-1, GEN-2 … */
export const genTag = (n: number) => `GEN-${n + 1}`;

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
const pitCount = (plan: NonNullable<Project['earthingPlan']>, it: Omit<EarthItem, 'pits' | 'linked'>) => Math.max(0, Math.round(plan.pits?.[it.key] ?? (it.legacyKey ? plan.pits?.[it.legacyKey] : undefined) ?? it.defaultPits));

/** Freeze legacy numbering before edits, then allocate above all reserved IDs.
 * Keep removed equipment/slots so their test records cannot move to new pits. */
export function withEarthPitIds(project: Project, previous?: Project): Project {
  const plan = project.earthingPlan ?? {};
  const existing = project.earthPitIds ?? previous?.earthPitIds;
  const pitIds: Record<string, string[]> = { ...existing };
  let pits = plan.pits, unlinked = plan.unlinked;
  let next = existing ? Math.max(0, ...Object.values(existing).flat().map((id) => Number(id.match(/^E(\d+)$/)?.[1]) || 0), ...Object.keys(plan.measured ?? {}).map((id) => Number(id.match(/^E(\d+)$/)?.[1]) || 0)) + 1 : 1;
  let changed = !project.earthPitIds;
  for (const it of equipment(project)) {
    if (it.legacyKey && it.legacyKey !== it.key) {
      if (pits?.[it.legacyKey] !== undefined) {
        pits = { ...pits, [it.key]: pits[it.key] ?? pits[it.legacyKey] };
        delete pits[it.legacyKey]; changed = true;
      }
      if (unlinked?.includes(it.legacyKey)) {
        unlinked = [...new Set(unlinked.map((key) => key === it.legacyKey ? it.key : key))]; changed = true;
      }
    }
    const count = pitCount({ ...plan, pits }, it);
    const ids = [...(pitIds[it.key] ?? [])];
    while (ids.length < count) { ids.push(`E${next++}`); changed = true; }
    if (ids.length) pitIds[it.key] = ids;
  }
  return changed ? { ...project, earthPitIds: pitIds, ...(project.earthingPlan ? { earthingPlan: { ...plan, ...(pits ? { pits } : {}), ...(unlinked ? { unlinked } : {}) } } : {}) } : project;
}

export function earthingLayout(project: Project): EarthLayout {
  const normalized = withEarthPitIds(project);
  const plan = normalized.earthingPlan ?? {};
  const unlinked = new Set(plan.unlinked ?? []);
  const items: EarthItem[] = equipment(project).map((e) => ({ ...e, pits: pitCount(plan, e), linked: !unlinked.has(e.key) && !(e.legacyKey && unlinked.has(e.legacyKey)) }));
  const pits: EarthPit[] = [];
  const links: [string, string][] = [];
  const nets: EarthNet[] = [];
  const byItem = new Map<string, string[]>();
  for (const it of items) {
    const ids = (normalized.earthPitIds?.[it.key] ?? []).slice(0, it.pits);
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
  if (items.some((i) => i.kind === 'gn')) checks.push({ level: 'ok', text: 'Generator neutral and body earths are separate (never interconnected)' });
  if (pits.length > 1) checks.push({ level: 'warn', text: 'Layout: keep earth pits at least 6 m apart' });
  return { items, pits, links, nets, checks, electrodeM: plan.electrodeM ?? 3, conductorMm2: plan.conductorMm2 ?? 70, bonding: plan.bonding ?? DEFAULT_BONDING };
}

/** Change one setting of the plan (pits, link, measured value). */
export function patchEarthing(project: Project, fn: (p: NonNullable<Project['earthingPlan']>) => NonNullable<Project['earthingPlan']>): Project {
  const before = withEarthPitIds(project);
  return withEarthPitIds({ ...before, earthingPlan: fn({ ...before.earthingPlan }) }, before);
}
