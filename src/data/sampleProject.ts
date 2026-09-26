import type { Project } from '../types';

// Cables and breakers in this sample were sized with the app's own engine
// (breaker In >= 1.25 x Ib, total voltage drop <= 80 % of the limit), so
// every check passes. Edit a feeder to see the checks respond.
export const sampleProject: Project = {
  name: 'Villa Complex 415V LV Network',
  voltageV: 415,
  frequencyHz: 50,
  ambientC: 45,
  vdLimitPct: 4,
  boards: [
    { id: 'MDB-1', name: 'Main Distribution Board', kind: 'MDB', sourceKva: 1000, sourceImpedancePct: 5, ratedCurrentA: 1600, busbarMaterial: 'copper', ipRating: 'IP42', location: 'Main building – ground floor', manufacturer: 'Schneider Electric', model: 'PrismaSeT P' },
    { id: 'SMDB-GF', name: 'Ground floor SMDB', kind: 'SMDB', upstreamId: 'MDB-1', ratedCurrentA: 400, busbarMaterial: 'copper', ipRating: 'IP42', location: 'Ground floor electrical room' },
    { id: 'SMDB-FF', name: 'First floor SMDB', kind: 'SMDB', upstreamId: 'MDB-1', ratedCurrentA: 250, busbarMaterial: 'copper', ipRating: 'IP42', location: 'First floor electrical room' },
    { id: 'MCC-1', name: 'Pump room MCC', kind: 'MCC', upstreamId: 'MDB-1', ratedCurrentA: 400, busbarMaterial: 'copper', ipRating: 'IP54', location: 'Basement pump room' }
  ],
  feeders: [
    { id: 'INC-GF', boardId: 'MDB-1', name: 'Incomer to Ground floor SMDB', loadKw: 0, demandFactor: 1, powerFactor: 0.85, lengthM: 35, cableCsaMm2: 240, cores: 4, breakerRatingA: 400, breakerIcuKa: 36, feedsBoardId: 'SMDB-GF' },
    { id: 'INC-FF', boardId: 'MDB-1', name: 'Incomer to First floor SMDB', loadKw: 0, demandFactor: 1, powerFactor: 0.85, lengthM: 55, cableCsaMm2: 95, cores: 4, breakerRatingA: 200, breakerIcuKa: 36, feedsBoardId: 'SMDB-FF' },
    { id: 'INC-MCC', boardId: 'MDB-1', name: 'Incomer to Pump room MCC', loadKw: 0, demandFactor: 1, powerFactor: 0.85, lengthM: 40, cableCsaMm2: 150, cores: 4, breakerRatingA: 315, breakerIcuKa: 36, feedsBoardId: 'MCC-1' },
    { id: 'DB-EV', boardId: 'MDB-1', name: 'EV charging – parking', loadKw: 44, demandFactor: 0.7, powerFactor: 0.98, lengthM: 60, cableCsaMm2: 10, cores: 4, breakerRatingA: 63, breakerIcuKa: 36, loadType: 'ev' },
    { id: 'DB-PV', boardId: 'MDB-1', name: 'Solar PV inverter', loadKw: 50, demandFactor: 1, powerFactor: 1, lengthM: 30, cableCsaMm2: 25, cores: 4, breakerRatingA: 100, breakerIcuKa: 36, loadType: 'pv', generation: true },
    { id: 'GF-LTG', boardId: 'SMDB-GF', name: 'Lighting', loadKw: 45, demandFactor: 0.9, powerFactor: 0.9, lengthM: 30, cableCsaMm2: 16, cores: 4, breakerRatingA: 80, breakerIcuKa: 25, loadType: 'lighting' },
    { id: 'GF-SKT', boardId: 'SMDB-GF', name: 'Sockets', loadKw: 28, demandFactor: 0.6, powerFactor: 0.85, lengthM: 35, cableCsaMm2: 4, cores: 4, breakerRatingA: 40, breakerIcuKa: 25, loadType: 'sockets' },
    { id: 'GF-HVAC', boardId: 'SMDB-GF', name: 'HVAC', loadKw: 120, demandFactor: 0.9, powerFactor: 0.85, lengthM: 40, cableCsaMm2: 95, cores: 4, breakerRatingA: 250, breakerIcuKa: 25, loadType: 'hvac' },
    { id: 'FF-OFF', boardId: 'SMDB-FF', name: 'Office', loadKw: 35, demandFactor: 0.8, powerFactor: 0.9, lengthM: 25, cableCsaMm2: 10, cores: 4, breakerRatingA: 63, breakerIcuKa: 25, loadType: 'sockets' },
    { id: 'FF-IT', boardId: 'SMDB-FF', name: 'IT room', loadKw: 20, demandFactor: 1, powerFactor: 0.95, lengthM: 20, cableCsaMm2: 4, cores: 4, breakerRatingA: 40, breakerIcuKa: 25, loadType: 'it' },
    { id: 'FF-LAB', boardId: 'SMDB-FF', name: 'Lab', loadKw: 50, demandFactor: 0.7, powerFactor: 0.85, lengthM: 30, cableCsaMm2: 16, cores: 4, breakerRatingA: 80, breakerIcuKa: 25, loadType: 'general' },
    { id: 'FF-LTG', boardId: 'SMDB-FF', name: 'Corridor lighting', loadKw: 4, demandFactor: 1, powerFactor: 0.9, lengthM: 35, cableCsaMm2: 6, cores: 2, breakerRatingA: 25, breakerIcuKa: 25, loadType: 'lighting' },
    { id: 'MCC-WP', boardId: 'MCC-1', name: 'Water pump', loadKw: 75, demandFactor: 1, powerFactor: 0.86, lengthM: 20, cableCsaMm2: 50, cores: 4, breakerRatingA: 160, breakerIcuKa: 25, loadType: 'motor' },
    { id: 'MCC-FP', boardId: 'MCC-1', name: 'Fire pump', loadKw: 55, demandFactor: 1, powerFactor: 0.86, lengthM: 25, cableCsaMm2: 35, cores: 4, breakerRatingA: 125, breakerIcuKa: 25, loadType: 'fire-pump' }
  ],
  updatedAt: new Date().toISOString()
};
