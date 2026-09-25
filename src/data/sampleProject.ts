import type { Project } from '../types';

export const sampleProject: Project = {
  name: 'Villa Complex 415V LV Network',
  voltageV: 415,
  frequencyHz: 50,
  ambientC: 45,
  vdLimitPct: 4,
  boards: [{ id: 'MDB-1', name: 'Main Distribution Board', sourceKva: 1000, sourceImpedancePct: 5 }],
  feeders: [
    { id: 'SMDB-GF', boardId: 'MDB-1', name: 'Ground floor SMDB', loadKw: 205, demandFactor: 0.8, powerFactor: 0.85, lengthM: 42, cableCsaMm2: 185, cores: 4, breakerRatingA: 400, breakerIcuKa: 36 },
    { id: 'SMDB-FF', boardId: 'MDB-1', name: 'First floor SMDB', loadKw: 138, demandFactor: 0.78, powerFactor: 0.85, lengthM: 55, cableCsaMm2: 120, cores: 4, breakerRatingA: 250, breakerIcuKa: 36 },
    { id: 'DB-AC', boardId: 'MDB-1', name: 'HVAC distribution board', loadKw: 310, demandFactor: 0.92, powerFactor: 0.85, lengthM: 68, cableCsaMm2: 300, cores: 4, breakerRatingA: 500, breakerIcuKa: 50 },
    { id: 'DB-EM', boardId: 'MDB-1', name: 'Emergency board (ATS)', loadKw: 96, demandFactor: 0.81, powerFactor: 0.85, lengthM: 25, cableCsaMm2: 120, cores: 4, breakerRatingA: 250, breakerIcuKa: 36 },
    { id: 'DB-PV', boardId: 'MDB-1', name: 'Solar PV inverter board', loadKw: 50, demandFactor: 1, powerFactor: 0.95, lengthM: 30, cableCsaMm2: 70, cores: 4, breakerRatingA: 160, breakerIcuKa: 25, generation: true }
  ],
  updatedAt: new Date().toISOString()
};
