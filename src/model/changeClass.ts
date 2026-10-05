import type { Board, Feeder, Project } from '../types';

/** What kind of change an edit is, so "has the design changed?" can be answered honestly:
 *  - engineering: values the calculations and equipment selection depend on
 *  - drawing: names, labels, sheets, title blocks, schedules' presentation, documents
 *  - commercial: BOQ lines and rates — pricing never changes the electrical baseline
 *  - admin: project details (owner, plot, status, brief, notes)
 *  - bookkeeping: identifiers, dates and numbers the app assigns by itself (never shown as a change)
 *
 * The three tables below list EVERY persisted field of the project, boards and circuits. They are typed
 * as complete records, so adding a field to the model without classifying it here fails the type check. */
export type ChangeClass = 'engineering' | 'drawing' | 'commercial' | 'admin' | 'bookkeeping';

export const CLASS_LABEL: Record<ChangeClass, string> = {
  engineering: 'Engineering', drawing: 'Drawings and documents', commercial: 'Commercial (BOQ, rates)', admin: 'Project details', bookkeeping: 'Automatic bookkeeping'
};

const E = 'engineering', D = 'drawing', C = 'commercial', A = 'admin', B = 'bookkeeping';

export const FEEDER_CLASS: Record<keyof Feeder, ChangeClass> = {
  id: E, boardId: E, name: D, loadKw: E, demandFactor: E, powerFactor: E, lengthM: E, cableCsaMm2: E, parallel: E, cores: E, breakerRatingA: E, breakerIcuKa: E,
  generation: E, loadType: E, breakerType: E, breakerImMultiple: E, cpcMm2: E, componentId: E, componentValues: E, standbyUnit: E, fromRoom: D, essential: E, phase: E, way: E,
  room: D, points: E, remarks: D, manualSize: E, starter: E, kvar: E, device: E, cableType: E, kwhMeter: E, circuitPurpose: E, rcdMa: E, localIsolator: E, capSteps: E,
  detunedPct: E, trayRoute: E, lengthToCheck: B, sizingPending: B, feedsBoardId: E
};

export const BOARD_CLASS: Record<keyof Board, ChangeClass> = {
  id: E, name: D, upstreamId: E, sourceKva: E, sourceImpedancePct: E, sourceXr: E, vectorGroup: E, kind: E, ratedCurrentA: E, busbarMaterial: E, ipRating: E, location: D, level: D,
  manufacturer: E, model: E, standby: E, protection: E, instruments: D, earthing: D, rmu: E, upsKva: E, spd: E, supply: E, generated: B, enclosure: E, substation: E, mdDemandFactor: E,
  txRef: D, summaryLoad: E, summaryMeters: E, pointWatts: E, pointItems: D, spareNames: D, elcbGroupSize: E, elcbRatingA: E, elcbSensitivityMa: E
};

export const PROJECT_CLASS: Record<keyof Project, ChangeClass> = {
  id: B, schemaVersion: B, createdAt: B, archivedAt: A, tags: A, notes: A, brief: A, origin: B, name: A, voltageV: E, frequencyHz: E, ambientC: E, vdLimitPct: E,
  strictFinalDisconnection: E, panelPrefixes: D, vdTempC: E, vdFinalCircuits: E, vdSelection: A, pointTemplate: D, info: A, revisions: B, drawing: D, ties: E, earthingPlan: E,
  earthPitIds: B, spacePlan: E, upsSystems: E, feederPresets: A, pv: E, trays: E, substations: E, studyReport: D, studyReportPresets: A, calc: A, studySettings: E, params: D,
  titleTemplates: D, drawingSet: D, cableRefs: B, components: E, building: E, boq: C, priceList: C, pfcCalc: E, containmentCalc: E, busRisers: E, busbarData: E, txGen: E, pfc: E,
  status: A, createdBy: B, updatedBy: B, boards: E, feeders: E, updatedAt: B
};

/** Project header details that are engineering inputs although the rest of `info` is administrative. */
export const INFO_ENGINEERING: (keyof NonNullable<Project['info']>)[] = ['mdDemandFactor', 'builtUpAreaM2'];

/** Whether a change of this class means "the design changed since the baseline" (commercial and admin do not). */
export const DESIGN_CLASSES: ChangeClass[] = ['engineering', 'drawing'];
