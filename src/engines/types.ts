import type { Project } from '../types';

/** Per-feeder values an engine can report. Every field is optional because
 * external engines (OpenDSS, pandapower, ...) won't all compute the same
 * things — the comparison view shows whatever each engine returns. */
export interface EngineFeederResult {
  ib?: number; // A
  vdTotalPct?: number; // source to cable end, %
  breakerFaultKA?: number; // 3-phase fault at the supply busbar
  endFaultKA?: number; // 3-phase fault at the far end of the cable
}

export interface StudyResults {
  engineId: string;
  feeders: Record<string, EngineFeederResult>;
  messages: string[]; // warnings/notes from the engine
}

/** A calculation engine that can run a full study on a project. The
 * built-in TypeScript engine is synchronous under the hood; external
 * engines will run in the Electron main process and answer over IPC. */
export interface CalcEngine {
  id: string;
  name: string;
  isAvailable(): Promise<boolean>;
  run(project: Project): Promise<StudyResults>;
}
