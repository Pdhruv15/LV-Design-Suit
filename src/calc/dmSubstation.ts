import type { DmSubstationRoom, Project } from '../types';

/** Dubai Municipality form DM-D-013: minimum area required for the
 * electrical substation (transformer room) and the LV room, by substation
 * type and number of transformers. Values (m) from the DM workbook
 * "Minimum Area Required for Transformer and LV Room"; texts translated
 * from Arabic. */

export type DmSubstationType = 'conventional' | 'detached-ground' | 'detached-basement' | 'pocket' | 'conventional-open';

export const DM_TYPES: { value: DmSubstationType; label: string; arabic: string; maxTransformers: number }[] = [
  { value: 'conventional', label: 'Conventional substation', arabic: 'المحطة الكهربائية الاعتيادية', maxTransformers: 15 },
  { value: 'detached-ground', label: 'Detached substation — ground floor', arabic: 'المحطة الفرعية المنفصلة - الأرضي', maxTransformers: 15 },
  { value: 'detached-basement', label: 'Detached substation — basement', arabic: 'المحطة الفرعية المنفصلة - السرداب', maxTransformers: 15 },
  { value: 'pocket', label: 'Detached substation — POCKET type', arabic: 'المحطة الفرعية المنفصلة من نوع POCKET', maxTransformers: 2 },
  { value: 'conventional-open', label: 'Conventional substation (open roof)', arabic: 'المحطة الكهربائية الاعتيادية (مفتوحة السقف)', maxTransformers: 1 }
];
export const dmType = (t: DmSubstationType) => DM_TYPES.find((x) => x.value === t)!;

type LW = [number, number]; // length × width (m)

// Conventional substation: substation (RMU + transformers) and LV room, for 1–15 transformers.
const CONVENTIONAL: { sub: LW; lv: LW }[] = [
  { sub: [7, 4.57], lv: [7, 3.25] }, { sub: [8.85, 6.1], lv: [8.85, 4.6] }, { sub: [12.78, 6.1], lv: [12.78, 4.6] },
  { sub: [18.5, 6.1], lv: [18.5, 4.6] }, { sub: [22.6, 6.1], lv: [22.6, 4.6] }, { sub: [26.7, 6.1], lv: [26.7, 4.6] },
  { sub: [30.8, 6.1], lv: [30.8, 4.6] }, { sub: [34.9, 6.1], lv: [34.9, 4.6] }, { sub: [39, 6.1], lv: [39, 4.6] },
  { sub: [43.1, 6.1], lv: [43.1, 4.6] }, { sub: [47.2, 6.1], lv: [47.2, 4.6] }, { sub: [51.3, 6.1], lv: [51.3, 4.6] },
  { sub: [55.4, 6.1], lv: [55.4, 4.6] }, { sub: [59.5, 6.1], lv: [59.5, 4.6] }, { sub: [63.6, 6.1], lv: [63.6, 4.6] }
];

// Detached substation (ground floor / basement): transformer room, RMU room and LV room, for 1–15 transformers.
const DETACHED: { tx: LW; rmu: LW; lv: LW }[] = [
  { tx: [4.57, 4.6], rmu: [3.05, 3.05], lv: [5.1, 4.6] }, { tx: [6.9, 6.1], rmu: [3.05, 3.05], lv: [6.9, 4.6] },
  { tx: [10.32, 6.1], rmu: [5.3, 3.05], lv: [10.32, 4.6] }, { tx: [13.77, 6.1], rmu: [8.6, 3.05], lv: [13.77, 4.6] },
  { tx: [17.2, 6.1], rmu: [11, 3.05], lv: [17.2, 4.6] }, { tx: [20.7, 6.1], rmu: [11, 3.05], lv: [20.7, 4.6] },
  { tx: [24.1, 6.1], rmu: [13.3, 3.05], lv: [24.1, 4.6] }, { tx: [27.55, 6.1], rmu: [13.3, 3.05], lv: [27.55, 4.6] },
  { tx: [30.98, 6.1], rmu: [15.76, 3.05], lv: [30.98, 4.6] }, { tx: [34.4, 6.1], rmu: [15.76, 3.05], lv: [34.4, 4.6] },
  { tx: [37.87, 6.1], rmu: [18.1, 3.05], lv: [37.87, 4.6] }, { tx: [41.31, 6.1], rmu: [18.1, 3.05], lv: [41.31, 4.6] },
  { tx: [44.75, 6.1], rmu: [20.4, 3.05], lv: [44.75, 4.6] }, { tx: [48.2, 6.1], rmu: [20.4, 3.05], lv: [48.2, 4.6] },
  { tx: [51.64, 6.1], rmu: [22.7, 3.05], lv: [51.64, 4.6] }
];

// POCKET type: transformer room, 1–2 transformers. Open roof: substation, 1 transformer.
const POCKET: LW[] = [[3.7, 4.57], [6.1, 6.1]];
const OPEN_ROOF: LW[] = [[6.1, 6.1]];

/** Notes and conditions of the form (translated). */
export const DM_NOTES = {
  checkedSubLv: 'Only the minimum required areas of the electrical substation and the LV electrical room, and their locations, have been checked. The consultant / contractor must comply with all other DEWA requirements for door size, ventilation, levels, trench depth, etc.',
  sikka: 'If the substation is located on a sikka (lane), the minimum width of the sikka shall not be less than 6.1 m; a width of 3.05 m is allowed if the substation is not more than 12 m from the main road, as per DEWA requirements.',
  columns: 'If there are structural columns inside the substation room, or the sides of the room are irregular, final approval of the room area must be obtained from DEWA.',
  basement: 'For a detached basement substation, DEWA approval of the substation location and area and of the vehicle ramp details must be obtained before casting the foundations.',
  checkedSubLvRmu: 'Only the minimum required areas of the electrical substation, the LV electrical room and the RMU room, and their locations, have been checked. The consultant / contractor must comply with all other DEWA requirements for door size, ventilation, levels, trench depth, etc.',
  openToSky: 'Open-to-sky space is required.',
  lvAdjacent: 'The LV distribution board must be adjacent to the transformer room.',
  drainageBelow: 'There shall be no sewage or rainwater drainage points directly above the transformer or electrical rooms, and no enclosed rooms below them (if any).',
  drainage: 'There shall be no sewage or rainwater drainage points directly above the transformer or electrical rooms.'
};

/** Which notes the form lists for each type (in the form's order). */
const NOTES_BY_TYPE: Record<DmSubstationType, (keyof typeof DM_NOTES)[]> = {
  conventional: ['checkedSubLv', 'sikka', 'columns', 'drainageBelow'],
  'detached-ground': ['checkedSubLvRmu', 'columns', 'drainageBelow'],
  'detached-basement': ['basement', 'drainage'],
  pocket: ['openToSky'],
  'conventional-open': ['lvAdjacent']
};

export const DM_UNDERTAKING = 'I, the consultant / contractor submitting this application, undertake to comply with the required areas of the electrical substation as per DEWA requirements, together with the other requirements for door size, ventilation, levels and all other requirements.';
export const DM_TITLE = 'Minimum Required Size of the Electrical Substation and LV Electrical Room';

export interface DmRoom {
  key: 'substation' | 'transformer' | 'rmu' | 'lv';
  label: string;
  lengthM: number;
  widthM: number;
  heightM?: number;
  areaM2: number;
  /** What the width means on the form. */
  widthNote: string;
}

export interface DmResult {
  type: DmSubstationType;
  transformers: number;
  rooms: DmRoom[];
  totalAreaM2: number;
  notes: string[];
  error?: string;
}

const room = (key: DmRoom['key'], label: string, [l, w]: LW, widthNote: string, heightM?: number): DmRoom => ({
  key, label, lengthM: l, widthM: w, heightM, areaM2: Math.round(l * w * 100) / 100, widthNote
});

const FRONT = 'minimum width of the front entrance facing the street / sikka';

/** Minimum room sizes for a substation type and number of transformers. */
export function dmSubstationAreas(type: DmSubstationType, transformers: number): DmResult {
  const n = Math.round(transformers);
  const t = dmType(type);
  const notes = NOTES_BY_TYPE[type].map((k) => DM_NOTES[k]);
  const fail = (error: string): DmResult => ({ type, transformers: n, rooms: [], totalAreaM2: 0, notes, error });
  if (!(n >= 1)) return fail('Enter the number of transformers (1 or more).');
  if (n > t.maxTransformers) {
    return fail(t.maxTransformers === 1 ? 'Not allowed: more than one transformer for this type.' : t.maxTransformers === 2 ? 'Not allowed: more than two transformers for this type.' : `The form covers up to ${t.maxTransformers} transformers.`);
  }
  let rooms: DmRoom[];
  if (type === 'conventional') {
    const r = CONVENTIONAL[n - 1];
    rooms = [
      room('substation', 'Substation (RMU and transformers)', r.sub, FRONT, 3.7),
      room('lv', 'LV electrical room', r.lv, 'minimum width, adjacent to the transformer room')
    ];
  } else if (type === 'detached-ground' || type === 'detached-basement') {
    const r = DETACHED[n - 1];
    rooms = [
      room('transformer', 'Transformer room', r.tx, type === 'detached-ground' ? 'minimum width' : FRONT, 3.7),
      room('rmu', 'Ring main unit (RMU) room', r.rmu, 'minimum width, on the plot boundary', 3.05),
      room('lv', 'LV electrical room', r.lv, 'minimum width, adjacent to the transformer room')
    ];
  } else if (type === 'pocket') {
    rooms = [room('transformer', 'Transformer room', POCKET[n - 1], FRONT)];
  } else {
    rooms = [room('substation', 'Substation', OPEN_ROOF[n - 1], FRONT)];
  }
  return { type, transformers: n, rooms, totalAreaM2: Math.round(rooms.reduce((a, r) => a + r.areaM2, 0) * 100) / 100, notes };
}

// ---- From the project ------------------------------------------------------

let seq = 0;
const newId = () => `ss-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** One substation per RMU, with its transformers: from the space plan when it
 * has transformers, otherwise from the SLD's main boards (grouped by their
 * RMU; a main board without an RMU is its own substation). */
export function substationsFromProject(project: Project, type: DmSubstationType = 'conventional'): { rooms: DmSubstationRoom[]; source: 'space plan' | 'SLD' | 'none' } {
  const plan = project.spacePlan;
  const groups = new Map<string, { kvas: number[]; buildings: Set<string> }>();
  const add = (key: string, kva: number, building?: string) => {
    const g = groups.get(key) ?? { kvas: [], buildings: new Set<string>() };
    g.kvas.push(kva);
    if (building) g.buildings.add(building);
    groups.set(key, g);
  };
  let source: 'space plan' | 'SLD' | 'none' = 'none';
  if (plan?.transformers.length) {
    source = 'space plan';
    for (const t of plan.transformers) {
      const buildings = plan.panels.filter((p) => p.transformer === t.id).map((p) => p.building).filter(Boolean);
      add(t.rmu ?? `Substation ${t.id}`, t.kva, buildings[0]);
    }
  } else {
    const mains = project.boards.filter((b) => !b.upstreamId && b.sourceKva);
    if (mains.length) source = 'SLD';
    for (const b of mains) add(b.rmu ?? `Substation ${b.id}`, b.sourceKva!, b.location);
  }
  const rooms = [...groups.entries()].map(([name, g]) => {
    const max = Math.max(...g.kvas);
    return {
      id: newId(), name, transformers: g.kvas.length,
      type: g.kvas.length > dmType(type).maxTransformers ? 'conventional' : type,
      kva: max, building: [...g.buildings].join(', ') || undefined
    } satisfies DmSubstationRoom;
  });
  return { rooms, source };
}
