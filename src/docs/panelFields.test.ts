import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addOutgoingFeeder } from '../model/mdFeeders';
import { addSpareWay } from '../model/spareWays';
import { buildMdSheet } from './mdSheet';
import { panelData, panelRowKeys } from './panelFields';

const AT = new Date('2026-10-27T10:00:00Z');
const BOARDS = ['MDB-1', 'SMDB-GF', 'MCC-1'];
const withWay = addSpareWay(sampleProject, 'SMDB-GF', 'spare').project;
const num = (v: string | number) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v);

describe('panelData', () => {
  it('has one row per feeder and way of the form, in its order', () => {
    for (const id of BOARDS) {
      const t = buildMdSheet(sampleProject, id), form = t.rows.filter((r) => r.type === 'feeder' || r.type === 'way');
      const d = panelData(sampleProject, id, AT);
      expect(d.rows, id).toHaveLength(form.length);
      expect(d.rows.map((r) => r['row.sl'])).toEqual(form.map((_, i) => i + 1));
    }
  });

  it("the first feeder's name, rating, size and load are the form's own cells, numbers as numbers", () => {
    for (const id of BOARDS) {
      const t = buildMdSheet(sampleProject, id), y = t.rows.findIndex((r) => r.type === 'feeder'), line = t.data[y], at = (k: string) => t.keys.indexOf(k as never);
      const r = panelData(sampleProject, id, AT).rows[0], dev = (['ACB', 'MCCB', 'ISOL'] as const).find((k) => line[at(k)] !== '')!;
      expect(r['row.name']).toBe(line[at('name')]);
      expect([r['row.device'], r['row.rating']]).toEqual([dev, num(line[at(dev)])]);
      expect(r['row.size']).toBe(line[at('size')]);
      expect(r['row.tcl']).toBe(Number(line[at('tcl')]));
      expect(typeof r['row.tcl']).toBe('number');
      expect(r['row.mdl']).toBe(Number(line[at('mdl')]));
    }
    expect(panelData(sampleProject, 'MDB-1', AT).rows[0]).toMatchObject({ 'row.size': '2x150', 'row.cableType': 'XLPE/PVC/SWA', 'row.cores': '4C', 'row.poles': 'TP', 'row.meter': '' });
  });

  it('names the board a feeder supplies', () => {
    const rows = panelData(sampleProject, 'MDB-1', AT).rows;
    expect(rows[0]).toMatchObject({ 'row.to': 'SMDB-GF', 'row.name': 'SMDB-GF (GROUND FLOOR SMDB)' });
    expect(panelData(sampleProject, 'MCC-1', AT).rows.every((r) => r['row.to'] === '')).toBe(true);
  });

  it('shows a way added with the model\'s own function as a row with a spare: key', () => {
    const before = panelData(sampleProject, 'SMDB-GF', AT).rows.length, d = panelData(withWay, 'SMDB-GF', AT), keys = panelRowKeys(withWay, 'SMDB-GF');
    expect(d.rows).toHaveLength(before + 1);
    expect(keys[keys.length - 1]).toMatch(/^spare:/);
    expect(d.rows[d.rows.length - 1]).toMatchObject({ 'row.sl': before + 1, 'row.to': '', 'row.R': 0, 'row.tcl': 0 });
    expect(d.rows[d.rows.length - 1]['row.device']).not.toBe('');
  });

  it('totals, load and demand factor are the form\'s', () => {
    for (const id of BOARDS) {
      const t = buildMdSheet(sampleProject, id), at = (k: string) => t.keys.indexOf(k as never), f = panelData(sampleProject, id, AT).fields;
      expect([f['total.R'], f['total.Y'], f['total.B']]).toEqual([Number(t.totals[at('R')]), Number(t.totals[at('Y')]), Number(t.totals[at('B')])]);
      expect([f['panel.tcl'], f['panel.mdl'], f['panel.df']]).toEqual([Number(t.totals[at('tcl')]), Number(t.totals[at('mdl')]), t.form.demandFactor]);
    }
  });

  it('the incomer is the feeder from the board above, or the authority supply of a main board', () => {
    expect(panelData(sampleProject, 'SMDB-GF', AT).fields).toMatchObject({
      'board.id': 'SMDB-GF', 'board.fedFrom': 'MDB-1', 'incomer.poles': 'TP', 'incomer.device': 'MCCB', 'incomer.rating': 500, 'incomer.fault': 36, 'incomer.cores': '4C',
      'incomer.cableType': 'XLPE/PVC/SWA', 'incomer.size': '2x150', 'incomer.ecc': 95, 'incomer.length': 35
    });
    expect(panelData(sampleProject, 'MDB-1', AT).fields).toMatchObject({ 'board.fedFrom': 'DEWA', 'incomer.poles': 'TP', 'incomer.device': 'MCCB', 'incomer.rating': 1600, 'incomer.cores': 'BY DEWA', 'incomer.size': '', 'incomer.length': '' });
  });

  it('has the project fields of the DB data and the date asked for', () => {
    const f = panelData(sampleProject, 'MCC-1', AT).fields;
    expect(f).toMatchObject({ 'project.name': sampleProject.name, 'project.voltage': 415, 'project.frequency': 50, date: '27 Oct 2026' });
  });
});

describe('panelRowKeys', () => {
  it('is unique and as long as the rows', () => {
    const p = addOutgoingFeeder(withWay, 'SMDB-GF').project;
    for (const [project, id] of [[sampleProject, 'MDB-1'], [sampleProject, 'MCC-1'], [p, 'SMDB-GF']] as const) {
      const keys = panelRowKeys(project, id);
      expect(keys).toHaveLength(panelData(project, id, AT).rows.length);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
