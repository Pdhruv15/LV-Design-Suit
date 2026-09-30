import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { evaluate, fillParams, paramList } from './params';
import { addCol, addRow, cellAt, mergeDown, mergeRight, removeCol, removeRow, split, standardTemplate, titleBlockHtml } from './titleBlock';
import { componentLabel, componentPreset, componentValues, newComponent, syncComponent } from './components';
import { applyPreset } from './presets';
import type { Project } from '../types';

const p: Project = { ...sampleProject, params: { designedBy: 'P. Samy', submissionDate: '15 Oct 2026', custom: [{ name: 'ContractNo', value: 'C-778' }] } };

describe('parameters', () => {
  it('fills built-in, people, own and board values; leaves unknown ones', () => {
    expect(fillParams('{Project} · {DesignedBy} · {SubmissionDate} · {ContractNo}', p)).toBe(`${p.name} · P. Samy · 15 Oct 2026 · C-778`);
    expect(fillParams('{smdb-gf.DemandKW} kW', p)).toMatch(/^\d/);
    expect(fillParams('{MDB-1.KVA} kVA', p)).toBe('1000 kVA');
    expect(fillParams('{Nope} {MDB-1.Colour}', p)).toBe('{Nope} {MDB-1.Colour}');
    expect(paramList(p).find((x) => x.name === 'Voltage')!.value).toBe('415 V');
  });
  it('evaluates formulas safely', () => {
    expect(evaluate('kW * 1000 / (sqrt(3) * Voltage * PF)', { kW: 22, Voltage: 415, PF: 0.85 })).toBeCloseTo(36.01, 1);
    expect(evaluate('2^3 + max(1, 4) - round(2.4)', {})).toBe(10);
    expect(() => evaluate('alert(1)', {})).toThrow();
    expect(() => evaluate('kW +', { kW: 1 })).toThrow();
  });
});

describe('title block templates', () => {
  it('standard template covers the grid; merge, split, add and remove rows / columns', () => {
    const t = standardTemplate();
    for (let r = 0; r < t.rows.length; r++) for (let c = 0; c < t.cols.length; c++) expect(cellAt(t, r, c)).toBeDefined();
    const a = cellAt(t, 3, 2)!; // REV
    const m = mergeRight(t, a.id);
    expect(m.cells.find((x) => x.id === a.id)!.cs).toBe(2);
    expect(split(m, a.id).cells.length).toBe(t.cells.length);
    const d = mergeDown(t, cellAt(t, 4, 2)!.id);
    expect(d.cells.find((x) => x.id === cellAt(t, 4, 2)!.id)!.rs).toBe(2);
    expect(mergeDown(t, cellAt(t, 4, 0)!.id)).toBe(t); // the cell below spans two columns: refused
    const r = addRow(t, 5);
    expect(r.rows.length).toBe(7);
    expect(cellAt(r, 6, 0)).toBeDefined();
    const c = addCol(t, 3);
    expect(cellAt(c, 0, 4)).toBeDefined();
    expect(removeRow(r, 6).rows.length).toBe(6);
    expect(removeCol(c, 4).cols.length).toBe(4);
  });
  it('renders with parameters filled', () => {
    const html = titleBlockHtml(standardTemplate(), p);
    expect(html).toContain('P. Samy');
    expect(html).toContain(p.name);
    expect(html).not.toContain('{DesignedBy}');
  });
});

describe('custom components', () => {
  const c = { ...newComponent('ahu'), starter: 'VFD' as const };
  it('results from formulas; label with values', () => {
    const { values, errors } = componentValues(c, 415);
    expect(errors).toEqual([]);
    expect(values.Current).toBeCloseTo(36.01, 1);
    const f = { ...sampleProject.feeders[0], name: 'AHU-01', componentId: 'ahu' };
    expect(componentLabel(sampleProject, c, f)).toBe('AHU-01 · 22 kW · 36 A');
  });
  it('drops like a preset and edits update every copy', () => {
    const r = applyPreset(sampleProject, componentPreset(sampleProject, c), 'SMDB-GF');
    const added = r.project.feeders.find((f) => !sampleProject.feeders.some((x) => x.id === f.id))!;
    expect(added.loadKw).toBe(22);
    const tagged = { ...r.project, feeders: r.project.feeders.map((f) => (f.id === added.id ? { ...f, componentId: 'ahu' } : f)) };
    const s = syncComponent(tagged, { ...c, inputs: c.inputs.map((x) => (x.name === 'kW' ? { ...x, value: 30 } : x)) });
    expect(s.updated).toBe(1);
    expect(s.project.feeders.find((f) => f.id === added.id)!.loadKw).toBe(30);
  });
});
