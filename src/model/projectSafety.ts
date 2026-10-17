import { isRasterDataUrl } from '../util/escape';

/** Checks that make a project file safe to open, before anything is drawn from it.
 *
 * A project file is untrusted: TypeScript types are not checked at run time, and
 * drawings and reports are built from its values. A file is refused (with a
 * plain reason) when it has the wrong structure for the values that reach the
 * drawings — a number field holding text, an earth pit ID that is not E1, E2 …,
 * a logo that is not a PNG / JPEG image — or is built to strain the app (very
 * deep nesting, huge strings or lists, prototype keys). Engineering values that
 * are merely out of range still open and are listed in the To do list
 * (projectInputIssues). */

export const LIMITS = {
  depth: 64,
  /** Longest string anywhere (a logo has its own limit). */
  stringChars: 200_000,
  /** Longest panel / circuit ID. */
  idChars: 200,
  /** Most items in one list or record. */
  items: 200_000,
  /** Most values in the whole file. */
  nodes: 5_000_000
} as const;

const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown) => typeof v === 'number';
const okNum = (v: unknown) => v === undefined || v === null || isNum(v);

/** Numeric fields that are drawn or printed. Out-of-range numbers go to the To do list; text in them is refused. */
const PROJECT_NUM = ['schemaVersion', 'voltageV', 'frequencyHz', 'ambientC', 'vdLimitPct', 'vdTempC', 'groundTempC', 'soilResistivityKmW'];
const BOARD_NUM = ['sourceKva', 'sourceImpedancePct', 'sourceXr', 'ratedCurrentA', 'upsKva', 'mdDemandFactor', 'elcbRatingA', 'elcbSensitivityMa'];
const FEEDER_NUM = ['loadKw', 'demandFactor', 'powerFactor', 'lengthM', 'cableCsaMm2', 'parallel', 'breakerRatingA', 'breakerIcuKa', 'breakerImMultiple', 'cpcMm2', 'way', 'kvar', 'rcdMa', 'capSteps', 'detunedPct', 'cores'];
const MARKUP_NUM = ['x', 'y', 'w', 'h', 'x2', 'y2', 'size'];
const MARKUP_KINDS = new Set(['cloud', 'rect', 'line', 'arrow', 'text', 'callout']);
const PIT_ID = /^E\d{1,6}$/;

/** The reason a file is not safe to open, or undefined when it is. */
export function unsafeReason(raw: Record<string, unknown>): string | undefined {
  // 1. Size and shape of the whole file.
  let nodes = 0;
  const walk = (v: unknown, depth: number, path: string): string | undefined => {
    if (++nodes > LIMITS.nodes) return 'it is too large';
    if (depth > LIMITS.depth) return `it is nested too deeply (at ${path})`;
    if (typeof v === 'string') return v.length > LIMITS.stringChars && path !== 'drawing.logo' ? `a text value is too long (at ${path})` : undefined;
    if (typeof v === 'number' || v === null || typeof v === 'boolean' || v === undefined) return undefined;
    if (Array.isArray(v)) {
      if (v.length > LIMITS.items) return `a list is too long (at ${path})`;
      for (let i = 0; i < v.length; i++) { const r = walk(v[i], depth + 1, `${path}[${i}]`); if (r) return r; }
      return undefined;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length > LIMITS.items) return `a record is too large (at ${path})`;
      for (const k of keys) {
        if (BAD_KEYS.has(k)) return `it contains a reserved key "${k}" (at ${path || 'top level'})`;
        const r = walk((v as Record<string, unknown>)[k], depth + 1, path ? `${path}.${k}` : k);
        if (r) return r;
      }
      return undefined;
    }
    return `it contains a value that is not data (at ${path})`;
  };
  const shape = walk(raw, 0, '');
  if (shape) return shape;

  // 2. Values that reach the drawings and reports.
  const numbers = (o: Record<string, unknown>, keys: string[], what: string) => {
    const k = keys.find((key) => !okNum(o[key]));
    return k ? `${what}: "${k}" is not a number` : undefined;
  };
  const r0 = numbers(raw, PROJECT_NUM, 'project settings');
  if (r0) return r0;
  for (const b of raw.boards as Record<string, unknown>[]) {
    if ((b.id as string).length > LIMITS.idChars) return `panel ID ${(b.id as string).slice(0, 40)}… is too long`;
    if (b.upstreamId !== undefined && b.upstreamId !== null && typeof b.upstreamId !== 'string') return `panel ${b.id}: "upstreamId" is not text`;
    const r = numbers(b, BOARD_NUM, `panel ${b.id}`);
    if (r) return r;
  }
  for (const f of raw.feeders as Record<string, unknown>[]) {
    if ((f.id as string).length > LIMITS.idChars) return `circuit ID ${(f.id as string).slice(0, 40)}… is too long`;
    if (f.feedsBoardId !== undefined && f.feedsBoardId !== null && typeof f.feedsBoardId !== 'string') return `circuit ${f.id}: "feedsBoardId" is not text`;
    const r = numbers(f, FEEDER_NUM, `circuit ${f.id}`);
    if (r) return r;
  }

  // Earth pits: IDs E1, E2 … and the plan's records of the right types.
  if (raw.earthPitIds !== undefined) {
    if (!isObj(raw.earthPitIds)) return 'the earth pit IDs are not a record';
    for (const [k, ids] of Object.entries(raw.earthPitIds)) {
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && PIT_ID.test(id))) return `the earth pit IDs of ${k.slice(0, 60)} are not of the form E1, E2 …`;
    }
  }
  const plan = raw.earthingPlan;
  if (plan !== undefined) {
    if (!isObj(plan)) return 'the earthing plan is not a record';
    const rec = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || (isObj(v) && Object.values(v).every(ok));
    const strs = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
    if (!rec(plan.pits, isNum)) return 'the earthing plan: pits per equipment are not numbers';
    if (!rec(plan.measured, isNum) || !Object.keys(isObj(plan.measured) ? plan.measured : {}).every((id) => PIT_ID.test(id))) return 'the earthing plan: measured values are not numbers per pit ID';
    if (!rec(plan.tests, (t) => isObj(t) && ['date', 'by'].every((k) => t[k] === undefined || typeof t[k] === 'string'))) return 'the earthing plan: test records are not valid';
    if (!strs(plan.unlinked) || !strs(plan.bonding)) return 'the earthing plan: lists are not text';
    if (!okNum(plan.electrodeM) || !okNum(plan.conductorMm2)) return 'the earthing plan: electrode or conductor size is not a number';
    if (plan.system !== undefined && typeof plan.system !== 'string') return 'the earthing plan: earthing system is not text';
  }

  // Logo: a PNG / JPEG image only (the app saves every logo as PNG).
  const drawing = raw.drawing;
  if (isObj(drawing) && drawing.logo !== undefined && drawing.logo !== '' && !isRasterDataUrl(drawing.logo)) return 'the company logo is not a PNG or JPEG image';

  // Sheet markups: numbers, a known kind, text.
  const set = raw.drawingSet;
  if (isObj(set) && Array.isArray(set.sheets)) {
    for (const s of set.sheets) {
      if (!isObj(s) || s.markups === undefined) continue;
      if (!Array.isArray(s.markups)) return `sheet ${String(s.number ?? '')}: markups are not a list`;
      for (const m of s.markups) {
        if (!isObj(m) || !MARKUP_KINDS.has(m.kind as string)) return `sheet ${String(s.number ?? '')}: a markup has an unknown kind`;
        const r = numbers(m, MARKUP_NUM, `sheet ${String(s.number ?? '')} markup`);
        if (r) return r;
        if (!isNum(m.x) || !isNum(m.y)) return `sheet ${String(s.number ?? '')} markup: no position`;
        if (['text', 'rev', 'color', 'id'].some((k) => m[k] !== undefined && typeof m[k] !== 'string')) return `sheet ${String(s.number ?? '')} markup: a text value is not text`;
      }
    }
  }

  // Title block templates: grid sizes and cell spans are numbers, alignment one of three words.
  if (raw.titleTemplates !== undefined) {
    if (!Array.isArray(raw.titleTemplates)) return 'the title block templates are not a list';
    for (const t of raw.titleTemplates) {
      if (!isObj(t) || !Array.isArray(t.cols) || !Array.isArray(t.rows) || !Array.isArray(t.cells)) return 'a title block template is not valid';
      if (![...t.cols, ...t.rows].every(isNum)) return `title block ${String(t.name ?? '')}: grid sizes are not numbers`;
      for (const c of t.cells) {
        if (!isObj(c) || !['r', 'c', 'rs', 'cs', 'size'].every((k) => okNum(c[k]))) return `title block ${String(t.name ?? '')}: a cell position or size is not a number`;
        if (c.align !== undefined && !['left', 'center', 'right'].includes(c.align as string)) return `title block ${String(t.name ?? '')}: a cell alignment is not left, center or right`;
        if (!['text', 'logo', 'revisions'].includes(c.kind as string)) return `title block ${String(t.name ?? '')}: a cell has an unknown kind`;
        if (['text', 'caption'].some((k) => c[k] !== undefined && typeof c[k] !== 'string')) return `title block ${String(t.name ?? '')}: a cell text is not text`;
      }
    }
  }
  return undefined;
}
