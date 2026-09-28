import { useMemo, useRef, useState } from 'react';
import { Plus, Scale, Trash2, Zap } from 'lucide-react';
import type { Board, Phase, PointType, Project } from '../../types';
import { cables } from '../../calc/cableTable';
import { defaultCpcMm2 } from '../../calc/earthing';
import { breakerRatings } from '../../calc/sizing';
import { missingWatts, pointColumns, pointLabel, pointWattsFor, isScheduleCircuit } from '../../calc/loadSchedule';
import { settingsOf } from '../../types';
import { loadsForColumn, type Database } from '../../database/database';
import { buildLoadScheduleHtml, loadScheduleCsv, loadScheduleRows } from '../../docs/loadScheduleDoc';
import { addCircuit, balancePhases, deleteCircuit, refreshBoard, updateCircuit, type CircuitPatch } from '../../model/schedule';
import { saveBinary, saveCsv, savePdf, safeFileName } from '../../util/files';
import { buildFormWorkbook, workbookBytes, type WorkbookScope } from '../../docs/formWorkbook';
import { Page, STATUS_LABEL } from '../ui';
import { applySheetEdits, buildDbSheet } from '../../docs/dbSheet';
import { cellKey } from '../grid/excelGrid';
import { useExcelGrid } from '../grid/useExcelGrid';
import MdSheetView from './MdSheetView';
import { hasMdSheet } from '../../docs/mdSheet';

const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.round(+v) || 0));

/** DEWA-style load distribution schedule for a 3-phase DB, editable in
 * place. It edits the same project data as the SLD, so changes show on
 * the diagram and in every study immediately (and vice versa). */
export default function LoadScheduleView({
  project,
  boardId,
  db,
  onBoard,
  onChange,
  onStatus,
  onSettings
}: {
  project: Project;
  boardId: string;
  db: Database;
  onBoard: (id: string) => void;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
  onSettings: () => void;
}) {
  const board = project.boards.find((b) => b.id === boardId) ?? project.boards[0];
  const data = useMemo(() => loadScheduleRows(project, board.id), [project, board.id]);
  const watts = pointWattsFor(board);
  const otherFeeders = project.feeders.filter((f) => f.boardId === board.id && !isScheduleCircuit(f));
  const missing = missingWatts(project, board);
  const settings = settingsOf(project);
  const columns = pointColumns(project, board);
  // Excel-style keys, paste, selection, copy and fill down on the table:
  // cells are addressed like the DB sheet model (row 0 = WATT / UNIT), and
  // multi-cell changes go through its checks.
  const dbs = useMemo(() => buildDbSheet(project, board.id), [project, board.id]);
  const rowOf = useMemo(() => new Map(dbs.rows.map((r, y) => [r.type === 'circuit' ? r.feeder.id : r.type === 'watts' ? '__watts' : '', y])), [dbs]);
  const colOf = (key: string) => dbs.sheetCols.findIndex((c) => c.key === key);
  const cell = (feederId: string, key: string) => cellKey(rowOf.get(feederId) ?? -1, colOf(key));
  const grid = useRef<HTMLDivElement>(null);
  useExcelGrid(grid, (edits) => {
    const { project: next, rejected } = applySheetEdits(project, dbs, edits);
    if (next !== project) onChange(next);
    if (rejected.length) onStatus(`Not applied — ${rejected.slice(0, 3).join('; ')}${rejected.length > 3 ? ` (+${rejected.length - 3} more)` : ''}`);
  });
  // Which form: the DB load distribution schedule, or the connected load &
  // maximum demand form (boards with outgoing feeders). A board with no
  // circuits opens on the MD form.
  const mdAvailable = hasMdSheet(project, board.id);
  const [pick, setPick] = useState<{ board: string; form: 'db' | 'md' } | null>(null);
  const form: 'db' | 'md' = pick?.board === board.id ? pick.form : data.rows.length || !mdAvailable ? 'db' : 'md';
  const [exporting, setExporting] = useState(false);
  async function exportExcel(scope: WorkbookScope, name: string) {
    setExporting(true);
    try {
      const bytes = await workbookBytes(buildFormWorkbook(project, scope));
      const m = await saveBinary(`${safeFileName(name)}.xlsx`, bytes, 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (m) onStatus(m);
    } catch (e) {
      onStatus(`Excel export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  const setBoard = (patch: Partial<Board>, resize = false) => {
    const p = { ...project, boards: project.boards.map((b) => (b.id === board.id ? { ...b, ...patch } : b)) };
    onChange(resize ? refreshBoard(p, board.id) : p);
  };
  const patch = (id: string, pt: CircuitPatch) => onChange(updateCircuit(project, id, pt));
  const add = (phase?: Phase) => {
    try {
      onChange(addCircuit(project, board.id, phase).project);
    } catch (e) {
      onStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Page
      title={form === 'md' ? 'Connected load, maximum demand & kWh metering' : 'Load distribution schedule'}
      intro={form === 'md'
        ? 'Authority form for a meter cabinet, MDB, SMDB or MCC: its incomer and every outgoing feeder. Connected load per phase, TCL and MDL come from everything below each feeder, down to the DB load schedules. Type ratings, cable type, meters and remarks in the white cells.'
        : `Enter circuits here or on the SLD — both edit the same data. Circuit references are phase + way (R1, Y1, B1, R2…; RYB = 3-phase). Load per circuit = points × WATT/UNIT (your input). Lighting circuits (LTG / fans only): min ${settings.minWireLightingMm2} mm², ${settings.elcbLightingMa} mA ELCB; power circuits: min ${settings.minWirePowerMm2} mm², ${settings.elcbPowerMa} mA ELCB — change these in Project settings. MCB and wire are sized from the load, voltage drop and earth fault; a size chosen by hand is kept.`}
      actions={
        <>
          <select className="chip" value={board.id} onChange={(e) => onBoard(e.target.value)} aria-label="DB">
            {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id} — {b.name}</option>)}
          </select>
          <button className="chip" disabled={exporting} title="This form as an Excel workbook, laid out like the authority form"
            onClick={() => exportExcel({ boardIds: [board.id], forms: [form] }, `${project.name} ${board.id} ${form === 'md' ? 'connected load MD' : 'load schedule'}`)}>
            Export Excel
          </button>
          <button className="chip" disabled={exporting} title="Every form of the project in one workbook: load summary, MDB / SMDB / MCC forms, then every DB schedule"
            onClick={() => exportExcel({}, `${project.name} submission forms`)}>
            {exporting ? 'Exporting…' : 'Submission pack (Excel)'}
          </button>
          {form === 'db' && <>
          <button className="chip" onClick={async () => { const c = loadScheduleCsv(project, board.id); const m = await saveCsv(`${project.name} ${board.id} load schedule`, c.headers, c.rows); if (m) onStatus(m); }}>Export CSV</button>
          <button className="chip primary" onClick={async () => { const m = await savePdf(`${safeFileName(board.id)}-load-schedule.pdf`, buildLoadScheduleHtml(project, board.id)); if (m) onStatus(m); }}>Export PDF</button>
          </>}
        </>
      }
    >
      <div className="seg form-tabs" role="tablist" aria-label="Form">
        <button role="tab" aria-selected={form === 'db'} className={form === 'db' ? 'on' : ''} onClick={() => setPick({ board: board.id, form: 'db' })}>DB load distribution schedule</button>
        <button role="tab" aria-selected={form === 'md'} className={form === 'md' ? 'on' : ''} disabled={!mdAvailable} title={mdAvailable ? undefined : `${board.id} has no outgoing feeders`} onClick={() => setPick({ board: board.id, form: 'md' })}>Connected load &amp; MD</button>
      </div>
      {form === 'md' ? (
        <MdSheetView project={project} boardId={board.id} onChange={onChange} onStatus={onStatus} onSettings={onSettings} />
      ) : (
        <>
          <div className="ls-head">
            <span><span className="m">Project</span> <b>{project.name}</b></span>
            <span><span className="m">DB No.</span> <b>{board.id}</b></span>
            <span><span className="m">Fed from</span> <b>{board.upstreamId ?? 'Transformer'}</b></span>
            <label><span className="m">Location</span> <input value={board.location ?? ''} onChange={(e) => setBoard({ location: e.target.value || undefined })} /></label>
            <span><span className="m">Incomer</span> <b>{data.incomer ? `${data.incomer.breakerRatingA} A TP&N` : board.ratedCurrentA ? `${board.ratedCurrentA} A` : '—'}</b></span>
            <label><span className="m">ELCB per</span>
              <select value={board.elcbGroupSize ?? 6} onChange={(e) => setBoard({ elcbGroupSize: +e.target.value as 0 | 3 | 6 })}>
                <option value={6}>6 circuits (2 ways)</option>
                <option value={3}>3 circuits (1 way)</option>
                <option value={0}>No ELCB</option>
              </select>
            </label>
            <label><span className="m">Sensitivity</span>
              <select value={board.elcbSensitivityMa ?? ''} onChange={(e) => setBoard({ elcbSensitivityMa: e.target.value === '' ? undefined : +e.target.value })}>
                <option value="">Auto (lighting {settings.elcbLightingMa} / power {settings.elcbPowerMa} mA)</option>
                {[30, 100, 300].map((m) => <option key={m} value={m}>All {m} mA</option>)}
              </select>
            </label>
          </div>

          {missing.length > 0 && (
            <p className="ls-missing warn">
              Enter WATT / UNIT for: {missing.map((t) => pointLabel(board, t, project)).join(', ')} — circuits using them count as 0 W until you do.
            </p>
          )}
          <div className="ls-actions">
            <span className="m gx-hint" title="Arrows / Enter move · Shift+arrows or drag select · Ctrl/⌘ C copy · Ctrl/⌘ V paste from Excel · Ctrl/⌘ D fill down · Delete clears the selection">Excel keys: paste · fill down (⌘D) · copy</span>
            <button className="chip" onClick={() => add()}><Plus size={14} /> Add circuit</button>
            <button className="chip" onClick={() => add('RYB')}><Zap size={14} /> Add 3-phase circuit</button>
            <button className="chip" disabled={data.rows.length < 2} onClick={() => onChange(balancePhases(project, board.id))} title="Lighting circuits first, then power, each starting on an ELCB section; spread over R/Y/B and renumber"><Scale size={14} /> Balance phases</button>
            <span className="sp" />
            <span>
              Phase load (W): <b className="ph-r">R {(data.phaseW.R * 1000).toFixed(0)}</b> · <b className="ph-y">Y {(data.phaseW.Y * 1000).toFixed(0)}</b> ·{' '}
              <b className="ph-b">B {(data.phaseW.B * 1000).toFixed(0)}</b> · imbalance{' '}
              <b className={data.imbalance > 20 ? 'warn' : 'ok'}>{data.imbalance.toFixed(0)}%</b>
            </span>
          </div>

          {(
            <div className="ls-wrap" ref={grid}>
              <table className="ls">
                <thead>
                  <tr>
                    <th rowSpan={2}>ELCB</th><th rowSpan={2}>Sl.</th><th rowSpan={2}>Cir No.</th><th rowSpan={2}>MCB (A)</th>
                    <th rowSpan={2}>CCT wire mm²</th><th rowSpan={2}>ECC mm²</th><th rowSpan={2}>Room / area</th>
                    <th colSpan={columns.length}>Connected loads / points</th>
                    <th colSpan={3} className="shade">Load per circuit (W)</th>
                    <th rowSpan={2} title="Not on the DEWA form — used only for voltage drop and earth-fault checks">Length (m)<br /><span className="m">calc only</span></th><th rowSpan={2}>Check</th><th rowSpan={2}>Remarks</th><th rowSpan={2}></th>
                  </tr>
                  <tr>
                    {columns.map((t) => (
                      <th key={t.value} title={t.title} className="pt">
                        {t.value.startsWith('spare') ? (
                          <input className="hdr-in" value={pointLabel(board, t.value, project)} onChange={(e) => setBoard({ spareNames: { ...board.spareNames, [t.value]: e.target.value } })} aria-label={`${t.title} heading`} />
                        ) : t.label}
                      </th>
                    ))}
                    <th className="shade">R</th><th className="shade">Y</th><th className="shade">B</th>
                  </tr>
                  <tr className="watt-row">
                    <td colSpan={7}><b>WATT / UNIT</b></td>
                    {columns.map((t) => (
                      <td key={t.value} className={missing.includes(t.value) ? 'missing' : ''} title={board.pointItems?.[t.value] ? `From library: ${board.pointItems[t.value]}` : undefined}>
                        {/* Typing a value unlinks the column from the library. */}
                        <input inputMode="numeric" data-cell={cellKey(rowOf.get('__watts') ?? 0, colOf(`pt:${t.value}`))} value={watts[t.value] || ''} placeholder="W" aria-label={`${t.title} watts per point`}
                          onChange={(e) => setBoard({ pointWatts: { ...board.pointWatts, [t.value]: num(e.target.value) }, pointItems: { ...board.pointItems, [t.value]: undefined } }, true)} />
                        {db.loads.length > 0 && (
                          <select className={`lib-pick ${board.pointItems?.[t.value] ? 'linked' : ''}`} value={board.pointItems?.[t.value] ?? ''} aria-label={`${t.title} from library`}
                            onChange={(e) => {
                              const item = db.loads.find((l) => l.name === e.target.value);
                              setBoard(item
                                ? { pointWatts: { ...board.pointWatts, [t.value]: item.watts }, pointItems: { ...board.pointItems, [t.value]: item.name } }
                                : { pointItems: { ...board.pointItems, [t.value]: undefined } }, true);
                            }}>
                            <option value="">{board.pointItems?.[t.value] ? 'unlink' : 'library…'}</option>
                            {loadsForColumn(db, t.value).map((l) => <option key={l.name} value={l.name}>{l.name} ({l.watts} W)</option>)}
                          </select>
                        )}
                      </td>
                    ))}
                    <td colSpan={3} className="shade" /><td colSpan={4} />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr><td colSpan={7 + columns.length + 7} className="m">No circuits yet — use Add circuit to start this DB's schedule.</td></tr>
                  )}
                  {data.rows.map((r, i) => {
                    const f = r.f;
                    const first = r.group && data.rows.findIndex((x) => x.group === r.group) === i;
                    return (
                      <tr key={f.id} className={r.group && r.group.index % 2 === 0 ? 'alt' : ''}>
                        {first ? (
                          <td rowSpan={data.rows.filter((x) => x.group === r.group).length} className={`elcb ${r.group!.category === 'mixed' ? 'warn' : ''}`}
                            title={r.group!.category === 'mixed' ? 'Lighting and power share this ELCB — use Balance phases to separate them' : undefined}>
                            ELCB-{r.group!.index}<br />{r.group!.label}<br /><span className="m">{r.group!.category === 'mixed' ? 'mixed!' : r.group!.category}</span>
                          </td>
                        ) : !r.group ? <td /> : null}
                        <td data-cell={cell(f.id, 'sl')}>{r.sl}</td>
                        <td>
                          <b className={`ph-${f.phase === 'RYB' ? 'ryb' : f.phase!.toLowerCase()}`}>{r.ref}</b>
                          <span className={`cat cat-${r.category}`} title={r.category === 'lighting' ? 'Lighting circuit' : 'Power circuit'}>{r.category === 'lighting' ? 'L' : 'P'}</span>
                        </td>
                        <td>
                          <select data-cell={cell(f.id, 'mcb')} value={f.breakerRatingA} onChange={(e) => patch(f.id, { breakerRatingA: +e.target.value })}>
                            {[...new Set([...breakerRatings().filter((a) => a <= 125), f.breakerRatingA])].sort((a, b) => a - b).map((a) => <option key={a} value={a}>{a}</option>)}
                          </select>
                        </td>
                        <td>
                          <select data-cell={cell(f.id, 'wire')} value={f.cableCsaMm2} onChange={(e) => patch(f.id, { cableCsaMm2: +e.target.value })}>
                            {cables().map((c) => <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2}</option>)}
                          </select>
                        </td>
                        <td>
                          <select data-cell={cell(f.id, 'ecc')} value={f.cpcMm2 ?? ''} onChange={(e) => patch(f.id, { cpcMm2: e.target.value === '' ? undefined : +e.target.value })} title="Protective (earth) conductor">
                            <option value="">{defaultCpcMm2(f.cableCsaMm2)}</option>
                            {cables().filter((c) => c.csaMm2 <= f.cableCsaMm2).map((c) => <option key={c.csaMm2} value={c.csaMm2}>{c.csaMm2}*</option>)}
                          </select>
                        </td>
                        <td><input className="room" data-cell={cell(f.id, 'room')} value={f.room ?? ''} placeholder="Room" onChange={(e) => patch(f.id, { room: e.target.value })} /></td>
                        {columns.map((t) => (
                          <td key={t.value}>
                            <input inputMode="numeric" className="pt-in" data-cell={cell(f.id, `pt:${t.value}`)} value={f.points?.[t.value as PointType] || ''} aria-label={`${r.ref} ${t.title}`}
                              onChange={(e) => patch(f.id, { points: { ...f.points, [t.value]: num(e.target.value) } })} />
                          </td>
                        ))}
                        <td className="shade" data-cell={cell(f.id, 'R')}>{r.ph.R}</td><td className="shade" data-cell={cell(f.id, 'Y')}>{r.ph.Y}</td><td className="shade" data-cell={cell(f.id, 'B')}>{r.ph.B}</td>
                        <td><input inputMode="decimal" className="pt-in" key={f.lengthM} data-cell={cell(f.id, 'length')} defaultValue={f.lengthM}
                          onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); if (v > 0 && v !== f.lengthM) patch(f.id, { lengthM: v }); else e.target.value = String(f.lengthM); }}
                          aria-label={`${r.ref} length`} /></td>
                        <td className={r.status} title={r.belowMin ? `Wire below the ${r.minWire} mm² minimum for ${r.category} circuits` : undefined}>
                          {r.belowMin ? `< ${r.minWire} mm²` : STATUS_LABEL[r.status]}
                        </td>
                        <td><input className="room" data-cell={cell(f.id, 'remarks')} value={f.remarks ?? ''} onChange={(e) => patch(f.id, { remarks: e.target.value || undefined })} aria-label={`${r.ref} remarks`} /></td>
                        <td>
                          <button className="icon-btn" title={`Delete ${r.ref}`} onClick={() => window.confirm(`Delete circuit ${r.ref}?`) && onChange(deleteCircuit(project, f.id))}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="total">
                    <td colSpan={7 + columns.length} style={{ textAlign: 'right' }}>TOTAL (W)</td>
                    <td className="shade">{(data.phaseW.R * 1000).toFixed(0)}</td>
                    <td className="shade">{(data.phaseW.Y * 1000).toFixed(0)}</td>
                    <td className="shade">{(data.phaseW.B * 1000).toFixed(0)}</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="m note">
            ECC: the plain number is the IEC 60364-5-54 default; a starred size was chosen by hand ({data.rows.filter((r) => r.f.cpcMm2 !== undefined).length} set).
            {' '}Length isn't on the DEWA form or its PDF — it's only used for the voltage drop and earth-fault checks (default 20 m).
            {otherFeeders.length > 0 && ` Also on this board (not schedule circuits): ${otherFeeders.map((f) => f.id).join(', ')}.`}
          </p>
        </>
      )}
    </Page>
  );
}
