// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SystemDiagram from '../components/SystemDiagram';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject } from '../calc/electrical';
import { legendEntries } from './IecSymbols';
import { ChangeoverIncomers } from './ChangeoverSym';
import type { Feeder, Project } from '../types';

/** Transformer, generator, ATS, instruments, lamps, relays and the separate RCD come from the symbol library. */

const capacitor: Feeder = { ...sampleProject.feeders.find((f) => f.id === 'MCC-WP')!, id: 'MCC-CAP', name: 'Capacitor bank', loadType: 'capacitor', kvar: 50 };
const project: Project = {
  ...sampleProject,
  boards: sampleProject.boards.map((b) =>
    b.id === 'MDB-1' ? b
      : b.id === 'MCC-1' ? { ...b, standby: { kva: 250, changeover: 'ATS' as const }, protection: { apfc: true }, instruments: true }
        : b),
  feeders: [
    ...sampleProject.feeders.map((f) =>
      f.id === 'MCC-WP' ? { ...f, remarks: 'UVR' }
        : f.id === 'MCC-FP' ? { ...f, rcdMa: 300, remarks: 'RCCB 300mA' }
          : f),
    { ...capacitor, boardId: 'MCC-1' }
  ]
};

const draw = (p: Project) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <SystemDiagram project={p} calcProject={p} results={evaluateProject(p)}
      selectedFeederId={null} selectedBoardId={null} onSelectFeeder={() => {}} onSelectBoard={() => {}} onDrawing={() => {}} />
  );
  return host;
};
const texts = (el: Element | null) => [...(el?.querySelectorAll('text') ?? [])].map((t) => t.textContent);

describe('SLD sources, instruments and relays from the symbol library', () => {
  const host = draw(project);

  it('draws the transformer as the library two-winding symbol', () => {
    const tx = host.querySelector('[data-lv-id="board:MDB-1"].tx, g.tx')!;
    const circles = [...tx.querySelectorAll('circle')].map((c) => [c.getAttribute('cy'), c.getAttribute('r')]);
    expect(circles).toEqual([['85.88', '7.88'], ['98.13', '7.88']]); // load scale, centred where the old pair was
  });

  it('draws the standby generator and the ATS from the library', () => {
    const standby = host.querySelector('g.standby')!;
    expect(texts(standby)).toEqual(expect.arrayContaining(['G', '3~', '250 kVA']));
    expect(texts(standby)).not.toContain('ATS'); // no boxed ATS: the changeover symbol
    expect(standby.innerHTML).toMatch(/<path d="M -?[\d.]+ [\d.]+ V [\d.]+ M/); // two fixed contacts and the blade
  });

  it('draws the PFR, the instruments and the lamps from the library', () => {
    expect(texts(host)).toContain('PFR');
    const inst = [...host.querySelectorAll('g.instruments')];
    expect(inst.length).toBeGreaterThan(0);
    const t = texts(inst[0]);
    expect(t).toEqual(expect.arrayContaining(['A', 'V', 'S/S', 'R', 'Y', 'B']));
    expect(inst[0].querySelectorAll('circle[r="7"]')).toHaveLength(2); // ammeter and voltmeter
    expect(inst[0].querySelectorAll('circle[r="3"]')).toHaveLength(3); // three lamps
  });

  it('draws a feeder UVR as the library relay, and a separate RCCB as its toroid on the cable', () => {
    const wp = host.querySelector('[data-lv-id="feeder:MCC-WP"]')!;
    expect(texts(wp)).toContain('U<');
    expect(texts(wp)).not.toContain('UVR');
    const fp = host.querySelector('[data-lv-id="feeder:MCC-FP"]')!;
    expect(texts(fp)).toContain('RCCB'); // a separate RCCB after the breaker keeps its name box
    expect(fp.querySelectorAll('ellipse[rx="3"]')).toHaveLength(1); // library RCD toroid on the line
  });

  it('lists the same library symbols in the legend', () => {
    const entries = legendEntries(project);
    const keys = entries.map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(['tx', 'gen', 'ats', 'pfr', 'am', 'lamps', 'uvr', 'rcd']));
    const svg = (k: string) => renderToStaticMarkup(<svg>{entries.find((e) => e.key === k)!.draw(0, 0)}</svg>);
    expect(svg('gen')).toContain('>3~<');
    expect(svg('pfr')).toContain('>PFR<');
    expect(svg('uvr')).toContain('>U&lt;<');
    expect(svg('am')).toContain('>A<');
    expect(svg('am')).toContain('>V<');
    expect(svg('tx').match(/<circle/g)).toHaveLength(2);
    expect(svg('lamps')).toContain('<circle');
    expect(svg('ats')).not.toContain('<rect');
  });
});

describe('changeover incomers from the symbol library', () => {
  const brk = { ratingA: 1600, device: 'ACB' as const, drawOut: true };
  const svg = renderToStaticMarkup(
    <svg><ChangeoverIncomers x={100} genX={300} headY={0} busY={300} kva={500} mains={brk} generator={brk} instruments pmu={false} /></svg>
  );

  it('draws the generator, ammeters, voltmeters and lamps as library symbols', () => {
    expect(svg).toContain('>3~<');
    expect(svg.match(/<circle[^>]* r="7"/g)).toHaveLength(8); // 3 ammeters + 1 voltmeter per incomer
    expect(svg.match(/<circle[^>]* r="3"/g)).toHaveLength(6); // 3 lamps per incomer
  });
});
