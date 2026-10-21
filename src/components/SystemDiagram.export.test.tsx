// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SystemDiagram from './SystemDiagram';
import { sampleProject } from '../data/sampleProject';
import { evaluateProject } from '../calc/electrical';

const noop = () => {};

describe('SLD export lookup', () => {
  it('finds the drawing, not a toolbar icon, with the selector the exports use', () => {
    const html = renderToStaticMarkup(
      <SystemDiagram project={sampleProject} calcProject={sampleProject} results={evaluateProject(sampleProject)}
        selectedFeederId={null} selectedBoardId={null} onSelectFeeder={noop} onSelectBoard={noop} onDrawing={noop} />
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelectorAll('.sysdiag-tools svg').length).toBeGreaterThan(0); // the toolbar has icons…
    const svg = host.querySelector<SVGSVGElement>('.sysdiag > svg'); // …and the exports still get the drawing
    expect(svg?.dataset.w).toBeTruthy();
    expect(svg?.closest('.sysdiag-tools')).toBeNull();
    // The old lookup ('.sysdiag svg') would pick the first toolbar icon: keep the child selector.
    expect(host.querySelector('.sysdiag svg')?.closest('.sysdiag-tools')).not.toBeNull();
  });
});
