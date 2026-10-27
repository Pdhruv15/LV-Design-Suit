import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { buildDesignBasis } from '../docs/designBasis';
import {
  BUILT_IN_REFERENCES, REFERENCES_KEY, applyReference, appliedStatus, changedSinceApplied, duplicateReference, exportReferences, importReferences,
  loadReferences, loadUserReferences, newReference, projectValue, referenceChanges, referenceIssues, referenceSourceOf, resolveReference, saveReference, saveUserReferences
} from './designReference';
import type { Project } from '../types';

const ref = (id: string) => BUILT_IN_REFERENCES.find((r) => r.id === id)!;
const base: Project = { ...sampleProject, voltageV: 415, ambientC: 45, vdLimitPct: 4, studySettings: {}, info: { ...sampleProject.info, mdDemandFactor: 0.8 }, designReference: undefined };

describe('built-in design references', () => {
  it('has DEWA, IEC, BS 7671, ADDC and EtihadWE, all read only and marked to verify', () => {
    expect(BUILT_IN_REFERENCES.map((r) => r.name)).toEqual(['DEWA (Dubai)', 'IEC 60364', 'BS 7671', 'ADDC (Abu Dhabi)', 'EtihadWE (Northern Emirates)']);
    for (const r of BUILT_IN_REFERENCES) {
      expect(r.builtIn).toBe(true);
      expect(r.status).toBe('to-verify');
      expect(referenceIssues(r)).toEqual([]);
    }
  });
  it('DEWA holds the values new projects have used, so applying it to a default project changes nothing', () => {
    expect(referenceChanges(base, ref('builtin-dewa'))).toEqual([]);
  });
  it('ADDC and EtihadWE start from the DEWA values, each flagged in its note', () => {
    expect(ref('builtin-addc').values.vdLimitPct?.value).toBe(4);
    expect(ref('builtin-etihadwe').values.ambientC?.note).toMatch(/check/i);
  });
});

describe('applying a reference to a project', () => {
  it('lists the changes, then writes project, study and form values and records the reference', () => {
    const bs = ref('builtin-bs7671');
    const changes = referenceChanges(base, bs);
    expect(changes.map((c) => c.key)).toEqual(['voltageV', 'ambientC', 'vdLimitPct', 'elcbLightingMa']);
    expect(changes.find((c) => c.key === 'elcbLightingMa')).toMatchObject({ from: 100, to: 30 });

    const p = applyReference(base, bs, '2026-10-12T08:00:00Z');
    expect([p.voltageV, p.ambientC, p.vdLimitPct, p.studySettings?.elcbLightingMa]).toEqual([400, 30, 5, 30]);
    expect(p.studySettings?.pfTarget).toBeUndefined(); // blank in the reference: the project's own value stays
    expect(p.designReference).toMatchObject({ id: 'builtin-bs7671', name: 'BS 7671', version: 1, appliedAt: '2026-10-12T08:00:00Z' });
    expect(referenceChanges(p, bs)).toEqual([]);
  });
  it('tracks values changed in the project after applying, and the report source follows', () => {
    const p = applyReference(base, ref('builtin-iec'));
    expect(changedSinceApplied(p)).toEqual([]);
    expect(referenceSourceOf(p, 'vdLimitPct')).toBe('Design reference: IEC 60364 v1');
    const edited = { ...p, vdLimitPct: 3 };
    expect(changedSinceApplied(edited)).toEqual(['vdLimitPct']);
    expect(referenceSourceOf(edited, 'vdLimitPct')).toBeUndefined();
  });
  it('the design report names the reference and uses it as the source of its values', () => {
    const b = buildDesignBasis(applyReference(base, ref('builtin-iec')), []);
    expect(b.standards.reference).toMatch(/^IEC 60364 \(version 1, applied /);
    expect(b.criteria.find((c) => c.parameter.startsWith('Voltage drop limit'))?.source).toBe('Design reference: IEC 60364 v1');
    expect(b.criteria.find((c) => c.parameter.startsWith('System voltage'))?.source).toBe('Design reference: IEC 60364 v1');
  });
  it('reads the project value with study defaults', () => {
    expect(projectValue(base, 'pfTarget')).toBe(0.95);
    expect(projectValue(base, 'mdDemandFactor')).toBe(0.8);
  });
});

describe('your references', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() });
  });

  it('a duplicate is editable, linked to the original, and saves with a raised version', () => {
    const copy = duplicateReference(ref('builtin-dewa'), 'DEWA — our practice');
    expect(copy.builtIn).toBeUndefined();
    expect(copy.basedOn).toBe('builtin-dewa');
    let list = saveReference([], copy);
    expect(list[0].version).toBe(1);
    list = saveReference(list, { ...list[0], values: { ...list[0].values, vdLimitPct: { value: 3, clause: 'Company std 4.2' } } });
    expect(list[0].version).toBe(2);
    expect(saveReference(list, ref('builtin-dewa'))).toBe(list); // built-ins are never stored
  });
  it('are stored for Library.json and loaded after the built-ins', () => {
    const mine = { ...newReference('Villa practice'), entries: [{ id: 'e1', topic: 'Sockets per circuit', value: '6' }] };
    saveUserReferences([...BUILT_IN_REFERENCES, mine]);
    expect(JSON.parse(localStorage.getItem(REFERENCES_KEY)!)).toHaveLength(1);
    expect(loadUserReferences()[0].entries[0].topic).toBe('Sockets per circuit');
    expect(loadReferences().map((r) => r.name).slice(-1)).toEqual(['Villa practice']);
  });
  it('rejects a blank or taken name and out-of-range values', () => {
    expect(referenceIssues({ ...newReference(''), values: {} })).toEqual(['Give the reference a name.']);
    expect(referenceIssues(newReference('BS 7671'), BUILT_IN_REFERENCES)[0]).toMatch(/already called/);
    expect(referenceIssues({ ...newReference('X'), values: { vdLimitPct: { value: 40 } } })[0]).toMatch(/Voltage drop limit/);
  });
  it('export and import round-trip; a clash in id or name comes in as a new copy', () => {
    const mine = saveReference([], { ...newReference('Villa practice'), values: { vdLimitPct: { value: 3 } } });
    const text = exportReferences(mine);
    const { added, error } = importReferences(text, mine);
    expect(error).toBeUndefined();
    expect(added[0].name).toBe('Villa practice (imported)');
    expect(added[0].id).not.toBe(mine[0].id);
    expect(added[0].values.vdLimitPct?.value).toBe(3);
    expect(importReferences('not json', []).error).toMatch(/JSON/);
    expect(importReferences('{"x":1}', []).error).toMatch(/No design references/);
  });
  it('says when the applied reference was edited later or removed', () => {
    const mine = saveReference([], newReference('Villa practice'));
    const p = applyReference(base, mine[0]);
    const edited = saveReference(mine, { ...mine[0], values: { vdLimitPct: { value: 3 } } });
    expect(appliedStatus(p, edited)).toMatchObject({ newer: true, missing: false });
    expect(appliedStatus(p, [])).toMatchObject({ missing: true });
  });
});

describe('layered references and rule rows', () => {
  const dewa = ref('builtin-dewa');
  const company = { ...newReference('Company DEWA'), id: 'co', extends: dewa.id, values: { vdLimitPct: { value: 3 } },
    rules: [{ id: 'r1', kind: 'minWireMm2' as const, when: { category: 'power' as const }, value: 6 }] };
  const list = [...BUILT_IN_REFERENCES, company];

  it('a reference inherits the values it does not set, and records where each came from', () => {
    const r = resolveReference(company, list);
    expect(r.values.vdLimitPct?.value).toBe(3);
    expect(r.values.ambientC?.value).toBe(45);
    expect(r.sources).toMatchObject({ vdLimitPct: 'Company DEWA', ambientC: 'DEWA (Dubai)' });
    expect(r.rules).toEqual([{ ...company.rules[0], from: 'Company DEWA v1' }]);
  });
  it('a nearer row with the same condition replaces the base row', () => {
    const base2 = { ...company, id: 'base2', extends: undefined, name: 'Base', rules: [{ ...company.rules[0], id: 'b', value: 4 }] };
    const child = { ...company, id: 'child', extends: 'base2', name: 'Child' };
    expect(resolveReference(child, [base2, child]).rules.map((x) => x.value)).toEqual([6]);
  });
  it('flags a missing base and a loop', () => {
    expect(resolveReference({ ...company, extends: 'gone' }, list).missingBase).toBe('gone');
    const a = { ...company, id: 'a', name: 'A', extends: 'b' };
    const b = { ...company, id: 'b', name: 'B', extends: 'a' };
    expect(referenceIssues(a, [b])).toContain('The reference it builds on leads back to itself.');
    expect(resolveReference(a, [a, b]).values.vdLimitPct?.value).toBe(3); // still resolves
  });
  it('applying writes inherited values and the rows, and keeps the project\'s own rows', () => {
    const own = { id: 'mine', kind: 'elcbMa' as const, when: {}, value: 30 };
    const old = { id: 'old', kind: 'minWireMm2' as const, when: {}, value: 10, from: 'Earlier v1' };
    const p = applyReference({ ...base, designRules: [old, own] }, company, '2026-10-27T00:00:00Z', list);
    expect(p.vdLimitPct).toBe(3);
    expect(p.ambientC).toBe(45);
    expect(p.designRules?.map((x) => x.id)).toEqual(['r1', 'mine']);
    expect(referenceChanges(p, company, list)).toEqual([]);
  });
  it('a reference without rows leaves a project without rows', () => {
    expect(applyReference(base, dewa, undefined, list).designRules).toBeUndefined();
  });
  it('rows survive export and import, and bad rows are reported', () => {
    const { added } = importReferences(exportReferences([company]), []);
    expect(added[0]).toMatchObject({ extends: dewa.id, rules: [{ kind: 'minWireMm2', value: 6, when: { category: 'power' } }] });
    expect(referenceIssues({ ...company, rules: [{ ...company.rules[0], value: 0 }] })[0]).toMatch(/outside/);
  });
});
