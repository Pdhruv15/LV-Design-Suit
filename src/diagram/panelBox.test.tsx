// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { boxedBoardIds, hiddenBoardIds, panelSymbolOf } from './panelBox';
import { BOX_DY, layoutSystem, LEAF_W } from './layout';
import { legendEntries } from './IecSymbols';
import SystemDiagram from '../components/SystemDiagram';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject } from '../calc/electrical';
import type { Board, Feeder, Project } from '../types';

const fd = (id: string, boardId: string, p: Partial<Feeder> = {}) => ({
  id, boardId, name: id, loadKw: 10, demandFactor: 1, powerFactor: 0.9, lengthM: 10, cableCsaMm2: 16, cores: 4, breakerRatingA: 63, breakerIcuKa: 36, ...p
}) as Feeder;
const base = { name: 'T', voltageV: 415, frequencyHz: 50, ambientC: 45, vdLimitPct: 4, updatedAt: '' };
const proj = (boards: Board[], feeders: Feeder[]) => ({ ...base, boards, feeders }) as Project;

describe('panel symbols for boards drawn as one box', () => {
  it('picks the symbol from the panel role', () => {
    const boards: Board[] = [
      { id: 'MDB', name: 'M' }, { id: 'S', name: 'S', kind: 'SMDB', upstreamId: 'MDB' }, { id: 'D', name: 'D', upstreamId: 'S' },
      { id: 'MCC', name: 'P', kind: 'MCC', upstreamId: 'MDB' }, { id: 'EM', name: 'E', kind: 'EMDB', upstreamId: 'MDB' },
      { id: 'ED', name: 'ED', kind: 'DB', upstreamId: 'EM' }, { id: 'U', name: 'U', kind: 'UPS', upstreamId: 'MDB' }, { id: 'CAP', name: 'C', upstreamId: 'MDB' }
    ];
    const p = proj(boards, [fd('C1', 'CAP', { loadType: 'capacitor' }), fd('C2', 'CAP', { loadType: 'capacitor' })]);
    const of = (id: string) => panelSymbolOf(p, boards.find((b) => b.id === id)!);
    expect(of('MDB')).toBe('p-mdb');
    expect(of('S')).toBe('p-smdb');
    expect(of('D')).toBe('p-db');
    expect(of('MCC')).toBe('p-mcc');
    expect(of('EM')).toBe('p-mdb');
    expect(of('ED')).toBe('p-edb'); // a DB below an EMDB
    expect(of('U')).toBeUndefined();
    expect(of('CAP')).toBe('p-apfc');
  });

  it('boxes end boards only: a panel feeding ways keeps its busbar', () => {
    const p = proj([
      { id: 'MDB', name: 'M' }, { id: 'S', name: 'S', kind: 'SMDB', upstreamId: 'MDB' }, { id: 'D', name: 'D', upstreamId: 'S' },
      { id: 'S2', name: 'S2', kind: 'SMDB', upstreamId: 'MDB', spareWays: [{ id: 'w', ratingA: 32 }] as Board['spareWays'] },
      { id: 'U', name: 'U', kind: 'UPS', upstreamId: 'MDB' }, { id: 'CAP', name: 'C', upstreamId: 'MDB' }
    ], [
      fd('INC-S', 'MDB', { feedsBoardId: 'S' }), fd('INC-D', 'S', { feedsBoardId: 'D' }), fd('R1', 'D', { phase: 'R', way: 1 }),
      fd('C1', 'CAP', { loadType: 'capacitor' })
    ]);
    // D: final circuits only. CAP: its steps are inside the APFC panel. S feeds D, S2 has a spare way on its busbar, U has no symbol, MDB is the main board.
    expect([...boxedBoardIds(p)].sort()).toEqual(['CAP', 'D']);
    expect([...hiddenBoardIds(p)].sort()).toEqual(['CAP', 'D']);
  });

  it('lays an end board out in a load slot on its parent level', () => {
    const p = proj(
      [{ id: 'MDB', name: 'M' }, { id: 'S', name: 'S', kind: 'SMDB', upstreamId: 'MDB' }, { id: 'D', name: 'D', upstreamId: 'S' }],
      [fd('INC-S', 'MDB', { feedsBoardId: 'S' }), fd('A', 'S'), fd('INC-D', 'S', { feedsBoardId: 'D' }), fd('R1', 'D', { phase: 'R', way: 1 }), fd('L', 'MDB')]
    );
    const l = layoutSystem(p);
    const s = l.boards.find((b) => b.board.id === 'S')!, d = l.boards.find((b) => b.board.id === 'D')!;
    expect(d.boxed).toBe(true);
    expect(d.depth).toBe(2);
    expect(d.busY).toBe(s.busY + BOX_DY);
    expect(d.circuits.map((c) => c.id)).toEqual(['R1']);
    const inc = l.feeders.find((f) => f.feeder.id === 'INC-D')!;
    expect(inc.panelBoardId).toBe('D');
    expect(inc.childBoardId).toBeUndefined();
    expect(d.x).toBe(inc.x);
    expect(inc.x - l.feeders.find((f) => f.feeder.id === 'A')!.x).toBe(LEAF_W);
    expect(l.height).toBe(layoutSystem({ ...p, feeders: p.feeders.filter((f) => f.id !== 'INC-D') }).height); // no extra level
  });

  it('draws an end board as its panel symbol on the SLD, and lists it in the legend', () => {
    const project = sampleProject;
    const html = renderToStaticMarkup(
      <SystemDiagram project={project} calcProject={project} results={evaluateProject(project)}
        selectedFeederId={null} selectedBoardId={null} onSelectFeeder={() => {}} onSelectBoard={() => {}} onDrawing={() => {}} />
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    const texts = [...host.querySelector('[data-lv-id="feeder:INC-DBGF1"]')!.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(['DB', 'DB-GF1'])); // DB-GF1 has final circuits only
    const smdb = [...host.querySelector('[data-lv-id="feeder:INC-GF"]')!.querySelectorAll('text')].map((t) => t.textContent);
    expect(smdb).not.toContain('SMDB'); // SMDB-GF feeds ways: drawn with its busbar
    expect(legendEntries(project).map((e) => e.key)).toContain('p-db');
  });
});
