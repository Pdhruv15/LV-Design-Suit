import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SingleLineDiagram from './SingleLineDiagram';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject } from '../calc/electrical';

/** The Board view draws each circuit's library symbol just above its card. */
const results = evaluateProject(sampleProject);
const view = (boardId: string) => {
  const board = sampleProject.boards.find((b) => b.id === boardId)!;
  return renderToStaticMarkup(
    <SingleLineDiagram board={board} project={sampleProject} results={results.filter((r) => r.feeder.boardId === boardId)} selected={null} onSelect={() => {}} />
  );
};

describe('Board view symbols', () => {
  it('draws a load symbol above each load card (SMDB-FF)', () => {
    const svg = view('SMDB-FF');
    expect(svg).toContain('>IT</text>'); // FF-IT: IT / data equipment box
    expect(svg).toContain('>L</text>'); // FF-LAB: other load
    expect(svg.match(/<g class="iec">/g)!.length).toBeGreaterThanOrEqual(8); // a breaker and a symbol per circuit
  });

  it('draws the board\'s panel symbol above a way that feeds a board (SMDB-GF → DB-GF1)', () => {
    expect(view('SMDB-GF')).toContain('>DB</text>');
  });

  it('draws motors on an MCC as the motor symbol, the fire pump marked FP, at load size', () => {
    const svg = view('MCC-1');
    expect(svg).toContain('>3~</text>');
    expect(svg).toContain('>FP</text>');
    expect(svg).toMatch(/<circle cx="[\d.]+" cy="252" r="12.25"/); // big enough for M and 3~ inside
  });

  it('ends a way to a board in its panel symbol, with a card for the board name, TCL and MDL', () => {
    const svg = view('SMDB-GF');
    expect(svg).toMatch(/<rect x="[\d.]+" y="238" width="24.5" height="28"/); // DB symbol at load size
    expect(svg).toContain('>DB-GF1</text>');
    expect(svg).toMatch(/>TCL [\d.]+ kW</);
    expect(svg).toMatch(/>MDL [\d.]+ kW · \d+ A</);
    expect(svg).not.toContain('→ DB-GF1');
  });

  it('keeps the incomer breaker clear of the busbar, with a run of line below it', () => {
    const svg = view('SMDB-FF');
    expect(svg).toMatch(/<line x1="([\d.]+)" y1="86" x2="\1" y2="118"/);
  });
});
