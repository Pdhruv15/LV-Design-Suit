/** Field-by-field comparison of nested design data (UPS systems, the earthing plan, drawing sheets, BOQ, …):
 * what changed, with before and after values. Used by the revision comparison. */
export interface FieldChange { field: string; from: string; to: string }

/** Readable names, with units, for the keys that appear in nested data. Anything else is shown as a spaced-out version of its key. */
export const LEAF_LABELS: Record<string, string> = {
  // UPS and batteries
  growthPct: 'Growth (%)', maxLoadingPct: 'Max loading (%)', outputPf: 'Output PF', inverterEff: 'Inverter efficiency', autonomyMin: 'Backup time (min)', chem: 'Battery chemistry',
  dcVoltage: 'DC bus (V)', blockV: 'Block / module (V)', endCellV: 'End voltage per cell (V)', rateCapacityPct: 'Capacity at rate (%)', ageing: 'Ageing factor', tempFactor: 'Temperature factor',
  designMargin: 'Design margin', startSocPct: 'Start SOC (%)', minSocPct: 'Minimum SOC (%)', endModuleV: 'End module voltage (V)', bmsDischargeA: 'BMS discharge limit (A)',
  chargerCurrentA: 'Charger current (A)', rechargeLoadA: 'Load during recharge (A)', rechargeFromSocPct: 'Recharge from SOC (%)', rechargeToSocPct: 'Recharge to SOC (%)',
  chargeEfficiencyPct: 'Charge efficiency (%)', absorptionHours: 'Absorption (h)', blockAhOptions: 'Block sizes (Ah)', boardId: 'Board', loads: 'Loads', powerTable: 'Manufacturer power table',
  surge: 'Starting surge', totalKw: 'Total (kW)', totalKva: 'Total (kVA)', durationSeconds: 'Duration (s)', ratedKw: 'Inverter peak (kW)', ratedKva: 'Inverter peak (kVA)', ratedSeconds: 'Overload duration (s)',
  blockAh: 'Block (Ah)', temperatureC: 'Temperature (°C)', wattsPerBlock: 'W per block', minutes: 'Minutes',
  // Earthing
  pits: 'Pits', unlinked: 'Not linked', measured: 'Measured (Ω)', electrodeM: 'Electrode length (m)', conductorMm2: 'Earth conductor (mm²)',
  // Drawing sheets and documents
  number: 'Number', title: 'Title', kind: 'Kind', boards: 'Panels', size: 'Paper', status: 'Status', scale: 'Scale', notes: 'Notes', clouds: 'Revision clouds', arrows: 'Callouts',
  markups: 'Markups', cableLabels: 'Cable text', tags: 'Values printed', drawnBy: 'Drawn by', checkedBy: 'Checked by', approvedBy: 'Approved by', remarks: 'Remarks',
  // BOQ and rates
  projectType: 'Project type', includeSchedulePoints: 'Schedule points included', scopeReview: 'Scope review', scopeNotes: 'Scope notes', sections: 'Sections', manual: 'Manual lines',
  overrides: 'Quantity changes', wastage: 'Wastage (%)', discountPct: 'Discount (%)', markupPct: 'Overheads and profit (%)', currency: 'Currency', rates: 'Rates', rate: 'Rate'
};

const humanize = (k: string) => {
  const s = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** A key that is a field name (camelCase) is spelled out; one that is data — a pit or rate key such as "lv:MDB-1" — is shown as it is. */
export const leafLabel = (k: string) => LEAF_LABELS[k] ?? (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(k) ? humanize(k) : k);

/** Nothing there: missing, blank, an empty list or an empty object. (0 and false are values.) */
export function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v as object).every(isEmpty);
  return false;
}

/** Plain text for a value (numbers to `digits` decimals; lists and objects spelled out briefly). */
export function show(v: unknown, digits = 3): string {
  if (isEmpty(v)) return '—';
  if (typeof v === 'number') return String(+v.toFixed(digits));
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.map((x) => show(x, digits)).join(', ');
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).filter(([, x]) => !isEmpty(x)).map(([k, x]) => `${leafLabel(k)} ${show(x, digits)}`).join(', ');
  return String(v);
}

/** A value reduced to what matters for "is it different": nothing-there values collapse (missing, blank, empty list or
 * object), object keys are put in order, and — with `dropZero` — zero entries inside an object count as absent.
 * Numbers are kept exactly: a change in the fifth decimal is a change. */
export function canon(v: unknown, dropZero = false): unknown {
  if (isEmpty(v)) return undefined;
  if (Array.isArray(v)) return v.map((x) => canon(x, dropZero) ?? null);
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const c = canon((v as Record<string, unknown>)[k], dropZero);
      if (c !== undefined && !(dropZero && c === 0)) o[k] = c;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

/** Whether two values are the same design value. Compared exactly, never through their rounded text. */
export const same = (a: unknown, b: unknown, dropZero = false): boolean => JSON.stringify(canon(a, dropZero) ?? null) === JSON.stringify(canon(b, dropZero) ?? null);

/** Before and after as text, with as many decimals as it takes for two different numbers to read differently
 * (1.7501 → 1.7502 is shown as such, not as 1.75 → 1.75). */
export function pairText(a: unknown, b: unknown, fmt: (v: unknown, digits: number) => string = show): [string, string] {
  let x = fmt(a, 3), y = fmt(b, 3);
  for (const d of [4, 5, 6, 8, 10, 12]) { if (x !== y) break; x = fmt(a, d); y = fmt(b, d); }
  return [x, y];
}

const hasId = (x: unknown): x is { id: string } => !!x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string';
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export interface LeafOptions {
  /** Keys to skip (identifiers and numbers the app assigns by itself). */
  skip?: string[];
  /** A readable name for an item of a list (default its name, title, number or id). */
  itemName?: (item: Record<string, unknown>) => string;
  /** Most lines to return before "… and n more" (default 40). */
  max?: number;
}

const nameOf = (o: Record<string, unknown>) => [o.number, o.name ?? o.title].filter((x) => x !== undefined && x !== '').join(' ') || String(o.id ?? '');

/** Every difference between two values, as before → after lines named by their path ("Backup time (min)",
 * "Pits › lv:A:Main DB"). Lists of items with an `id` are matched by id: items added or removed are one
 * line each, changed items show only their changed fields. */
export function leafChanges(before: unknown, after: unknown, o: LeafOptions = {}): FieldChange[] {
  const out: FieldChange[] = [];
  const skip = new Set(o.skip ?? []);
  const nm = o.itemName ?? nameOf;
  const walk = (a: unknown, b: unknown, path: string[]) => {
    if (isEmpty(a) && isEmpty(b)) return;
    const name = path.join(' › ') || 'Value';
    if (Array.isArray(a) || Array.isArray(b)) {
      const xa = Array.isArray(a) ? a : [], xb = Array.isArray(b) ? b : [];
      if ([...xa, ...xb].some(hasId)) {
        const ma = new Map(xa.filter(hasId).map((x) => [x.id, x])), mb = new Map(xb.filter(hasId).map((x) => [x.id, x]));
        for (const id of [...new Set([...ma.keys(), ...mb.keys()])]) {
          const x = ma.get(id), y = mb.get(id);
          const label = `${name} [${nm((y ?? x) as Record<string, unknown>) || id}]`;
          if (!x) out.push({ field: label, from: '—', to: 'added' });
          else if (!y) out.push({ field: label, from: 'present', to: 'removed' });
          else walk(x, y, [...path, `[${nm(y as Record<string, unknown>) || id}]`]);
        }
        return;
      }
      if (!same(a, b)) { const [from, to] = pairText(a, b); out.push({ field: name, from, to }); }
      return;
    }
    if (isObj(a) || isObj(b)) {
      const xa = isObj(a) ? a : {}, xb = isObj(b) ? b : {};
      for (const k of [...new Set([...Object.keys(xa), ...Object.keys(xb)])]) if (!skip.has(k)) walk(xa[k], xb[k], [...path, leafLabel(k)]);
      return;
    }
    if (!same(a, b)) { const [from, to] = pairText(a, b); out.push({ field: name, from, to }); }
  };
  walk(before, after, []);
  const max = o.max ?? 40;
  return out.length > max ? [...out.slice(0, max), { field: '…', from: '', to: `and ${out.length - max} more` }] : out;
}
