import type { Project, ProjectParams } from '../types';
import { boardLocation } from './levels';
import { currentRevision } from './revisions';
import { systemSummary, boardTotals, boardSummary } from '../calc/summary';
import { builtUpAreaOf } from '../calc/building';

/** Project parameters: named values written as {Name} in title blocks,
 * notes, labels and custom text. Built-in ones come from the project; people,
 * dates and your own are typed on Home → Parameters. A board's values are
 * {BOARD-ID.Prop}, e.g. {SMDB-GF.DemandKW}. Unknown names are left as typed. */

export interface ParamDef { name: string; value: string; group: 'Project' | 'People & dates' | 'Your own' | 'Design'; editable?: keyof ProjectParams | 'custom'; hint?: string }

const f = (n: number, d = 0) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: d }) : '');

export const PEOPLE: { key: keyof ProjectParams; name: string; hint: string }[] = [
  { key: 'designedBy', name: 'DesignedBy', hint: 'e.g. P. Govindasamy' },
  { key: 'drawnBy', name: 'DrawnBy', hint: 'defaults to the drawing’s “Drawn”' },
  { key: 'checkedBy', name: 'CheckedBy', hint: '' },
  { key: 'approvedBy', name: 'ApprovedBy', hint: '' },
  { key: 'submissionDate', name: 'SubmissionDate', hint: 'e.g. 15 Oct 2026' },
  { key: 'authorityRef', name: 'AuthorityRef', hint: 'DEWA / DM reference' },
  { key: 'discipline', name: 'Discipline', hint: 'e.g. ELECTRICAL' }
];

export function paramList(p: Project): ParamDef[] {
  const i = p.info ?? {};
  const d = p.drawing ?? {};
  const pp = p.params ?? {};
  const rev = currentRevision(p);
  const sys = systemSummary(p);
  const gfa = builtUpAreaOf(p);
  const list: ParamDef[] = [
    { name: 'Project', value: p.name, group: 'Project' },
    { name: 'Owner', value: i.owner ?? '', group: 'Project' },
    { name: 'Plot', value: i.plotNo ?? '', group: 'Project' },
    { name: 'Area', value: i.area ?? '', group: 'Project' },
    { name: 'Consultant', value: i.consultant ?? '', group: 'Project' },
    { name: 'Contractor', value: i.contractor ?? '', group: 'Project' },
    { name: 'Company', value: d.company ?? i.consultant ?? '', group: 'Project' },
    { name: 'DrawingNo', value: d.number ?? '', group: 'Project' },
    { name: 'DrawingTitle', value: d.title ?? 'SINGLE LINE DIAGRAM', group: 'Project' },
    { name: 'Rev', value: rev?.id ?? '—', group: 'Project' },
    { name: 'RevDate', value: rev?.date ?? '', group: 'Project' },
    { name: 'RevDescription', value: rev?.description ?? '', group: 'Project' },
    { name: 'Today', value: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), group: 'Project' },
    ...PEOPLE.map((x) => ({
      name: x.name, group: 'People & dates' as const, editable: x.key, hint: x.hint,
      value: (pp[x.key] as string | undefined) ?? (x.key === 'drawnBy' ? d.drawnBy ?? '' : x.key === 'checkedBy' ? d.checkedBy ?? '' : x.key === 'approvedBy' ? d.approvedBy ?? '' : '')
    })),
    { name: 'Voltage', value: `${p.voltageV} V`, group: 'Design' },
    { name: 'Frequency', value: `${p.frequencyHz} Hz`, group: 'Design' },
    { name: 'TCL', value: `${f(sys.connectedKw, 1)} kW`, group: 'Design' },
    { name: 'MaxDemand', value: `${f(sys.demandKw, 1)} kW`, group: 'Design' },
    { name: 'MaxDemandKVA', value: `${f(sys.demandKva, 1)} kVA`, group: 'Design' },
    { name: 'PF', value: sys.powerFactor.toFixed(2), group: 'Design' },
    { name: 'TransformerKVA', value: `${f(sys.transformerKva)} kVA`, group: 'Design' },
    { name: 'GFA', value: gfa ? `${f(gfa)} m²` : '', group: 'Design' },
    { name: 'Panels', value: String(p.boards.length), group: 'Design' },
    ...(pp.custom ?? []).map((c) => ({ name: c.name, value: c.value, group: 'Your own' as const, editable: 'custom' as const }))
  ];
  return list;
}

const BOARD_PROPS = ['DemandKW', 'DemandKVA', 'ConnectedKW', 'CurrentA', 'FaultKA', 'LoadingPct', 'RatingA', 'Name', 'Location', 'KVA'] as const;
export const boardParamNames = BOARD_PROPS;

function boardValue(p: Project, id: string, prop: string): string | undefined {
  const b = p.boards.find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!b) return undefined;
  const t = boardTotals(p, b.id);
  const s = boardSummary(p, b);
  switch (prop.toLowerCase()) {
    case 'demandkw': return f(t.demandKw, 1);
    case 'demandkva': return f(s.demandKva, 1);
    case 'connectedkw': return f(t.connectedKw, 1);
    case 'currenta': return f(s.currentA);
    case 'faultka': return f(s.faultKA, 1);
    case 'loadingpct': return s.loadingPct !== undefined ? f(s.loadingPct) : '';
    case 'ratinga': return b.ratedCurrentA ? String(b.ratedCurrentA) : '';
    case 'name': return b.name;
    case 'location': return boardLocation(p, b);
    case 'kva': return b.sourceKva ? String(b.sourceKva) : '';
    default: return undefined;
  }
}

/** Replaces {Name} and {BOARD.Prop} in a text; unknown ones stay as typed. */
export function fillParams(text: string, p: Project, extra: Record<string, string> = {}, list = paramList(p)): string {
  if (!text.includes('{')) return text;
  const map = new Map<string, string>();
  for (const x of list) map.set(x.name.toLowerCase(), x.value);
  for (const [k, v] of Object.entries(extra)) map.set(k.toLowerCase(), v);
  return text.replace(/\{([A-Za-z0-9 _-]+?)(?:\.([A-Za-z]+))?\}/g, (m, a: string, b?: string) => {
    if (b) return boardValue(p, a.trim(), b) ?? map.get(`${a}.${b}`.toLowerCase()) ?? m;
    return map.get(a.trim().toLowerCase()) ?? m;
  });
}

// ---- Formulas (custom components) ----------------------------------------------

/** A small, safe arithmetic evaluator: numbers, names, + − × ÷ ^, brackets,
 * and sqrt / abs / min / max / round / ceil / floor. No code is run. */
export function evaluate(expr: string, vars: Record<string, number>): number {
  const src = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/√/g, 'sqrt');
  let i = 0;
  const peek = () => src[i];
  const skip = () => { while (/\s/.test(src[i] ?? '')) i++; };
  const fns: Record<string, (...a: number[]) => number> = { sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, ceil: Math.ceil, floor: Math.floor };
  const lower = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  function primary(): number {
    skip();
    const c = peek();
    if (c === '(') { i++; const v = add(); skip(); if (peek() !== ')') throw new Error('missing )'); i++; return v; }
    if (c === '-') { i++; return -primary(); }
    if (c === '+') { i++; return primary(); }
    const num = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (num) { i += num[0].length; return +num[0]; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      const name = id[0].toLowerCase();
      skip();
      if (peek() === '(' && fns[name]) {
        i++;
        const args: number[] = [];
        skip();
        if (peek() !== ')') for (;;) { args.push(add()); skip(); if (peek() === ',') { i++; continue; } break; }
        if (peek() !== ')') throw new Error('missing )');
        i++;
        return fns[name](...args);
      }
      if (name === 'pi') return Math.PI;
      if (!(name in lower)) throw new Error(`unknown "${id[0]}"`);
      return lower[name];
    }
    throw new Error(`unexpected "${c ?? 'end'}"`);
  }
  function pow(): number { let v = primary(); skip(); while (peek() === '^') { i++; v = v ** primary(); skip(); } return v; }
  function mul(): number { let v = pow(); skip(); while (peek() === '*' || peek() === '/') { const o = src[i++]; const r = pow(); v = o === '*' ? v * r : v / r; skip(); } return v; }
  function add(): number { let v = mul(); skip(); while (peek() === '+' || peek() === '-') { const o = src[i++]; const r = mul(); v = o === '+' ? v + r : v - r; skip(); } return v; }
  const v = add();
  skip();
  if (i < src.length) throw new Error(`unexpected "${src[i]}"`);
  return v;
}
