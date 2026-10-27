import { EXCHANGE_SCHEMA, EXCHANGE_VERSION, hashedText, type LoadItem } from '../exchange/contracts';
import type { Project } from '../types';
import type { ElvEstimate } from './estimate';

export const ELV_CATALOGUE_REVISION = 'ELV defaults 1 (typical, verify)';

/** An estimate's supplies as an ELV loads package (exchange contract version 1), for LV to review and accept. Each
 * supply is one load: its upstream kW, the rooms it serves, and how the kW was worked out. */
export function elvLoadsPackage(project: Project, estimate: ElvEstimate, exportedAt: string, sha256: (text: string) => string) {
  if (!estimate.supplies.length) throw new Error('The ELV estimate has no supplies: the project has no rooms with ELV devices.');
  const items: LoadItem[] = estimate.supplies.map((s) => ({
    id: s.id, system: s.system, equipment: s.equipment.slice(0, 200), equipmentType: s.equipmentType,
    ...(s.rooms.length ? { rooms: s.rooms } : {}), serves: s.levelId ? 'floor' : 'building',
    kW: Math.max(s.kW, 0.001), pf: s.pf, demandBasis: s.demandBasis.slice(0, 200), supply: s.supply,
    ...(s.backup ? { backup: s.backup.slice(0, 200) } : {}), catalogueRevision: ELV_CATALOGUE_REVISION
  }));
  const pkg = {
    schema: EXCHANGE_SCHEMA, version: EXCHANGE_VERSION, kind: 'loads' as const,
    project: { ...(project.id ? { id: project.id } : {}), name: project.name },
    source: { app: 'elv' as const, file: `${project.name} — ELV estimate`, tool: 'LV Design Studio ELV estimate' }, exportedAt, items
  };
  return { ...pkg, sha256: sha256(hashedText(pkg)) };
}
