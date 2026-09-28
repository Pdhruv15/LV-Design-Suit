import { applyAllRecommendations } from '../calc/sizing';
import { areaLoad } from '../calc/spacePlan';
import { STANDARD_BREAKER_A } from '../calc/sizing';
import type { Board, Feeder, LoadType, Project, SpacePlan } from '../types';

/** The SLD from a space plan: per transformer a main LV switchboard (with
 * its transformer and RMU), the planned MDBs and SMDBs below it, and each
 * planned area as a load on its panel. Every breaker and cable is then
 * sized by the app, top-down. Replaces the project's boards and feeders. */

const USE_LOAD_TYPE: Record<string, LoadType> = {
  residential: 'general', villa: 'general', office: 'sockets', retail: 'general', fnb: 'general',
  hotel: 'general', common: 'lighting', parking: 'lighting', services: 'hvac'
};

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toUpperCase().slice(0, 16) || 'LOAD';

/** Rated current of a transformer's LV switchboard: its full-load current,
 * up to the next standard rating. */
const lvRating = (kva: number, voltageV: number) => {
  const i = (kva * 1000) / (Math.sqrt(3) * voltageV);
  return STANDARD_BREAKER_A.find((a) => a >= i) ?? STANDARD_BREAKER_A[STANDARD_BREAKER_A.length - 1];
};

export interface PlanToSld {
  project: Project;
  counts: { rmus: number; transformers: number; panels: number; loads: number };
}

export function planToSld(project: Project, plan: SpacePlan): PlanToSld {
  const boards: Board[] = [];
  const feeders: Feeder[] = [];
  const ids = new Set<string>();
  const unique = (base: string) => {
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    return id;
  };

  // Transformers → main LV switchboards (roots), grouped by RMU.
  const txBoard = new Map<string, string>();
  const byRmu = [...plan.transformers].sort((a, b) => (a.rmu ?? '').localeCompare(b.rmu ?? '') || a.id.localeCompare(b.id));
  for (const t of byRmu) {
    const id = unique(t.id);
    txBoard.set(t.id, id);
    boards.push({
      id, name: `${t.id} LV switchboard`, kind: 'MDB', rmu: t.rmu,
      sourceKva: t.kva, sourceImpedancePct: t.kva >= 1500 ? 6 : 5, ratedCurrentA: lvRating(t.kva, project.voltageV)
    });
  }

  // Panels: MDBs under their transformer, SMDBs under their parent (parents first).
  const panelBoard = new Map<string, string>();
  const pending = [...plan.panels];
  for (let guard = 0; pending.length && guard < 50; guard++) {
    for (const p of [...pending]) {
      const up = p.kind === 'MDB' ? (p.transformer ? txBoard.get(p.transformer) : undefined) : p.parent ? panelBoard.get(p.parent) : undefined;
      if (!up && (p.kind === 'MDB' ? p.transformer : p.parent) && pending.some((x) => x.id === p.parent)) continue; // parent not placed yet
      pending.splice(pending.indexOf(p), 1);
      if (!up) continue; // not fed: left out
      const id = unique(p.id);
      panelBoard.set(p.id, id);
      boards.push({ id, name: `${p.building}${p.location ? ` – ${p.location}` : ''} ${p.kind}`, kind: p.kind, upstreamId: up, location: p.location });
      feeders.push({
        id: unique(`INC-${id}`), boardId: up, name: `Incomer to ${id}`, feedsBoardId: id,
        loadKw: 0, demandFactor: 1, powerFactor: plan.settings.powerFactor, lengthM: 50, cableCsaMm2: 16, cores: 4,
        breakerRatingA: 100, breakerIcuKa: 36, device: p.kind === 'MDB' ? 'MCCB' : undefined
      });
    }
  }

  // Areas → loads on their panel.
  let loads = 0;
  for (const a of plan.areas) {
    const board = a.panel ? panelBoard.get(a.panel) : undefined;
    if (!board) continue;
    const l = areaLoad(plan, a);
    feeders.push({
      id: unique(`${board}-${slug(`${a.floor ?? ''} ${a.name}`)}`), boardId: board,
      name: [a.floor, a.name].filter(Boolean).join(' '),
      loadKw: +l.connectedKw.toFixed(2), demandFactor: l.demandFactor, powerFactor: plan.settings.powerFactor,
      lengthM: 30, cableCsaMm2: 16, cores: 4, breakerRatingA: 63, breakerIcuKa: 25,
      loadType: USE_LOAD_TYPE[a.use] ?? 'general',
      remarks: a.areaM2 ? `${a.areaM2} m² × ${l.wPerM2} W/m² (planned)` : 'Specific load (planned)'
    });
    loads++;
  }

  // Keep only the boards that ended up fed; drop the incomer of any board
  // that didn't make it.
  const next: Project = { ...project, boards, feeders, ties: [], vdSelection: undefined };
  const sized = applyAllRecommendations(next, 'optimise');
  return {
    project: sized,
    counts: {
      rmus: new Set(plan.transformers.map((t) => t.rmu).filter(Boolean)).size,
      transformers: plan.transformers.length,
      panels: panelBoard.size,
      loads
    }
  };
}
