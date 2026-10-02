import { cableTypeOf } from '../model/cableTypes';
import { boardLocation } from '../model/levels';
import { cableRefOf } from '../model/cableRefs';
import { evaluateFeeder, faultCurrentKA, impedanceToBoard, cableSizeText, runsOf } from '../calc/electrical';
import { breakerTypeOf, cpcOf } from '../calc/earthing';
import { boardSummary, boardsInSupplyOrder, loadTypeOf } from '../calc/summary';
import { BOARD_KINDS, LOAD_TYPES, type Feeder, type Project } from '../types';

export interface Schedule {
  headers: string[];
  rows: (string | number)[][];
  /** Rows that are sub-totals / section headers, for styling. */
  totalRows?: number[];
}

const n = (v: number, d = 0) => Number(v.toFixed(d));
const poles = (f: Feeder) => (f.cores === 2 ? 'SP+N' : f.cores === 3 ? 'TP' : 'TP+N');
const loadLabel = (f: Feeder) => LOAD_TYPES.find((t) => t.value === loadTypeOf(f))?.label ?? '';
const cableText = (p: Project, f: Feeder) => `${cableSizeText(f)} ${cableTypeOf(p, f).code} + ${runsOf(f) > 1 ? `${runsOf(f)} × ` : ''}${cpcOf(f)} mm² CPC`;

/** Accessories on a feeder as schedule text, e.g. "RCD 30 mA · CT kWh meter · local isolator". */
export function accessoriesText(f: Feeder): string {
  return [
    f.rcdMa ? `RCD ${f.rcdMa} mA` : '',
    f.kwhMeter ? (f.kwhMeter === 'CT' ? 'CT kWh meter' : `${f.kwhMeter} kWh meter`) : '',
    f.localIsolator ? 'local isolator' : '',
    f.capSteps && f.capSteps > 1 ? `${f.capSteps} steps` : '',
    f.detunedPct ? `${f.detunedPct}% detuned` : ''
  ].filter(Boolean).join(' · ');
}

/** DB (panel) schedule: one block per board with its circuits and a total. */
export function dbSchedule(project: Project, boardIds?: string[]): Schedule {
  const headers = [
    'Board', 'Cct', 'Circuit ID', 'Description', 'Load type', 'Connected (kW)', 'DF', 'Demand (kW)', 'PF',
    'Ib (A)', 'Breaker', 'Poles', 'Icu (kA)', 'Cable', 'Length (m)', 'Vd total (%)', 'Status', 'Accessories'
  ];
  const rows: Schedule['rows'] = [];
  const totalRows: number[] = [];
  for (const b of boardsInSupplyOrder(project).filter((b) => !boardIds || boardIds.includes(b.id))) {
    const feeders = project.feeders.filter((f) => f.boardId === b.id);
    feeders.forEach((f, i) => {
      const r = evaluateFeeder(project, f);
      rows.push([
        b.id, i + 1, f.id, f.name, f.feedsBoardId ? `Sub-board ${f.feedsBoardId}` : loadLabel(f),
        f.feedsBoardId ? '' : n(f.loadKw, 1), f.feedsBoardId ? '' : f.demandFactor,
        f.feedsBoardId ? '' : n(f.loadKw * f.demandFactor, 1), f.feedsBoardId ? '' : f.powerFactor, n(r.ib),
        `${f.breakerRatingA} A ${breakerTypeOf(f)}`, poles(f), f.breakerIcuKa, cableText(project, f), f.lengthM,
        n(r.vdTotalPct, 2), r.status === 'ok' ? 'Pass' : r.status === 'warn' ? 'Check' : 'Fail', accessoriesText(f)
      ]);
    });
    const s = boardSummary(project, b);
    totalRows.push(rows.length);
    rows.push([
      b.id, '', 'TOTAL', `${b.name}${b.ratedCurrentA ? ` — ${b.ratedCurrentA} A` : ''}`, '', n(s.connectedKw, 1), '',
      n(s.demandKw, 1), n(s.powerFactor, 2), n(s.currentA), '', '', n(s.faultKA, 1), '', '', '',
      s.loadingPct === undefined ? '' : `${s.loadingPct.toFixed(0)}% loaded`, b.spd ? `SPD ${b.spd}` : ''
    ]);
  }
  return { headers, rows, totalRows };
}

/** Cable schedule: every cable in the installation. */
export function cableSchedule(project: Project): Schedule {
  const headers = [
    'Cable tag', 'From', 'To', 'Ref', 'Type', 'Cores × size', 'CPC (mm²)', 'Length (m)', 'Tray route', 'Ib (A)', 'Breaker In (A)',
    'Iz (A)', 'Vd cable (%)', 'Vd total (%)', 'Status'
  ];
  const rows = boardsInSupplyOrder(project).flatMap((b) =>
    project.feeders
      .filter((f) => f.boardId === b.id)
      .map((f) => {
        const r = evaluateFeeder(project, f);
        return [
          `C-${f.id}`, f.boardId, f.feedsBoardId ?? f.name, (() => { const c = cableRefOf(project, f); return `${c.ref}${c.fireRated ? ' *' : ''}`; })(), cableTypeOf(project, f).label, cableSizeText(f),
          cpcOf(f), f.lengthM, f.trayRoute ?? '', n(r.ib), f.breakerRatingA, n(r.ampacity), n(r.vdPct, 2), n(r.vdTotalPct, 2),
          r.status === 'ok' ? 'Pass' : r.status === 'warn' ? 'Check' : 'Fail'
        ];
      })
  );
  return { headers, rows };
}

/** Equipment schedule: transformers and boards. */
export function equipmentSchedule(project: Project): Schedule {
  const headers = ['Tag', 'Description', 'Type', 'Rating', 'Fault level (kA)', 'Busbar', 'IP', 'Location', 'Manufacturer', 'Model', 'Fed from', 'Surge protection'];
  const rows: Schedule['rows'] = [];
  for (const b of boardsInSupplyOrder(project)) {
    if (!b.upstreamId && b.sourceKva) {
      rows.push([
        `TX-${b.id}`, `Transformer for ${b.id}`, 'Distribution transformer', `${b.sourceKva} kVA, ${b.sourceImpedancePct ?? '—'}% Z`,
        n(faultCurrentKA(impedanceToBoard(project, b.id), project.voltageV), 1), '', '', boardLocation(project, b), '', '', 'Utility 11 kV', ''
      ]);
    }
    const s = boardSummary(project, b);
    rows.push([
      b.id, b.name, BOARD_KINDS.find((k) => k.value === (b.kind ?? (b.upstreamId ? 'DB' : 'MDB')))?.label ?? '',
      b.ratedCurrentA ? `${b.ratedCurrentA} A` : '', n(s.faultKA, 1), b.busbarMaterial ?? '', b.ipRating ?? '',
      boardLocation(project, b), b.manufacturer ?? '', b.model ?? '', b.upstreamId ?? (b.sourceKva ? `TX-${b.id}` : ''), b.spd ? `SPD ${b.spd}` : ''
    ]);
  }
  return { headers, rows };
}
