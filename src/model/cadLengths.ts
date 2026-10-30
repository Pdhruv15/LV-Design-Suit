import type { CadLengthSettings, Feeder, Project } from '../types';

/** A cable route measured on the CAD floor plan, in drawing units. */
export interface CadRoute { feederId: string; length: number; pieces: number }

export const CAD_LENGTH_DEFAULTS: Required<CadLengthSettings> = { units: 'mm', verticalM: 6, terminationM: 3, wastePct: 5, dropM: 1.5, allowancePct: 10 };

const UNIT_M: Record<NonNullable<CadLengthSettings['units']>, number> = { mm: 0.001, cm: 0.01, m: 1 };
/** Metres per drawing unit from the drawing's INSUNITS code (1 in, 2 ft, 4 mm, 5 cm, 6 m); unitless or unknown
 * drawings use the project's setting. */
export function metresPerUnit(insunits: number | undefined, settings: CadLengthSettings | undefined): { factor: number; source: string } {
  const byCode: Record<number, [number, string]> = { 1: [0.0254, 'inches'], 2: [0.3048, 'feet'], 4: [0.001, 'mm'], 5: [0.01, 'cm'], 6: [1, 'm'] };
  const known = insunits !== undefined ? byCode[insunits] : undefined;
  if (known) return { factor: known[0], source: `drawing in ${known[1]}` };
  const units = settings?.units ?? CAD_LENGTH_DEFAULTS.units;
  return { factor: UNIT_M[units], source: `drawing units not set; taken as ${units}` };
}

export interface CadLengthProposal {
  feederId: string;
  label: string; // "MDB-1 → SMDB-GF" or "DB-GF1 R3"
  routeM: number;
  verticalM: number;
  terminationM: number;
  wastePct: number;
  proposedM: number;
  currentM: number;
  pieces: number;
}

export interface CadLengthPull {
  proposals: CadLengthProposal[]; // feeders whose length differs from CAD
  matching: number;
  unknownFeeders: string[]; // routes linked to a feeder that is no longer in the design
  units: string;
}

const label = (p: Project, f: Feeder) => {
  const ref = f.phase && f.way ? `${f.phase}${f.way}` : '';
  if (f.feedsBoardId) return `${f.boardId} → ${f.feedsBoardId}`;
  return `${f.boardId} ${ref || f.name || f.id}`.trim();
};

/** Proposed lengths: (route + vertical + terminations) × (1 + waste), rounded up to a whole metre. */
export function pullCadLengths(project: Project, routes: CadRoute[], insunits: number | undefined): CadLengthPull {
  const s = { ...CAD_LENGTH_DEFAULTS, ...project.cadLength };
  const unit = metresPerUnit(insunits, project.cadLength);
  const proposals: CadLengthProposal[] = [];
  const unknownFeeders: string[] = [];
  let matching = 0;
  for (const r of routes) {
    const f = project.feeders.find((x) => x.id === r.feederId);
    if (!f) { unknownFeeders.push(r.feederId); continue; }
    const routeM = Math.round(r.length * unit.factor * 10) / 10;
    const verticalM = f.cadVerticalM ?? s.verticalM;
    const proposedM = Math.ceil((routeM + verticalM + s.terminationM) * (1 + s.wastePct / 100) - 1e-9);
    if (proposedM === f.lengthM && !f.lengthToCheck) { matching += 1; continue; }
    proposals.push({ feederId: f.id, label: label(project, f), routeM, verticalM, terminationM: s.terminationM, wastePct: s.wastePct, proposedM, currentM: f.lengthM, pieces: r.pieces });
  }
  proposals.sort((a, b) => a.label.localeCompare(b.label));
  return { proposals, matching, unknownFeeders, units: unit.source };
}

/** Sets the accepted lengths (and clears "length to check"); the calculations re-run as for any length edit. */
export function applyCadLengths(project: Project, accepted: CadLengthProposal[]): Project {
  const byId = new Map(accepted.map((a) => [a.feederId, a.proposedM]));
  return {
    ...project,
    feeders: project.feeders.map((f) => (byId.has(f.id) ? { ...f, lengthM: byId.get(f.id)!, lengthToCheck: undefined } : f))
  };
}

/** "48.2 m route + 6 m vertical + 3 m terminations, +5 % = 61 m" */
export function lengthBreakdown(p: CadLengthProposal): string {
  return `${p.routeM} m route + ${p.verticalM} m vertical + ${p.terminationM} m terminations, +${p.wastePct} % = ${p.proposedM} m`;
}
