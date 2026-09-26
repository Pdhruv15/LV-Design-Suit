import { evaluateProject } from '../calc/electrical';
import type { CalcEngine } from './types';

/** The in-app TypeScript engine (src/calc). Always available. */
export const builtinEngine: CalcEngine = {
  id: 'builtin',
  name: 'Built-in (IEC hand-calc)',
  isAvailable: async () => true,
  run: async (project) => ({
    engineId: 'builtin',
    feeders: Object.fromEntries(
      evaluateProject(project).map((r) => [
        r.feeder.id,
        { ib: r.ib, vdTotalPct: r.vdTotalPct, breakerFaultKA: r.breakerFaultKA, endFaultKA: r.endFaultKA }
      ])
    ),
    messages: []
  })
};

export const ENGINES: CalcEngine[] = [builtinEngine];
