import { exportDss } from './opendss/exportDss';
import type { CalcEngine, EngineProbe, StudyResults } from './types';
import type { Project } from '../types';
import { cables } from '../calc/cableTable';
import { resistanceFactor } from '../calc/electrical';

/** The cable data the app is using (Cables.xlsx or the reference table) and
 * the resistance factor for the project's conductor temperature: sent with
 * every engine run so the comparison uses exactly the same data. */
export const engineCableData = (project: Project) => ({
  cables: cables().map((c) => [c.csaMm2, c.rOhmPerKm20C, c.xOhmPerKm, c.ampacityA] as [number, number, number, number]),
  rFactor: resistanceFactor(project.vdTempC)
});

const hasBridge = () => typeof window !== 'undefined' && !!window.lvds?.engines;

let probeCache: Promise<EngineProbe | { error: string }> | null = null;

/** Asks the Python helper which engines are installed. Cached until
 * `refresh` is set (e.g. after the user picks a different Python). */
export function probeEngines(refresh = false): Promise<EngineProbe | { error: string }> {
  if (!hasBridge()) return Promise.resolve({ error: 'External engines are only available in the desktop app.' });
  if (!probeCache || refresh) probeCache = window.lvds.engines.probe();
  return probeCache;
}

function pythonEngine(id: string, name: string, buildRequest: (p: Project) => { engine: string; project: Project; dss?: string; cables?: [number, number, number, number][]; rFactor?: number }): CalcEngine {
  return {
    id,
    name,
    async isAvailable() {
      const probe = await probeEngines();
      return !('error' in probe) && !!probe.engines[id]?.available;
    },
    async run(project): Promise<StudyResults> {
      if (!hasBridge()) throw new Error('External engines are only available in the desktop app.');
      const res = await window.lvds.engines.run(buildRequest(project));
      if ('error' in res) throw new Error(res.error);
      return res;
    }
  };
}

/** OpenDSS via OpenDSSDirect.py: runs the same script as the .dss export. */
export const openDssEngine = pythonEngine('opendss', 'OpenDSS', (project) => ({
  engine: 'opendss',
  project,
  dss: exportDss(project).script
}));

/** pandapower: Newton-Raphson load flow + IEC 60909 short circuit. */
export const pandapowerEngine = pythonEngine('pandapower', 'pandapower (IEC 60909)', (project) => ({
  engine: 'pandapower',
  project,
  ...engineCableData(project)
}));
