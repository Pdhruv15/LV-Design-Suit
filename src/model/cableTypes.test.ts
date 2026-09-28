import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { cableTypeDef, cableTypeOf, fireRatingIssues, labelCode, needsFireRated } from './cableTypes';
import { applyDrop } from './sldEdit';
import { cableSchedule } from '../docs/schedules';
import { emptyTrayPlan, sizeRoute } from '../calc/cableTray';
import { legendEntries } from '../diagram/IecSymbols';
import { applyPreset, presetParts } from './presets';
import type { Project } from '../types';

const fp = sampleProject.feeders.find((f) => f.loadType === 'fire-pump')!;
const normal = sampleProject.feeders.find((f) => !f.phase && !f.feedsBoardId && f.loadType !== 'fire-pump' && !f.essential)!;

describe('cable types', () => {
  it('life safety circuits are fire-rated by default; others the default armoured cable', () => {
    expect(needsFireRated(sampleProject, fp)).toBe(true);
    expect(cableTypeOf(sampleProject, fp).fireRated).toBe(true);
    expect(cableTypeOf(sampleProject, normal).code).toBe('XLPE/SWA');
    expect(labelCode(sampleProject, normal)).toBe(''); // the default isn't repeated on every label
    expect(labelCode(sampleProject, fp)).toBe('FR');
    // Feeders from an EMDB, and loads marked essential, too.
    const emdb: Project = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === normal.boardId ? { ...b, kind: 'EMDB' as const } : b)) };
    expect(needsFireRated(emdb, normal)).toBe(true);
    expect(needsFireRated(sampleProject, { ...normal, essential: true })).toBe(true);
  });

  it('a life safety circuit set to a non-fire-rated cable is flagged', () => {
    expect(fireRatingIssues(sampleProject)).toEqual([]);
    const p: Project = { ...sampleProject, feeders: sampleProject.feeders.map((f) => (f.id === fp.id ? { ...f, cableType: 'XLPE/PVC/SWA' } : f)) };
    expect(fireRatingIssues(p).map((f) => f.id)).toEqual([fp.id]);
  });

  it('palette drops set fire-rated or LSZH cable; older stored values still read', () => {
    const r = applyDrop(sampleProject, { kind: 'accessory', accessory: 'cable-fr' }, { type: 'feeder', feederId: normal.id });
    expect(cableTypeOf(r.project, r.project.feeders.find((f) => f.id === normal.id)!).fireRated).toBe(true);
    const l = applyDrop(sampleProject, { kind: 'accessory', accessory: 'cable-lszh' }, { type: 'feeder', feederId: normal.id });
    expect(labelCode(l.project, l.project.feeders.find((f) => f.id === normal.id)!)).toBe('LSZH');
    expect(cableTypeDef('XLPE/LSF/SWA').lszh).toBe(true);
    expect(cableTypeDef('Something custom').code).toBe('Something custom');
  });

  it('the cable schedule states each cable\'s real type', () => {
    const s = cableSchedule(sampleProject);
    const typeCol = s.headers.indexOf('Type');
    expect(s.rows.find((r) => r[0] === `C-${fp.id}`)![typeCol]).toMatch(/Fire-rated/);
    expect(s.rows.find((r) => r[0] === `C-${normal.id}`)![typeCol]).toMatch(/XLPE\/SWA\/PVC/);
  });

  it('the tray schedule warns when fire-rated and other cables share a route', () => {
    const p: Project = { ...sampleProject, feeders: sampleProject.feeders.map((f) => (f.id === fp.id || f.id === normal.id ? { ...f, trayRoute: 'A' } : f)) };
    const plan = { ...emptyTrayPlan(), routes: [{ id: 'r', name: 'A', cables: [] }] };
    const r = sizeRoute(p, plan, plan.routes[0]);
    expect(r.lines.find((l) => l.feederId === fp.id)!.description).toMatch(/FR$/);
    expect(r.notes.join(' ')).toMatch(/segregate/);
    expect(r.status).toBe('warn');
  });

  it('legend and presets know the cable types', () => {
    expect(legendEntries(sampleProject).map((e) => e.key)).toEqual(expect.arrayContaining(['cable', 'fr']));
    const preset = { id: 'x', name: 'x', kind: 'load' as const, loadName: 'Smoke fan', loadKw: 7.5, cableType: 'FR BS 8491', breaker: 'MCCB' as const };
    expect(presetParts(preset)).toContain('FR cable');
    const r = applyPreset(sampleProject, preset, 'SMDB-GF');
    expect(r.project.feeders.find((f) => !sampleProject.feeders.some((x) => x.id === f.id))!.cableType).toBe('FR BS 8491');
  });
});
