import { cableTypeOf } from '../model/cableTypes';
import { STATUS_TEXT } from '../calc/statusText';
import { boardLocation } from '../model/levels';
import { cableRefOf } from '../model/cableRefs';
import { evaluateFeeder, faultCurrentKA, impedanceToBoard, cableSizeText } from '../calc/electrical';
import { cpcOf } from '../calc/earthing';
import { boardSummary, boardsInSupplyOrder } from '../calc/summary';
import { BOARD_KINDS, type Project } from '../types';

export interface Schedule {
  headers: string[];
  rows: (string | number)[][];
  /** Rows that are sub-totals / section headers, for styling. */
  totalRows?: number[];
}

const n = (v: number, d = 0) => (Number.isFinite(v) ? Number(v.toFixed(d)) : '—');
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
          STATUS_TEXT[r.status]
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
