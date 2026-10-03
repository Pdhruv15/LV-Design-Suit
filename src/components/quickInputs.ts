/** Numeric input rules for the Quick Calculator cards. Empty values stay
 * empty: they must never become a default or zero during calculation. */
export type QuickValues = Record<string, string>;
export type QuickErrors = Record<string, string>;

export function quickNumber(value: string | undefined): number | undefined {
  const text = (value ?? '').trim();
  if (!text) return undefined;
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(text)) return NaN;
  return Number(text.replace(',', '.'));
}

type Rule = { label: string; min?: number; max?: number; exclusiveMin?: boolean; integer?: boolean; choices?: string[] };
const positive = (label: string): Rule => ({ label, min: 0, exclusiveMin: true });
const magnitude = (label: string): Rule => ({ label, min: 0 });
const factor = (label: string, allowZero = false): Rule => ({ ...magnitude(label), max: 1, exclusiveMin: !allowZero });
const supply: Rule = { label: 'Supply', choices: ['1', '3'] };
const runs: Rule = { ...positive('Runs in parallel'), integer: true };
const limit: Rule = { ...positive('Voltage-drop limit'), max: 100 };

/** Only fields used by the selected mode are required. */
export function quickInputErrors(card: string, values: QuickValues, cableSizes: number[] = []): QuickErrors {
  const cable: Rule = { label: 'Cable size', choices: cableSizes.map(String) };
  let rules: Record<string, Rule>;
  switch (card) {
    case 'amps':
      rules = { p: magnitude('Power'), v: positive('Voltage'), ph: supply, unit: { label: 'Unit', choices: ['kW', 'kVA', 'HP', 'W'] } };
      if (values.unit !== 'kVA') Object.assign(rules, { pf: factor('Power factor'), eff: factor('Efficiency') });
      break;
    case 'power': rules = { i: magnitude('Current'), v: positive('Voltage'), ph: supply, pf: factor('Power factor', true) }; break;
    case 'triangle': {
      const pairs: Record<string, [string, string]> = { 'kw-pf': ['kW', 'PF'], 'kva-pf': ['kVA', 'PF'], 'kw-kva': ['kW', 'kVA'], 'kw-kvar': ['kW', 'kVAr'], 'kva-kvar': ['kVA', 'kVAr'] };
      const pair = pairs[values.known] ?? pairs['kw-pf'];
      rules = { known: { label: 'Known values', choices: Object.keys(pairs) }, x: magnitude(pair[0]), y: pair[1] === 'PF' ? factor('Power factor', true) : magnitude(pair[1]) };
      break;
    }
    case 'cable': rules = { i: positive('Design current'), v: positive('Voltage'), ph: supply, l: magnitude('Length'), pf: factor('Power factor', true), amb: { label: 'Ambient temperature', min: 25, max: 70 }, g: factor('Grouping factor'), vd: limit }; break;
    case 'vd': rules = { i: magnitude('Current'), v: positive('Voltage'), ph: supply, l: magnitude('Length'), pf: factor('Power factor', true), runs, csa: cable, lim: limit }; break;
    case 'tx': rules = { kva: positive('Transformer rating'), v: positive('Voltage'), z: positive('Impedance') }; break;
    case 'motor': rules = { p: magnitude('Output power'), v: positive('Voltage'), ph: supply, pf: factor('Power factor'), eff: factor('Efficiency'), unit: { label: 'Unit', choices: ['kW', 'HP'] }, st: { label: 'Starter', choices: ['DOL', 'SD', 'SS', 'VFD'] } }; break;
    case 'pfc': rules = { kw: positive('Active power'), now: factor('Present power factor'), target: factor('Target power factor') }; break;
    case 'fault':
      rules = { src: { label: 'Source', choices: ['tx', 'ka'] }, v: positive('Voltage'), l: magnitude('Length'), runs, csa: cable };
      Object.assign(rules, values.src === 'tx' ? { kva: positive('Transformer rating'), z: positive('Impedance') } : { ka: positive('Fault at start') });
      break;
    case 'ohm': {
      const pairs: Record<string, [string, string]> = { 'v-i': ['Voltage', 'Current'], 'v-r': ['Voltage', 'Resistance'], 'v-p': ['Voltage', 'Power'], 'i-r': ['Current', 'Resistance'], 'i-p': ['Current', 'Power'], 'r-p': ['Resistance', 'Power'] };
      const pair = pairs[values.known] ?? pairs['v-i'];
      rules = { known: { label: 'Known values', choices: Object.keys(pairs) }, x: magnitude(pair[0]), y: magnitude(pair[1]) };
      // Denominators must be nonzero; zero load remains valid where defined.
      if (['v-i', 'v-p', 'i-p'].includes(values.known)) rules.x = positive(pair[0]);
      if (['v-i', 'v-r', 'v-p', 'i-r', 'i-p'].includes(values.known)) rules.y = positive(pair[1]);
      if (values.known === 'r-p') rules.x = positive(pair[0]);
      break;
    }
    case 'energy': rules = { kw: magnitude('Load'), h: { label: 'Hours per day', min: 0, max: 24 }, days: magnitude('Days'), rate: magnitude('Tariff') }; break;
    case 'units': rules = { hp: magnitude('HP'), kw: magnitude('kW'), awg: { label: 'AWG', min: -3, integer: true }, mm2: positive('Cable area'), kcmil: magnitude('kcmil') }; break;
    default: return {};
  }
  const errors: QuickErrors = {};
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.choices) {
      if (!rule.choices.includes(values[key])) errors[key] = `Choose a supported ${rule.label.toLowerCase()}.`;
      continue;
    }
    const value = quickNumber(values[key]);
    if (value === undefined) errors[key] = `Enter ${rule.label.toLowerCase()}.`;
    else if (!Number.isFinite(value)) errors[key] = `${rule.label} must be a finite number.`;
    else if (rule.integer && !Number.isInteger(value)) errors[key] = `${rule.label} must be a whole number.`;
    else if (rule.min !== undefined && (rule.exclusiveMin ? value <= rule.min : value < rule.min)) errors[key] = `${rule.label} must be ${rule.exclusiveMin ? 'above' : 'at least'} ${rule.min}.`;
    else if (rule.max !== undefined && value > rule.max) errors[key] = `${rule.label} must be at most ${rule.max}.`;
  }
  return errors;
}
