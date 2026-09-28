import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { dmSubstationAreas, DM_NOTES, substationsFromProject } from './dmSubstation';
import { buildDmFormHtml } from '../docs/dmForm';

const sizes = (t: Parameters<typeof dmSubstationAreas>[0], n: number) => dmSubstationAreas(t, n).rooms.map((r) => [r.key, r.lengthM, r.widthM, r.heightM, r.areaM2]);

describe('DM-D-013 minimum substation and LV room areas', () => {
  it('conventional substation — as the DM workbook (8 transformers: 212.89 m² and 160.54 m²)', () => {
    expect(sizes('conventional', 8)).toEqual([['substation', 34.9, 6.1, 3.7, 212.89], ['lv', 34.9, 4.6, undefined, 160.54]]);
    expect(sizes('conventional', 1)).toEqual([['substation', 7, 4.57, 3.7, 31.99], ['lv', 7, 3.25, undefined, 22.75]]);
    expect(sizes('conventional', 15)[0].slice(1, 3)).toEqual([63.6, 6.1]);
    expect(dmSubstationAreas('conventional', 8).notes).toEqual([DM_NOTES.checkedSubLv, DM_NOTES.sikka, DM_NOTES.columns, DM_NOTES.drainageBelow]);
  });

  it('detached substation: transformer, RMU and LV rooms (ground floor and basement use the same table)', () => {
    expect(sizes('detached-ground', 8)).toEqual([['transformer', 27.55, 6.1, 3.7, 168.06], ['rmu', 13.3, 3.05, 3.05, 40.57], ['lv', 27.55, 4.6, undefined, 126.73]]);
    expect(sizes('detached-basement', 1)).toEqual([['transformer', 4.57, 4.6, 3.7, 21.02], ['rmu', 3.05, 3.05, 3.05, 9.3], ['lv', 5.1, 4.6, undefined, 23.46]]);
    expect(dmSubstationAreas('detached-ground', 3).rooms[0].widthNote).toBe('minimum width');
    expect(dmSubstationAreas('detached-basement', 3).rooms[0].widthNote).toContain('street');
    expect(dmSubstationAreas('detached-basement', 3).notes).toEqual([DM_NOTES.basement, DM_NOTES.drainage]);
    expect(dmSubstationAreas('detached-ground', 3).notes[0]).toBe(DM_NOTES.checkedSubLvRmu);
  });

  it('POCKET up to 2 transformers, open roof 1 — more is not allowed', () => {
    expect(sizes('pocket', 1)).toEqual([['transformer', 3.7, 4.57, undefined, 16.91]]);
    expect(sizes('pocket', 2)).toEqual([['transformer', 6.1, 6.1, undefined, 37.21]]);
    expect(dmSubstationAreas('pocket', 3).error).toContain('more than two');
    expect(sizes('conventional-open', 1)).toEqual([['substation', 6.1, 6.1, undefined, 37.21]]);
    expect(dmSubstationAreas('conventional-open', 2).error).toContain('more than one');
    expect(dmSubstationAreas('pocket', 1).notes).toEqual([DM_NOTES.openToSky]);
    expect(dmSubstationAreas('conventional-open', 1).notes).toEqual([DM_NOTES.lvAdjacent]);
    expect(dmSubstationAreas('conventional', 16).error).toBeTruthy();
    expect(dmSubstationAreas('conventional', 0).error).toBeTruthy();
  });

  it('one substation per RMU from the space plan, else from the SLD transformers', () => {
    const plan = {
      areas: [], uses: undefined,
      panels: [{ id: 'MDB-1', building: 'A', kind: 'MDB' as const, transformer: 'TX-1' }, { id: 'MDB-2', building: 'B', kind: 'MDB' as const, transformer: 'TX-2' }, { id: 'MDB-3', building: 'C', kind: 'MDB' as const, transformer: 'TX-3' }],
      transformers: [{ id: 'TX-1', kva: 1500, rmu: 'RMU-1' }, { id: 'TX-2', kva: 1500, rmu: 'RMU-1' }, { id: 'TX-3', kva: 1000, rmu: 'RMU-2' }],
      settings: { transformerKva: 0, maxLoadingPct: 80, maxTransformersPerRmu: 2, powerFactor: 0.9, growthPct: 0 }
    };
    const r = substationsFromProject({ ...sampleProject, spacePlan: plan });
    expect(r.source).toBe('space plan');
    expect(r.rooms.map((x) => [x.name, x.transformers, x.kva, x.building])).toEqual([['RMU-1', 2, 1500, 'A, B'], ['RMU-2', 1, 1000, 'C']]);
    const sld = substationsFromProject(sampleProject);
    expect(sld.source).toBe('SLD');
    expect(sld.rooms).toHaveLength(sampleProject.boards.filter((b) => !b.upstreamId && b.sourceKva).length);
  });

  it('the form: one page per substation, in English, with the notes and the undertaking', () => {
    const html = buildDmFormHtml(sampleProject, [
      { id: 'a', name: 'SS-1', type: 'conventional', transformers: 8, remarks: 'Room at ground floor' },
      { id: 'b', name: 'SS-2', type: 'pocket', transformers: 3 }
    ]);
    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html).toContain('212.89');
    expect(html).toContain(DM_NOTES.sikka);
    expect(html).toContain('Room at ground floor');
    expect(html).toContain('more than two');
    expect(html).toContain('I, the consultant / contractor');
    expect(html).not.toMatch(/[؀-ۿ]/); // no Arabic
  });
});
