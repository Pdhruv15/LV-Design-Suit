/** Main screens of the app, shared by the left menu and the ribbon. */
export type MainView =
  | 'design' | 'load-schedule'
  | 'voltage-drop' | 'earthing' | 'selection' | 'coordination' | 'sizing' | 'pfc' | 'engines'
  | 'db-schedule' | 'cable-schedule' | 'equipment' | 'boq' | 'report' | 'database';

export const STUDIES: [MainView, string][] = [
  ['voltage-drop', 'Voltage drop'],
  ['engines', 'Load flow (engines)'],
  ['earthing', 'Earthing'],
  ['coordination', 'Protection coordination'],
  ['selection', 'Breaker & cable selection'],
  ['sizing', 'Transformer & generator'],
  ['pfc', 'Power factor correction']
];

export const DOCUMENTS: [MainView, string][] = [
  ['db-schedule', 'DB schedule'],
  ['cable-schedule', 'Cable schedule'],
  ['equipment', 'Equipment schedule'],
  ['boq', 'Cost estimate (BOQ)'],
  ['report', 'Calculation report (PDF)']
];
