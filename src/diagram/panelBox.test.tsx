// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { boxedBoardIds, hiddenBoardIds, panelSymbolOf } from './panelBox';
import { layoutSystem, LEAF_W } from './layout';
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

  it('boxes only sub-boards that have a panel symbol, and hides what is below them', () => {
    const p = proj([
      { id: 'MDB', name: 'M', sldBox: true }, { id: 'S', name: 'S', kind: 'SMDB', upstreamId: 'MDB', sldBox: true },
      { id: 'D', name: 'D', upstreamId: 'S' }, { id: 'U', name: 'U', kind: 'UPS', upstreamId: 'MDB', sldBox: true }
    ], []);
    expect([...boxedBoardIds(p)]).toEqual(['S']);
    expect([...hiddenBoardIds(p)].sort()).toEqual(['D', 'S']);
  });

  it('lays a boxed board out in one load slot, with nothing below it', () => {
    const p = proj(
      [{ id: 'MDB', name: 'M' }, { id: 'S', name: 'S', kind: 'SMDB', upstreamId: 'MDB', sldBox: true }, { id: 'D', name: 'D', upstreamId: 'S' }],
      [fd('INC-S', 'MDB', { feedsBoardId: 'S' }), fd('A', 'S'), fd('B', 'S'), fd('INC-D', 'S', { feedsBoardId: 'D' }), fd('X', 'D'), fd('L', 'MDB')]
    );
    const l = layoutSystem(p);
    expect(l.boards.map((b) => b.board.id)).toEqual(['MDB']);
    expect(l.feeders.map((f) => f.feeder.id)).toEqual(['INC-S', 'L']);
    const inc = l.feeders.find((f) => f.feeder.id === 'INC-S')!;
    expect(inc.panelBoardId).toBe('S');
    expect(inc.childBoardId).toBeUndefined();
    expect(l.feeders[1].x - inc.x).toBe(LEAF_W);
    // Unboxed, the sub-board takes its own three slots and a level below.
    const open = layoutSystem({ ...p, boards: p.boards.map((b) => ({ ...b, sldBox: undefined })) });
    expect(open.boards).toHaveLength(3);
  });

  it('draws the panel symbol with the board name on the SLD, and lists it in the legend', () => {
    const project: Project = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'SMDB-GF' ? { ...b, sldBox: true } : b)) };
    const html = renderToStaticMarkup(
      <SystemDiagram project={project} calcProject={project} results={evaluateProject(project)}
        selectedFeederId={null} selectedBoardId={null} onSelectFeeder={() => {}} onSelectBoard={() => {}} onDrawing={() => {}} />
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    const g = host.querySelector('[data-lv-id="feeder:INC-GF"]')!;
    const texts = [...g.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(['SMDB', 'SMDB-GF']));
    expect(host.querySelector('[data-lv-id="feeder:INC-DBGF1"]')).toBeNull(); // below the box: on its own sheet only
    const keys = legendEntries(project).map((e) => e.key);
    expect(keys).toContain('p-smdb');
  });
});
