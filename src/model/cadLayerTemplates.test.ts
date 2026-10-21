import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTemplate, bestTemplate, CAD_LAYER_TEMPLATES_KEY, loadLayerTemplates, saveLayerTemplates, withTemplate, type CadLayerTemplate } from './cadLayerTemplates';
import type { CadLayerMap } from '../types';

const abc: CadLayerTemplate = {
  id: 't1', name: 'ABC Architects', savedAt: '2026-10-21T00:00:00.000Z',
  layers: [{ layer: 'A-AREA', role: 'room' }, { layer: 'A-AREA-IDEN', role: 'room-name' }, { layer: 'E-TRAY', role: 'tray' }, { layer: 'XREF-GRID', role: 'ignore' }]
};
const xyz: CadLayerTemplate = { id: 't2', name: 'XYZ Consultants', savedAt: '2026-10-21T00:00:00.000Z', layers: [{ layer: 'ROOMS', role: 'room' }] };

describe('layer templates per architect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('applies a template to the layers it knows, in any case, and leaves the others', () => {
    const roles: CadLayerMap[] = [{ layer: 'a-area', role: 'ignore' }, { layer: 'E-TRAY', role: 'route' }, { layer: 'NEW-LAYER', role: 'wall' }];
    expect(applyTemplate(roles, abc)).toEqual([{ layer: 'a-area', role: 'room' }, { layer: 'E-TRAY', role: 'tray' }, { layer: 'NEW-LAYER', role: 'wall' }]);
  });

  it('offers the template that knows most of the plan’s layers, when it knows at least two and half', () => {
    expect(bestTemplate(['A-AREA', 'a-area-iden', 'E-TRAY', 'OTHER'], [xyz, abc])).toMatchObject({ template: { name: 'ABC Architects' }, matched: 3, of: 4 });
    expect(bestTemplate(['A-AREA', 'P1', 'P2', 'P3', 'P4'], [abc])).toBeUndefined(); // one of five
    expect(bestTemplate(['ROOMS', 'X'], [xyz])).toBeUndefined(); // only one layer known
  });

  it('saves a mapping under a name, replacing the same name in any case', () => {
    const now = new Date('2026-10-21T10:00:00Z');
    const list = withTemplate([abc, xyz], ' abc architects ', [{ layer: 'R', role: 'room' }], now);
    expect(list.map((t) => [t.id, t.name, t.layers])).toEqual([['t1', 'abc architects', [{ layer: 'R', role: 'room' }]], ['t2', 'XYZ Consultants', [{ layer: 'ROOMS', role: 'room' }]]]);
    expect(withTemplate([], 'New', [], now)[0]).toMatchObject({ name: 'New', savedAt: now.toISOString() });
  });

  it('stores templates for the LV Database, dropping damaged entries and unknown roles', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
    expect(saveLayerTemplates([xyz, abc])).toBe(true);
    expect(loadLayerTemplates().map((t) => t.name)).toEqual(['ABC Architects', 'XYZ Consultants']);
    store[CAD_LAYER_TEMPLATES_KEY] = JSON.stringify([{ ...abc, layers: [...abc.layers, { layer: 'Q', role: 'hatchery' }, { layer: '', role: 'room' }] }, { name: 'no id' }, 7]);
    expect(loadLayerTemplates()).toEqual([abc]);
    store[CAD_LAYER_TEMPLATES_KEY] = 'not json';
    expect(loadLayerTemplates()).toEqual([]);
  });
});
