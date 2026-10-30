// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SystemDiagram from './SystemDiagram';
import { sampleProject as p } from '../data/sampleProject';

const noop = () => {};
const clouds = (c: { boards: string[]; feeders?: string[]; rev: string }[]) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <SystemDiagram project={p} calcProject={p} results={[]} clouds={c} selectedFeederId={null} selectedBoardId={null} onSelectFeeder={noop} onSelectBoard={noop} />
  );
  return [...host.querySelectorAll('g.rev-cloud')].map((g) => ({ rev: g.querySelector('text')!.textContent, d: g.querySelector('path')!.getAttribute('d')! }));
};

describe('revision clouds on the SLD', () => {
  it('goes round one circuit, smaller than its panel\'s cloud', () => {
    const [panel, circuit] = clouds([{ boards: ['MDB-1'], rev: 'B' }, { boards: [], feeders: ['INC-MCC'], rev: 'B' }]);
    expect(circuit.rev).toBe('B');
    expect(circuit.d.length).toBeLessThan(panel.d.length); // fewer scallops
    expect(clouds([{ boards: [], feeders: ['no-such-circuit'], rev: 'B' }])).toEqual([]);
  });
});
