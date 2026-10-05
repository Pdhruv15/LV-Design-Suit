import type { Project } from '../types';

/** A reference inside the project that points at something that does not exist (a panel, circuit, sheet or
 * building that was renamed or removed without the reference being updated). */
export interface RefIssue { where: string; ref: string; problem: string }

/** Every cross-reference in the project: which panel a circuit is on and feeds, which panel feeds which, and the
 * panels, circuits and buildings named by sheets, UPS systems, bus couplers, risers, reports and studies.
 * Used to prove that rename, move, copy and delete leave the model consistent. */
export function checkReferences(p: Project): RefIssue[] {
  const out: RefIssue[] = [];
  const boards = new Set(p.boards.map((b) => b.id)), feeders = new Set(p.feeders.map((f) => f.id));
  const need = (set: Set<string>, ref: string | undefined, where: string, what: string) => { if (ref && !set.has(ref)) out.push({ where, ref, problem: `${what} does not exist` }); };

  for (const b of p.boards) {
    need(boards, b.upstreamId, `Panel ${b.id}`, 'Panel it is fed from');
    // A loop in the supply chain: following "fed from" must end at a main board.
    let x: string | undefined = b.id, n = 0;
    while (x && n++ <= p.boards.length) x = p.boards.find((y) => y.id === x)?.upstreamId;
    if (x) out.push({ where: `Panel ${b.id}`, ref: b.id, problem: 'is fed in a loop' });
  }
  const ids = new Set<string>();
  for (const b of p.boards) { if (ids.has(b.id)) out.push({ where: `Panel ${b.id}`, ref: b.id, problem: 'has the same name as another panel' }); ids.add(b.id); }
  const fids = new Set<string>();
  for (const f of p.feeders) { if (fids.has(f.id)) out.push({ where: `Circuit ${f.id}`, ref: f.id, problem: 'has the same id as another circuit' }); fids.add(f.id); }

  const compIds = new Set((p.components ?? []).map((c) => c.id));
  for (const f of p.feeders) {
    need(boards, f.boardId, `Circuit ${f.id}`, 'Panel it is on');
    need(boards, f.feedsBoardId, `Circuit ${f.id}`, 'Panel it feeds');
    need(compIds, f.componentId, `Circuit ${f.id}`, 'Own component it was made from');
  }
  for (const t of p.ties ?? []) { need(boards, t.a, `Bus coupler ${t.id}`, 'Panel A'); need(boards, t.b, `Bus coupler ${t.id}`, 'Panel B'); }
  for (const u of p.upsSystems ?? []) need(boards, u.boardId, `UPS ${u.name || u.id}`, 'UPS panel');
  for (const r of p.busRisers ?? []) need(boards, r.sourceBoardId, `Busbar riser ${r.name || r.id}`, 'Source panel');
  for (const id of p.studyReport?.boards ?? []) need(boards, id, 'Study report', 'Selected panel');
  for (const id of p.pfc?.boards ?? []) need(boards, id, 'Power factor plan', 'Panel');
  for (const id of p.txGen?.txBoards ?? []) need(boards, id, 'Transformer plan', 'Panel');
  for (const id of p.txGen?.n1 ?? []) need(boards, id, 'Transformer plan (two transformers)', 'Panel');
  for (const id of p.vdSelection ?? []) need(feeders, id, 'Voltage drop selection', 'Circuit');

  const buildingIds = new Set((p.building?.buildings ?? []).map((b) => b.id));
  for (const s of p.drawingSet?.sheets ?? []) {
    const where = `Sheet ${s.number || s.id}`;
    for (const id of s.boards) need(boards, id, where, 'Panel on the sheet');
    for (const c of s.clouds ?? []) for (const id of c.boards) need(boards, id, `${where} revision cloud`, 'Panel');
    for (const a of s.arrows ?? []) { if (a.target.startsWith('f:')) need(feeders, a.target.slice(2), `${where} callout`, 'Circuit'); else need(boards, a.target, `${where} callout`, 'Panel'); }
    if (s.kind === 'riser') need(buildingIds, s.buildingId, where, 'Building');
  }
  return out;
}

/** The project with references to panels and circuits that no longer exist taken out: sheets lose the panel,
 * clouds and callouts that pointed only at it are removed, a UPS is unlinked from its board, couplers to it are removed,
 * and report scopes, plans and selections drop it. Run after deleting panels. */
export function removeDanglingReferences(p: Project): Project {
  const boards = new Set(p.boards.map((b) => b.id)), feeders = new Set(p.feeders.map((f) => f.id));
  const keep = (ids: string[]) => ids.filter((id) => boards.has(id));
  const next: Project = { ...p };
  if (p.drawingSet) {
    next.drawingSet = {
      ...p.drawingSet,
      sheets: p.drawingSet.sheets.map((s) => {
        const clouds = (s.clouds ?? []).map((c) => ({ ...c, boards: keep(c.boards) })).filter((c) => c.boards.length);
        const arrows = (s.arrows ?? []).filter((a) => (a.target.startsWith('f:') ? feeders.has(a.target.slice(2)) : boards.has(a.target)));
        return { ...s, boards: keep(s.boards), clouds: clouds.length ? clouds : undefined, arrows: arrows.length ? arrows : undefined };
      })
    };
  }
  if (p.ties) next.ties = p.ties.filter((t) => boards.has(t.a) && boards.has(t.b));
  if (p.upsSystems) next.upsSystems = p.upsSystems.map((u) => (u.boardId && !boards.has(u.boardId) ? { ...u, boardId: undefined } : u));
  if (p.busRisers) next.busRisers = p.busRisers.map((r) => (r.sourceBoardId && !boards.has(r.sourceBoardId) ? { ...r, sourceBoardId: undefined } : r));
  if (p.studyReport) next.studyReport = { ...p.studyReport, boards: keep(p.studyReport.boards) };
  if (p.pfc?.boards) next.pfc = { ...p.pfc, boards: keep(p.pfc.boards) };
  if (p.txGen) next.txGen = { ...p.txGen, ...(p.txGen.txBoards ? { txBoards: keep(p.txGen.txBoards) } : {}), ...(p.txGen.n1 ? { n1: keep(p.txGen.n1) } : {}) };
  if (p.vdSelection) next.vdSelection = p.vdSelection.filter((id) => feeders.has(id));
  // Earthing settings kept for equipment of a panel that is gone (the retired pit IDs stay reserved on purpose).
  if (p.earthingPlan) {
    const live = (k: string) => { const m = k.match(/^(?:txn|txb|lv|sub):(.+)$/) ?? k.match(/^rmu:.*:@(.+)$/); return !m || boards.has(m[1]); };
    next.earthingPlan = {
      ...p.earthingPlan,
      ...(p.earthingPlan.pits ? { pits: Object.fromEntries(Object.entries(p.earthingPlan.pits).filter(([k]) => live(k))) } : {}),
      ...(p.earthingPlan.unlinked ? { unlinked: p.earthingPlan.unlinked.filter(live) } : {})
    };
  }
  return next;
}
