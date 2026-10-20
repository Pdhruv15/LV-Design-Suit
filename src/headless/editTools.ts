import path from 'node:path';
import { z } from 'zod';
import { buildDashboard } from '../calc/dashboard';
import { evaluateFeeder, runsOf } from '../calc/electrical';
import { runCalculations } from '../calc/runs';
import { applyRecommendation, recommend } from '../calc/sizing';
import { selectCable } from '../calc/electrical';
import { addOp, newModification, PROPOSABLE, transition, withProposal, withRecord, type ModTarget } from '../model/designChanges';
import { moveBlocked, moveBoard } from '../model/moveBoard';
import { renamePanels, renameProblems } from '../model/renamePanels';
import { pasteBoard } from '../model/copyBoard';
import { boardAndDescendants, deleteBoard } from '../model/edit';
import { removeDanglingReferences } from '../model/integrity';
import { deleteCircuit } from '../model/schedule';
import { BOARD_KINDS, LOAD_TYPES, type Board, type BoardKind, type Feeder, type LoadType, type Project } from '../types';
import { openProject } from './project';
import { circuitIssues, r, type Tool, type ToolContext } from './tools';
import { commitProject, readLog, undoChange, WriteRefused } from './write';

/** Stage 2: tools that change a project. Two kinds:
 *
 * - Value changes (cable size, breaker, load, settings) are only ever PROPOSED: a modification record (MOD-00x) is added
 *   to Reports → Changes, and the engineer accepts and applies it in the app — one undo step, with the app's conflict
 *   checks. The working design is not changed by the tool, and the tool never accepts anything on anyone's behalf.
 * - Structure changes (add a panel or circuit, move, rename, copy a panel) change the file, after a preview.
 *
 * Every tool previews by default (nothing written). Writing keeps the previous version and logs it (undo_change). The
 * MCP server and the local API offer these tools only when started with --write. Deleting (delete_panel, delete_circuit)
 * also needs the name of the engineer who approved it. Exports are in exportTools.ts. */

export const AUTHOR = 'AI assistant (lvds)';
const project = z.string().describe('Project file name in the projects folder, as given by list_projects');
const preview = (other: 'apply' | 'propose') => z.enum(['preview', other]).default('preview').describe(`preview = show what would change, nothing is written; ${other} = ${other === 'apply' ? 'change the project file (a backup is kept; undo_change puts it back)' : 'add the proposal to Reports → Changes for the engineer to accept and apply in the app'}`);

interface Planned {
  next: Project;
  summary: string;
  details?: unknown;
  warnings?: string[];
  /** The design the checks are run on, when it is not `next` (a proposal: the design once it is applied). */
  designAfter?: Project;
}

function checksOf(p: Project) {
  const run = runCalculations(p);
  const d = buildDashboard(p, run);
  return { fail: d.todo.filter((t) => t.status === 'bad').length, check: d.todo.filter((t) => t.status === 'warn').length, failing: new Set(circuitIssues(run, 'bad').map((c) => c.circuit)), run };
}

/** Runs a planned change: a preview, or the change written with a backup. */
function edit(args: Record<string, unknown>, ctx: ToolContext, tool: string, write: boolean, plan: (p: Project) => Planned) {
  const { project: p, file, text } = openProject({ ref: String(args.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
  const out = plan(p);
  const before = checksOf(p), after = checksOf(out.designAfter ?? out.next);
  const result = {
    summary: out.summary,
    ...(out.details !== undefined ? { details: out.details } : {}),
    ...(out.warnings?.length ? { warnings: out.warnings } : {}),
    checks: {
      before: { fail: before.fail, check: before.check },
      after: { fail: after.fail, check: after.check },
      newlyFailing: [...after.failing].filter((id) => !before.failing.has(id)),
      fixed: [...before.failing].filter((id) => !after.failing.has(id))
    }
  };
  if (!write) return { mode: 'preview', written: false, ...result, next: 'Nothing was written. Call again with mode apply / propose to make the change.' };
  if (out.next === p) return { mode: 'done', written: false, ...result };
  const entry = commitProject(ctx.folder, file, text, out.next, tool, out.summary);
  return { mode: 'done', written: true, change: entry.id, file: path.basename(file), ...result, note: `Undo with undo_change (change ${entry.id}). If the project is open in the app, open it again to see the change.` };
}

const findBoard = (p: Project, id: string): Board => {
  const b = p.boards.find((x) => x.id === id) ?? p.boards.find((x) => x.id.toLowerCase() === id.toLowerCase());
  if (!b) throw new Error(`No panel "${id}". Panels: ${p.boards.map((x) => x.id).join(', ')}`);
  return b;
};
const taken = (p: Project) => new Set([...p.boards.map((b) => b.id), ...p.feeders.map((f) => f.id)]);
/** base-1, base-2 … (or base1, base2 … with sep ''), the first one free. */
const uniqueId = (p: Project, base: string, sep = '-') => { const t = taken(p); for (let n = 1; ; n++) if (!t.has(`${base}${sep}${n}`)) return `${base}${sep}${n}`; };
const checkNewId = (p: Project, id: string) => { if (!id.trim()) throw new Error('The id is empty.'); if (taken(p).has(id)) throw new Error(`${id} already exists in the project.`); };

/** Board ratings for a new panel, as the diagram palette gives them (src/model/sldEdit.ts). */
const BOARD_RATING: Record<BoardKind, number> = { MC: 400, MDB: 1600, 'LV-MDB': 1600, SMDB: 250, DB: 63, EDB: 63, MCC: 400, EMCC: 400, EMDB: 250, UPS: 32 };

// ---- Proposals -------------------------------------------------------------------

interface ValueChange { target: ModTarget; id?: string; field: string; value: unknown }

/** A proposal (status proposed) with these changes, checked by the app's own rules. */
function proposal(p: Project, title: string, reason: string, changes: ValueChange[]) {
  if (!changes.length) throw new Error('Nothing to propose: no value would change.');
  let rec = newModification(p, { title, reason, author: AUTHOR });
  for (const c of changes) rec = addOp(p, rec, c.target, c.target === 'project' ? undefined : c.id, c.field, c.value);
  const t = transition(p, rec, 'proposed', { by: AUTHOR });
  if (!t.ok) throw new Error(t.error);
  return t.record;
}

function proposeTool(args: Record<string, unknown>, ctx: ToolContext, tool: string, make: (p: Project) => { title: string; reason: string; changes: ValueChange[]; warnings?: string[] }) {
  const write = args.mode === 'propose';
  // Only the record is written; the checks show the design as it would be once the engineer applies it.
  const res = edit(args, ctx, tool, write, (p) => {
    const m = make(p);
    const rec = proposal(p, m.title, m.reason, m.changes);
    return {
      next: withRecord(p, rec),
      designAfter: withProposal(p, rec),
      summary: `${rec.id} proposed: ${rec.title} (${rec.ops.length} change${rec.ops.length === 1 ? '' : 's'})`,
      details: { proposal: rec.id, changes: rec.ops.map((o) => ({ item: o.targetId ?? 'project', field: o.label, from: o.before, to: o.after })) },
      warnings: m.warnings
    };
  });
  if (!write) return res;
  const id = (res.details as { proposal: string }).proposal;
  return { ...res, note: `${id} is in Reports → Changes as proposed. The engineer reviews it there, accepts it with their name and applies it (one undo step); the design is not changed until then. undo_change removes the proposal.` };
}

/** Feeders in supply order (incomers of upper boards first), as applyAllRecommendations sizes them. */
function supplyOrder(p: Project, feeders: Feeder[]): Feeder[] {
  const depth = (id: string, seen = new Set<string>()): number => { const b = p.boards.find((x) => x.id === id); if (!b?.upstreamId || seen.has(id)) return 0; seen.add(id); return 1 + depth(b.upstreamId, seen); };
  return [...feeders].sort((a, b) => depth(a.boardId) - depth(b.boardId) || Number(!!b.feedsBoardId) - Number(!!a.feedsBoardId));
}

const SIZED_FIELDS = ['breakerRatingA', 'breakerIcuKa', 'breakerType', 'cableCsaMm2'] as const;

// ---- The tools ---------------------------------------------------------------------

const valueChange = z.object({
  target: z.enum(['feeder', 'board', 'project']).describe('feeder = a circuit, board = a panel, project = a project setting'),
  id: z.string().optional().describe('Circuit or panel id (not for a project setting)'),
  field: z.string().describe(`Field to change. Circuit: ${PROPOSABLE.feeder.map((f) => f.key).join(', ')}. Panel: ${PROPOSABLE.board.map((f) => f.key).join(', ')}. Project: ${PROPOSABLE.project.map((f) => f.key).join(', ')}`),
  value: z.union([z.number(), z.string(), z.boolean()]).describe('New value')
});

export const EDIT_TOOLS: Tool[] = [
  {
    name: 'propose_changes',
    title: 'Propose value changes',
    description: 'Proposes changes to values (cable size, breaker rating, load, length, panel or project settings) as one modification record in Reports → Changes. The engineer accepts and applies it in the app; this tool never changes the design itself. Preview first shows the checks as they would be once applied.',
    input: { project, title: z.string().min(3).describe('Short title, e.g. "Upsize GF sockets cable"'), reason: z.string().min(3).describe('Why: the engineering reason'), changes: z.array(valueChange).min(1).max(200), mode: preview('propose') },
    usesProject: true, writes: true,
    run: (a, ctx) => proposeTool(a, ctx, 'propose_changes', () => ({ title: String(a.title), reason: String(a.reason), changes: a.changes as ValueChange[] }))
  },
  {
    name: 'size_circuits',
    title: 'Size cables and breakers',
    description: "Sizes breakers, breaking capacity and cables with the app's own selection (Ib ≤ In ≤ Iz, loading below 85 %, voltage drop budget, fault level), incomers first, and proposes the result as a modification record for the engineer to accept and apply. scope: failing = circuits that fail or need checking, pending = placeholder incomers not sized yet, all = every circuit (only upsizing what does not pass).",
    input: { project, scope: z.enum(['failing', 'pending', 'all']).default('failing'), panel: z.string().optional().describe('Only circuits on this panel'), mode: preview('propose') },
    usesProject: true, writes: true,
    run: (a, ctx) => proposeTool(a, ctx, 'size_circuits', (p) => {
      const scope = String(a.scope ?? 'failing');
      const panel = a.panel ? findBoard(p, String(a.panel)).id : undefined;
      const inScope = p.feeders.filter((f) => (!panel || f.boardId === panel) && (scope === 'all' || (scope === 'pending' ? f.sizingPending : evaluateFeeder(p, f).status !== 'ok')));
      let work = p;
      const warnings: string[] = [];
      for (const f of supplyOrder(p, inScope)) {
        const cur = work.feeders.find((x) => x.id === f.id)!;
        const rec = recommend(work, cur, 'fix');
        if (rec.note) warnings.push(`${f.id}: ${rec.note}`);
        if (!rec.changed) continue;
        const next = applyRecommendation(cur, rec);
        work = { ...work, feeders: work.feeders.map((x) => (x.id === f.id ? next : x)) };
      }
      const changes: ValueChange[] = [];
      for (const f of p.feeders) {
        const n = work.feeders.find((x) => x.id === f.id)!;
        if (n === f) continue;
        for (const k of SIZED_FIELDS) if (n[k] !== undefined && n[k] !== f[k]) changes.push({ target: 'feeder', id: f.id, field: k, value: n[k] });
        if (runsOf(n) !== runsOf(f)) changes.push({ target: 'feeder', id: f.id, field: 'parallel', value: runsOf(n) });
        if (f.cpcMm2 !== undefined && n.cpcMm2 === undefined) warnings.push(`${f.id}: the earth conductor (CPC ${f.cpcMm2} mm²) was set by hand; check it for the new cable size`);
        if (f.sizingPending) warnings.push(`${f.id}: after applying, untick "sizing pending" on the circuit in the app`);
      }
      if (!changes.length) throw new Error(inScope.length ? `The ${inScope.length} circuit(s) in scope already pass with their present sizes (or nothing standard fits: ${warnings.join('; ') || 'none'}).` : 'No circuits in scope.');
      return { title: `Size ${new Set(changes.map((c) => c.id)).size} circuit(s)${panel ? ` on ${panel}` : ''}`, reason: `Cable and breaker selection by the app's sizing rules (scope: ${scope}), proposed by ${AUTHOR}.`, changes, warnings };
    })
  },
  {
    name: 'add_panel',
    title: 'Add a panel',
    description: "Adds a panel (board). With fedFrom, it also adds its incomer on that panel: breaker at the panel's rating and a cable sized by the app for that breaker and the length. Without fedFrom it is a new main board with its own supply.",
    input: {
      project,
      kind: z.enum(BOARD_KINDS.map((k) => k.value) as [BoardKind, ...BoardKind[]]).describe(BOARD_KINDS.map((k) => `${k.value} = ${k.label}`).join('; ')),
      id: z.string().optional().describe('Panel id, e.g. "SMDB-L3" (default: next free <kind>-n)'),
      name: z.string().optional(),
      fedFrom: z.string().optional().describe('Panel that supplies it'),
      ratedA: z.number().positive().optional().describe('Busbar / main device rating, A (default by kind)'),
      lengthM: z.number().positive().default(30).describe('Incomer cable length, m'),
      location: z.string().optional(),
      transformerKva: z.number().positive().optional().describe('Main board only: transformer rating, kVA'),
      impedancePct: z.number().positive().optional().describe('Main board only: transformer impedance, %'),
      mode: preview('apply')
    },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'add_panel', a.mode === 'apply', (p) => {
      const kind = a.kind as BoardKind;
      const id = a.id ? String(a.id).trim() : uniqueId(p, kind);
      checkNewId(p, id);
      const parent = a.fedFrom ? findBoard(p, String(a.fedFrom)) : undefined;
      if (!parent && (a.transformerKva === undefined) !== (a.impedancePct === undefined)) throw new Error('Give both transformerKva and impedancePct, or neither.');
      if (parent && a.transformerKva !== undefined) throw new Error('A transformer goes on a main board (no fedFrom).');
      const board: Board = {
        id, name: a.name ? String(a.name) : id, kind, ratedCurrentA: Number(a.ratedA ?? BOARD_RATING[kind]),
        ...(parent ? { upstreamId: parent.id } : { supply: { fedFrom: 'DEWA' } }),
        ...(a.location ? { location: String(a.location) } : {}),
        ...(a.transformerKva !== undefined ? { sourceKva: Number(a.transformerKva), sourceImpedancePct: Number(a.impedancePct) } : {})
      };
      if (!parent) return { next: { ...p, boards: [...p.boards, board] }, summary: `Add main board ${id} (${kind}) with its own supply`, details: { panel: board } };
      const rating = board.ratedCurrentA!;
      const lengthM = Number(a.lengthM ?? 30);
      const inc0: Feeder = {
        id: taken(p).has(`INC-${id}`) ? uniqueId(p, `INC-${id}`) : `INC-${id}`, boardId: parent.id, feedsBoardId: id, name: `Incomer to ${board.name}`,
        loadKw: 0, demandFactor: 1, powerFactor: 0.85, lengthM, cores: 4, breakerRatingA: rating, breakerIcuKa: 36,
        cableCsaMm2: selectCable(rating, lengthM, p.voltageV, 4, 0.85, p.ambientC, 100, rating) ?? 300,
        breakerType: rating > 1600 ? 'ACB' : rating > 63 ? 'MCCB' : 'C'
      };
      const withBoard = { ...p, boards: [...p.boards, board], feeders: [...p.feeders, inc0] };
      const inc = applyRecommendation(inc0, recommend(withBoard, inc0, 'fix'));
      const next = { ...withBoard, feeders: withBoard.feeders.map((f) => (f.id === inc.id ? inc : f)) };
      return { next, summary: `Add ${id} (${kind}) on ${parent.id}: incomer ${inc.id}, ${inc.breakerRatingA} A, ${runsOf(inc) > 1 ? `${runsOf(inc)} × ` : ''}4C × ${inc.cableCsaMm2} mm², ${lengthM} m`, details: { panel: board, incomer: { id: inc.id, breakerA: inc.breakerRatingA, icuKA: inc.breakerIcuKa, cableMm2: inc.cableCsaMm2, runs: runsOf(inc) } } };
    })
  },
  {
    name: 'add_circuit',
    title: 'Add a circuit',
    description: "Adds an outgoing circuit (load) to a panel, with its breaker and cable sized by the app's selection for its load and length.",
    input: {
      project,
      panel: z.string().describe('Panel the circuit is on'),
      name: z.string().min(1).describe('e.g. "Chiller 1"'),
      loadKw: z.number().nonnegative().describe('Load, kW'),
      loadType: z.enum(LOAD_TYPES.map((t) => t.value) as [LoadType, ...LoadType[]]).default('general'),
      powerFactor: z.number().gt(0).max(1).default(0.9),
      demandFactor: z.number().gt(0).max(1).default(1),
      lengthM: z.number().positive().describe('Cable length, m'),
      phases: z.union([z.literal(1), z.literal(3)]).default(3),
      id: z.string().optional().describe('Circuit id (default: <panel>-C<n>)'),
      mode: preview('apply')
    },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'add_circuit', a.mode === 'apply', (p) => {
      const b = findBoard(p, String(a.panel));
      const id = a.id ? String(a.id).trim() : uniqueId(p, `${b.id}-C`, '');
      checkNewId(p, id);
      const lt = a.loadType as LoadType;
      const f0: Feeder = {
        id, boardId: b.id, name: String(a.name), loadKw: Number(a.loadKw), loadType: lt, powerFactor: Number(a.powerFactor), demandFactor: Number(a.demandFactor),
        lengthM: Number(a.lengthM), cores: a.phases === 1 ? 2 : 4, cableCsaMm2: 4, breakerRatingA: 16, breakerIcuKa: 25,
        ...(lt === 'pv' ? { generation: true } : {})
      };
      const withF = { ...p, feeders: [...p.feeders, f0] };
      const rec = recommend(withF, f0, 'optimise');
      const f = applyRecommendation(f0, rec);
      const next = { ...p, feeders: [...p.feeders, f] };
      const res = evaluateFeeder(next, f);
      return {
        next, summary: `Add ${id} "${f.name}" on ${b.id}: ${f.loadKw} kW, ${f.breakerRatingA} A ${f.breakerType ?? ''}, ${runsOf(f) > 1 ? `${runsOf(f)} × ` : ''}${f.cores}C × ${f.cableCsaMm2} mm², ${f.lengthM} m`,
        details: { circuit: id, ibA: r(res.ib, 1), breakerA: f.breakerRatingA, icuKA: f.breakerIcuKa, cableMm2: f.cableCsaMm2, runs: runsOf(f), izA: r(res.ampacity, 1), vdTotalPct: r(res.vdTotalPct), status: res.status },
        warnings: rec.note ? [rec.note] : undefined
      };
    })
  },
  {
    name: 'move_panel',
    title: 'Move a panel',
    description: 'Supplies a panel (with everything below it) from another panel. Its incomer moves to the new source and its length is flagged for checking, since the route changed.',
    input: { project, panel: z.string(), to: z.string().describe('New supplying panel'), mode: preview('apply') },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'move_panel', a.mode === 'apply', (p) => {
      const b = findBoard(p, String(a.panel)), to = findBoard(p, String(a.to));
      const blocked = moveBlocked(p, b.id, to.id);
      if (blocked) throw new Error(blocked);
      return { next: moveBoard(p, b.id, to.id), summary: `Move ${b.id} from ${b.upstreamId ?? 'its own supply'} to ${to.id}`, warnings: ['The incomer length is flagged "to check": the cable route changed.'] };
    })
  },
  {
    name: 'rename_panels',
    title: 'Rename panels',
    description: 'Renames panels everywhere they are referenced (parents, circuits, ties, sheets, risers, reports); circuit and incomer ids that carry the panel name follow it.',
    input: { project, renames: z.array(z.object({ from: z.string(), to: z.string() })).min(1).max(500), mode: preview('apply') },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'rename_panels', a.mode === 'apply', (p) => {
      const pairs = (a.renames as { from: string; to: string }[]).map((x) => ({ from: findBoard(p, x.from).id, to: x.to.trim() }));
      const problems = renameProblems(p, pairs);
      if (problems.length) throw new Error(problems.join('; '));
      return { next: renamePanels(p, pairs), summary: `Rename ${pairs.map((x) => `${x.from} → ${x.to}`).join(', ')}` };
    })
  },
  {
    name: 'copy_panel',
    title: 'Copy a panel with its branch',
    description: 'Copies a panel with everything below it (sub-panels, circuits, load schedules) onto another panel, renamed — e.g. the L1 SMDB and its DBs for L2. Ids have idFind replaced by idReplace (taken ids get -2, -3 …); names and locations have nameFind replaced by nameReplace.',
    input: {
      project, panel: z.string().describe('Panel to copy'), to: z.string().describe('Panel the copy is fed from'),
      idFind: z.string().default(''), idReplace: z.string().default(''), nameFind: z.string().default(''), nameReplace: z.string().default(''),
      mode: preview('apply')
    },
    usesProject: true, writes: true,
    run: (a, ctx) => edit(a, ctx, 'copy_panel', a.mode === 'apply', (p) => {
      const b = findBoard(p, String(a.panel)), to = findBoard(p, String(a.to));
      const res = pasteBoard(p, b.id, to.id, { idFind: String(a.idFind ?? ''), idReplace: String(a.idReplace ?? ''), nameFind: String(a.nameFind ?? ''), nameReplace: String(a.nameReplace ?? '') });
      const added = res.project.boards.filter((x) => !p.boards.some((y) => y.id === x.id)).map((x) => x.id);
      return { next: res.project, summary: `Copy ${b.id} onto ${to.id} as ${res.rootId} (${added.length} panel(s), ${res.project.feeders.length - p.feeders.length} circuit(s))`, details: { panels: added } };
    })
  },
  {
    name: 'delete_panel',
    title: 'Delete a panel',
    description: 'Deletes a panel with every panel below it, all their circuits and its incomer, and takes it out of sheets, risers, ties and reports (the app\'s own delete). Preview first; deleting needs approvedBy, the name of the engineer who approved it. undo_change puts it back.',
    input: { project, panel: z.string(), approvedBy: z.string().trim().min(2).optional().describe('Name of the engineer who approved the delete (required to apply)'), mode: preview('apply') },
    usesProject: true, writes: true,
    run: (a, ctx) => {
      if (a.mode === 'apply' && !(typeof a.approvedBy === 'string' && a.approvedBy.trim().length >= 2)) throw new Error('Deleting needs approvedBy: the name of the engineer who approved it.');
      return edit(a, ctx, 'delete_panel', a.mode === 'apply', (p) => {
        const b = findBoard(p, String(a.panel));
        const gone = boardAndDescendants(p, b.id);
        const circuits = p.feeders.filter((f) => gone.has(f.boardId) || (f.feedsBoardId !== undefined && gone.has(f.feedsBoardId)));
        const next = deleteBoard(p, b.id);
        return {
          next,
          summary: `Delete ${b.id}${gone.size > 1 ? ` and ${gone.size - 1} panel(s) below it` : ''}, ${circuits.length} circuit(s)${a.approvedBy ? ` — approved by ${String(a.approvedBy).trim()}` : ''}`,
          details: { panels: [...gone], circuits: circuits.map((f) => f.id) }
        };
      });
    }
  },
  {
    name: 'delete_circuit',
    title: 'Delete a circuit',
    description: 'Deletes one outgoing circuit and its references (tray routes, sheets). An incomer is not deleted here: delete its panel with delete_panel. Preview first; deleting needs approvedBy. undo_change puts it back.',
    input: { project, circuit: z.string(), approvedBy: z.string().trim().min(2).optional().describe('Name of the engineer who approved the delete (required to apply)'), mode: preview('apply') },
    usesProject: true, writes: true,
    run: (a, ctx) => {
      if (a.mode === 'apply' && !(typeof a.approvedBy === 'string' && a.approvedBy.trim().length >= 2)) throw new Error('Deleting needs approvedBy: the name of the engineer who approved it.');
      return edit(a, ctx, 'delete_circuit', a.mode === 'apply', (p) => {
        const id = String(a.circuit);
        const f = p.feeders.find((x) => x.id === id) ?? p.feeders.find((x) => x.id.toLowerCase() === id.toLowerCase());
        if (!f) throw new Error(`No circuit "${id}".`);
        if (f.feedsBoardId) throw new Error(`${f.id} is the incomer of ${f.feedsBoardId}: delete the panel with delete_panel (or move it with move_panel).`);
        return { next: removeDanglingReferences(deleteCircuit(p, f.id)), summary: `Delete ${f.id} "${f.name}" on ${f.boardId}${a.approvedBy ? ` — approved by ${String(a.approvedBy).trim()}` : ''}`, details: { circuit: f.id, panel: f.boardId, loadKw: f.loadKw } };
      });
    }
  },
  {
    name: 'list_changes',
    title: 'Changes made by tools',
    description: 'The changes written by these tools (newest first): id, time, project file, what was done, and whether it was undone. Proposals the engineer has applied are listed in the app under Reports → Changes.',
    input: { project: project.optional().describe('Only this project file') },
    run: (a, ctx) => {
      const all = readLog(ctx.folder);
      const undone = new Set(all.map((e) => e.undoes).filter(Boolean));
      const want = a.project ? openProject({ ref: String(a.project), folder: ctx.folder, anywhere: ctx.anywhere }).file : undefined;
      return all.filter((e) => !want || e.file === path.basename(want)).reverse().slice(0, 100)
        .map((e) => ({ change: e.id, at: e.at, file: e.file, tool: e.tool, summary: e.summary, ...(undone.has(e.id) ? { undone: true } : {}) }));
    }
  },
  {
    name: 'undo_change',
    title: 'Undo a change',
    description: 'Puts a project file back to how it was before a change made by these tools (default: the latest one not yet undone). Only when the file has not been changed since; otherwise it says where the earlier version is kept.',
    input: { project, change: z.string().optional().describe('Change id from list_changes (default: the latest)'), mode: preview('apply') },
    usesProject: true, writes: true,
    run: (a, ctx) => {
      const { project: p, file, text } = openProject({ ref: String(a.project ?? ''), folder: ctx.folder, anywhere: ctx.anywhere });
      const name = path.basename(file);
      const log = readLog(ctx.folder).filter((e) => e.file === name);
      const undone = new Set(log.map((e) => e.undoes).filter(Boolean));
      const target = a.change ? log.find((e) => e.id === a.change) : [...log].reverse().find((e) => !e.undoes && !undone.has(e.id));
      if (!target) throw new WriteRefused(a.change ? `No change ${String(a.change)} for ${name}.` : `No change to undo for ${name}.`);
      if (a.mode !== 'apply') return { mode: 'preview', written: false, wouldUndo: { change: target.id, at: target.at, summary: target.summary }, next: 'Call again with mode apply to put it back.' };
      const e = undoChange(ctx.folder, file, text, p, target.id);
      return { mode: 'done', written: true, change: e.id, summary: e.summary, note: 'If the project is open in the app, open it again to see it.' };
    }
  }
];
