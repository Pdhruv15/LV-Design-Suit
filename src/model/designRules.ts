import type { LoadType } from '../types';

/** Design rules: rows such as "Min wire | power circuits | 4 mm² | DEWA …"
 * that a design reference or the project sets. A row may apply only to a
 * circuit category, a load type and/or circuits from a given load upward;
 * the most specific matching row wins (a later row wins a tie). With no
 * matching row the project's settings apply, as before. */

export type RuleKind = 'minWireMm2' | 'elcbMa';

export const RULE_KINDS = [
  { kind: 'minWireMm2', label: 'Minimum circuit wire', unit: 'mm²', min: 1, max: 300 },
  { kind: 'elcbMa', label: 'ELCB / RCD sensitivity', unit: 'mA', min: 10, max: 1000 }
] as const satisfies readonly { kind: RuleKind; label: string; unit: string; min: number; max: number }[];

export type RuleCategory = 'lighting' | 'power';

/** Which circuits a row applies to; an empty condition applies to all. */
export interface RuleCondition { category?: RuleCategory; loadType?: LoadType; minKw?: number }

export interface DesignRule {
  id: string;
  kind: RuleKind;
  when: RuleCondition;
  value: number;
  clause?: string;
  note?: string;
  /** The reference the row came from ("DEWA (Dubai) v2"); none for the project's own rows. */
  from?: string;
}

/** The circuit a rule is looked up for. */
export interface RuleContext { category: RuleCategory; loadType?: LoadType; kw: number }

const kindOf = (k: RuleKind) => RULE_KINDS.find((x) => x.kind === k)!;
const specificity = (c: RuleCondition) => (c.category ? 1 : 0) + (c.loadType ? 1 : 0) + (c.minKw !== undefined ? 1 : 0);

export function matches(c: RuleCondition, ctx: RuleContext): boolean {
  return (!c.category || c.category === ctx.category)
    && (!c.loadType || c.loadType === (ctx.loadType ?? 'general'))
    && (c.minKw === undefined || ctx.kw >= c.minKw);
}

/** The winning row for a circuit, or undefined when none applies. */
export function resolveRule(rules: DesignRule[] | undefined, kind: RuleKind, ctx: RuleContext): DesignRule | undefined {
  let best: DesignRule | undefined;
  for (const r of rules ?? []) {
    if (r.kind !== kind || !Number.isFinite(r.value) || !matches(r.when ?? {}, ctx)) continue;
    if (!best || specificity(r.when ?? {}) >= specificity(best.when ?? {})) best = r;
  }
  return best;
}

export const hasRules = (rules: DesignRule[] | undefined, kind: RuleKind) => !!rules?.some((r) => r.kind === kind);

/** Rows with the same kind and condition replace each other when references are layered. */
export const ruleKey = (r: DesignRule) => `${r.kind}|${r.when?.category ?? ''}|${r.when?.loadType ?? ''}|${r.when?.minKw ?? ''}`;

/** Cleans rows read from a file: unknown kinds and non-numbers dropped. */
export function normaliseRules(raw: unknown): DesignRule[] {
  if (!Array.isArray(raw)) return [];
  const out: DesignRule[] = [];
  raw.forEach((x, i) => {
    if (!x || typeof x !== 'object') return;
    const r = x as Partial<DesignRule>;
    if (!RULE_KINDS.some((k) => k.kind === r.kind) || !Number.isFinite(Number(r.value))) return;
    const w = (r.when ?? {}) as RuleCondition;
    const when: RuleCondition = {
      ...(w.category === 'lighting' || w.category === 'power' ? { category: w.category } : {}),
      ...(typeof w.loadType === 'string' && w.loadType ? { loadType: w.loadType } : {}),
      ...(Number.isFinite(Number(w.minKw)) && w.minKw !== undefined && w.minKw !== null ? { minKw: Number(w.minKw) } : {})
    };
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : `rule-${i}`, kind: r.kind!, when, value: Number(r.value),
      ...(r.clause && { clause: String(r.clause) }), ...(r.note && { note: String(r.note) }), ...(r.from && { from: String(r.from) })
    });
  });
  return out;
}

/** Problems that stop rows being saved. */
export function ruleIssues(rules: DesignRule[] | undefined): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const r of rules ?? []) {
    const k = kindOf(r.kind);
    if (!k) { issues.push(`Unknown rule "${r.kind}".`); continue; }
    if (!Number.isFinite(r.value) || r.value < k.min || r.value > k.max) issues.push(`${k.label}: ${r.value} is outside ${k.min}–${k.max} ${k.unit}.`);
    if (r.when?.minKw !== undefined && !(r.when.minKw >= 0)) issues.push(`${k.label}: the load threshold must be 0 kW or more.`);
    const key = ruleKey(r);
    if (seen.has(key)) issues.push(`${k.label}: two rows apply to the same circuits.`);
    seen.add(key);
  }
  return issues;
}
