import type { Board, Feeder, Project, ProjectBuilding } from '../types';
import type { BusRiser } from '../calc/busbar';
import { addRiserSheet, setOf } from './drawingSet';

export interface G10RiserMockupResult {
  project: Project;
  buildingId: string;
  riserId: string;
  sourceBoardId: string;
  panelIds: string[];
  sheetId: string;
}

const unique = (taken: Set<string>, base: string) => {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
};

/** Ready-to-edit G+10 tower mock-up for the graphical riser drawing and the
 * busbar-riser calculation. Values are illustrative design inputs, not an
 * authority or manufacturer template. */
export function addG10RiserMockup(project: Project, preferredSourceId?: string): G10RiserMockupResult {
  const taken = new Set([...project.boards.map((b) => b.id), ...project.feeders.map((f) => f.id)]);
  const buildingIds = new Set((project.building?.buildings ?? []).map((b) => b.id));
  const riserIds = new Set((project.busRisers ?? []).map((r) => r.id));
  const buildingId = unique(buildingIds, 'BLD-G10');
  const riserId = unique(riserIds, 'BR-G10');
  const source = project.boards.find((b) => b.id === preferredSourceId)
    ?? project.boards.find((b) => !b.upstreamId);
  const sourceBoardId = source?.id ?? unique(taken, 'LV-MDB-G10');
  const sourceBoard: Board | undefined = source ? undefined : {
    id: sourceBoardId, name: 'G+10 LV main distribution board', kind: 'LV-MDB', sourceKva: 1500,
    sourceImpedancePct: 6, ratedCurrentA: 2500, busbarMaterial: 'copper', ipRating: 'IP42', location: 'Ground-floor LV room'
  };
  if (sourceBoard) taken.add(sourceBoard.id);

  const groundLevel = `${buildingId}-G`;
  const typicalLevel = `${buildingId}-T`;
  const building: ProjectBuilding = {
    id: buildingId,
    name: 'G+10 Riser Mock-up',
    use: 'Illustrative residential tower',
    levels: [
      { id: groundLevel, name: 'Ground floor', kind: 'ground', heightM: 4.5, grossM2: 900 },
      { id: typicalLevel, name: 'Typical floors', kind: 'typical', heightM: 3.6, count: 10, grossM2: 900 }
    ],
    riser: { fromBoardId: sourceBoardId, horizontalM: 15, perDbM: 8 }
  };

  const panelIds: string[] = [];
  const boards: Board[] = [];
  const feeders: Feeder[] = [];
  const floors: BusRiser['floors'] = [];
  for (let floor = 0; floor <= 10; floor++) {
    const tag = floor === 0 ? 'G' : `L${String(floor).padStart(2, '0')}`;
    const panelId = unique(taken, `${buildingId}-SMDB-${tag}`);
    taken.add(panelId);
    panelIds.push(panelId);
    boards.push({
      id: panelId, name: `${tag} floor SMDB`, kind: 'SMDB', upstreamId: sourceBoardId, ratedCurrentA: floor === 0 ? 400 : 250,
      busbarMaterial: 'copper', ipRating: 'IP42', location: `${tag} electrical room`, mdDemandFactor: 0.8,
      level: { building: buildingId, level: floor === 0 ? groundLevel : typicalLevel, ...(floor > 1 ? { index: floor - 1 } : {}) }
    });
    const incomingId = unique(taken, `${buildingId}-TO-${tag}`);
    taken.add(incomingId);
    feeders.push({
      id: incomingId, boardId: sourceBoardId, feedsBoardId: panelId, name: `Busbar tap-off to ${panelId}`,
      loadKw: 0, demandFactor: 1, powerFactor: 0.9, lengthM: 8, cableCsaMm2: floor === 0 ? 120 : 70, cores: 4,
      breakerRatingA: floor === 0 ? 250 : 160, breakerIcuKa: 36, breakerType: 'MCCB'
    });
    const loadId = unique(taken, `${panelId}-LOAD`);
    taken.add(loadId);
    feeders.push({
      id: loadId, boardId: panelId, name: floor === 0 ? 'Ground-floor common services' : `Typical residential load — ${tag}`,
      loadKw: floor === 0 ? 75 : 55, demandFactor: 0.8, powerFactor: 0.9, lengthM: 25, cableCsaMm2: floor === 0 ? 70 : 50,
      cores: 4, breakerRatingA: floor === 0 ? 160 : 125, breakerIcuKa: 25, breakerType: 'MCCB', loadType: 'general'
    });
    floors.push({ id: `F${floor + 1}`, name: floor === 0 ? 'Ground floor' : `Level ${floor}`, boardId: panelId });
  }

  const riser: BusRiser = {
    id: riserId, name: 'G+10 Main Busbar Riser', sourceBoardId, material: 'cu', feedM: 15,
    floorHeightM: 3.6, offsetFloors: 0, elementM: 3, elbows: 2, floors
  };
  const info = project.building ?? { buildings: [], rooms: [] };
  const withData: Project = {
    ...project,
    building: { ...info, buildings: [...info.buildings, building] },
    boards: [...project.boards, ...(sourceBoard ? [sourceBoard] : []), ...boards],
    feeders: [...project.feeders, ...feeders],
    busRisers: [...(project.busRisers ?? []), riser]
  };
  const drawing = addRiserSheet(setOf(withData), buildingId, building.name);
  return { project: { ...withData, drawingSet: drawing.set }, buildingId, riserId, sourceBoardId, panelIds, sheetId: drawing.id };
}
