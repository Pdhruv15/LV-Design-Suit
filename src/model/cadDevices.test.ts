import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { circuitLabel, finalCircuits, LV_PALETTE, placedOn, placeItem, moveItem, removeItem } from './cadDevices';
import { ELV_PALETTE, elvPlacedOn, placeElv } from '../components/elv/elvCadDevices';
import type { Project } from '../types';

const villa: Project = {
  ...sampleProject, lvPoints: undefined, elvDevices: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }], rooms: [{ id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Majlis', type: 'living', areaM2: 36, outline: [[0, 6], [6, 6], [6, 12], [0, 12]] }] }
};
const level = { building: 'V', level: 'GF' };
const light = LV_PALETTE.find((x) => x.id === 'ltg')!;
const db = LV_PALETTE.find((x) => x.id === 'db')!;
const circuit = villa.feeders.find((f) => f.id === 'DB-GF1-Y1')!; // Majlis lighting

describe('devices placed in the CAD view', () => {
  it('names circuits as plans write them', () => {
    expect(circuitLabel(villa, circuit)).toBe('DB-GF1/Y1 · Majlis lighting');
    expect(finalCircuits(villa).some((f) => f.feedsBoardId)).toBe(false);
  });

  it('places a light on a circuit and counts it there; deleting takes it off again', () => {
    const before = circuit.points?.ltg ?? 0;
    const { project, message } = placeItem(villa, light, level, 3, 9, { feederId: circuit.id });
    expect(project.feeders.find((f) => f.id === circuit.id)!.points?.ltg).toBe(before + 1);
    expect(message).toBe(`Light placed on DB-GF1/Y1 · Majlis lighting — ${before + 1} on the circuit`);
    const placed = placedOn(project, level);
    expect(placed).toEqual([expect.objectContaining({ key: 'lv:P1', label: 'Light', detail: 'DB-GF1/Y1 · Majlis lighting', room: 'Majlis' })]);
    const moved = moveItem(project, placed[0], 4, 10, level);
    expect(moved.lvPoints![0]).toMatchObject({ x: 4, y: 10 });
    const gone = removeItem(moved, placed[0]);
    expect(gone.lvPoints).toBeUndefined();
    expect(gone.feeders.find((f) => f.id === circuit.id)!.points?.ltg).toBe(before);
    expect(placeItem(gone, light, level, 1, 1, { feederId: circuit.id }).project.lvPoints![0].id).toBe('P2'); // IDs not reused
  });

  it('places ELV devices through the ELV placement, in their room', () => {
    expect(ELV_PALETTE.map((x) => x.id)).toContain('smoke-detector');
    const { project } = placeElv(villa, 'smoke-detector', level, 3, 9);
    expect(project.elvDevices).toEqual([expect.objectContaining({ type: 'smoke-detector', roomId: 'R1' })]);
    expect(elvPlacedOn(project, level)[0]).toMatchObject({ what: 'elv', label: 'Smoke detector', room: 'Majlis' });
    expect(placedOn(project, level)).toEqual([]); // the LV side lists LV points and boards only
  });

  it('places a board: its position, level and room', () => {
    const { project } = placeItem(villa, db, level, 2, 7, { boardId: 'DB-GF1' });
    expect(project.boards.find((b) => b.id === 'DB-GF1')).toMatchObject({ planPoint: { x: 2, y: 7 }, level, location: 'Majlis' });
    expect(() => placeItem(villa, light, level, 1, 1, {})).toThrow(/Choose the circuit/);
  });
});
