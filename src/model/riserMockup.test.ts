import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { sizeRiser } from '../calc/busbar';
import { summarizeBuilding } from '../calc/building';
import { riserLayout } from '../diagram/riserLayout';
import { addG10RiserMockup } from './riserMockup';

describe('G+10 riser mock-up', () => {
  it('creates a connected eleven-floor riser and a drawable riser sheet', () => {
    const r = addG10RiserMockup(sampleProject, 'MDB-1');
    const b = r.project.building!.buildings.find((x) => x.id === r.buildingId)!;
    expect(summarizeBuilding(r.project.building!, b).description).toBe('G + 10');
    expect(r.panelIds).toHaveLength(11);
    expect(r.project.busRisers!.find((x) => x.id === r.riserId)!.floors).toHaveLength(11);
    expect(sizeRiser(r.project, r.project.busRisers!.find((x) => x.id === r.riserId)!).tapOffs).toBe(11);
    const layout = riserLayout(r.project, r.buildingId);
    expect(layout.empty).toBe(false);
    expect(layout.nodes.filter((n) => r.panelIds.includes(n.board.id))).toHaveLength(11);
    expect(layout.buses).toHaveLength(1);
    expect(r.project.drawingSet!.sheets.find((s) => s.id === r.sheetId)).toMatchObject({ kind: 'riser', buildingId: r.buildingId });
  });

  it('adds an LV-MDB source when the project has no main board', () => {
    const r = addG10RiserMockup({ ...sampleProject, boards: [], feeders: [] });
    expect(r.project.boards.find((b) => b.id === r.sourceBoardId)).toMatchObject({ kind: 'LV-MDB', sourceKva: 1500 });
  });
});
