import { it } from 'vitest';
import os from 'node:os';
import { network, type Shape } from '../fixtures/networks';
import { evaluateProject } from '../../src/calc/electrical';
import { evaluateEarthingAll } from '../../src/calc/earthing';
import { evaluateSelectivity } from '../../src/calc/protection';
import { runCalculations } from '../../src/calc/runs';

/** Calculation benchmark: the built-in engine only — no UI, drawing, storage
 * or export. Per case: one warm-up, then repeated timed runs (5, or 2 when a
 * run takes over 5 s); median and slowest reported. A size is skipped once
 * the same shape has taken longer than BENCH_LIMIT_S (default 120 s) for one
 * run. Sizes: BENCH_SIZES (default 100,500,1000). Results are a measurement
 * of this machine, not a supported project limit. */
const SIZES = (process.env.BENCH_SIZES ?? '100,500,1000').split(',').map(Number);
const LIMIT_MS = Number(process.env.BENCH_LIMIT_S ?? 120) * 1000;
const STEPS = {
  'feeder checks': (p: ReturnType<typeof network>) => evaluateProject(p),
  earthing: (p: ReturnType<typeof network>) => evaluateEarthingAll(p),
  discrimination: (p: ReturnType<typeof network>) => evaluateSelectivity(p),
  'full run (F5)': (p: ReturnType<typeof network>) => runCalculations(p)
};
const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)} s` : `${x.toFixed(1)} ms`);

it('calculation benchmark', () => {
  const lines = [`Machine: ${os.cpus()[0]?.model} · ${os.cpus().length} cores · Node ${process.version} · ${new Date().toISOString()}`, ''];
  for (const shape of ['shallow', 'deep'] as Shape[]) {
    let tooSlow = false;
    for (const n of SIZES) {
      const p = network(n, shape);
      const head = `${shape.padEnd(7)} ${String(n).padStart(4)} boards ${String(p.feeders.length).padStart(5)} feeders`;
      if (tooSlow) { lines.push(`${head}  skipped (a smaller size took over ${LIMIT_MS / 1000} s)`); continue; }
      const parts: string[] = [];
      for (const [name, step] of Object.entries(STEPS)) {
        const warm = performance.now(); step({ ...p }); const first = performance.now() - warm;
        if (first > LIMIT_MS) { parts.push(`${name} ${ms(first)} (1 run)`); tooSlow = true; continue; }
        const runs = first > 5000 ? 2 : 5, t: number[] = [];
        for (let r = 0; r < runs; r++) { const s = performance.now(); step({ ...p }); t.push(performance.now() - s); }
        t.sort((a, b) => a - b);
        parts.push(`${name} ${ms(t[Math.floor((t.length - 1) / 2)])} (max ${ms(t[t.length - 1])}, ${runs} runs)`);
      }
      lines.push(`${head}  ${parts.join(' · ')}`);
    }
  }
  process.stdout.write(`\n${lines.join('\n')}\n\n`);
});
