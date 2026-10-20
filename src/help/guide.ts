import type { Project } from '../types';
import { staleStudies } from '../calc/runs';
import type { CalcRun, StudyKey } from '../calc/runs';
import { isScheduleCircuit } from '../calc/loadSchedule';
import type { MainView } from '../views';

/** The in-app guide: the project workflow step by step, quick paths for one
 * job only, and a "start here" checklist that ticks itself from the project. */

export interface GuideStep { n: number; phase: 'Setup' | 'Design' | 'Check' | 'Deliver'; title: string; where: string; what: string; go: MainView | 'settings' }

/** The stage each phase stands for (the ribbon's numbered tabs). */
export const PHASE_LABEL: Record<GuideStep['phase'], string> = { Setup: '1 Concept', Design: '2 Schematic', Check: '3 Detailed design', Deliver: '4 Tender and IFC' };

export const WORKFLOW: GuideStep[] = [
  { n: 1, phase: 'Setup', title: 'New project and building', where: 'Project → New; 1 Concept → Building', what: 'A new project starts at the Concept stage. Owner, plot, voltage; buildings, levels, rooms, GFA.', go: 'building' },
  { n: 2, phase: 'Setup', title: 'Load assessment and supply', where: '1 Concept → Load assessment, Tx & Gen sizing, Substation area', what: 'Total load from area and building type → transformers, generator, room sizes → Issue concept.', go: 'load-assessment' },
  { n: 3, phase: 'Design', title: 'Main boards and risers', where: '2 Schematic → Build hierarchy, SLD, Busbar riser', what: 'MDB / SMDB with their ratings, risers, main cables from rough lengths.', go: 'panels' },
  { n: 4, phase: 'Design', title: 'Main systems', where: '2 Schematic → Power factor, UPS, Solar PV, Earth pits', what: 'Capacitor banks, back-up and earthing concept → Issue schematic.', go: 'pfc' },
  { n: 5, phase: 'Check', title: 'DBs and circuits', where: '3 Detailed design → SLD, Schedule', what: 'Every DB’s circuits from the MEP layouts, spare ways, R / Y / B balance.', go: 'design' },
  { n: 6, phase: 'Check', title: 'Calculate and fix', where: 'Run (F5) → Overview to-do; Selection, Voltage drop, Earthing, Protection', what: 'Click each item, fix it, run again until nothing fails → Issue detailed design.', go: 'dashboard' },
  { n: 7, phase: 'Deliver', title: 'Documents', where: 'Documents → schedules, Drawings, Study reports', what: 'Load schedules, drawing set (status follows the stage), study and calculation reports.', go: 'drawings' },
  { n: 8, phase: 'Deliver', title: 'Tender and IFC', where: '4 Tender and IFC → Issue for tender / Issue IFC, Submissions', what: 'Close comments and tender queries, re-run, freeze and issue the IFC package.', go: 'revisions' }
];

export interface QuickPath { task: string; where: string; steps: string; go: MainView }
export const QUICK_PATHS: QuickPath[] = [
  { task: 'A quick number (amps, kW ↔ kVA, cable, voltage drop, lux)', where: '3 Detailed design → More → Quick calcs', steps: 'Type values — instant; nothing changes in the project.', go: 'calculators' },
  { task: 'One DB load schedule', where: 'Documents → Load schedule', steps: 'Click the DB in the tree → enter circuits → Export PDF / Excel.', go: 'load-schedule' },
  { task: 'DEWA forms (MD, TCL summary, bus riser)', where: 'Documents → Load schedule → tabs', steps: 'Check the details → Submission pack (Excel).', go: 'load-schedule' },
  { task: 'Short circuit (or any study) for chosen MDBs', where: 'Documents → Study reports', steps: 'Tick boards → tick studies → Export PDF.', go: 'study-reports' },
  { task: 'Transformer / generator size', where: '1 Concept → Tx & Gen sizing', steps: 'Tick MDBs and the generator boards → Apply to SLD.', go: 'sizing' },
  { task: 'Power factor correction', where: '2 Schematic → Power factor', steps: 'Central / Group / Individual → Add to SLD → PDF sheet.', go: 'pfc' },
  { task: 'Busbar riser (high-rise)', where: '2 Schematic → Busbar riser', steps: 'Floors or “Take floors from …” → Cu / Al → PDF.', go: 'busbar' },
  { task: 'Cable tray size', where: 'Documents → Cable trays', steps: 'Route path per cable (A-B-C) → tray size and BOQ.', go: 'cable-tray' },
  { task: 'UPS or solar PV', where: '2 Schematic → UPS & battery / Solar PV', steps: 'Loads or roof → size → PDF.', go: 'ups' },
  { task: 'Substation room size (DM)', where: '1 Concept → Substation area', steps: 'Number and size of transformers → minimum room area.', go: 'substation-area' },
  { task: 'Voltage drop / earthing check', where: '3 Detailed design → the study', steps: 'Run (F5) → click a board in the tree to filter.', go: 'earthing' },
  { task: 'Project at a glance / client summary', where: 'Project → Overview', steps: 'Numbers, charts, to-do → 1-page PDF.', go: 'dashboard' }
];

export interface ChecklistItem { id: string; label: string; done: boolean; go: MainView | 'settings' }

/** Start-here checklist, ticked from what the project already has. */
export function startChecklist(p: Project, run?: CalcRun, stale: StudyKey[] = [], saved = false): ChecklistItem[] {
  stale = [...new Set([...stale, ...staleStudies(run, p)])];
  const i = p.info ?? {};
  const failing = !run || stale.length > 0 || run.results.some(r => r.status === 'bad') || run.earthing.some(r => r.status === 'bad') || run.selectivity.some(r => r.status === 'bad');
  return [
    { id: 'details', label: 'Project details: owner, plot, consultant', done: !!(i.owner && i.plotNo && i.consultant), go: 'settings' },
    { id: 'building', label: 'Building: levels and area (GFA)', done: !!p.building?.buildings.length || !!i.builtUpAreaM2, go: 'building' },
    { id: 'tx', label: 'Transformer set on the main board', done: p.boards.some((b) => !b.upstreamId && b.sourceKva), go: 'design' },
    { id: 'boards', label: 'Boards on the SLD (SMDBs / DBs)', done: p.boards.length > 1, go: 'design' },
    { id: 'loads', label: 'Loads or DB load schedules entered', done: p.feeders.some((f) => isScheduleCircuit(f)) || p.feeders.filter((f) => !f.feedsBoardId).length >= 3, go: 'load-schedule' },
    { id: 'run', label: 'Calculations run and up to date', done: !!run && !stale.length, go: 'dashboard' },
    { id: 'pass', label: 'No failing circuits', done: !!run && !failing, go: 'selection' },
    { id: 'saved', label: 'Saved (Ctrl+S)', done: saved, go: 'projects' },
    { id: 'rev', label: 'Revision issued (Rev A)', done: !!p.revisions?.length, go: 'revisions' }
  ];
}
