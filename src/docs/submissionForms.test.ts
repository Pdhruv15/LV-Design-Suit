import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import type { Board, BoardKind, Feeder, Project } from '../types';
import { buildMdSheet, MD_TITLE, MD_TITLE_METERING, mdFormOf, panelDf } from './mdSheet';
import { buildTxSummary } from './txSummary';
import { buildFormWorkbook } from './formWorkbook';
import { roleOf } from '../model/emergency';
import { scheduleGroupOf } from '../model/scheduleGroups';
import { needsFireRated } from '../model/cableTypes';
import { leafSymbol } from '../diagram/feederRiserLayout';
import { panelSymbolOf } from '../diagram/panelBox';

/** The DEWA submission table: which form each panel type gets. */

const base = sampleProject.feeders[0];
const fd = (id: string, boardId: string, p: Partial<Feeder> = {}): Feeder => ({ ...base, id, boardId, name: id, feedsBoardId: undefined, phase: undefined, way: undefined, ...p });
const board = (id: string, kind: BoardKind, upstreamId?: string): Board => ({ id, name: id, kind, ...(upstreamId ? { upstreamId } : {}) });

// Substation LV ACB → LV MDB → SMDB / MCC; LV EMDB → ESMDB / EMCC / FP; EMDB under the LV MDB.
const boards: Board[] = [
  board('ACB', 'LV-ACB'), board('MDB', 'LV-MDB', 'ACB'), board('SMDB', 'SMDB', 'MDB'), board('MCC', 'MCC', 'MDB'), board('EMDB', 'EMDB', 'MDB'),
  board('LVE', 'LV-EMDB'), board('ESMDB', 'SMDB', 'LVE'), board('EMCC', 'MCC', 'LVE'), board('FP', 'FP', 'LVE')
];
const project: Project = {
  ...sampleProject, building: undefined, busRisers: [], boards,
  feeders: [
    fd('I-MDB', 'ACB', { feedsBoardId: 'MDB' }), fd('I-SMDB', 'MDB', { feedsBoardId: 'SMDB' }), fd('I-MCC', 'MDB', { feedsBoardId: 'MCC' }), fd('I-EMDB', 'MDB', { feedsBoardId: 'EMDB' }),
    fd('I-ESMDB', 'LVE', { feedsBoardId: 'ESMDB' }), fd('I-EMCC', 'LVE', { feedsBoardId: 'EMCC' }), fd('I-FP', 'LVE', { feedsBoardId: 'FP' }),
    fd('L1', 'SMDB'), fd('M1', 'MCC'), fd('E1', 'EMDB'), fd('E2', 'ESMDB'), fd('E3', 'EMCC'),
    fd('FP-R1', 'FP', { phase: 'R', way: 1, loadType: 'fire-pump' })
  ]
};
const b = (id: string) => project.boards.find((x) => x.id === id)!;

describe('submission forms by panel type', () => {
  it('gives each panel type the form of the DEWA submission table', () => {
    const form = (id: string) => mdFormOf(project, b(id));
    for (const id of ['ACB', 'MDB', 'EMDB', 'LVE']) expect(form(id), id).toEqual({ title: MD_TITLE_METERING, metering: true });
    for (const id of ['SMDB', 'ESMDB', 'EMCC', 'MCC']) expect(form(id), id).toEqual({ title: MD_TITLE, metering: false });
    expect(MD_TITLE_METERING).toBe('DETAILS OF CONNECTED LOAD, MAX. DEMAND & kWh METERING');
    expect(MD_TITLE).toBe('DETAILS OF CONNECTED LOAD / MAX. DEMAND');
  });

  it('leaves the kWh meter columns off the connected load / max. demand form', () => {
    const smdb = buildMdSheet(project, 'SMDB'), mdb = buildMdSheet(project, 'MDB');
    expect(smdb.keys).toHaveLength(17);
    expect(smdb.keys).not.toContain('CT');
    expect(smdb.groups.map((g) => g.title)).not.toContain('PROPOSED TYPE & No OF kWh METER');
    expect(smdb.groups.reduce((s, g) => s + g.colspan, 0)).toBe(17);
    expect(mdb.keys).toHaveLength(20);
    expect(mdb.form.metering).toBe(true);
  });

  it('makes LV EMDB an emergency main board, LV ACB a main board, FP a fire pump panel', () => {
    expect(['ESMDB', 'EMCC', 'FP'].map((id) => roleOf(project, b(id)))).toEqual(['ESMDB', 'EMCC', 'FP']);
    expect(scheduleGroupOf(project, b('LVE'))).toBe('emg');
    expect(scheduleGroupOf(project, b('FP'))).toBe('emg');
    expect(scheduleGroupOf(project, b('ACB'))).toBe('mdb');
    expect(needsFireRated(project, project.feeders.find((f) => f.id === 'I-FP')!)).toBe(true); // into the fire pump panel
    expect(needsFireRated(project, project.feeders.find((f) => f.id === 'I-ESMDB')!)).toBe(true); // from the LV EMDB
    expect(leafSymbol('FP')).toBe('mcc');
    expect(panelSymbolOf(project, b('ACB'))).toBe('p-mdb');
    expect(panelSymbolOf(project, b('LVE'))).toBe('p-mdb');
  });

  it('prints the fire pump panel as a load distribution schedule, the LV EMDB with kWh metering', () => {
    const names = buildFormWorkbook(project).worksheets.map((w) => w.name);
    expect(names).toContain('FP SCHEDULE');
    expect(names).not.toContain('FP MD');
    const lve = buildFormWorkbook(project, { boardIds: ['LVE'], forms: ['md'] }).worksheets[0];
    expect(lve.getCell('F1').value).toBe(MD_TITLE_METERING);
  });
});

describe('one demand factor on every sheet', () => {
  it('uses the board DF, else the project DF, else the loads', () => {
    const mdb = sampleProject.boards.find((x) => x.id === 'MDB-1')!;
    expect(panelDf(sampleProject, mdb)).toBe(0.8); // the project's demand factor
    expect(panelDf(sampleProject, { ...mdb, mdDemandFactor: 0.7 })).toBe(0.7);
    const noProjectDf = { ...sampleProject, info: { ...sampleProject.info, mdDemandFactor: undefined } };
    expect(panelDf(noProjectDf, mdb)).toBeCloseTo(0.88, 2); // from the loads
  });

  it('shows the same maximum demand for the main board on its MD form and on the TCL summary', () => {
    const md = buildMdSheet(sampleProject, 'MDB-1').form;
    const tx = buildTxSummary(sampleProject).groups.flatMap((g) => g.rows).find((r) => r.board.id === 'MDB-1')!;
    expect(md.demandFactor).toBe(tx.df);
    expect(md.maxDemandKw).toBeCloseTo(tx.mdlKw, 2);
  });
});
