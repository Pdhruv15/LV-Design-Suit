// @vitest-environment node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { hashedText, type ExchangePackage, type RoomsPackage } from './contracts';
import { decide, readPackage, reviewPackage, roomsExport } from './inbox';

const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const fixture = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../tests/fixtures/exchange', name), 'utf-8'));
const AT = '2026-10-26T12:00:00Z';
const ifc = { app: 'ifc' as const, file: 'Villa-ARC.ifc' };

function villa(): Project {
  return {
    name: 'Villa', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '', boards: [], feeders: [],
    building: {
      buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }, { id: 'FF', name: 'First', kind: 'other', heightM: 3.5 }] }],
      rooms: [
        { id: 'R1', buildingId: 'V', levelId: 'GF', name: 'Kitchen', type: 'kitchen', areaM2: 25, boardId: 'DB-GF' },
        { id: 'R2', buildingId: 'V', levelId: 'GF', name: 'Store', type: 'store', areaM2: 6, source: { ...ifc, sourceId: 'OLD-STORE' } },
        { id: 'R3', buildingId: 'V', levelId: 'FF', name: 'Hall', type: 'living', areaM2: 30 }
      ]
    }
  };
}

function read(raw: Record<string, unknown>) {
  const r = readPackage(raw, sha256);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}
const rooms = () => { const r = read(fixture('villa-gf-rooms.ifc.json')); return { ...r, pkg: r.pkg as RoomsPackage }; };
const kinds = (p: Project, pkg: ExchangePackage, hash: string) => reviewPackage(p, pkg, hash).changes.map((c) => [c.key, c.kind]);

describe('reading a package', () => {
  it('accepts the sample packages', () => {
    for (const f of ['villa-gf-rooms.ifc.json', 'villa-luminaires.dialux.json', 'villa-elv-loads.json']) expect(readPackage(fixture(f), sha256).ok).toBe(true);
  });

  it('rejects other schemas and other contract versions with a clear reason', () => {
    expect(readPackage([], sha256)).toMatchObject({ ok: false, errors: [{ message: /JSON object/ }] });
    expect(readPackage({ ...rooms().pkg, schema: 'x' }, sha256)).toMatchObject({ ok: false, errors: [{ field: 'schema' }] });
    expect(readPackage({ ...rooms().pkg, version: 2 }, sha256)).toMatchObject({ ok: false, errors: [{ message: /version 2; this app reads version 1\. Update the app/ }] });
    expect(readPackage({ ...rooms().pkg, version: '1' }, sha256)).toMatchObject({ ok: false, errors: [{ message: /Unknown contract version/ }] });
  });

  it('reports wrong rows by row number, and duplicates', () => {
    const raw = fixture('villa-gf-rooms.ifc.json') as { items: Record<string, unknown>[] };
    raw.items[1].netAreaM2 = -4;
    expect(readPackage(raw, sha256)).toMatchObject({ ok: false, errors: [{ row: 2, field: 'netAreaM2' }] });
    raw.items[1].netAreaM2 = 4;
    raw.items[2].sourceId = raw.items[0].sourceId;
    expect(readPackage(raw, sha256)).toMatchObject({ ok: false, errors: [{ row: 3, message: /Duplicate of row 1/ }] });
    const lum = fixture('villa-luminaires.dialux.json') as { items: unknown[] };
    lum.items.push(lum.items[0]);
    expect(readPackage(lum, sha256)).toMatchObject({ ok: false, errors: [{ row: 3 }] });
  });

  it('checks the package’s own sha256, whatever the key order', () => {
    const { pkg, hash } = rooms();
    expect(hash).toBe(sha256(hashedText(pkg)));
    const reordered = Object.fromEntries(Object.entries({ ...pkg, sha256: hash }).reverse());
    expect(readPackage(reordered, sha256)).toMatchObject({ ok: true, hash });
    expect(readPackage({ ...pkg, sha256: hash, exportedAt: '2026-10-27T09:00:00Z' }, sha256)).toMatchObject({ ok: false, errors: [{ field: 'sha256' }] });
  });

  it('warns that removed items cannot be found without a source file name', () => {
    const { pkg } = rooms();
    expect(read({ ...pkg, source: { app: 'ifc' } }).warnings).toEqual([{ field: 'source.file', message: expect.stringMatching(/cannot be recognised/) }]);
  });
});

describe('rooms', () => {
  it('reviews: same name on the level → changed, new rooms added, rooms gone from the same file → removed', () => {
    const { pkg, hash } = rooms();
    const r = reviewPackage(villa(), pkg, hash);
    expect(r.changes.map((c) => [c.label, c.kind, c.before, c.after])).toEqual([
      ['Kitchen', 'changed', 'Kitchen, 25 m²', 'Kitchen, 30 m²'],
      ['Majlis', 'added', undefined, 'Majlis, 42.5 m²'],
      ['Guest WC', 'added', undefined, 'Guest WC, 4.2 m²'],
      ['Store', 'removed', 'Store, 6 m²', undefined]
    ]);
    expect(r.counts).toEqual({ added: 2, changed: 1, renamed: 0, removed: 1, same: 0 });
    expect(r.problems).toEqual([]);
  });

  it('applies everything accepted, links each room to its source, and logs the decision', () => {
    const { pkg, hash } = rooms();
    const { project, record } = decide(villa(), pkg, hash, { accept: 'all', by: 'A. Engineer', at: AT });
    expect(project.building!.rooms.map((x) => [x.id, x.levelId, x.name, x.type, x.areaM2, x.source?.sourceId])).toEqual([
      ['R1', 'GF', 'Kitchen', 'kitchen', 30, '2O2Fr$t4X7Zf8NOew3FLOH'],
      ['R3', 'FF', 'Hall', 'living', 30, undefined],
      ['R4', 'GF', 'Majlis', 'living', 42.5, '1hqIFTRjfV6AWq_bMtnZwI'], // type guessed from the name
      ['R5', 'GF', 'Guest WC', 'bathroom', 4.2, '3cUkl32yn9qRSPvBJVyWYp']
    ]);
    expect(project.building!.rooms[0]).toMatchObject({ boardId: 'DB-GF', source: { app: 'ifc', file: 'Villa-ARC.ifc', revision: 'B' } });
    expect(record).toEqual({ id: 'X-001', hash, kind: 'rooms', source: pkg.source, exportedAt: pkg.exportedAt, at: AT, by: 'A. Engineer', decision: 'accepted', accepted: { changed: 1, added: 2, removed: 1 }, offered: 4 });
    // The same package again: nothing left to change, and it is recognised.
    const again = reviewPackage(project, pkg, hash);
    expect(again.counts).toMatchObject({ added: 0, changed: 0, removed: 0, same: 3 });
    expect(again.seenBefore?.id).toBe('X-001');
  });

  it('keeps the room when the architect renames it in the next revision', () => {
    const first = rooms();
    const { project } = decide(villa(), first.pkg, first.hash, { accept: 'all', by: 'A. Engineer', at: AT });
    const raw = { ...first.pkg, source: { ...ifc, revision: 'C' }, items: first.pkg.items.map((x) => (x.name === 'Kitchen' ? { ...x, name: 'Show kitchen' } : x)) };
    const next = read(raw);
    expect(kinds(project, next.pkg, next.hash)).toEqual([['room:2O2Fr$t4X7Zf8NOew3FLOH', 'renamed'], ['room:1hqIFTRjfV6AWq_bMtnZwI', 'same'], ['room:3cUkl32yn9qRSPvBJVyWYp', 'same']]);
    const done = decide(project, next.pkg, next.hash, { accept: 'all', by: 'A. Engineer', at: AT }).project;
    expect(done.building!.rooms.find((x) => x.id === 'R1')).toMatchObject({ name: 'Show kitchen', boardId: 'DB-GF', source: { revision: 'C' } });
  });

  it('applies only the changes accepted; rejecting changes nothing but the log', () => {
    const { pkg, hash } = rooms();
    const some = decide(villa(), pkg, hash, { accept: ['room:1hqIFTRjfV6AWq_bMtnZwI'], by: 'A. Engineer', at: AT });
    expect(some.project.building!.rooms.map((x) => [x.name, x.areaM2])).toEqual([['Kitchen', 25], ['Store', 6], ['Hall', 30], ['Majlis', 42.5]]);
    expect(some.record).toMatchObject({ decision: 'partly accepted', accepted: { added: 1 }, offered: 4 });
    const none = decide(villa(), pkg, hash, { accept: [], by: 'A. Engineer', at: AT, note: 'Wrong revision' });
    expect(none.project.building).toEqual(villa().building);
    expect(none.record).toMatchObject({ decision: 'rejected', accepted: {}, note: 'Wrong revision' });
    expect(none.project.exchange!.log).toHaveLength(1);
  });

  it('lists rows it cannot place as problems, and refuses rooms from other programs', () => {
    const { pkg } = rooms();
    const raw = { ...pkg, items: [{ ...pkg.items[0], level: 'Roof' }, { ...pkg.items[1], building: 'Annex' }, { ...pkg.items[2], type: 'Sauna' }] };
    const r = read(raw);
    const review = reviewPackage(villa(), r.pkg, r.hash);
    expect(review.problems.map((x) => [x.row, x.field])).toEqual([[1, 'level'], [2, 'building'], [3, 'type']]);
    expect(review.changes.map((c) => c.label)).toEqual(['Guest WC', 'Store']); // an unknown type is guessed, not a blocker
    const fromElv = read({ ...pkg, source: { app: 'elv', file: 'x' } });
    expect(reviewPackage(villa(), fromElv.pkg, fromElv.hash).problems).toEqual([{ field: 'source.app', message: expect.stringMatching(/CAD or IFC/) }]);
  });

  it('refuses a decision without a name or with keys that are not changes', () => {
    const { pkg, hash } = rooms();
    expect(() => decide(villa(), pkg, hash, { accept: 'all', by: ' ', at: AT })).toThrow(/name of the engineer/);
    expect(() => decide(villa(), pkg, hash, { accept: ['room:nope'], by: 'A. Engineer', at: AT })).toThrow(/Not a change in this package: room:nope/);
  });
});

describe('luminaires and ELV loads', () => {
  const withRooms = () => { const r = rooms(); return decide(villa(), r.pkg, r.hash, { accept: 'all', by: 'A. Engineer', at: AT }).project; };

  it('needs the rooms first; then stores the accepted rows, and compares the next package with them', () => {
    const lum = read(fixture('villa-luminaires.dialux.json'));
    expect(reviewPackage(villa(), lum.pkg, lum.hash).problems.map((p) => [p.row, p.field])).toEqual([[1, 'room'], [2, 'room']]);
    const p1 = decide(withRooms(), lum.pkg, lum.hash, { accept: 'all', by: 'A. Engineer', at: AT }).project;
    expect(p1.exchange!.packages).toEqual([expect.objectContaining({ kind: 'fixtures', hash: lum.hash, fixtures: [expect.objectContaining({ room: 'R1', code: 'DL-12', quantity: 8 }), expect.objectContaining({ room: 'R1', code: 'EM-3' })] })]);
    // Revision 2: two more downlights, the emergency fitting gone; only the downlights are accepted.
    const raw = { ...lum.pkg, source: { ...lum.pkg.source, revision: '2' }, items: [{ ...lum.pkg.items[0], quantity: 10 }] };
    const rev2 = read(raw);
    expect(kinds(p1, rev2.pkg, rev2.hash)).toEqual([['fixture:R1|DL-12|normal', 'changed'], ['fixture:R1|EM-3|emergency', 'removed']]);
    const p2 = decide(p1, rev2.pkg, rev2.hash, { accept: ['fixture:R1|DL-12|normal'], by: 'A. Engineer', at: AT }).project;
    expect(p2.exchange!.packages[0].fixtures!.map((f) => [f.code, f.quantity])).toEqual([['EM-3', 1], ['DL-12', 10]]);
    expect(p2.exchange!.log.map((x) => x.decision)).toEqual(['accepted', 'accepted', 'partly accepted']);
  });

  it('keeps ELV loads with the rooms they serve as project room IDs', () => {
    const loads = read(fixture('villa-elv-loads.json'));
    expect(reviewPackage(villa(), loads.pkg, loads.hash).problems).toEqual([{ row: 2, field: 'rooms', message: 'No room "2O2Fr$t4X7Zf8NOew3FLOH" in the project.' }]);
    const p = decide(withRooms(), loads.pkg, loads.hash, { accept: 'all', by: 'A. Engineer', at: AT }).project;
    expect(p.exchange!.packages[0].loads!.map((l) => [l.id, l.kW, l.supply, l.rooms])).toEqual([['FA-PANEL-01', 0.3, 'essential', undefined], ['CCTV-SW-01', 0.18, 'normal', ['R1']]]);
  });
});

describe('rooms export', () => {
  it('writes the project rooms as a checked package that names each room by its project ID', () => {
    const pkg = roomsExport(villa(), AT, sha256, 'Villa');
    const back = read(pkg as unknown as Record<string, unknown>);
    expect(back.hash).toBe(pkg.sha256);
    expect(pkg.source).toEqual({ app: 'lvds', file: 'Villa' });
    expect(pkg.items.map((x) => [x.sourceId, x.building, x.level, x.name])).toEqual([['R1', 'Villa', 'Ground', 'Kitchen'], ['R2', 'Villa', 'Ground', 'Store'], ['R3', 'Villa', 'First', 'Hall']]);
    expect(() => roomsExport({ ...villa(), building: undefined }, AT, sha256)).toThrow(/no rooms/);
  });
});
