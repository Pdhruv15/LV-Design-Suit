import type { Project } from '../types';
import type { PricedBom, PricedItem } from './priceList';
import { isScheduleCircuit } from '../calc/loadSchedule';
import { breakerTypeOf } from '../calc/earthing';

export type BoqAction = 'new' | 'retain' | 'relocate' | 'remove' | 'replace';
export type BoqResponsibility = 'contractor' | 'client' | 'others';
export interface BoqLineScope {
  action?: BoqAction;
  supplyBy?: BoqResponsibility;
  installBy?: BoqResponsibility;
  evidence?: string;
  /** The BOQ key of the package that includes this line. */
  includedIn?: string;
}

/** Templates are review prompts, never inferred physical quantities. */
export const SCOPE_CHECKS: { id: string; title: string; fitOut: boolean; newInstallation: boolean }[] = [
  { id: 'lighting', title: 'Luminaires, controls and lighting point quantities', fitOut: true, newInstallation: true },
  { id: 'emergency', title: 'Emergency lighting and exit signs', fitOut: true, newInstallation: true },
  { id: 'wiring-devices', title: 'Sockets, switches, fused connection units and final connections', fitOut: true, newInstallation: true },
  { id: 'conduit-boxes', title: 'Conduit, trunking, back boxes and junction boxes', fitOut: true, newInstallation: true },
  { id: 'mechanical-interfaces', title: 'Mechanical equipment isolators, controls and interface scope', fitOut: true, newInstallation: true },
  { id: 'elv', title: 'Data, fire alarm, CCTV, access control and other ELV scope', fitOut: true, newInstallation: true },
  { id: 'testing', title: 'Testing, commissioning and authority interfaces', fitOut: true, newInstallation: true },
  { id: 'documentation', title: 'Labels, as-built drawings, manuals and handover', fitOut: true, newInstallation: true },
  { id: 'existing-work', title: 'Existing assets: retain, relocate, remove or replace', fitOut: true, newInstallation: false },
  { id: 'site-conditions', title: 'Survey, shutdowns, temporary power, access and occupied-site conditions', fitOut: true, newInstallation: true },
  { id: 'civil', title: 'Penetrations, fire stopping, making good and applicable civil works', fitOut: true, newInstallation: true },
  { id: 'earthing', title: 'Earthing, bonding and measured earth conductor routes', fitOut: true, newInstallation: true },
  { id: 'plant', title: 'Source equipment and specialist plant: included, client supplied or by others', fitOut: true, newInstallation: true }
];

const actionText: Record<BoqAction, string> = { new: 'New', retain: 'Existing retained', relocate: 'Relocate', remove: 'Remove', replace: 'Replace' };
const partyText: Record<BoqResponsibility, string> = { contractor: 'contractor', client: 'client', others: 'others' };
const scopePatterns: Record<string, RegExp> = {
  lighting: /luminaire|lighting (?:point|switch|control)/i,
  emergency: /emergency (?:luminaire|light)|exit sign/i,
  'wiring-devices': /socket|fused connection|switch|final connection/i,
  'conduit-boxes': /conduit|trunking|back box|junction box/i,
  'mechanical-interfaces': /mechanical|local isolator|BMS interface|plant installation/i,
  elv: /data|fire alarm|CCTV|access control|structured cabling/i,
  testing: /test|commission|authority|inspection/i,
  documentation: /as-built|manual|handover|label|training/i,
  'existing-work': /existing|relocat|remov|disconnect/i,
  'site-conditions': /survey|shutdown|temporary|access|scaffolding/i,
  civil: /penetration|fire stop|core drill|excavat|trench|duct bank|making good|make good/i,
  earthing: /earth|bonding|\bCPC\b/i,
  plant: /generator|transformer|UPS|inverter|plant|PV|solar|EV charger/i
};

/** Key-aware classification avoids mistaking descriptions of excluded work for quantities. */
function coversScope(it: PricedItem, id: string): boolean {
  if (!(it.qty > 0) || !Number.isFinite(it.qty)) return false;
  if (id === 'existing-work' && it.action !== 'new') return true;
  const point = it.key.startsWith('point:') ? it.key.split(':')[1] : undefined;
  if (point) {
    if (id === 'lighting') return point === 'ltg';
    if (id === 'wiring-devices') return ['shaver', 's13', 's13t', 's15', 'spur', 'isol'].includes(point);
    if (id === 'mechanical-interfaces') return ['isol', 'wh', 'hd', 'cooker', 'wac', 'sac', 'pump', 'fcu', 'cfan', 'exfan'].includes(point);
    // User-selected spare-column products can represent emergency or ELV equipment.
    if (id === 'emergency' || id === 'elv') return scopePatterns[id].test(it.description);
    return false;
  }
  if (id === 'earthing' && it.section === 'I') return true;
  if (id === 'plant' && /^(tx|gen|ups|cap|pv|inverter):/.test(it.key)) return true;
  if (id === 'mechanical-interfaces' && it.key.startsWith('iso:')) return true;
  if (!it.manualId && !it.key.startsWith('manual:') && it.quantitySource !== 'Manual quantity') return false;
  const text = `${it.description} ${it.evidence ?? ''}`;
  if (id === 'conduit-boxes' && /conduit.*(?:measured separately|by others|excluded)/i.test(text)) return false;
  return scopePatterns[id]?.test(text) ?? false;
}

const chargedLegs = (it: PricedItem) => ({
  supply: (it.action === 'new' || it.action === 'replace') && it.supplyBy === 'contractor',
  install: it.action !== 'retain' && it.installBy === 'contractor'
});

const compatibleAction = (child: BoqAction, parent: BoqAction) =>
  child === parent || (['new', 'replace'].includes(child) && ['new', 'replace'].includes(parent));

export function scopeSummary(it: PricedItem): string {
  return [
    actionText[it.action], `supply: ${partyText[it.supplyBy]}`, `installation: ${partyText[it.installBy]}`,
    ...(it.includedIn ? [`package: ${it.includedIn}`] : []),
    ...(it.quantitySource ? [`quantity: ${it.quantitySource}`] : []),
    ...(it.evidence ? [`evidence: ${it.evidence}`] : [])
  ].join(' · ');
}

/** Resolve package chains without permitting dangling links, cycles or unpaid packages. */
export function packageTarget(it: PricedItem, items: PricedItem[]): { parent?: PricedItem; error?: string } {
  if (!it.includedIn) return {};
  const byKey = new Map(items.map((x) => [x.key, x]));
  const seen = new Set([it.key]);
  let key: string | undefined = it.includedIn;
  let parent: PricedItem | undefined;
  let child = it;
  while (key) {
    if (seen.has(key)) return { error: 'Package link is self-referencing or cyclic; line remains separately priced.' };
    seen.add(key);
    if (items.filter((x) => x.key === key).length !== 1) return { error: 'Package link is missing or ambiguous; line remains separately priced.' };
    parent = byKey.get(key);
    if (!parent) return { error: 'Package link does not match a BOQ line; line remains separately priced.' };
    if (parent.source === 'excluded' && !parent.includedIn) return { error: 'Package is excluded or retained; line remains separately priced.' };
    const required = chargedLegs(child);
    const covered = chargedLegs(parent);
    if ((required.supply && !covered.supply) || (required.install && !covered.install)) {
      return { error: 'Package does not cover this line’s contractor supply and installation responsibilities; line remains separately priced.' };
    }
    if ((required.supply || required.install) && !compatibleAction(child.action, parent.action)) {
      return { error: 'Package has a different work action; line remains separately priced.' };
    }
    child = parent;
    key = parent.includedIn;
  }
  if (!parent || parent.missingRate || !(parent.amount > 0) || !Number.isFinite(parent.amount)) {
    return { error: 'Package has no complete, positive-priced allowance; line remains separately priced.' };
  }
  return { parent };
}

export function boqReview(project: Project, bom: PricedBom): { id: string; message: string }[] {
  const issues: { id: string; message: string }[] = [];
  const add = (id: string, message: string) => issues.push({ id, message });
  const custom = project.boq;
  for (const feeder of project.feeders) {
    if ((feeder.device === 'ACB' || feeder.device === 'MCCB') && feeder.device !== breakerTypeOf(feeder)) {
      add(`device-mismatch:${feeder.id}`, `${feeder.name} (${feeder.id}): the selected switching device ${feeder.device} differs from calculation breaker type ${breakerTypeOf(feeder)}. The BOQ uses the selected device; reconcile the engineering input before issuing.`);
    }
  }
  if (!custom?.projectType) add('project-type', 'Choose fit-out or new installation to review the applicable contractor scope.');
  for (const check of SCOPE_CHECKS) {
    const applicable = !custom?.projectType || (custom.projectType === 'fit-out' ? check.fitOut : check.newInstallation);
    if (applicable && !custom?.scopeReview?.[check.id]) add(`scope:${check.id}`, `Scope not reviewed: ${check.title}.`);
    const covered = bom.items.some((it) => coversScope(it, check.id));
    if (applicable && custom?.scopeReview?.[check.id] === 'included' && !covered) {
      add(`scope-quantity:${check.id}`, `${check.title}: marked included, but no matching positive-quantity BOQ line was found. Add measured items or confirm the package coverage; selecting scope does not create quantities.`);
    }
  }
  if (custom?.includeSchedulePoints && !bom.items.some((it) => it.quantitySource === 'Load schedule point counts')) {
    add('schedule-points', 'Schedule point quantities are enabled, but no measured point items were found. Confirm the point schedule.');
  }
  if (custom?.includeSchedulePoints) {
    const boardIds = new Set(project.boards.map((b) => b.id));
    for (const feeder of project.feeders) {
      if (!Object.values(feeder.points ?? {}).some((count) => (count ?? 0) > 0)) continue;
      if (boardIds.has(feeder.boardId) && isScheduleCircuit(feeder)) continue;
      const reasons = [!boardIds.has(feeder.boardId) ? 'unknown board' : '', !feeder.phase ? 'missing phase' : '', !feeder.way ? 'missing way number' : ''].filter(Boolean);
      add(`schedule-omitted:${feeder.id}`, `${feeder.name} (${feeder.id}): positive point counts are omitted from the schedule take-off (${reasons.join(', ')}). Correct the circuit schedule information.`);
    }
  }
  const activeKeys = new Set(bom.items.map((it) => it.key));
  for (const key of Object.keys(custom?.overrides ?? {})) {
    if (activeKeys.has(key)) continue;
    const inactive = key.startsWith('point:') && !custom?.includeSchedulePoints;
    add(`orphan-override:${key}`, inactive
      ? `Saved BOQ override ${key} is inactive while schedule point quantities are disabled. Its quantity, scope and exclusion settings are retained but are not applied.`
      : `Saved BOQ override ${key} has no current BOQ line. Its quantity, scope and exclusion settings are not applied. Review the changed specification or measurement key and explicitly transfer the applicable settings.`);
  }
  for (const key of Object.keys(project.priceList?.rates ?? {})) {
    if (key.startsWith('wire:') && activeKeys.has(`wire-conductor:${key.slice(5)}`)) {
      add(`legacy-wire-rate:${key}`, `Saved quote ${key} uses the old circuit-route metre basis. The current wire-conductor:${key.slice(5)} quantity is conductor metres; obtain a quote for the new unit. The old rate is not transferred.`);
    }
    if (!key.startsWith('panel:') || activeKeys.has(key)) continue;
    const replacements = bom.items.filter((it) => {
      if (!it.key.startsWith('panel:')) return false;
      const parts = it.key.split(':');
      return parts.length >= 7 && [...parts.slice(0, 4), ...parts.slice(7, 9)].join(':') === key;
    });
    if (replacements.length) add(`legacy-panel-rate:${key}`, `Saved panel quote ${key} does not include the current busbar material, manufacturer/model and saved enclosure specifications. Review and requote ${replacements.map((it) => it.key).join(', ')}; no rate is transferred automatically.`);
  }
  for (const [section, value] of Object.entries(custom?.wastage ?? {})) {
    if (!Number.isFinite(value) || value < 0) add(`wastage:${section}`, `Section ${section} has an invalid wastage percentage. Enter a finite, non-negative allowance.`);
  }
  if (!Number.isFinite(project.priceList?.markupPct ?? 0) || (project.priceList?.markupPct ?? 0) < 0) {
    add('markup', 'Markup must be a finite, non-negative percentage; the invalid value is not applied.');
  }
  if (!Number.isFinite(custom?.discountPct ?? 0) || (custom?.discountPct ?? 0) < 0 || (custom?.discountPct ?? 0) > 100) {
    add('discount', 'Discount must be between 0% and 100%; the invalid value is not applied.');
  }
  for (const it of bom.items) {
    const label = it.description;
    if (!Number.isFinite(it.qty) || it.qty < 0) add(`quantity:${it.key}`, `${label}: invalid quantity; it is not included in the priced total.`);
    else if (it.qty === 0 && it.source !== 'excluded') add(`quantity:${it.key}`, `${label}: quantity is zero. Measure or confirm the quantity before issuing the BOQ.`);
    if (it.supplyRateMissing) add(`supply-rate:${it.key}`, `${label}: contractor supply rate is missing or invalid.`);
    if (it.installRateMissing) add(`install-rate:${it.key}`, `${label}: an explicit contractor installation rate is missing or invalid; zero must be quoted explicitly.`);
    if ((it.rate !== undefined && (!Number.isFinite(it.rate) || it.rate < 0)) || !Number.isFinite(it.labour) || it.labour < 0) {
      add(`invalid-rate:${it.key}`, `${label}: rates must be finite and non-negative; invalid charges are not included.`);
    }
    if (it.includedIn) {
      const result = packageTarget(it, bom.items);
      if (result.error) add(`package:${it.key}`, `${label}: ${result.error}`);
    }
    if (it.changed) add(`changed:${it.key}`, `${label}: the design quantity changed after the BOQ override. Review the measured quantity.`);
    if (it.source !== 'excluded' && /allowance|approximate|to site|to confirm/i.test(`${it.quantitySource ?? ''} ${label}`)) {
      add(`evidence:${it.key}`, `${label}: confirm the product or measured quantity; the design contains an allowance or unresolved detail.`);
    }
    if (custom?.projectType && it.source !== 'excluded' && it.qty > 0 && (it.manualId || it.designQty !== undefined) && !it.evidence?.trim()) {
      add(`manual-evidence:${it.key}`, `${label}: record the drawing, site measurement or allowance basis for this manual quantity.`);
    }
  }
  return issues;
}
