import type { PointType } from '../types';

/** A regular load for the LV Database (Loads.xlsx). */
export interface StandardLoad {
  reference: string;
  name: string;
  column: PointType; // the load schedule column it is counted in
  category: string;
  watts: number;
  pf?: number;
  phases?: 1 | 3;
}

/** Note written with every standard row, so it stays clear in Loads.xlsx that the figure is a starting value. */
export const STANDARD_NOTE = 'Standard set — typical value, verify';

/** A starting set of regular loads, one or more per load schedule column. The watts are TYPICAL DRAFT VALUES for
 * the engineer to review and change before they are added (the user's decision, 2026-10-21); SS1 and TS1 are the
 * user's own figures (2026-10-16). Items whose reference or name is already in the library are never added. */
export const STANDARD_LOADS: StandardLoad[] = [
  // Lighting
  { reference: 'L1', name: 'LED downlight', column: 'ltg', category: 'Lighting', watts: 12, pf: 0.9 },
  { reference: 'L2', name: 'LED panel 600 × 600', column: 'ltg', category: 'Lighting', watts: 36, pf: 0.9 },
  { reference: 'L3', name: 'LED batten 1200 mm', column: 'ltg', category: 'Lighting', watts: 18, pf: 0.9 },
  { reference: 'L4', name: 'LED wall light', column: 'ltg', category: 'Lighting', watts: 10, pf: 0.9 },
  { reference: 'L5', name: 'LED external / garden light', column: 'ltg', category: 'Lighting', watts: 20, pf: 0.9 },
  { reference: 'EM1', name: 'Emergency / exit light', column: 'ltg', category: 'Lighting', watts: 5, pf: 0.9 },
  // Fans
  { reference: 'CF1', name: 'Ceiling fan', column: 'cfan', category: 'Fans', watts: 75, pf: 0.85 },
  { reference: 'EF1', name: 'Exhaust fan', column: 'exfan', category: 'Fans', watts: 40, pf: 0.8 },
  // Socket-outlets and outlets
  { reference: 'SS1', name: '13A single socket-outlet', column: 's13', category: 'Socket-outlets', watts: 200 },
  { reference: 'TS1', name: '13A twin socket-outlet', column: 's13t', category: 'Socket-outlets', watts: 400 },
  { reference: 'SS15', name: '15A socket-outlet', column: 's15', category: 'Socket-outlets', watts: 1000 },
  { reference: 'SH1', name: 'Shaver socket-outlet', column: 'shaver', category: 'Socket-outlets', watts: 20 },
  { reference: 'FS1', name: 'Fused spur outlet', column: 'spur', category: 'Socket-outlets', watts: 500 },
  // Kitchen, bathroom
  { reference: 'WH1', name: 'Water heater', column: 'wh', category: 'Water heating', watts: 3000, pf: 1 },
  { reference: 'CK1', name: 'Cooker', column: 'cooker', category: 'Kitchen', watts: 6000, pf: 1 },
  { reference: 'HD1', name: 'Hand dryer', column: 'hd', category: 'Bathroom', watts: 1800, pf: 1 },
  // Air conditioning
  { reference: 'AC1', name: 'Split A/C 1.5 TR', column: 'sac', category: 'Air conditioning', watts: 1900, pf: 0.85 },
  { reference: 'AC2', name: 'Split A/C 2.0 TR', column: 'sac', category: 'Air conditioning', watts: 2500, pf: 0.85 },
  { reference: 'WAC1', name: 'Window A/C 1.5 TR', column: 'wac', category: 'Air conditioning', watts: 2200, pf: 0.85 },
  { reference: 'FCU1', name: 'Fan coil unit', column: 'fcu', category: 'Air conditioning', watts: 200, pf: 0.85 },
  // Pumps
  { reference: 'WP1', name: 'Water pump 1 HP', column: 'pump', category: 'Pumps', watts: 1000, pf: 0.8 }
];
