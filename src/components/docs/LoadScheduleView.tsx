import { ask } from '../ConfirmDialog';
import { panelCategoryOf } from '../../docs/sheetLink';
import { projectFormat } from '../../model/scheduleFormats';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supplyChain } from '../../model/transformers';
import { Trash2, X } from 'lucide-react';
import type { Board, Phase, PointType, Project } from '../../types';
import { cables } from '../../calc/cableTable';
import { defaultCpcMm2 } from '../../calc/earthing';
import { breakerRatings } from '../../calc/sizing';
import { itemizedTypes, loadItemsText, missingWatts, pointColumns, pointLabel, pointWattsFor, isScheduleCircuit } from '../../calc/loadSchedule';
import { settingsOf } from '../../types';
import { loadsForColumn, type Database } from '../../database/database';
import { buildLoadScheduleHtml, loadScheduleCsv, loadScheduleRows } from '../../docs/loadScheduleDoc';
import { addCircuit, balancePhases, circuitRef, deleteCircuit, duplicateCircuit, fixCircuit, refreshBoard, updateCircuit, type CircuitPatch } from '../../model/schedule';
import { isFail, isProblem, nextProblemBoard, problemRows, rowFixes, rowReasons, type ScheduleRow, type ScheduleFix } from '../../docs/scheduleCheck';
import { saveBinary, saveCsv, savePdf, safeFileName } from '../../util/files';
import { buildFormWorkbook, workbookBytes, type WorkbookScope } from '../../docs/formWorkbook';
import { workbookHtml } from '../../docs/sheetPdf';
import { Page, STATUS_LABEL } from '../ui';
import { applySheetEdits, buildDbSheet } from '../../docs/dbSheet';
import { cellKey, type Pos } from '../grid/excelGrid';
import { useExcelGrid } from '../grid/useExcelGrid';
import GridSelect from '../grid/GridSelect';
import MdSheetView, { type MdTools } from './MdSheetView';
import { hasMdSheet } from '../../docs/mdSheet';
import { dbChecks } from '../../calc/building';
import TxSummaryView, { type TxTools } from './TxSummaryView';
import RiserFormView from './RiserFormView';
import { SCHEDULE_GROUPS, scheduleBoardOrder, scheduleGroupOf, scheduleGroups, type ScheduleGroup, incompleteSchedules } from '../../model/scheduleGroups';
import CircuitEditDialog from './CircuitEditDialog';
import TemplateExportDialog from './TemplateExportDialog';
import { addSpareWay, deleteSpareWay, spareLabel, spareRef, updateSpareWay } from '../../model/spareWays';
import { fmtFixed, txt } from '../../util/format';
import type { RibbonActions } from '../Ribbon';

const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.round(+v) || 0));
/** Final-circuit MCB ratings up to 125 A, plus the current one if it is outside that list. */
const mcbOptions = (current: number) => [...new Set([...breakerRatings().filter((a) => a <= 125), current])].sort((a, b) => a - b);

/** DEWA-style load distribution schedule for a 3-phase DB, editable in
 * place. It edits the same project data as the SLD, so changes show on
 * the diagram and in every study immediately (and vice versa). */
export default function LoadScheduleView({
  project,
  boardId,
  db,
  onBoard,
  onOpenRiser,
  onChange,
  onStatus,
  onSettings,
  onSchedule,
  onOpenSheet
}: {
  project: Project;
  boardId: string;
  db: Database;
  onBoard: (id: string) => void;
  onOpenRiser?: () => void;
  onChange: (p: Project, opts?: { step?: boolean }) => void;
  onStatus: (m: string) => void;
  onSettings: () => void;
  /** Tells the ribbon what the Load schedule tab's tools can do now (undefined when this page goes away). */
  onSchedule?: (s: RibbonActions['schedule']) => void;
  /** Shows a board as a sheet in the project's format for its panel category (Sheets); the ribbon's Open in my format. */
  onOpenSheet?: (boardId: string) => void;
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
  // The cell the selection ends on: its row is the one the ribbon's Edit and Delete act on.
  const [active, setActive] = useState<Pos | null>(null);
  const cmds = useExcelGrid(grid, (edits) => {
    const { project: next, rejected } = applySheetEdits(project, dbs, edits);
    if (next !== project) onChange(next);
    if (rejected.length) onStatus(`Not applied — ${rejected.slice(0, 3).join('; ')}${rejected.length > 3 ? ` (+${rejected.length - 3} more)` : ''}`);
  }, (p) => setActive((q) => (q?.y === p?.y && q?.x === p?.x ? q : p)));
  const activeRow = (() => {
    const r = active ? dbs.rows[active.y] : undefined;
    return r?.type === 'circuit' ? data.rows.find((x) => x.f.id === r.feeder.id) : undefined;
  })();
  // Which form: the DB load distribution schedule, or the connected load &
  // maximum demand form (boards with outgoing feeders). A board with no
  // circuits opens on the MD form; so does an empty MDB / SMDB / MCC (not a
  // DB or EDB), so its first feeder can be added there.
  const mdAvailable = hasMdSheet(project, board.id) || (board.kind ?? (board.upstreamId ? 'DB' : 'MDB')) !== 'DB';
  const [pick, setPick] = useState<{ board: string; form: 'db' | 'md' } | null>(null);
  const [txForm, setTxForm] = useState<false | 'tx' | 'riser'>(false);
  // Tabs by panel type (submission order); the open tab follows the selected panel.
  const groups = useMemo(() => scheduleGroups(project), [project]);
  const group: ScheduleGroup = scheduleGroupOf(project, board);
  const openGroup = (g: ScheduleGroup) => { setTxForm(false); const first = groups[g][0]; if (first && first.id !== board.id) onBoard(first.id); };
  /** A panel whose schedule still needs filling: a DB with no circuits, or a panel with no outgoing loads. */
  const incomplete = (b: Board) => incompleteSchedules(project).has(b.id);
  const form: 'db' | 'md' | 'tx' | 'riser' = txForm ? txForm : pick?.board === board.id ? pick.form : data.rows.length || !mdAvailable ? 'db' : 'md';
  const [exporting, setExporting] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  // Circuit open in the double-click edit dialog, and the field to focus.
  const [editing, setEditing] = useState<{ id: string; focus?: string } | null>(null);
  const editRow = editing && data.rows.find((r) => r.f.id === editing.id);
  /** Double-click on a row opens its edit dialog, focused on the clicked field. */
  const openEdit = (e: React.MouseEvent, id: string) => {
    const t = e.target as HTMLElement;
    if (t.closest('button')) return;
    const key = t.closest<HTMLElement>('[data-cell]')?.dataset.cell;
    const col = key ? dbs.sheetCols[+key.split(':')[1]]?.key : undefined;
    setEditing({ id, focus: col });
  };
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

  /** The same form as PDF, printed from the Excel layout (MD, TCL summary, risers). */
  async function exportFormPdf(scope: WorkbookScope, name: string) {
    setExporting(true);
    try {
      const m = await savePdf(`${safeFileName(name)}.pdf`, workbookHtml(project, buildFormWorkbook(project, scope), name), { pageSize: 'A4', landscape: true, cssPages: true });
      if (m) onStatus(m);
    } catch (e) {
      onStatus(`PDF export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }

  /** The form on screen as a workbook scope and file name. */
  const formScope = (): [WorkbookScope, string] => form === 'riser' ? [{ forms: ['riser'] }, `${project.name} bus bar risers`]
    : form === 'tx' ? [{ forms: ['tx'] }, `${project.name} TCL summary at transformer level`]
    : [{ boardIds: [board.id], forms: [form] }, `${project.name} ${board.id} ${form === 'md' ? 'connected load MD' : 'load schedule'}`];

  // Check: the circuit shown in the bar above the grid, and a jump to another board waiting for it to be on screen.
  const [bar, setBar] = useState<{ board: string; id: string } | null>(null);
  const jump = useRef<string | null>(null);
  const order = useMemo(() => scheduleBoardOrder(groups), [groups]);
  const problems = useMemo(() => problemRows(data.rows), [data]);
  const current = bar && bar.board === board.id && form === 'db' ? problems.find((r) => r.f.id === bar.id) : undefined;
  const why = useMemo(() => (current ? { reasons: rowReasons(project, current), fixes: rowFixes(project, current) } : undefined), [project, current]);
  // The bar goes when the board changes, its circuit is deleted or no longer a problem.
  useEffect(() => { if (bar && !current) setBar(null); }, [bar, current]);
  const showProblem = (r: ScheduleRow) => {
    setBar({ board: board.id, id: r.f.id });
    const y = rowOf.get(r.f.id);
    if (y !== undefined) cmds.select({ y, x: Math.max(colOf('room'), 0) });
  };
  const check = () => {
    if (problems.length) { showProblem(problems[((current ? problems.indexOf(current) : -1) + 1) % problems.length]); return; }
    const to = nextProblemBoard(project, board.id, order);
    if (!to) { onStatus('Every circuit in every schedule is within limits'); return; }
    jump.current = to;
    setTxForm(false);
    setPick({ board: to, form: 'db' });
    onBoard(to);
  };
  // The jump: once the other board's DB form is on screen, its first problem.
  useEffect(() => {
    if (jump.current !== board.id || form !== 'db') return;
    jump.current = null;
    if (problems[0]) showProblem(problems[0]);
  });
  const applyFix = (r: ScheduleRow, fix: ScheduleFix) => {
    const next = fixCircuit(project, r.f.id, fix.patch);
    onChange(next, { step: true });
    const row = loadScheduleRows(next, board.id).rows.find((x) => x.f.id === r.f.id);
    if (row && !isProblem(row)) { setBar(null); onStatus(`${r.ref}: ${fix.label} applied`); }
  };
  const duplicate = () => {
    if (!activeRow) return;
    try {
      const r = duplicateCircuit(project, activeRow.f.id);
      onChange(r.project, { step: true });
      onStatus(`Circuit ${circuitRef(r.project.feeders.find((f) => f.id === r.id)!)} added as a copy of ${activeRow.ref}`);
    } catch (e) {
      onStatus(e instanceof Error ? e.message : String(e));
    }
  };
  // The panels either side of this one in the schedule's own order (on a panel's own forms).
  const at = order.findIndex((b) => b.id === board.id);
  const onBoardForm = form === 'db' || form === 'md';
  const prevBoard = onBoardForm && at > 0 ? order[at - 1].id : undefined;
  const nextBoard = onBoardForm && at >= 0 ? order[at + 1]?.id : undefined;

  const setBoard = (patch: Partial<Board>, resize = false) => {
    const p = { ...project, boards: project.boards.map((b) => (b.id === board.id ? { ...b, ...patch } : b)) };
    onChange(resize ? refreshBoard(p, board.id) : p);
  };
  const patch = (id: string, pt: CircuitPatch) => onChange(updateCircuit(project, id, pt));
  // The MD form's and the TCL summary's own tools, as they publish them: the ribbon's buttons work through these.
  const mdTools = useRef<MdTools>();
  const txTools = useRef<TxTools>();
  const [mdShown, setMdShown] = useState<Pick<MdTools, 'row' | 'rowBlock' | 'dupBlock'>>({});
  const [txShown, setTxShown] = useState<Pick<TxTools, 'row' | 'substation'>>({ substation: '' });
  const addSpare = (kind: 'spare' | 'space', phase?: 'one' | 'three') => {
    if (form === 'md') { mdTools.current?.addWay(kind, phase ?? 'three'); return; }
    try {
      const r = addSpareWay(project, board.id, kind, phase === 'three' ? 'RYB' : undefined);
      onChange(r.project);
      onStatus(r.message);
    } catch (e) {
      onStatus(e instanceof Error ? e.message : String(e));
    }
  };
  const add = (phase?: Phase) => {
    if (form === 'md') { mdTools.current?.addFeeder(); return; }
    try {
      onChange(addCircuit(project, board.id, phase).project);
    } catch (e) {
      onStatus(e instanceof Error ? e.message : String(e));
    }
  };
  const removeCircuit = async (r: { f: { id: string }; ref: string }) => {
    if (await ask(`Delete circuit ${r.ref}?`)) onChange(deleteCircuit(project, r.f.id));
  };
  /** Paste from the ribbon: the system clipboard through the grid's own paste. */
  const pasteClipboard = async () => {
    const told = 'Paste: press Ctrl/⌘ V on the schedule';
    try {
      const text = await navigator.clipboard.readText();
      if (!(form === 'md' ? mdTools.current?.paste(text) : cmds.paste(text))) onStatus('Paste: click a cell on the schedule first');
    } catch {
      onStatus(told);
    }
  };
  const exportKind = async (kind: 'excel' | 'pdf' | 'csv' | 'pack' | 'template') => {
    if (kind === 'excel') await exportExcel(...formScope());
    else if (kind === 'pack') await exportExcel({}, `${project.name} submission forms`);
    else if (kind === 'template') setTemplateOpen(true);
    else if (kind === 'csv') { const c = loadScheduleCsv(project, board.id); const m = await saveCsv(`${project.name} ${board.id} load schedule`, c.headers, c.rows); if (m) onStatus(m); }
    else if (form === 'db') { const m = await savePdf(`${safeFileName(board.id)}-load-schedule.pdf`, buildLoadScheduleHtml(project, board.id), { pageSize: 'A4', landscape: true }); if (m) onStatus(m); }
    else await exportFormPdf(...formScope());
  };

  // The ribbon's Load schedule tools. Published by value: the handlers go through a ref, so what is sent changes only
  // with what the ribbon shows (publishing an object built every render would loop).
  const now = { add, addSpare,
    fill: () => (form === 'md' ? mdTools.current?.fillDown() : cmds.fillDown()),
    edit: () => { if (form === 'md') mdTools.current?.edit(); else if (form === 'tx') txTools.current?.edit(); else if (form === 'riser') onOpenRiser?.(); else if (activeRow) setEditing({ id: activeRow.f.id }); },
    remove: () => { if (form === 'md') mdTools.current?.remove(); else if (form === 'tx') txTools.current?.remove(); else if (activeRow) void removeCircuit(activeRow); },
    balance: () => onChange(balancePhases(project, board.id)), copy: () => { if (form === 'md') mdTools.current?.copy(); else cmds.copy(); }, paste: pasteClipboard, exportKind,
    step: (d: -1 | 1) => { const to = d < 0 ? prevBoard : nextBoard; if (to) onBoard(to); }, check,
    duplicate: () => { if (form === 'md') mdTools.current?.duplicate(); else duplicate(); },
    addTransformer: (newSubstation: boolean) => txTools.current?.addTransformer(newSubstation), formDetails: onSettings, openSheet: () => onOpenSheet?.(board.id) };
  const tools = useRef(now);
  tools.current = now;
  const publish = useRef(onSchedule);
  publish.current = onSchedule;
  const onGrid = form === 'db', rowRef = onGrid ? activeRow?.ref : form === 'md' ? mdShown.row : form === 'tx' ? txShown.row : undefined;
  const { rowBlock, dupBlock } = form === 'md' ? mdShown : { rowBlock: undefined, dupBlock: undefined };
  const substation = form === 'tx' ? txShown.substation : undefined;
  const imbalancePct = data.rows.length ? Math.round(data.imbalance) : undefined, canBalance = data.rows.length >= 2;
  const fails = onGrid ? problems.filter(isFail).length : 0, warns = onGrid ? problems.length - fails : 0;
  const category = panelCategoryOf(project, board), sheetFormat = !!(category && projectFormat(project, category)) || !!project.sheets?.sheets.some((s) => s.link?.boardId === board.id);
  useEffect(() => {
    publish.current?.({
      form, grid: onGrid, row: rowRef, rowBlock, dupBlock, substation, canBalance, imbalancePct, exporting, board: onBoardForm, prevBoard, nextBoard, fails, warns,
      onBoardStep: (d) => tools.current.step(d), onDuplicate: () => tools.current.duplicate(), onCheck: () => tools.current.check(),
      onAddCircuit: (three) => tools.current.add(three ? 'RYB' : undefined), onAddSpare: (k, phase) => tools.current.addSpare(k, phase),
      onAddTransformer: (n) => tools.current.addTransformer(n), onFormDetails: () => tools.current.formDetails(),
      onFillDown: () => tools.current.fill(), onEditRow: () => tools.current.edit(), onDeleteRow: () => tools.current.remove(),
      onBalance: () => tools.current.balance(), onCopy: () => tools.current.copy(), onPaste: () => void tools.current.paste(),
      onExport: (k) => void tools.current.exportKind(k), sheetFormat, onOpenSheet: () => tools.current.openSheet()
    });
  }, [sheetFormat, form, onGrid, rowRef, rowBlock, dupBlock, substation, canBalance, imbalancePct, exporting, onBoardForm, prevBoard, nextBoard, fails, warns]);
  useEffect(() => () => publish.current?.(undefined), []);

  return (
    <Page
      docId="load-schedule-page"
      title={form === 'riser' ? 'Bus bar riser — connected load / max. demand' : form === 'tx' ? 'Summary of the TCL at transformer level' : form === 'md' ? 'Connected load, maximum demand & kWh metering' : 'Load distribution schedule'}
      intro={form === 'riser' ? 'For high-rise buildings: the busbar riser from the MDB and each floor’s tap-off to its SMDB / DB, with connected load per phase, TCL, D.F, MD and kWh meters.' : form === 'tx' ? 'Authority summary of every transformer: main breaker and setting, fault duty, connected load per phase, TCL, demand factor, MDL and the kWh meters it feeds. Loads and meters come from the MD forms and load schedules below each transformer.' : form === 'md'
        ? 'Authority form for a meter cabinet, MDB, SMDB or MCC: its incomer and every outgoing feeder. Connected load per phase, TCL and MDL come from everything below each feeder, down to the DB load schedules. Type ratings, cable type, meters and remarks in the white cells.'
        : `Enter circuits here or on the SLD — both edit the same data. Circuit references are phase + way (R1, Y1, B1, R2…; RYB = 3-phase). Load per circuit = points × WATT/UNIT (your input). Lighting circuits (LTG / fans only): min ${settings.minWireLightingMm2} mm², ${settings.elcbLightingMa} mA ELCB; power circuits: min ${settings.minWirePowerMm2} mm², ${settings.elcbPowerMa} mA ELCB — change these in Project settings. MCB and wire are sized from the load, voltage drop and earth fault; a size chosen by hand is kept.`}
      actions={
        <>
          {form !== 'tx' && form !== 'riser' && <select className="chip" value={board.id} onChange={(e) => onBoard(e.target.value)} aria-label="DB">
            {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id} — {b.name}</option>)}
          </select>}
        </>
      }
    >
      <p className="m ls-supply" title="Where this board's supply comes from">Supply: {supplyChain(project, board.id).join(' → ')}</p>
      {(() => {
        const c = dbChecks(project).find((x) => x.boardId === board.id);
        if (!c) return null;
        return (
          <p className={`ls-rooms ${c.status}`} title="From Building information: the rooms this board serves and their room types' W/m²">
            Serves {c.rooms.length} room{c.rooms.length === 1 ? '' : 's'} ({c.rooms.map((x) => x.room.name).slice(0, 3).join(', ')}{c.rooms.length > 3 ? '…' : ''}), {txt.size(c.areaM2)} m²:
            {' '}expected {txt.power(c.expectedKw)} kW from the room types, designed {txt.power(c.scheduledKw)} kW ({c.wPerM2.toFixed(1)} W/m²)
            {c.status === 'warn' ? ' — check' : ' — OK'}
          </p>
        );
      })()}
      <div className="seg form-tabs" role="tablist" aria-label="Schedules" data-doc-id="load-schedule-groups">
        <button role="tab" aria-selected={form === 'tx'} className={form === 'tx' ? 'on' : ''} title="Summary of the TCL at transformer level — every transformer of the project" onClick={() => setTxForm('tx')}>TCL summary</button>
        {SCHEDULE_GROUPS.flatMap(({ key, label }) => {
          const tab = groups[key].length ? [<button key={key} role="tab" aria-selected={!txForm && group === key} className={!txForm && group === key ? 'on' : ''} onClick={() => openGroup(key)}>{label} <span className="m">({groups[key].length})</span></button>] : [];
          // The busbar riser follows the main LV panels.
          return key === 'mdb' && project.busRisers?.length ? [...tab, <button key="riser" role="tab" aria-selected={form === 'riser'} className={form === 'riser' ? 'on' : ''} title="Bus bar riser — connected load / max. demand of each tap-off (high-rise)" onClick={() => setTxForm('riser')}>Busbar riser</button>] : tab;
        })}
      </div>
      {!txForm && (
        <div className="ls-panels" data-doc-id="load-schedule-panels">
          {groups[group].map((b) => (
            <button key={b.id} className={`chip${b.id === board.id ? ' on' : ''}`} title={incomplete(b) ? `${b.id}: schedule not filled yet` : b.name} onClick={() => b.id !== board.id && onBoard(b.id)}>
              {b.id}{incomplete(b) && <span className="warn"> !</span>}
            </button>
          ))}
          {data.rows.length > 0 && mdAvailable && (
            <span className="seg ls-form">
              <button className={form === 'db' ? 'on' : ''} onClick={() => setPick({ board: board.id, form: 'db' })}>Load schedule</button>
              <button className={form === 'md' ? 'on' : ''} onClick={() => setPick({ board: board.id, form: 'md' })}>Connected load &amp; MD</button>
            </span>
          )}
        </div>
      )}
      {form === 'riser' ? (
        <RiserFormView project={project} onOpenRiser={() => onOpenRiser?.()} />
      ) : form === 'tx' ? (
        <TxSummaryView project={project} onChange={onChange} onSettings={onSettings}
          onTools={(t) => { txTools.current = t; setTxShown((q) => (q.row === t?.row && q.substation === (t?.substation ?? '') ? q : { row: t?.row, substation: t?.substation ?? '' })); }} />
      ) : form === 'md' ? (
        <MdSheetView project={project} boardId={board.id} onChange={onChange} onStatus={onStatus} onSettings={onSettings}
          onTools={(t) => { mdTools.current = t; setMdShown((q) => (q.row === t?.row && q.rowBlock === t?.rowBlock && q.dupBlock === t?.dupBlock ? q : { row: t?.row, rowBlock: t?.rowBlock, dupBlock: t?.dupBlock })); }} />
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
            <span className="sp" />
            <span>
              Phase load (W): <b className="ph-r">R {fmtFixed(data.phaseW.R * 1000, 0)}</b> · <b className="ph-y">Y {fmtFixed(data.phaseW.Y * 1000, 0)}</b> ·{' '}
              <b className="ph-b">B {fmtFixed(data.phaseW.B * 1000, 0)}</b> · imbalance{' '}
              <b className={data.imbalance > 20 ? 'warn' : 'ok'}>{data.imbalance.toFixed(0)}%</b>
            </span>
          </div>

          {current && why && (
            <div className="ls-missing warn" role="status" aria-label="Circuit to check">
              <span className="m">Problem {problems.indexOf(current) + 1} of {problems.length} · {board.id}</span>{' '}
              <b>{current.ref}{current.f.room ? ` · ${current.f.room}` : ''}</b>{' '}
              <span className={current.status}>{STATUS_LABEL[current.status]}</span>
              {why.reasons.length > 0 && <> — {why.reasons.join('; ')}</>}{' '}
              {why.fixes.map((x) => <button key={x.label} className="chip" onClick={() => applyFix(current, x)}>{x.label}</button>)}{' '}
              <button className="chip" onClick={check}>Next problem</button>{' '}
              <button className="icon-btn" title="Close" aria-label="Close" onClick={() => setBar(null)}><X size={14} /></button>
            </div>
          )}
          {(
            <div className="ls-wrap" ref={grid} data-doc-id="load-schedule-grid">
              <table className="ls">
                <thead>
                  <tr>
                    <th rowSpan={2}>ELCB</th><th rowSpan={2}>Sl.</th><th rowSpan={2}>Cir No.</th><th rowSpan={2}>MCB (A)</th>
                    <th rowSpan={2}>CCT wire mm²</th><th rowSpan={2}>ECC mm²</th><th rowSpan={2}>Room / area</th>
                    <th colSpan={columns.length}>Connected loads / points</th>
                    <th colSpan={3} className="shade">Load per circuit (W)</th>
                    <th rowSpan={2} title="Not on the authority form — used only for voltage drop and earth-fault checks">Length (m)<br /><span className="m">calc only</span></th><th rowSpan={2}>Check</th><th rowSpan={2}>Remarks</th><th rowSpan={2}></th>
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
                  {data.entries.length === 0 && (
                    <tr><td colSpan={7 + columns.length + 7} className="m">No circuits yet — use Load schedule → Add circuit to start this DB's schedule.</td></tr>
                  )}
                  {data.entries.map((e, i) => {
                    const g = e.group;
                    const first = g && data.entries.findIndex((x) => x.group === g) === i;
                    const elcbTd = first ? (
                      <td rowSpan={data.entries.filter((x) => x.group === g).length} className={`elcb ${g.category === 'mixed' ? 'warn' : ''}`}
                        title={g.category === 'mixed' ? 'Lighting and power share this ELCB — use Load schedule → Balance phases to separate them' : undefined}>
                        ELCB-{g.index}<br />{g.label}<br /><span className="m">{g.category === 'mixed' ? 'mixed!' : g.category}</span>
                      </td>
                    ) : !g ? <td /> : null;
                    if (e.type === 'spare') {
                      const sp = e.spare;
                      return (
                        <tr key={`sp:${sp.id}`} className={`ls-spare${g && g.index % 2 === 0 ? ' alt' : ''}`}>
                          {elcbTd}
                          <td>{e.sl}</td>
                          <td><b className={`ph-${sp.phase === 'RYB' ? 'ryb' : sp.phase.toLowerCase()}`}>{spareRef(sp)}</b></td>
                          <td>{sp.kind === 'spare' ? (
                            <GridSelect value={sp.ratingA} aria-label={`${spareRef(sp)} spare MCB`} options={mcbOptions(sp.ratingA)} onPick={(a) => onChange(updateSpareWay(project, board.id, sp.id, { ratingA: a }))} />
                          ) : <span className="m">—</span>}</td>
                          <td /><td />
                          <td><b>{spareLabel(sp)}</b></td>
                          {columns.map((t) => <td key={t.value} />)}
                          <td className="shade" /><td className="shade" /><td className="shade" />
                          <td /><td />
                          <td><input className="room" value={sp.remarks ?? ''} onChange={(ev) => onChange(updateSpareWay(project, board.id, sp.id, { remarks: ev.target.value || undefined }))} aria-label={`${spareRef(sp)} remarks`} /></td>
                          <td>
                            <button className="icon-btn" title={`Delete ${spareLabel(sp).toLowerCase()} ${spareRef(sp)}`} onClick={async () => (await ask(`Delete ${spareLabel(sp).toLowerCase()} ${spareRef(sp)}?`)) && onChange(deleteSpareWay(project, board.id, sp.id).project)}>
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    const r = e.row;
                    const f = r.f;
                    return (
                      <tr key={f.id} className={g && g.index % 2 === 0 ? 'alt' : ''} title="Double-click to edit this circuit" onDoubleClick={(ev) => openEdit(ev, f.id)}>
                        {elcbTd}
                        <td data-cell={cell(f.id, 'sl')}>{r.sl}</td>
                        <td>
                          <b className={`ph-${f.phase === 'RYB' ? 'ryb' : f.phase!.toLowerCase()}`}>{r.ref}</b>
                          <span className={`cat cat-${r.category}`} title={r.category === 'lighting' ? 'Lighting circuit' : 'Power circuit'}>{r.category === 'lighting' ? 'L' : 'P'}</span>
                        </td>
                        <td>
                          <GridSelect data-cell={cell(f.id, 'mcb')} aria-label={`${r.ref} MCB`} value={f.breakerRatingA} options={mcbOptions(f.breakerRatingA)} onPick={(a) => patch(f.id, { breakerRatingA: a })} />
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
                        {columns.map((t) => itemizedTypes(f).has(t.value) ? (
                          // Mixed load items: the count is their sum, edited in the circuit dialog.
                          <td key={t.value} className="itemized" title={`${loadItemsText(f, t.value)} — double-click to edit the load items`}>
                            <input readOnly className="pt-in" data-cell={cell(f.id, `pt:${t.value}`)} value={f.points?.[t.value as PointType] || ''} aria-label={`${r.ref} ${t.title} (load items)`} />
                          </td>
                        ) : (
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
                          <button className="icon-btn" title={`Delete ${r.ref}`} onClick={async () => (await ask(`Delete circuit ${r.ref}?`)) && onChange(deleteCircuit(project, f.id))}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="total">
                    <td colSpan={7 + columns.length} style={{ textAlign: 'right' }}>TOTAL (W)</td>
                    <td className="shade">{fmtFixed(data.phaseW.R * 1000, 0)}</td>
                    <td className="shade">{fmtFixed(data.phaseW.Y * 1000, 0)}</td>
                    <td className="shade">{fmtFixed(data.phaseW.B * 1000, 0)}</td>
                    <td colSpan={4} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {templateOpen && <TemplateExportDialog project={project} boardId={board.id} onStatus={onStatus} onClose={() => setTemplateOpen(false)} />}
          {editRow && (
            <CircuitEditDialog project={project} board={board} feeder={editRow.f} circuitRef={editRow.ref} columns={columns} library={db.loads} focus={editing!.focus}
              onSave={(pt) => { patch(editRow.f.id, pt); setEditing(null); }}
              onDelete={() => { onChange(deleteCircuit(project, editRow.f.id)); setEditing(null); }}
              onClose={() => setEditing(null)} />
          )}
          <p className="m note">
            ECC: the plain number is the IEC 60364-5-54 default; a starred size was chosen by hand ({data.rows.filter((r) => r.f.cpcMm2 !== undefined).length} set).
            {' '}Length isn't on the authority form or its PDF — it's only used for the voltage drop and earth-fault checks (default 20 m).
            {otherFeeders.length > 0 && ` Also on this board (not schedule circuits): ${otherFeeders.map((f) => f.id).join(', ')}.`}
          </p>
        </>
      )}
    </Page>
  );
}
