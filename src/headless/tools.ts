import { z } from 'zod';
import { buildDashboard } from '../calc/dashboard';
import { runCalculations, type CalcRun } from '../calc/runs';
import { boardSummary, boardsInSupplyOrder, systemSummary } from '../calc/summary';
import { boardLocation } from '../model/levels';
import { projectInputIssues } from '../model/projectValidate';
import { STARTERS } from '../calc/motor';
import * as quick from '../calc/quick';
import type { Project } from '../types';
import { listProjects, openProject } from './project';
import { EDIT_TOOLS } from './editTools';
import { EXPORT_TOOLS } from './exportTools';
import { EXCHANGE_TOOLS } from './exchangeTools';
import { ELV_TOOLS } from './elvTools';
import { BUILDING_TOOLS } from './buildingTools';

/** The tools the command line, the MCP server and the local API offer — one list, so the three
 * always agree. The tools in this file read and check only; the ones that change a project are in editTools.ts.
 *
 * Results are short and rounded (an AI client pays for every word it reads), and use the app's
 * own calculations, so they match what the app shows. */

export interface ToolContext {
  /** The projects folder. */
  folder: string;
  /** true for the command line (any path); false for MCP and the local API (projects folder only). */
  anywhere: boolean;
  /** Tools that change a project are offered (MCP / API started with --write; always on the command line, where they still preview by default). */
  write?: boolean;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  input: z.ZodRawShape;
  /** Takes a project (the CLI accepts it as the first plain argument). */
  usesProject?: boolean;
  /** Changes a project file (Stage 2, src/headless/editTools.ts). */
  writes?: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): unknown;
}

export const r = (x: number | undefined, d = 2): number | undefined => (x === undefined || !Number.isFinite(x) ? undefined : Math.round(x * 10 ** d) / 10 ** d);

const project = z.string().describe('Project file name in the projects folder (with or without .json), as given by list_projects');
const statusFilter = z.enum(['bad', 'warn', 'all']).default('bad').describe('bad = failures only, warn = failures and items to check, all = everything');
const limit = z.number().int().min(1).max(1000).default(50).describe('Most rows to return');
const phases = z.union([z.literal(1), z.literal(3)]).default(3).describe('1 or 3 phase');
const voltage = z.number().positive().default(415).describe('System voltage, V (phase-phase for 3 phase, phase-neutral for 1 phase)');
const pf = z.number().min(0).max(1).default(0.85).describe('Power factor');

function open(args: Record<string, unknown>, ctx: ToolContext): { p: Project; run: CalcRun } {
  const { project: p } = openProject({ ref: String(args.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
  return { p, run: runCalculations(p) };
}

const keep = (s: string, status: string) => status === 'all' || s === 'bad' || (status === 'warn' && s === 'warn');

/** Throws the calculation's own message when the inputs are not valid. */
function valid<T extends { invalid?: string }>(x: T): Omit<T, 'invalid'> {
  if (x.invalid) throw new Error(x.invalid);
  const { invalid: _i, ...rest } = x;
  return rest;
}

const roundAll = (o: Record<string, number | boolean | string | undefined>, d = 2) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? r(v, d) : v]));

export const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    title: 'List projects',
    description: 'The project files in the LV Design Studio projects folder, newest first: file, name, panels, circuits, status and latest revision.',
    input: {},
    run: (_a, ctx) => ({ folder: ctx.folder, projects: listProjects(ctx.folder) })
  },
  {
    name: 'project_summary',
    title: 'Project summary',
    description: 'Headline figures of a project: system settings, connected and maximum demand, transformers and their loading, number of panels and circuits, and how many checks pass, need checking or fail.',
    input: { project },
    usesProject: true,
    run: (a, ctx) => {
      const { p, run } = open(a, ctx);
      const sys = systemSummary(p);
      const d = buildDashboard(p, run);
      return {
        name: p.name,
        status: d.info.status,
        revision: d.info.revision,
        settings: { voltageV: p.voltageV, frequencyHz: p.frequencyHz, ambientC: p.ambientC, vdLimitPct: p.vdLimitPct },
        panels: p.boards.length,
        circuits: p.feeders.length,
        connectedKw: r(sys.connectedKw, 1),
        demandKw: r(sys.demandKw, 1),
        demandKva: r(sys.demandKva, 1),
        powerFactor: r(sys.powerFactor),
        demandCurrentA: r(sys.currentA, 1),
        transformers: d.transformers.map((t) => ({ panel: t.boardId, kva: t.kva, demandKva: r(t.demandKva, 1), loadingPct: r(t.loadingPct, 1), status: t.status })),
        generators: d.generators,
        studies: d.studies.map((s) => ({ study: s.label, pass: s.pass, check: s.check, fail: s.fail })),
        todo: { fail: d.todo.filter((t) => t.status === 'bad').length, check: d.todo.filter((t) => t.status === 'warn').length }
      };
    }
  },
  {
    name: 'list_panels',
    title: 'List panels',
    description: 'Every panel (board) of a project in supply order: id, name, kind, fed from, location, demand, current, busbar loading, voltage and fault level.',
    input: { project },
    usesProject: true,
    run: (a, ctx) => {
      const { p } = open(a, ctx);
      return boardsInSupplyOrder(p).map((b) => {
        const s = boardSummary(p, b);
        return {
          id: b.id, name: b.name, kind: b.kind, fedFrom: b.upstreamId ?? (b.sourceKva ? `${b.sourceKva} kVA transformer` : undefined),
          location: boardLocation(p, b) || undefined, circuits: s.outgoing,
          demandKw: r(s.demandKw, 1), demandKva: r(s.demandKva, 1), currentA: r(s.currentA, 1), ratedA: b.ratedCurrentA,
          loadingPct: r(s.loadingPct, 1), voltagePct: r(s.voltagePct), faultKA: r(s.faultKA, 1)
        };
      });
    }
  },
  {
    name: 'get_panel',
    title: 'Panel details',
    description: 'One panel with all its circuits and their results: design current, breaker, cable, derated rating Iz, voltage drop, fault levels and the status of each check.',
    input: { project, panel: z.string().describe('Panel id, e.g. "SMDB-GF"') },
    usesProject: true,
    run: (a, ctx) => {
      const { p, run } = open(a, ctx);
      const id = String(a.panel ?? '');
      const b = p.boards.find((x) => x.id === id) ?? p.boards.find((x) => x.id.toLowerCase() === id.toLowerCase());
      if (!b) throw new Error(`No panel "${id}". Panels: ${p.boards.map((x) => x.id).join(', ')}`);
      const s = boardSummary(p, b);
      return {
        id: b.id, name: b.name, kind: b.kind, fedFrom: b.upstreamId, location: boardLocation(p, b) || undefined,
        ratedA: b.ratedCurrentA, demandKw: r(s.demandKw, 1), demandKva: r(s.demandKva, 1), currentA: r(s.currentA, 1),
        loadingPct: r(s.loadingPct, 1), voltagePct: r(s.voltagePct), faultKA: r(s.faultKA, 1),
        incomer: s.incomer ? { id: s.incomer.id, breakerA: s.incomer.breakerRatingA, cable: cableText(s.incomer) } : undefined,
        circuits: run.results.filter((x) => x.feeder.boardId === b.id).map(circuitRow)
      };
    }
  },
  {
    name: 'run_checks',
    title: 'Run checks',
    description: "Runs every calculation (cables, breakers, voltage drop, fault level, earth fault disconnection, selectivity) and returns the project's to-do list: what fails or needs checking, naming the panel or circuit. The same list the app's dashboard shows.",
    input: { project, status: statusFilter, limit },
    usesProject: true,
    run: (a, ctx) => {
      const { p, run } = open(a, ctx);
      const d = buildDashboard(p, run);
      const status = String(a.status ?? 'bad');
      const items = d.todo.filter((t) => keep(t.status, status));
      const max = Number(a.limit ?? 50);
      return {
        studies: d.studies.map((s) => ({ study: s.label, pass: s.pass, check: s.check, fail: s.fail })),
        inputIssues: projectInputIssues(p).length,
        fail: d.todo.filter((t) => t.status === 'bad').length,
        check: d.todo.filter((t) => t.status === 'warn').length,
        items: items.slice(0, max).map((t) => ({ status: t.status, text: t.text, panel: t.go?.boardId, circuit: t.go?.feederId })),
        more: Math.max(0, items.length - max),
        circuits: circuitIssues(run, status).slice(0, max)
      };
    }
  },
  {
    name: 'circuit_results',
    title: 'Circuit results',
    description: 'Calculation results per circuit (design current, breaker, cable, Iz, loading, voltage drop, fault levels, check status), optionally for one panel or only failing circuits.',
    input: { project, panel: z.string().optional().describe('Only circuits on this panel'), status: statusFilter, limit },
    usesProject: true,
    run: (a, ctx) => {
      const { run } = open(a, ctx);
      const status = String(a.status ?? 'bad');
      const panel = a.panel ? String(a.panel).toLowerCase() : undefined;
      const rows = run.results.filter((x) => (!panel || x.feeder.boardId.toLowerCase() === panel) && keep(x.status, status));
      const max = Number(a.limit ?? 50);
      return { circuits: rows.slice(0, max).map(circuitRow), more: Math.max(0, rows.length - max) };
    }
  },

  // ---- Quick calculations (no project needed) --------------------------------
  {
    name: 'calc_current',
    title: 'Current from power',
    description: 'Line current from a power, for 1 or 3 phase.',
    input: {
      power: z.number().nonnegative().describe('Power'),
      unit: z.enum(['kW', 'kVA', 'HP', 'W']).default('kW'),
      phases, voltage, pf,
      efficiency: z.number().gt(0).max(1).default(1).describe('Efficiency (motors), 0–1')
    },
    run: (a) => ({ currentA: r(quick.currentFromPower(Number(a.power), a.unit as quick.PowerUnit, a.phases as quick.Phases, Number(a.voltage), Number(a.pf), Number(a.efficiency))) })
  },
  {
    name: 'calc_voltage_drop',
    title: 'Voltage drop',
    description: 'Voltage drop of a copper cable run (built-in cable data), in volts and percent.',
    input: {
      current: z.number().positive().describe('Design current, A'),
      length: z.number().nonnegative().describe('Cable length, m'),
      csa: z.number().positive().describe('Conductor size, mm²'),
      phases, voltage, pf,
      runs: z.number().int().min(1).default(1).describe('Cables in parallel')
    },
    run: (a) => roundAll(valid(quick.voltageDrop(Number(a.current), Number(a.length), Number(a.csa), a.phases as quick.Phases, Number(a.voltage), Number(a.pf), Number(a.runs))))
  },
  {
    name: 'calc_cable_size',
    title: 'Cable size',
    description: 'Smallest copper cable (and parallel runs when needed) for a current and voltage drop limit, after ambient and grouping derating; also picks the breaker when none is given.',
    input: {
      current: z.number().positive().describe('Design current Ib, A'),
      length: z.number().nonnegative().describe('Cable length, m'),
      phases, voltage, pf,
      ambient: z.number().min(25).max(70).default(40).describe('Ambient temperature, °C'),
      groupFactor: z.number().gt(0).max(1).default(1).describe('Grouping factor, 0–1'),
      vdLimit: z.number().gt(0).max(100).default(4).describe('Voltage drop limit, %'),
      breaker: z.number().positive().optional().describe('Breaker rating In, A (default: next standard size)')
    },
    run: (a) => {
      const s = quick.cableFor(Number(a.current), { lengthM: Number(a.length), phases: a.phases as quick.Phases, voltageV: Number(a.voltage), pf: Number(a.pf), ambientC: Number(a.ambient), groupFactor: Number(a.groupFactor), vdLimitPct: Number(a.vdLimit), breakerA: a.breaker === undefined ? undefined : Number(a.breaker) });
      if (s.status === 'invalid') throw new Error(s.message);
      return { status: s.status, message: s.message, breakerA: s.breakerA, csaMm2: s.sel?.csaMm2, runs: s.sel?.runs, izA: r(s.iz, 1), vdV: r(s.vd?.volts), vdPct: r(s.vd?.pct) };
    }
  },
  {
    name: 'calc_transformer',
    title: 'Transformer',
    description: 'Transformer full-load current and the 3-phase fault at its LV terminals (infinite MV source, c = 1.05).',
    input: { kva: z.number().positive().describe('Rating, kVA'), voltage, impedance: z.number().positive().default(5).describe('Impedance uk, %') },
    run: (a) => roundAll(valid(quick.transformer(Number(a.kva), Number(a.voltage), Number(a.impedance))))
  },
  {
    name: 'calc_fault_level',
    title: 'Fault level at cable end',
    description: 'Prospective 3-phase fault at the transformer terminals and at the far end of a cable from it.',
    input: {
      kva: z.number().positive().describe('Transformer rating, kVA'),
      impedance: z.number().positive().default(5).describe('Transformer impedance uk, %'),
      voltage, csa: z.number().positive().describe('Cable conductor size, mm²'),
      length: z.number().nonnegative().describe('Cable length, m'),
      runs: z.number().int().min(1).default(1).describe('Cables in parallel')
    },
    run: (a) => roundAll(valid(quick.faultFromTransformer(Number(a.kva), Number(a.impedance), Number(a.voltage), Number(a.csa), Number(a.length), Number(a.runs))))
  },
  {
    name: 'calc_motor',
    title: 'Motor',
    description: 'Motor full-load current, input power and starting current for a starter type.',
    input: {
      kw: z.number().nonnegative().describe('Output power, kW'),
      voltage, phases, pf,
      efficiency: z.number().gt(0).max(1).default(0.9).describe('Efficiency, 0–1'),
      starter: z.enum(STARTERS.map((s) => s.value) as [string, ...string[]]).default('DOL').describe(STARTERS.map((s) => `${s.value} = ${s.label}`).join(', '))
    },
    run: (a) => roundAll(valid(quick.motor(Number(a.kw), Number(a.voltage), a.phases as quick.Phases, Number(a.pf), Number(a.efficiency), a.starter as Parameters<typeof quick.motor>[5])))
  },
  {
    name: 'calc_pf_correction',
    title: 'Power factor correction',
    description: 'Capacitor kvar to raise the power factor of a load, and the kVA before and after.',
    input: { kw: z.number().positive().describe('Load, kW'), pfNow: z.number().gt(0).max(1).describe('Present power factor'), pfTarget: z.number().gt(0).max(1).default(0.95).describe('Target power factor') },
    run: (a) => roundAll(valid(quick.pfCorrection(Number(a.kw), Number(a.pfNow), Number(a.pfTarget))))
  }
];

function cableText(f: Project['feeders'][number]): string {
  return `${(f.parallel ?? 1) > 1 ? `${f.parallel} × ` : ''}${f.cores}C × ${f.cableCsaMm2} mm², ${f.lengthM} m`;
}

function circuitRow(x: CalcRun['results'][number]) {
  const f = x.feeder;
  const failed = [
    x.ampacityStatus === 'bad' && 'cable rating Iz < Ib',
    x.protectionStatus === 'bad' && 'not Ib ≤ In ≤ Iz',
    x.vdStatus !== 'ok' && `voltage drop ${r(x.vdTotalPct)} %`,
    x.icuStatus === 'bad' && `breaker Icu ${f.breakerIcuKa} kA < fault ${r(x.breakerFaultKA, 1)} kA`,
    x.loadingPct > 85 && `loading ${r(x.loadingPct, 0)} %`
  ].filter((s): s is string => typeof s === 'string');
  return {
    id: f.id, panel: f.boardId, name: f.name, feeds: f.feedsBoardId,
    ibA: r(x.ib, 1), breakerA: f.breakerRatingA, cable: cableText(f), izA: r(x.ampacity, 1),
    loadingPct: r(x.loadingPct, 0), vdPct: r(x.vdPct), vdTotalPct: r(x.vdTotalPct),
    faultKA: r(x.breakerFaultKA, 1), icuKA: f.breakerIcuKa, status: x.status,
    ...(failed.length ? { issues: failed } : {})
  };
}

/** Each circuit that fails (or needs checking) in any study, with what failed: the detail behind the to-do list. */
export function circuitIssues(run: CalcRun, status: string): { circuit: string; panel: string; status: string; issues: string[] }[] {
  const by = new Map<string, { circuit: string; panel: string; status: string; issues: string[] }>();
  const add = (f: Project['feeders'][number], s: string, issue: string) => {
    if (!keep(s, status)) return;
    const e = by.get(f.id) ?? { circuit: f.id, panel: f.boardId, status: s, issues: [] };
    if (s === 'bad') e.status = 'bad';
    e.issues.push(issue);
    by.set(f.id, e);
  };
  for (const x of run.results) if (x.status !== 'ok') for (const i of circuitRow(x).issues ?? [`check (${x.status})`]) add(x.feeder, x.status, i);
  for (const x of run.earthing) {
    if (x.disconnection !== 'ok') add(x.feeder, x.disconnection, `earth fault: Zs ${r(x.zsOhm, 3)} Ω vs max ${r(x.maxZsOhm, 3)} Ω (${x.requiredS} s required)`);
    if (x.adiabatic !== 'ok') add(x.feeder, x.adiabatic, `CPC ${x.cpcMm2} mm² vs ${r(x.adiabaticMinMm2, 1)} mm² needed for the fault energy`);
  }
  for (const x of run.selectivity) if (x.status !== 'ok') add(x.downstream, x.status, `selectivity with ${x.upstream.id}: ${x.shortCircuit}${x.ratioOk ? '' : `, In ratio ${r(x.ratio, 2)} < 1.6`}`);
  return [...by.values()].sort((a, b) => (a.status === b.status ? 0 : a.status === 'bad' ? -1 : 1));
}

/** Every tool, read-only ones first. */
export const allTools = (): Tool[] => [...TOOLS, ...EDIT_TOOLS, ...BUILDING_TOOLS, ...EXCHANGE_TOOLS, ...ELV_TOOLS, ...EXPORT_TOOLS];
/** The tools a server offers: write tools only when it was started with --write. */
export const offeredTools = (ctx: ToolContext): Tool[] => allTools().filter((t) => !t.writes || ctx.write);
export const toolByName = (name: string, list: Tool[] = allTools()): Tool | undefined => list.find((t) => t.name === name || t.name.replace(/_/g, '-') === name);

/** Checks the arguments against the tool's input (defaults filled in), then runs it. Some tools (exports) return a
 * promise: callers await the result. */
export function callTool(t: Tool, args: Record<string, unknown>, ctx: ToolContext): unknown {
  const parsed = z.object(t.input).strict().safeParse(args);
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  return t.run(parsed.data, ctx);
}
