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

  it('draws motors on an MCC as the motor symbol, the fire pump marked FP', () => {
    const svg = view('MCC-1');
    expect(svg).toContain('>3~</text>');
    expect(svg).toContain('>FP</text>');
  });
});
