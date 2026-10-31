// @vitest-environment jsdom
import { it } from 'vitest';
import os from 'node:os';
import v8 from 'node:v8';
import vm from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { network } from '../fixtures/networks';
import SystemDiagram from '../../src/components/SystemDiagram';
import { boardSummary } from '../../src/calc/summary';
import { evaluateProject } from '../../src/calc/electrical';
import { runCalculations, staleStudies } from '../../src/calc/runs';
import { buildAnnotations } from '../../src/diagram/annotations';
import { layoutSystem } from '../../src/diagram/layout';
import { buildReportHtml } from '../../src/docs/calcReport';
import { cableSchedule } from '../../src/docs/schedules';
import { withCableRefs } from '../../src/model/cableRefs';
import { withEarthPitIds } from '../../src/model/earthingPlan';
import { MAX_STEPS, record, reset } from '../../src/model/history';
import type { Project } from '../../src/types';

/** What one edit costs around the calculations, and what the outputs cost: the work calc.perf.ts does not see.
 * Each timed run gets a new edited project object, as a real edit does, so nothing is reused from the run before.
 * Sizes: BENCH_SIZES (default 100,500,1000). A step is skipped at the larger sizes once it has taken longer than
 * BENCH_LIMIT_S (default 30 s) for one run. Results are a measurement of this machine, not a supported project limit. */
const SIZES = (process.env.BENCH_SIZES ?? '100,500,1000').split(',').map(Number);
const LIMIT_MS = Number(process.env.BENCH_LIMIT_S ?? 30) * 1000;

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
const heap = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
const mb = (x: number) => `${(Math.max(0, x) / 1048576).toFixed(1)} MB`;
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${x.toFixed(1)} ms`);

/** The project after one edit: one circuit changed, everything else the same objects. */
const edit = (p: Project, i: number): Project => {
  const id = p.feeders[(i * 37) % p.feeders.length].id;
  return { ...p, feeders: p.feeders.map((f) => (f.id === id ? { ...f, loadKw: f.loadKw + 0.1 } : f)) };
};
const noop = () => {};
const sld = (p: Project) => renderToStaticMarkup(createElement(SystemDiagram, {
  project: p, calcProject: p, results: evaluateProject(p), selectedFeederId: null, selectedBoardId: null, onSelectFeeder: noop, onSelectBoard: noop, onDrawing: noop
}));

const STEPS: [string, (p: Project) => unknown][] = [
  ['numbering', (p) => withCableRefs(withEarthPitIds(p, p))],
  ['diagram labels', (p) => buildAnnotations(p, evaluateProject(p))],
  ['board summaries', (p) => p.boards.map((b) => boardSummary(p, b))],
  ['SLD layout', (p) => layoutSystem(p)],
  ['cable schedule', (p) => cableSchedule(p)],
  ['calculation report', (p) => buildReportHtml(p)],
  ['whole SLD', (p) => sld(p)],
  ['whole SLD, cable reference labels', (p) => sld({ ...p, drawing: { ...p.drawing, cableLabels: 'ref' } })]
];

it('edit and output benchmark', () => {
  const lines = [`Machine: ${os.cpus()[0]?.model} · ${os.cpus().length} cores · Node ${process.version} · ${new Date().toISOString()}`, ''];
  const tooSlow = new Set<string>();
  for (const n of SIZES) {
    const base = withCableRefs(withEarthPitIds(network(n, 'shallow')));
    const run = runCalculations(base);
    lines.push(`${n} boards, ${base.feeders.length} circuits, project ${(JSON.stringify(base).length / 1048576).toFixed(2)} MB`);
    for (const [name, step] of STEPS) {
      if (tooSlow.has(name)) { lines.push(`  ${name}: skipped (a smaller size took over ${LIMIT_MS / 1000} s)`); continue; }
      const first = performance.now(); step(edit(base, 1)); const once = performance.now() - first;
      if (once > LIMIT_MS) { tooSlow.add(name); lines.push(`  ${name}: ${ms(once)} (1 run)`); continue; }
      const runs = once > 5000 ? 1 : 5, t: number[] = [once];
      for (let r = 2; r <= runs; r++) { const p = edit(base, r); const s = performance.now(); step(p); t.push(performance.now() - s); }
      t.sort((a, b) => a - b);
      lines.push(`  ${name}: ${ms(t[Math.floor((t.length - 1) / 2)])}`);
    }
    const stale = edit(base, 2), s = performance.now(); staleStudies(run, stale);
    lines.push(`  stale check: ${ms(performance.now() - s)}`);
    // Memory the undo history keeps: every step's project, with what the screens read after that edit.
    let p = base, h = reset(p);
    const oneEdit = (i: number) => {
      p = withEarthPitIds(edit(p, i + 3), p);
      h = record(h, p, i * 1000);
      buildAnnotations(p, run.results);
      for (const b of p.boards) boardSummary(p, b);
    };
    for (let i = 0; i < 8; i++) oneEdit(i); // the indexes of the steps above have gone: what follows is the undo history alone
    h = reset(p);
    const h0 = heap();
    for (let i = 0; i < MAX_STEPS; i++) oneEdit(i);
    lines.push(`  memory kept by ${h.past.length} undo steps: ${mb(heap() - h0)}`);
    lines.push('');
  }
  process.stdout.write(`\n${lines.join('\n')}\n`);
}, 3_600_000);
