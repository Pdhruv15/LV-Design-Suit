import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { UPS_DEFAULTS } from '../calc/ups';
import { sheetsByCount } from './drawingSet';
import { BOARD_CLASS, FEEDER_CLASS, PROJECT_CLASS } from './changeClass';
import { withEarthPitIds } from './earthingPlan';
import { BOARD_FIELDS, changedSinceRevision, changeCountsSinceRevision, DATA_SETS, diffProjects, FEEDER_FIELDS, issueRevision, PROJECT_FIELDS, snapshotOf } from './revisions';
import type { Project } from '../types';

/** The design as issued (Rev A), then edited: what does the comparison say? */
const issued = (p: Project = sampleProject) => issueRevision(withEarthPitIds(p), { description: 'A', date: '2026-10-01' });
const edit = (p: Project, patch: Partial<Project>): Project => ({ ...p, ...patch });
const diff = (p: Project) => diffProjects(p.revisions![0].snapshot, p);
const upsA = { ...UPS_DEFAULTS, id: 'u1', name: 'UPS-1', boardId: 'MDB-1', chem: 'li-ion' as const, blockV: 51.2, autonomyMin: 30, loads: [] };
const withUps = (p: Project, u = upsA) => ({ ...p, upsSystems: [u] });

describe('every persisted field is accounted for', () => {
  it('has a comparison line for each circuit and board field that is not an identifier or bookkeeping', () => {
    const lines = (t: [string, string][]) => new Set(t.map(([k]) => k));
    const feederMissing = Object.entries(FEEDER_CLASS).filter(([k, c]) => c !== 'bookkeeping' && k !== 'id' && !lines(FEEDER_FIELDS).has(k)).map(([k]) => k);
    const boardMissing = Object.entries(BOARD_CLASS).filter(([k, c]) => c !== 'bookkeeping' && k !== 'id' && !lines(BOARD_FIELDS).has(k)).map(([k]) => k);
    expect(feederMissing).toEqual([]);
    expect(boardMissing).toEqual([]);
  });

  it('has a comparison for each project field that is not bookkeeping', () => {
    const handled = new Set([...PROJECT_FIELDS, ...DATA_SETS].map(([k]) => k as string));
    const special = ['info', 'boq', 'priceList', 'drawingSet', 'upsSystems', 'earthingPlan', 'boards', 'feeders'];
    const missing = Object.entries(PROJECT_CLASS).filter(([k, c]) => c !== 'bookkeeping' && !handled.has(k) && !special.includes(k)).map(([k]) => k);
    expect(missing).toEqual([]);
  });
});

describe('UPS and battery changes', () => {
  const base = issued(withUps(sampleProject));
  it('shows capacity, state of charge and BMS edits with before and after values', () => {
    const p = edit(base, { upsSystems: [{ ...upsA, autonomyMin: 45, startSocPct: 90, minSocPct: 10, bmsDischargeA: 120, chargerCurrentA: 40 }] });
    const c = diff(p).changes.find((x) => x.what === 'ups')!;
    expect(c).toMatchObject({ kind: 'changed', class: 'engineering', label: 'UPS UPS-1', boardId: 'MDB-1' });
    expect(c.fields).toEqual(expect.arrayContaining([
      { field: 'Backup time (min)', from: '30', to: '45' }, { field: 'Start SOC (%)', from: '—', to: '90' }, { field: 'Minimum SOC (%)', from: '—', to: '10' },
      { field: 'BMS discharge limit (A)', from: '—', to: '120' }, { field: 'Charger current (A)', from: '—', to: '40' }
    ]));
    expect(changedSinceRevision(p)).toBe(true);
  });
  it('shows manufacturer power table edits and a surge scenario', () => {
    const table = { model: 'X', source: 'datasheet', blockAh: 100, blockV: 12, endCellV: 1.75, temperatureC: 25, points: [{ minutes: 10, wattsPerBlock: 300 }, { minutes: 30, wattsPerBlock: 180 }] };
    const p = edit(base, { upsSystems: [{ ...upsA, powerTable: table, surge: { totalKw: 20, durationSeconds: 5, source: 'inverter datasheet' } }] });
    const f = diff(p).changes.find((x) => x.what === 'ups')!.fields.map((x) => x.field);
    expect(f).toEqual(expect.arrayContaining(['Manufacturer power table › Model', 'Manufacturer power table › Points [10]'].slice(0, 1)));
    expect(f.some((x) => x.startsWith('Starting surge'))).toBe(true);
  });
  it('shows a UPS added or removed', () => {
    expect(diff(edit(base, { upsSystems: [] })).changes.find((x) => x.what === 'ups')).toMatchObject({ kind: 'removed' });
    expect(diff(edit(base, { upsSystems: [upsA, { ...upsA, id: 'u2', name: 'UPS-2' }] })).changes.find((x) => x.what === 'ups' && x.id === 'u2')).toMatchObject({ kind: 'added' });
  });
  it('the same UPS data reads as unchanged', () => {
    expect(diff(base).changes).toEqual([]);
    expect(changedSinceRevision(base)).toBe(false);
  });
});

describe('earthing changes', () => {
  const base = issued(sampleProject);
  it('shows pits, links, measurements and electrode edits', () => {
    const p = edit(base, { earthingPlan: { ...base.earthingPlan, pits: { 'lv:MDB-1': 3 }, unlinked: ['lv:MDB-1'], measured: { E1: 0.8 }, electrodeM: 4, conductorMm2: 95 } });
    const c = diff(p).changes.find((x) => x.what === 'earthing')!;
    expect(c.class).toBe('engineering');
    expect(c.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['Pits › lv:MDB-1', 'Measured (Ω) › E1', 'Electrode length (m)', 'Earth conductor (mm²)']));
    expect(c.fields.find((f) => f.field === 'Measured (Ω) › E1')).toEqual({ field: 'Measured (Ω) › E1', from: '—', to: '0.8' });
    expect(changedSinceRevision(p)).toBe(true);
  });
  it('does not count the app assigning pit IDs, or an old file normalised on opening, as an edit', () => {
    const legacy = issueRevision(sampleProject, { description: 'A' }); // issued before pit IDs existed
    const opened = withEarthPitIds(legacy);
    expect(diffProjects(legacy.revisions![0].snapshot, opened).changes).toEqual([]);
    expect(changedSinceRevision(opened)).toBe(false);
    expect(diff(edit(base, { earthPitIds: { ...base.earthPitIds, extra: ['E99'] } })).changes).toEqual([]);
  });
});

describe('what kind of change it is', () => {
  const base = issued(sampleProject);
  it('pricing is commercial and never marks the electrical design changed', () => {
    const p = edit(base, { priceList: { id: 'pl', name: 'Rates', date: '2026-10-05', currency: 'AED', markupPct: 10, rates: { 'cable:x': { supply: 5, install: 2 } as never } }, boq: { discountPct: 3, overrides: { k: { qty: 5 } as never } } });
    const d = diff(p);
    expect(d.changes.map((c) => c.class)).toEqual(['commercial']);
    expect(d.changes[0].fields.map((f) => f.field)).toEqual(expect.arrayContaining(['BOQ › Discount (%)', 'Price list › Overheads and profit (%)']));
    expect(changedSinceRevision(p)).toBe(false);
    expect(changeCountsSinceRevision(p)).toMatchObject({ engineering: 0, drawing: 0, commercial: 1 });
  });
  it('project details are administration: owner, status, tags, notes, scope', () => {
    const p = edit(base, { status: 'review', tags: ['villa'], notes: 'call client', info: { ...base.info, owner: 'New owner', plotNo: '9' } });
    const d = diff(p);
    expect(new Set(d.changes.map((c) => c.class))).toEqual(new Set(['admin']));
    expect(changedSinceRevision(p)).toBe(false);
  });
  it('but the demand factor and built-up area in the form details are engineering inputs', () => {
    const p = edit(base, { info: { ...base.info, mdDemandFactor: 0.7 } });
    expect(diff(p).changes[0]).toMatchObject({ class: 'engineering', what: 'project' });
    expect(changedSinceRevision(p)).toBe(true);
  });
  it('who and when saved, ids and app-assigned numbers are not changes at all', () => {
    const p = edit(base, { updatedAt: '2031-01-01T00:00:00.000Z', updatedBy: 'Someone', id: 'other', createdAt: '2020-01-01', schemaVersion: 9, cableRefs: [{ ref: 99, key: 'k', text: 't' }], origin: { copiedAt: 'x', kind: 'save-as' } as never });
    expect(diff(p).changes).toEqual([]);
  });
  it('renaming a panel or editing remarks is a drawing change; a rating is engineering', () => {
    const b0 = base.boards[0];
    const renamed = edit(base, { boards: base.boards.map((b) => (b === b0 ? { ...b, name: 'Main DB (new name)' } : b)) });
    expect(diff(renamed).changes[0]).toMatchObject({ what: 'board', class: 'drawing' });
    expect(changedSinceRevision(renamed)).toBe(true);
    const rerated = edit(base, { boards: base.boards.map((b) => (b === b0 ? { ...b, ratedCurrentA: (b.ratedCurrentA ?? 1000) + 400 } : b)) });
    expect(diff(rerated).changes[0]).toMatchObject({ what: 'board', class: 'engineering' });
  });
  it('compares the circuit and board fields that were missed before', () => {
    const f0 = base.feeders[0], b0 = base.boards[0];
    const p = edit(base, {
      feeders: base.feeders.map((f) => (f === f0 ? { ...f, manualSize: true, localIsolator: true, capSteps: 4, detunedPct: 7 } : f)),
      boards: base.boards.map((b) => (b === b0 ? { ...b, manufacturer: 'ABB', model: 'MNS', ipRating: 'IP54', busbarMaterial: 'aluminium' as const, spd: 'T2' as never } : b))
    });
    const d = diff(p);
    expect(d.changes.find((c) => c.id === f0.id)!.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['Sizes set by hand', 'Local isolator', 'Capacitor steps', 'Detuning (%)']));
    expect(d.changes.find((c) => c.id === b0.id)!.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['Manufacturer', 'Model', 'IP rating', 'Busbar material', 'Surge protection']));
  });
});

describe('drawings and documents', () => {
  const withSheets = (): Project => ({ ...sampleProject, drawingSet: sheetsByCount(sampleProject, 10) });
  const base = issued(withSheets());
  it('shows a markup, a note or a paper change on a sheet as a drawing change', () => {
    const set = base.drawingSet!;
    const s0 = set.sheets[0];
    const p = edit(base, { drawingSet: { ...set, sheets: set.sheets.map((s) => (s === s0 ? { ...s, size: 'A1' as const, notes: ['Refer to E-SLD-002'], markups: [{ id: 'm1', kind: 'cloud' as const, x: 10, y: 10, w: 40, h: 30, rev: 'B' }] } : s)) } });
    const c = diff(p).changes.find((x) => x.what === 'sheet')!;
    expect(c.class).toBe('drawing');
    expect(c.fields.map((f) => f.field)).toEqual(expect.arrayContaining(['Paper', 'Notes', 'Markups [Cloud?]'.replace('Cloud?', 'm1')]));
    expect(changedSinceRevision(p)).toBe(true);
  });
  it('a sheet added or removed, and the title block, are drawing changes', () => {
    const set = base.drawingSet!;
    expect(diff(edit(base, { drawingSet: { ...set, sheets: set.sheets.slice(1) } })).changes.find((c) => c.what === 'sheet')).toMatchObject({ kind: 'removed', class: 'drawing' });
    const t = diff(edit(base, { drawing: { ...base.drawing, drawnBy: 'Asha' } })).changes[0];
    expect(t).toMatchObject({ class: 'drawing' });
    expect(t.fields.some((f) => f.field.includes('SLD title block'))).toBe(true);
  });
  it('the sheet issue history and "drawn when issued" fingerprint are not edits', () => {
    const set = base.drawingSet!;
    const p = edit(base, { drawingSet: { ...set, issues: [{ id: 'T-1', date: '2026-10-05', purpose: 'FOR APPROVAL', description: '', sheets: [] }], sheets: set.sheets.map((s) => ({ ...s, issuedHash: 'zzz', history: [{ rev: 'A', date: '2026-10-05', description: 'issued' }] })) } });
    expect(diff(p).changes).toEqual([]);
  });
});

describe('older revisions stay readable', () => {
  it('compares a revision made before ids, versions and pit IDs existed with today’s design, without false changes', () => {
    const { id: _a, schemaVersion: _b, createdAt: _c, ...old } = snapshotOf(sampleProject) as Project & { id?: string };
    const today = withEarthPitIds({ ...sampleProject, id: 'p-1', schemaVersion: 1, createdAt: '2026-10-05T00:00:00.000Z' });
    expect(diffProjects(old as Project, today).changes).toEqual([]);
  });
});
