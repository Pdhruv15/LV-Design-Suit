// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SystemDiagram from '../../components/SystemDiagram';
import { evaluateProject } from '../electrical';
import { boardSummary, boardsInSupplyOrder } from '../summary';
import { runCalculations, staleStudies } from '../runs';
import { buildAnnotations } from '../../diagram/annotations';
import { layoutSystem } from '../../diagram/layout';
import { buildReportHtml } from '../../docs/calcReport';
import { panelSummary } from '../../docs/mdSheet';
import { cableSchedule } from '../../docs/schedules';
import { withCableRefs } from '../../model/cableRefs';
import { withEarthPitIds } from '../../model/earthingPlan';
import { network } from '../../../tests/fixtures/networks';
import type { Project } from '../../types';

/** Work as a count, so these limits hold on any computer: every read of a field of a board or circuit. */
function counted(p: Project) {
  let reads = 0;
  const watch = <T extends object>(x: T): T => new Proxy(x, { get(t, k, r) { reads++; return Reflect.get(t, k, r); } });
  return { project: { ...p, boards: p.boards.map(watch), feeders: p.feeders.map(watch) }, reads: () => reads };
}

const SMALL = 20, LARGE = 80;
/** How much the work grows when the project grows four times: 4 is in step with the project, 16 is a scan inside a scan. */
function growth(step: (p: Project) => unknown): number {
  const work = (n: number) => {
    const c = counted(withCableRefs(withEarthPitIds(network(n, 'shallow'))));
    const before = c.reads();
    step(c.project);
    return c.reads() - before;
  };
  return work(LARGE) / work(SMALL);
}

const noop = () => {};
const sld = (p: Project, labels: 'ref' | 'auto') => {
  const drawn = { ...p, drawing: { ...p.drawing, cableLabels: labels } };
  return renderToStaticMarkup(<SystemDiagram project={drawn} calcProject={drawn} results={evaluateProject(drawn)} selectedFeederId={null} selectedBoardId={null} onSelectFeeder={noop} onSelectBoard={noop} onDrawing={noop} />);
};

const LIMIT = 6;
const TIMEOUT = 300_000; // a scan inside a scan can take a while before it fails on its count

describe('work grows in step with the project', () => {
  const steps: [string, (p: Project) => unknown][] = [
    ['earth pit and cable numbering after an edit', (p) => withCableRefs(withEarthPitIds({ ...p }))],
    ['the stale check after an edit', (p) => staleStudies(runCalculations(p), { ...p })],
    ['diagram labels', (p) => buildAnnotations(p, evaluateProject(p))],
    ['board summaries for the panel tree', (p) => p.boards.map((b) => boardSummary(p, b))],
    ['panel summaries on the SLD', (p) => p.boards.map((b) => panelSummary(p, b))],
    ['supply order', (p) => boardsInSupplyOrder(p)],
    ['SLD layout', (p) => layoutSystem(p)],
    ['cable schedule', (p) => cableSchedule(p)],
    ['calculation report', (p) => buildReportHtml(p)],
    ['whole SLD with cable reference labels', (p) => sld(p, 'ref')],
    ['whole SLD', (p) => sld(p, 'auto')]
  ];
  for (const [name, step] of steps) it(name, () => expect(growth(step)).toBeLessThan(LIMIT), TIMEOUT);
});
