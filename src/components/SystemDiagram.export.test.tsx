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

describe('SLD library symbols', () => {
  it('draws the starter, RCBO, kWh / CT and PMU from the model', () => {
    const motor = sampleProject.feeders.find((f) => !f.feedsBoardId && (f.loadType === 'motor' || f.loadType === 'fire-pump'))!;
    const project = {
      ...sampleProject,
      boards: sampleProject.boards.map((b) => ({ ...b, pmu: true })),
      feeders: sampleProject.feeders.map((f) => (f.id === motor.id ? { ...f, starter: 'VFD' as const, rcdMa: 30, kwhMeter: 'CT' as const } : f))
    };
    const html = renderToStaticMarkup(
      <SystemDiagram project={project} calcProject={project} results={evaluateProject(project)}
        selectedFeederId={null} selectedBoardId={null} onSelectFeeder={noop} onSelectBoard={noop} onDrawing={noop} />
    );
    const host = document.createElement('div');
    host.innerHTML = html;
    const g = host.querySelector(`[data-lv-id="feeder:${motor.id}"]`)!;
    const texts = [...g.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(['f1', 'f2', 'kWh'])); // VFD symbol and kWh meter
    expect(texts).not.toContain('VFD'); // no boxed starter label in IEC style
    expect(texts).not.toContain('ELCB'); // the RCBO symbol carries it
    expect(g.querySelectorAll('ellipse').length).toBe(1); // RCBO toroid
  });
});
