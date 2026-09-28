/** Main screens of the app, shared by the left menu and the ribbon. */
export type MainView =
  | 'design' | 'space-planning' | 'substation-area' | 'load-schedule'
  | 'calculators' | 'voltage-drop' | 'earthing' | 'selection' | 'coordination' | 'sizing' | 'pfc' | 'ups' | 'solar' | 'engines'
  | 'db-schedule' | 'cable-schedule' | 'cable-tray' | 'equipment' | 'study-reports' | 'boq' | 'report' | 'revisions' | 'database';

export const STUDIES: [MainView, string][] = [
  ['voltage-drop', 'Voltage drop'],
  ['engines', 'Load flow (engines)'],
  ['earthing', 'Earthing'],
  ['coordination', 'Protection coordination'],
  ['selection', 'Breaker & cable selection'],
  ['sizing', 'Transformer & generator'],
  ['pfc', 'Power factor correction'],
  ['ups', 'UPS & battery'],
  ['solar', 'Solar PV']
];

export const DOCUMENTS: [MainView, string][] = [
  ['db-schedule', 'DB schedule'],
  ['cable-schedule', 'Cable schedule'],
  ['cable-tray', 'Cable tray schedule'],
  ['equipment', 'Equipment schedule'],
  ['boq', 'Cost estimate (BOQ)'],
  ['study-reports', 'Study reports (submission)'],
  ['report', 'Calculation report (PDF)'],
  ['revisions', 'Revisions']
];
