/** Main screens of the app, shared by the left menu and the ribbon. */
export type MainView =
  | 'projects' | 'help' | 'parameters' | 'titleblock' | 'dashboard' | 'building' | 'design' | 'space-planning' | 'substation-area' | 'enclosure' | 'earth-schematic' | 'panels' | 'load-schedule'
  | 'calculators' | 'voltage-drop' | 'earthing' | 'selection' | 'coordination' | 'sizing' | 'pfc' | 'busbar' | 'ups' | 'solar' | 'engines'
  | 'drawings' | 'drawing-register' | 'db-schedule' | 'cable-schedule' | 'cable-tray' | 'equipment' | 'study-reports' | 'boq' | 'report' | 'revisions' | 'modifications' | 'review' | 'database';

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
  ['boq', 'Bill of quantities (BOQ)'],
  ['study-reports', 'Study reports (submission)'],
  ['report', 'Calculation report (PDF)'],
  ['drawings', 'Drawings (SLD sheets & register)'],
  ['revisions', 'Revisions']
];
