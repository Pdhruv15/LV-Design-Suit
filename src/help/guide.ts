import type { Project } from '../types';
import type { CalcRun, StudyKey } from '../calc/runs';
import { isScheduleCircuit } from '../calc/loadSchedule';
import type { MainView } from '../views';

/** The in-app guide: the project workflow step by step, quick paths for one
 * job only, and a "start here" checklist that ticks itself from the project. */

export interface GuideStep { n: number; phase: 'Setup' | 'Design' | 'Check' | 'Deliver'; title: string; where: string; what: string; go: MainView | 'settings' }

export const WORKFLOW: GuideStep[] = [
  { n: 1, phase: 'Setup', title: 'New project', where: 'Home → New', what: 'Name it; your profile’s defaults and details fill in.', go: 'projects' },
  { n: 2, phase: 'Setup', title: 'Project details and building', where: 'Home → Project settings, Building', what: 'Owner, plot, consultant, voltage; buildings, levels, rooms, GFA.', go: 'building' },
  { n: 3, phase: 'Design', title: 'Space plan (optional)', where: 'Design → Space plan', what: 'Areas × W/m² → panels and transformers → Create SLD.', go: 'space-planning' },
  { n: 4, phase: 'Design', title: 'Single line diagram', where: 'Design → SLD', what: 'Transformer and MDB, then drag boards, loads and presets from the palette.', go: 'design' },
  { n: 5, phase: 'Design', title: 'Load schedules', where: 'Reports → Load schedule', what: 'Each DB’s circuits — click the DB in the panel tree.', go: 'load-schedule' },
  { n: 6, phase: 'Check', title: 'Run and fix', where: 'Run (F5) → Dashboard to-do', what: 'Click each item, fix it, run again until nothing fails.', go: 'dashboard' },
  { n: 7, phase: 'Check', title: 'Sizing studies', where: 'Calculate → Transformer / Gen, Power factor, Busbar riser', what: 'Size, Apply to SLD, run again.', go: 'sizing' },
  { n: 8, phase: 'Deliver', title: 'Issue and submit', where: 'Reports → Revisions, Study reports, Load schedule', what: 'Issue Rev A, then the submission pack (Excel) and study reports (PDF).', go: 'revisions' }
];

export interface QuickPath { task: string; where: string; steps: string; go: MainView }
export const QUICK_PATHS: QuickPath[] = [
  { task: 'A quick number (amps, kW ↔ kVA, cable, voltage drop)', where: 'Calculate → Quick calcs', steps: 'Type values — instant; nothing changes in the project.', go: 'calculators' },
  { task: 'One DB load schedule', where: 'Reports → Load schedule', steps: 'Click the DB in the tree → enter circuits → Export PDF / Excel.', go: 'load-schedule' },
  { task: 'DEWA forms (MD, TCL summary, bus riser)', where: 'Reports → Load schedule → tabs', steps: 'Check the details → Submission pack (Excel).', go: 'load-schedule' },
  { task: 'Short circuit (or any study) for chosen MDBs', where: 'Reports → Study reports', steps: 'Tick boards → tick studies → Export PDF.', go: 'study-reports' },
  { task: 'Transformer / generator size', where: 'Calculate → Transformer / Gen', steps: 'Tick MDBs and the generator boards → Apply to SLD.', go: 'sizing' },
  { task: 'Power factor correction', where: 'Calculate → Power factor', steps: 'Central / Group / Individual → Add to SLD → PDF sheet.', go: 'pfc' },
  { task: 'Busbar riser (high-rise)', where: 'Calculate → Busbar riser', steps: 'Floors or “Take floors from …” → Cu / Al → PDF.', go: 'busbar' },
  { task: 'Cable tray size', where: 'Reports → Cable trays', steps: 'Route path per cable (A-B-C) → tray size and BOQ.', go: 'cable-tray' },
  { task: 'UPS or solar PV', where: 'Calculate → UPS & battery / Solar PV', steps: 'Loads or roof → size → PDF.', go: 'ups' },
  { task: 'Substation room size (DM)', where: 'Design → Substation area', steps: 'Number and size of transformers → minimum room area.', go: 'substation-area' },
  { task: 'Voltage drop / earthing check', where: 'Calculate → the study', steps: 'Run (F5) → click a board in the tree to filter.', go: 'earthing' },
  { task: 'Project at a glance / client summary', where: 'Home → Dashboard', steps: 'Numbers, charts, to-do → 1-page PDF.', go: 'dashboard' }
];

export interface ChecklistItem { id: string; label: string; done: boolean; go: MainView | 'settings' }

/** Start-here checklist, ticked from what the project already has. */
export function startChecklist(p: Project, run?: CalcRun, stale: StudyKey[] = [], saved = false): ChecklistItem[] {
  const i = p.info ?? {};
  const failing = run?.results.some((r) => r.status === 'bad') ?? true;
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
