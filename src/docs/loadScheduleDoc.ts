import { evaluateFeeder, type Status } from '../calc/electrical';
import { boardLocation } from '../model/levels';
import { breakerTypeOf, cpcOf } from '../calc/earthing';
import { boardPhaseKw, circuitCategory, circuitRef, circuitWatts, elcbGroups, imbalancePct, minWireMm2, pointColumns, pointWattsFor, scheduleCircuits } from '../calc/loadSchedule';
import { incomerDeviceOf, type Board, type Feeder, type Project } from '../types';
import { polesOf } from '../calc/bom';
import { cableTypeOf } from '../model/cableTypes';
import { cableBuildText, feederBuild } from '../model/cableRefs';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Rows of the DEWA-style load distribution schedule for one DB, shared by
 * the PDF and the CSV export. */
/** The board's incomer device as named on the SLD: its own setting (default isolator for a DB, non-automatic MCCB above),
 * else the supplying feeder's breaker when the drawing hides the incomer. */
export function incomerDeviceText(board: Board, incomer: Feeder | undefined): string {
  const dev = incomerDeviceOf(board);
  if (dev === 'MCCB-NA') return 'MCCB (NA)';
  if (dev === 'ISOL') return 'ISOLATOR';
  return dev ?? (incomer ? breakerTypeOf(incomer) : '');
}

/** The incomer as printed: rating and device as on the SLD, poles from the feeder (SP+N for a 2-core supply, TP+N for 4-core). */
export function incomerLabel(board: Board, incomer: Feeder | undefined): string {
  if (!incomer) return board.ratedCurrentA ? `${board.ratedCurrentA} A ${incomerDeviceText(board, undefined)}`.trim() : '';
  return `${board.ratedCurrentA ?? incomer.breakerRatingA} A ${incomerDeviceText(board, incomer)} ${polesOf(incomer)}`;
}

/** The incoming cable as on the cable schedule: parallel runs, construction (fire-rated / LSZH) and ECC. */
export function incomerCableText(project: Project, incomer: Feeder | undefined): string {
  if (!incomer) return 'CABLE SIZE: —';
  const fr = cableTypeOf(project, incomer).fireRated ? ' (fire rated)' : '';
  return `CABLE SIZE: ${cableBuildText(feederBuild(project, incomer))}${fr}, ${incomer.lengthM} m`;
}

export function loadScheduleRows(project: Project, boardId: string) {
  const board = project.boards.find((b) => b.id === boardId)!;
  const circuits = scheduleCircuits(project, boardId);
  const incomer = project.feeders.find((f) => f.feedsBoardId === boardId && f.boardId === board.upstreamId);
  const groups = elcbGroups(project, board);
  const groupOf = new Map(groups.flatMap((g) => g.circuits.map((c) => [c.id, g] as const)));
  const rows = circuits.map((f, i) => {
    const w = circuitWatts(f, board) || 0; // an unknown point type counts as 0, never NaN
    const ph = { R: '', Y: '', B: '' } as Record<'R' | 'Y' | 'B', string | number>;
    if (f.phase === 'RYB') (['R', 'Y', 'B'] as const).forEach((p) => (ph[p] = Math.round(w / 3)));
    else if (f.phase) ph[f.phase] = Math.round(w);
    const calc = evaluateFeeder(project, f).status;
    const minWire = minWireMm2(project, f);
    // A hand-set wire below the type's minimum is flagged for checking.
    const belowMin = f.cableCsaMm2 < minWire;
    const status: Status = calc === 'bad' ? 'bad' : belowMin ? 'warn' : calc;
    return { f, sl: i + 1, ref: circuitRef(f)!, watts: w, ph, group: groupOf.get(f.id), category: circuitCategory(f), minWire, belowMin, status };
  });
  // Connected: the watts printed on the rows. Demand: after demand factors, with every outgoing way (sub-boards and equipment not on this schedule too).
  const connectedW = { R: 0, Y: 0, B: 0 };
  for (const r of rows) for (const ph of ['R', 'Y', 'B'] as const) connectedW[ph] += Number(r.ph[ph]) || 0;
  const scheduled = new Set(circuits.map((f) => f.id));
  const others = project.feeders.filter((f) => f.boardId === boardId && !scheduled.has(f.id));
  const phaseW = boardPhaseKw(project, boardId);
  return { board, incomer, groups, rows, phaseW, connectedW, others, imbalance: imbalancePct(phaseW) };
}

/** Print-ready HTML reproducing the DEWA "Load Distribution Schedule"
 * form for a 3-phase DB with R/Y/B circuit references. */
export function buildLoadScheduleHtml(project: Project, boardId: string): string {
  const { board, incomer, rows, phaseW, connectedW, others, imbalance } = loadScheduleRows(project, boardId);
  const watts = pointWattsFor(board);
  const columns = pointColumns(project, board);
  const pointCols = columns.map((t) => t.value);
  const incomerText = esc(incomerLabel(board, incomer));
  const kw = (v: number) => (v * 1000).toFixed(0);

  // ELCB cells span their group's rows.
  const elcbCell = (i: number) => {
    const g = rows[i].group;
    if (!g) return i === 0 ? `<td rowspan="${rows.length}"></td>` : '';
    if (rows.findIndex((r) => r.group === g) !== i) return '';
    return `<td class="v" rowspan="${rows.filter((r) => r.group === g).length}">ELCB-${g.index}<br>${esc(g.label)}</td>`;
  };

  const body = rows
    .map((r, i) => `<tr>
      ${i === 0 ? `<td class="v" rowspan="${rows.length}">${incomerText}</td>` : ''}
      ${elcbCell(i)}
      <td>${r.sl}</td><td><b>${r.ref}</b></td><td>${r.f.breakerRatingA}</td><td>${r.f.cableCsaMm2}</td><td>${cpcOf(r.f)}</td>
      <td class="l">${esc(r.f.room ?? r.f.name)}</td>
      ${pointCols.map((t) => `<td>${r.f.points?.[t] || ''}</td>`).join('')}
      <td>${r.ph.R}</td><td>${r.ph.Y}</td><td>${r.ph.B}</td>
      <td class="l">${esc(r.f.remarks ?? '')}${r.status !== 'ok' ? ` <span class="${r.status}">(${r.status === 'bad' ? 'fails check' : 'check'})</span>` : ''}</td>
    </tr>`)
    .join('');

  const cable = esc(incomerCableText(project, incomer));

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(board.id)} load schedule</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    body { font: 9px/1.3 Arial, "Segoe UI", sans-serif; color: #111; margin: 0; }
    .hdr { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 8px; margin-bottom: 6px; }
    .hdr p { margin: 2px 0; font-size: 10px; } .hdr h1 { margin: 0; font-size: 14px; text-align: center; text-decoration: underline; }
    .hdr .c { text-align: center; } .hdr .r { text-align: right; }
    table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #333; padding: 2px 3px; text-align: center; }
    thead { display: table-header-group; } tr { break-inside: avoid; }
    th { font-weight: 600; font-size: 8px; } th.rot { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; height: 58px; }
    td.l { text-align: left; } td.v { font-size: 8px; } .shade { background: #e4e4e4; }
    tr.total td { font-weight: 700; } .foot { margin-top: 6px; font-size: 9px; } .bad { color: #b00; } .warn { color: #a60; }
  </style></head><body>
  <div class="hdr">
    <div><p>PROJECT: VILLA / BUILDING: <b>${esc(project.name)}</b></p><p>DB No.: <b>${esc(board.id)}</b> — ${esc(board.name)}</p>
      <p>FED FROM: MDB / SMDB: <b>${esc(board.upstreamId ?? '—')}</b> / METER ENCLOSURE</p></div>
    <div class="c"><h1>LOAD DISTRIBUTION SCHEDULE</h1><p>( 3 - Phase, ${project.voltageV} V )</p></div>
    <div class="r"><p>LOCATION OF DB: <b>${esc(boardLocation(project, board))}</b></p></div>
  </div>
  <table>
    <thead>
      <tr>
        <th rowspan="2">RATING OF INCOMER</th><th rowspan="2">RATG. OF ELCB</th><th rowspan="2">SL. No.</th><th rowspan="2">CIR No.</th>
        <th rowspan="2">MCB RTG. IN AMPS</th><th rowspan="2">CCT WIRE SIZE mm²</th><th rowspan="2">ECC WIRE SIZE mm²</th><th rowspan="2">ROOM / AREA</th>
        <th colspan="${pointCols.length}">CONNECTED LOADS / POINTS</th>
        <th colspan="3" class="shade">LOAD PER CIRCUIT - WATT</th><th rowspan="2">REMARKS</th>
      </tr>
      <tr>
        ${columns.map((t) => `<th class="rot">${esc(t.label)}</th>`).join('')}
        <th class="shade">R</th><th class="shade">Y</th><th class="shade">B</th>
      </tr>
      <tr><td colspan="8" class="l"><b>WATT / UNIT</b></td>${pointCols.map((t) => `<td>${watts[t] || ''}</td>`).join('')}<td class="shade" colspan="3"></td><td></td></tr>
    </thead>
    <tbody>${body}
      <tr class="total"><td colspan="${8 + pointCols.length}" style="text-align:right">TOTAL CONNECTED LOAD (W) — the circuits above</td>
        <td class="shade">${connectedW.R.toFixed(0)}</td><td class="shade">${connectedW.Y.toFixed(0)}</td><td class="shade">${connectedW.B.toFixed(0)}</td>
        <td class="l">${(connectedW.R + connectedW.Y + connectedW.B).toFixed(0)} W</td></tr>
      <tr class="total"><td colspan="${8 + pointCols.length}" style="text-align:right">MAXIMUM DEMAND (W) — after demand factors${others.length ? `, incl. ${others.length} other way(s) not listed: ${esc(others.map((f) => f.feedsBoardId ?? f.id).join(', '))}` : ''}</td>
        <td class="shade">${kw(phaseW.R)}</td><td class="shade">${kw(phaseW.Y)}</td><td class="shade">${kw(phaseW.B)}</td>
        <td class="l">${kw(phaseW.R + phaseW.Y + phaseW.B)} W · imbalance ${imbalance.toFixed(0)} %</td></tr>
    </tbody>
  </table>
  <div class="foot">
    <p>${cable}</p>
    <p>C.FAN = Ceiling Fan, EX.FAN = Exhaust Fan, SH. S/O = Shaver Socket-outlet, W/H = Water Heater, H/D = Hand Dryer, 'W' = Window type &amp; 'S' = Split type.
      Circuit references: R/Y/B = phase, number = way; RYB = 3-phase circuit.</p>
  </div>
  </body></html>`;
}

/** Same schedule as CSV (Excel). */
export function loadScheduleCsv(project: Project, boardId: string): { headers: string[]; rows: (string | number)[][] } {
  const { board, rows, phaseW, connectedW, others } = loadScheduleRows(project, boardId);
  const watts = pointWattsFor(board);
  const columns = pointColumns(project, board);
  const pointCols = columns.map((t) => t.value);
  const headers = ['ELCB', 'Sl. No.', 'Cir No.', 'MCB (A)', 'CCT wire (mm²)', 'ECC wire (mm²)', 'Room / area', ...columns.map((t) => t.label), 'R (W)', 'Y (W)', 'B (W)', 'Remarks'];
  const out: (string | number)[][] = [['', '', '', '', '', '', 'WATT / UNIT', ...pointCols.map((t) => watts[t]), '', '', '', '']];
  for (const r of rows) {
    out.push([
      r.group ? `ELCB-${r.group.index} ${r.group.label}` : '', r.sl, r.ref, r.f.breakerRatingA, r.f.cableCsaMm2, cpcOf(r.f), r.f.room ?? '',
      ...pointCols.map((t) => r.f.points?.[t] ?? ''), r.ph.R, r.ph.Y, r.ph.B, r.f.remarks ?? ''
    ]);
  }
  out.push(['', '', '', '', '', '', 'TOTAL CONNECTED', ...pointCols.map(() => ''), Math.round(connectedW.R), Math.round(connectedW.Y), Math.round(connectedW.B), 'circuits above']);
  out.push(['', '', '', '', '', '', 'MAXIMUM DEMAND', ...pointCols.map(() => ''), Math.round(phaseW.R * 1000), Math.round(phaseW.Y * 1000), Math.round(phaseW.B * 1000),
    `after demand factors${others.length ? `; incl. ${others.length} other way(s) not listed` : ''}`]);
  return { headers, rows: out };
}
