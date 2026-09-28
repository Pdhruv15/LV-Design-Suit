import { useEffect, useMemo, useState } from 'react';
import { Feeder, Board, Project, newProject } from './types';
import { sampleProject } from './data/sampleProject';
import { evaluateProject, type Status } from './calc/electrical';
import SingleLineDiagram from './components/SingleLineDiagram';
import ResultsTable from './components/ResultsTable';
import SidePanel from './components/SidePanel';
import FeederForm from './components/FeederForm';
import BoardForm from './components/BoardForm';
import BoqTable from './components/BoqTable';
import { exportDss } from './engines/opendss/exportDss';
import EngineCompare from './components/EngineCompare';
import SystemDiagram from './components/SystemDiagram';
import SystemSummaryCards from './components/SystemSummaryCards';
import BoardPanel from './components/BoardPanel';
import EarthingStudy from './components/studies/EarthingStudy';
import SelectionStudy from './components/studies/SelectionStudy';
import VoltageDropStudy from './components/studies/VoltageDropStudy';
import RevisionsView from './components/docs/RevisionsView';
import SpacePlanView from './components/docs/SpacePlanView';
import CoordinationStudy from './components/studies/CoordinationStudy';
import { PfcStudy, TransformerGeneratorStudy } from './components/studies/SizingStudy';
import { CableScheduleView, DbScheduleView, EquipmentScheduleView, ReportView } from './components/docs/Documents';
import LoadScheduleView from './components/docs/LoadScheduleView';
import { refreshBoard } from './model/schedule';
import DatabaseView from './components/docs/DatabaseView';
import { applyDatabase, applyParameters, databaseSeeds, EMPTY_DATABASE, parseDatabase, syncLibrary, type Database, type RawDatabase } from './database/database';

// window.lvds is only present when running inside Electron. Fall back to
// in-memory-only mode so the same UI still runs in a plain browser tab
// during development (`vite` alone, without `electron .`).
const hasBridge = typeof window !== 'undefined' && !!window.lvds;
// The database needs the desktop app's main process to be up to date too
// (an older running instance has the bridge but no database handlers).
const hasDatabase = hasBridge && !!window.lvds.database;

import { DOCUMENTS, STUDIES, type MainView } from './views';
import Ribbon, { tabForView, type DiagramTool, type RibbonTab } from './components/Ribbon';
import ProjectSettings from './components/ProjectSettings';
import type { BoardTab } from './components/BoardPanel';
import BoardEditForm from './components/BoardEditForm';
import DiagramResultsBar, { type ResultSource } from './components/DiagramResultsBar';
import { buildAnnotations, DEFAULT_LAYERS, type ResultLayers } from './diagram/annotations';
import { EXTERNAL_ENGINES } from './engines';
import type { StudyResults } from './engines/types';
import { deleteBoard } from './model/edit';
import { useHistory } from './model/history';
import { generatorScenario, transformerOutage, type SupplyMode } from './calc/scenario';
import { removeTie } from './model/sldEdit';
import type { ColorBy } from './diagram/heatmap';
import { applyDrop, applyMove, libraryEntries, type DropResult, type DropTarget, type MoveItem, type PaletteItem } from './model/sldEdit';
import EquipmentPalette from './components/EquipmentPalette';
import SldExportDialog from './components/SldExportDialog';
import PasteBoardDialog from './components/PasteBoardDialog';
import DiscriminationPanel from './components/DiscriminationPanel';
import { discriminationChain } from './calc/protection';
import { pasteBoard } from './model/copyBoard';
type DiagramMode = 'system' | 'board';

export default function App() {
  // The project, with undo / redo. Opening or starting a project clears the history.
  const history = useHistory<Project>(sampleProject);
  const project = history.value;
  const setProject = history.set;
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);
  const [projectsFolder, setProjectsFolder] = useState<string>('');
  const [projectList, setProjectList] = useState<{ file: string; name: string; updatedAt: number }[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string>(project.boards[0]?.id ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [view, setViewState] = useState<MainView>('design');
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('design');
  const [tool, setTool] = useState<DiagramTool>('select');
  const [feederPreset, setFeederPreset] = useState<Partial<Feeder>>({});
  const [boardTab, setBoardTab] = useState<BoardTab>('general');
  const [showSettings, setShowSettings] = useState(false);
  const [editBoardId, setEditBoardId] = useState<string | null>(null);
  const [layers, setLayers] = useState<ResultLayers>(DEFAULT_LAYERS);
  const [resultSource, setResultSource] = useState<ResultSource>('builtin');
  const [engineRun, setEngineRun] = useState<{ project: Project; results: StudyResults } | null>(null);
  const [simRunning, setSimRunning] = useState(false);
  const [simError, setSimError] = useState('');
  const [db, setDb] = useState<Database>(EMPTY_DATABASE);
  const [colorBy, setColorBy] = useState<ColorBy>('none');
  const [supply, setSupply] = useState<SupplyMode>('normal');
  const [showExport, setShowExport] = useState(false);
  // Copy / paste of a board with everything below it.
  const [copiedBoard, setCopiedBoard] = useState<string | null>(null);
  const [pasteTarget, setPasteTarget] = useState<string | null>(null);

  // LV Database: Excel workbooks in the projects folder. Every save in Excel
  // arrives here; the data is applied to the calculations, library-linked
  // WATT/UNIT values are synced, and the project is re-evaluated.
  function receiveDatabase(raw: RawDatabase & { created?: string[] }) {
    const parsed = parseDatabase(raw);
    applyDatabase(parsed);
    setDb(parsed);
    setProject((p) => {
      const s = syncLibrary(p, parsed);
      const next = s.changedBoards.reduce((q, id) => refreshBoard(q, id), s.project);
      return { ...next }; // new object so every calculation re-runs with the new data
    });
    const created = raw.created?.length ? `Created ${raw.created.join(', ')} in the database folder. ` : '';
    const issues = parsed.issues.length ? `${parsed.issues.length} database problem(s) — see Database. ` : '';
    setStatus(`${created}${issues}Database synced ${new Date(raw.readAt).toLocaleTimeString()}`);
  }

  function initDatabase() {
    if (!hasDatabase) return;
    window.lvds.database.init(databaseSeeds()).then(receiveDatabase).catch((e) => setStatus(`Database: ${e.message}`));
  }

  useEffect(() => {
    if (!hasDatabase) return;
    initDatabase();
    return window.lvds.database.onChange(receiveDatabase);
  }, []);
  // Navigating (left menu or ribbon) keeps the ribbon on the matching tab.
  const setView = (v: MainView) => {
    setViewState(v);
    setRibbonTab(tabForView(v));
  };
  const [showFeederForm, setShowFeederForm] = useState<'new' | 'edit' | null>(null);
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [diagramMode, setDiagramMode] = useState<DiagramMode>('system');
  const [panel, setPanel] = useState<'feeder' | 'board'>('board');

  const allResults = useMemo(() => evaluateProject(project), [project]);
  const board = project.boards.find((b) => b.id === activeBoardId) ?? project.boards[0];
  const boardResults = useMemo(() => allResults.filter((r) => r.feeder.boardId === board?.id), [allResults, board]);
  const selectedFeeder = project.feeders.find((f) => f.id === selected);

  // Engine results are used only while they match the current project and
  // the chosen source; any edit falls back to the instant built-in values.
  const engineFresh = !!engineRun && engineRun.project === project && engineRun.results.engineId === resultSource;
  const annotations = useMemo(
    () => buildAnnotations(project, allResults, engineFresh ? engineRun!.results : undefined),
    [project, allResults, engineFresh, engineRun]
  );
  // Generator mode: the SLD shows the network as it runs on the standby
  // generators (built-in engine only).
  const hasGenerator = project.boards.some((b) => b.standby);
  const onGenerator = supply === 'generator' && hasGenerator;
  // Transformer outage: a main board with a bus tie to another.
  const tiedRoots = [...new Set((project.ties ?? []).flatMap((t) => [t.a, t.b]))]
    .filter((id) => project.boards.some((b) => b.id === id && !b.upstreamId && b.sourceKva));
  const outageId = supply.startsWith('outage:') && tiedRoots.includes(supply.slice(7)) ? supply.slice(7) : undefined;
  const genScenario = useMemo(
    () => (onGenerator ? generatorScenario(project) : outageId ? transformerOutage(project, outageId) : undefined),
    [project, onGenerator, outageId]
  );
  const genResults = useMemo(() => (genScenario ? evaluateProject(genScenario.project) : undefined), [genScenario]);
  const genAnnotations = useMemo(() => (genScenario && genResults ? buildAnnotations(genScenario.project, genResults) : undefined), [genScenario, genResults]);

  // The selected feeder's breaker chain, highlighted on the SLD.
  const chain = useMemo(() => {
    if (panel !== 'feeder' || !selectedFeeder) return undefined;
    const m = new Map<string, Status>();
    for (const r of discriminationChain(project, selectedFeeder)) {
      m.set(r.upstream.id, r.status);
      if (!m.has(r.downstream.id)) m.set(r.downstream.id, r.status);
    }
    return m;
  }, [project, panel, selectedFeeder]);

  const resultsNote = (() => {
    if (onGenerator) return { text: 'Generator supply — built-in results; fault levels from the generators’ X″d (15 %)', cls: 'warn' };
    if (outageId) return { text: `Transformer of ${outageId} out — built-in results with the bus tie closed`, cls: 'warn' };
    const name = EXTERNAL_ENGINES.find((e) => e.id === resultSource)?.name;
    if (resultSource === 'builtin') return { text: 'Built-in estimate — bus voltages from the main busbar' };
    if (simRunning) return { text: `Running ${name}…` };
    if (simError) return { text: simError, cls: 'bad' };
    if (engineFresh) return { text: `${name} results (transformer drop included)`, cls: 'ok' };
    if (engineRun?.results.engineId === resultSource) return { text: 'Project changed — showing built-in values; run again', cls: 'warn' };
    return { text: 'Showing built-in values until you run the simulation', cls: 'warn' };
  })();

  async function runSimulation() {
    const engine = EXTERNAL_ENGINES.find((e) => e.id === resultSource);
    if (!engine) return;
    setSimRunning(true);
    setSimError('');
    try {
      const snapshot = project;
      setEngineRun({ project: snapshot, results: await engine.run(snapshot) });
    } catch (e) {
      setSimError(e instanceof Error ? e.message : String(e));
    } finally {
      setSimRunning(false);
    }
  }

  useEffect(() => {
    if (!hasBridge) return;
    window.lvds.settings.get().then((s) => setProjectsFolder(s.projectsFolder));
    refreshList();
  }, []);

  useEffect(() => {
    if (!board) return;
    if (!boardResults.find((r) => r.feeder.id === selected)) {
      setSelected(boardResults[0]?.feeder.id ?? null);
    }
  }, [board?.id]);

  function selectFeeder(id: string) {
    const f = project.feeders.find((x) => x.id === id);
    if (!f) return;
    setSelected(id);
    setActiveBoardId(f.boardId);
    setPanel('feeder');
  }

  function selectBoard(id: string) {
    setActiveBoardId(id);
    setPanel('board');
  }

  function updateBoard(b: Board) {
    setProject((prev) => ({ ...prev, boards: prev.boards.map((x) => (x.id === b.id ? b : x)) }));
  }

  function refreshList() {
    if (!hasBridge) return;
    window.lvds.projects.list().then(setProjectList);
  }

  async function saveProject() {
    if (!hasBridge) {
      setStatus('Save is only available in the desktop app.');
      return;
    }
    const toSave = { ...project, updatedAt: new Date().toISOString() };
    const res = await window.lvds.projects.save(currentFile, toSave);
    setCurrentFile(res.file);
    setStatus(`Saved ${res.file}`);
    refreshList();
  }

  async function openProject(file: string) {
    if (!hasBridge) return;
    const p = await window.lvds.projects.load(file);
    history.load(p);
    setCurrentFile(file);
    setActiveBoardId(p.boards[0]?.id ?? '');
    setSelected(null);
    setStatus(`Opened ${file}`);
  }

  async function chooseFolder() {
    if (!hasBridge) return;
    const s = await window.lvds.settings.chooseProjectsFolder();
    setProjectsFolder(s.projectsFolder);
    refreshList();
    initDatabase(); // the database folder lives inside the projects folder
  }

  async function exportOpenDss() {
    const { script, warnings } = exportDss(project);
    const defaultName = `${project.name.replace(/[^a-z0-9]+/gi, '-')}.dss`;
    const warnNote = warnings.length ? ` — ${warnings.length} warning(s): ${warnings.join(' ')}` : '';
    if (!hasBridge) {
      const url = URL.createObjectURL(new Blob([script], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`Downloaded ${defaultName}${warnNote}`);
      return;
    }
    const saved = await window.lvds.files.saveText({ defaultName, content: script, filterName: 'OpenDSS script', extensions: ['dss'] });
    if (saved) setStatus(`Exported ${saved.split(/[\\/]/).pop()}${warnNote}`);
  }

  function startNewProject() {
    const p = applyParameters(newProject('Untitled project'), db); // your Parameters.xlsx defaults
    history.load(p);
    setCurrentFile(undefined);
    setActiveBoardId(p.boards[0].id);
    setSelected(null);
    setStatus('New project — not saved yet');
  }

  function saveFeeder(f: Feeder) {
    setProject((prev) => {
      const exists = prev.feeders.some((x) => x.id === f.id);
      const feeders = exists ? prev.feeders.map((x) => (x.id === f.id ? f : x)) : [...prev.feeders, f];
      return { ...prev, feeders };
    });
    setSelected(f.id);
    setShowFeederForm(null);
  }

  function openAddFeeder(preset: Partial<Feeder>) {
    setView('design');
    setFeederPreset(preset);
    setShowFeederForm('new');
  }

  function openTransformer() {
    const main = project.boards.find((b) => !b.upstreamId);
    if (!main) return;
    setView('design');
    selectBoard(main.id);
    setBoardTab('electrical');
  }

  function confirmDeleteSelected() {
    if (selectedFeeder && window.confirm(`Delete feeder ${selectedFeeder.id}?`)) deleteFeeder(selectedFeeder.id);
  }

  function editFeeder(id: string) {
    selectFeeder(id);
    setShowFeederForm('edit');
  }

  function saveBoardEdit(b: Board) {
    updateBoard(b);
    setEditBoardId(null);
  }

  function removeBoard(id: string) {
    try {
      const next = deleteBoard(project, id);
      setProject(next);
      setEditBoardId(null);
      const main = next.boards.find((b) => !b.upstreamId) ?? next.boards[0];
      if (main) selectBoard(main.id);
      setStatus(`Deleted ${id}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }

  function deleteFeeder(id: string) {
    setProject((prev) => ({ ...prev, feeders: prev.feeders.filter((x) => x.id !== id) }));
    setSelected(null);
    setShowFeederForm(null);
  }

  /** An item from the equipment library dropped on the SLD. */
  function dropItem(item: PaletteItem, target: DropTarget) {
    showResult(applyDrop(project, item, target, db.loads));
  }

  /** Something already on the SLD dragged to another busbar or feeder. */
  function moveItem(item: MoveItem, target: DropTarget) {
    showResult(applyMove(project, item, target));
  }

  function showResult(r: DropResult) {
    if (r.project !== project) setProject(r.project, { step: true });
    if (r.select?.type === 'board') selectBoard(r.select.id);
    if (r.select?.type === 'feeder') {
      setSelected(r.select.id);
      const f = r.project.feeders.find((x) => x.id === r.select!.id);
      if (f) setActiveBoardId(f.boardId);
      setPanel('feeder');
    }
    setStatus(r.message);
  }

  /** Delete key on the diagram: the selected feeder, or the selected board
   * with everything below it. */
  function deleteSelection() {
    if (panel === 'feeder' && selectedFeeder) return confirmDeleteSelected();
    if (panel === 'board' && board && window.confirm(`Delete ${board.id} and everything fed from it?`)) removeBoard(board.id);
  }

  // ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo, Delete on the diagram. Typing in a
  // field or a sheet keeps its own undo and delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || !!t.closest('.jss_container, .ls-sheet'));
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
      } else if (mod && e.key.toLowerCase() === 'c' && view === 'design' && panel === 'board' && board && !!t?.closest('.sysdiag')) {
        e.preventDefault();
        copyBoard(board.id);
      } else if (mod && e.key.toLowerCase() === 'v' && view === 'design' && panel === 'board' && board && copiedBoard && !!t?.closest('.sysdiag')) {
        e.preventDefault();
        setPasteTarget(board.id);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && view === 'design' && !!t?.closest('.sysdiag')) {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function copyBoard(id: string) {
    setCopiedBoard(id);
    setStatus(`Copied ${id} with everything below it — select the board to paste it on and press Paste (⌘V / Ctrl+V)`);
  }

  function addBoard(b: Board, incomer: Feeder) {
    setProject((prev) => ({ ...prev, boards: [...prev.boards, b], feeders: [...prev.feeders, incomer] }));
    setActiveBoardId(b.id);
    setPanel('board');
    setShowBoardForm(false);
  }

  return (
    <div className="app-root">
      <div className="top">
        <div className="brand">
          LV Design Studio
          <small>Low-voltage power design suite</small>
        </div>
        <div className="crumb">
          Projects / <b>{project.name}</b>
          {status && <span className="saved">{status}</span>}
        </div>
        <div className="sp" />
        <button className="chip" onClick={startNewProject}>New project</button>
        <button className="chip" onClick={saveProject}>Save</button>
      </div>

      <Ribbon
        tab={ribbonTab}
        onTab={setRibbonTab}
        a={{
          view,
          onView: setView,
          tool,
          onTool: setTool,
          boardId: board?.id ?? '',
          selectedFeederId: panel === 'feeder' ? selected : null,
          onAddFeeder: openAddFeeder,
          onAddBoard: () => setShowBoardForm(true),
          onTransformer: openTransformer,
          onBoardProperties: () => { setView('design'); if (board) selectBoard(board.id); setBoardTab('general'); },
          onEditSelected: () => { setView('design'); setShowFeederForm('edit'); },
          onDeleteSelected: confirmDeleteSelected,
          onExportDss: exportOpenDss,
          onSettings: () => setShowSettings(true),
          onUndo: history.undo,
          onRedo: history.redo,
          canUndo: history.canUndo,
          canRedo: history.canRedo
        }}
      />

      <div className="app">
        <nav className="nav" aria-label="Navigation">
          <h4>Design</h4>
          <button className={view === 'space-planning' ? 'on' : ''} onClick={() => setView('space-planning')}>Space planning</button>
          <button className={view === 'design' ? 'on' : ''} onClick={() => setView('design')}>Single line diagram</button>
          <button className={view === 'load-schedule' ? 'on' : ''} onClick={() => setView('load-schedule')}>Load schedule (DB)</button>

          <h4>Boards</h4>
          {project.boards.map((b) => (
            <button key={b.id} className={view === 'design' && panel === 'board' && board?.id === b.id ? 'on' : ''} style={{ paddingLeft: 10 + (b.upstreamId ? 12 : 0) }} onClick={() => { setView('design'); selectBoard(b.id); }}>
              {b.id}
            </button>
          ))}
          <button onClick={() => setShowBoardForm(true)}>+ Add board</button>

          <h4>Studies</h4>
          {STUDIES.map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>
          ))}

          <h4>Documents</h4>
          {DOCUMENTS.map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>
          ))}
          <button onClick={exportOpenDss} title="Export the network as an OpenDSS script to cross-check load flow and fault levels">Export OpenDSS (.dss)</button>

          <h4>Database</h4>
          <button className={view === 'database' ? 'on' : ''} onClick={() => setView('database')}>
            Equipment &amp; data {db.issues.length > 0 && <span className="warn">({db.issues.length} ⚠)</span>}
          </button>

          <h4>Projects folder</h4>
          <button onClick={chooseFolder} title={projectsFolder}>
            {hasBridge ? projectsFolder.split(/[\\/]/).pop() || 'Choose folder…' : 'Browser preview mode'}
          </button>
          <h4>Saved projects</h4>
          {projectList.length === 0 && <span className="m" style={{ padding: '4px 10px', color: 'var(--mut)' }}>No projects saved yet</span>}
          {projectList.map((p) => (
            <button key={p.file} className={currentFile === p.file ? 'on' : ''} onClick={() => openProject(p.file)}>
              {p.name}
            </button>
          ))}

        </nav>

        {view === 'design' && board ? (
          <>
            <main className="mid">
              <section className="stage">
                <div className="stage-head">
                  <div className="seg" role="tablist" aria-label="Diagram">
                    <button role="tab" aria-selected={diagramMode === 'system'} className={diagramMode === 'system' ? 'on' : ''} onClick={() => setDiagramMode('system')}>
                      System diagram
                    </button>
                    <button role="tab" aria-selected={diagramMode === 'board'} className={diagramMode === 'board' ? 'on' : ''} onClick={() => setDiagramMode('board')}>
                      Board: {board.id}
                    </button>
                  </div>
                  <div>
                    <button className="chip" onClick={() => openAddFeeder({})}>+ Add feeder to {board.id}</button>
                    <button className="chip" onClick={() => setShowBoardForm(true)}>+ Add board</button>
                    {panel === 'board' && board && <button className="chip" onClick={() => copyBoard(board.id)} title="Copy this board with its sub-boards, feeders and load schedule circuits (⌘C)">Copy {board.id}</button>}
                    {panel === 'board' && board && copiedBoard && project.boards.some((b) => b.id === copiedBoard) && (
                      <button className="chip" onClick={() => setPasteTarget(board.id)} title={`Paste ${copiedBoard} on ${board.id}'s busbar (⌘V)`}>Paste {copiedBoard} here</button>
                    )}
                    {diagramMode === 'system' && <button className="chip" onClick={() => setShowExport(true)} title="PDF sheet with title block, DXF for CAD, or SVG">Export drawing…</button>}
                    {selectedFeeder && panel === 'feeder' && <button className="chip" onClick={() => setShowFeederForm('edit')}>Edit {selectedFeeder.id}</button>}
                  </div>
                </div>
                {diagramMode === 'system' && (
                  <DiagramResultsBar
                    layers={layers}
                    onLayers={setLayers}
                    source={resultSource}
                    onSource={(s) => { setResultSource(s); setSimError(''); }}
                    onRun={runSimulation}
                    running={simRunning}
                    note={resultsNote}
                    colorBy={colorBy}
                    onColorBy={setColorBy}
                    supply={onGenerator ? 'generator' : outageId ? `outage:${outageId}` : 'normal'}
                    onSupply={setSupply}
                    hasGenerator={hasGenerator}
                    outages={tiedRoots}
                  />
                )}
                {diagramMode === 'system' ? (
                  <div className="sld-edit">
                  <EquipmentPalette onHint={setStatus} library={libraryEntries(db.loads)} />
                  <SystemDiagram
                    project={project}
                    results={genResults ?? allResults}
                    selectedFeederId={panel === 'feeder' ? selected : null}
                    selectedBoardId={panel === 'board' ? board.id : null}
                    onSelectFeeder={selectFeeder}
                    onSelectBoard={selectBoard}
                    tool={tool}
                    annotations={genAnnotations ?? annotations}
                    layers={layers}
                    onEditFeeder={editFeeder}
                    onEditBoard={(id) => { selectBoard(id); setEditBoardId(id); }}
                    onOpenSchedule={(id) => { setActiveBoardId(id); setView('load-schedule'); }}
                    colorBy={colorBy}
                    scenario={genScenario}
                    chain={chain}
                    onRemoveTie={(id) => {
                      if (!window.confirm(`Remove bus coupler ${id}?`)) return;
                      setProject(removeTie(project, id), { step: true });
                      setStatus(`Removed bus coupler ${id}`);
                    }}
                    onDropItem={dropItem}
                    onMoveItem={moveItem}
                    onPatchFeeder={(id, patch) => {
                      setProject((p) => ({ ...p, feeders: p.feeders.map((f) => (f.id === id ? { ...f, ...patch, cpcMm2: patch.cableCsaMm2 && patch.cableCsaMm2 !== f.cableCsaMm2 ? undefined : f.cpcMm2 } : f)) }), { step: true });
                      selectFeeder(id);
                      setStatus(`${id}: cable ${patch.parallel ? `${patch.parallel} × ` : ''}${patch.cores}C × ${patch.cableCsaMm2} mm², ${patch.lengthM} m`);
                    }}
                  />
                  </div>
                ) : (
                  <SingleLineDiagram board={board} voltageV={project.voltageV} results={boardResults} selected={selected} onSelect={selectFeeder} />
                )}
              </section>
              <SystemSummaryCards
                project={project}
                selectedBoardId={panel === 'board' ? board.id : null}
                onSelectBoard={selectBoard}
                annotations={engineFresh ? annotations : undefined}
                sourceLabel={engineFresh ? `${EXTERNAL_ENGINES.find((e) => e.id === resultSource)?.name} load flow: voltages include the transformer's own drop; fault levels from the engine's fault study.` : undefined}
              />
              <h3 className="section-title">Feeders on {board.id}</h3>
              <ResultsTable results={boardResults} vdLimitPct={project.vdLimitPct} selected={selected} onSelect={selectFeeder} />
            </main>

            <aside className="side">
              {panel === 'board' ? (
                <BoardPanel project={project} board={board} results={allResults} onChange={updateBoard} onSelectFeeder={selectFeeder} tab={boardTab} onTab={setBoardTab} />
              ) : (
                <>
                  <SidePanel results={boardResults} selected={selected} />
                  {selectedFeeder && <DiscriminationPanel project={project} feeder={selectedFeeder} />}
                </>
              )}
            </aside>
          </>
        ) : (
          <main className="mid" style={{ gridColumn: '2 / span 2' }}>
            {view === 'load-schedule' && board && (
              <LoadScheduleView project={project} boardId={board.id} db={db} onBoard={(id) => setActiveBoardId(id)} onChange={setProject} onStatus={setStatus} onSettings={() => setShowSettings(true)} />
            )}
            {view === 'database' && (
              <DatabaseView
                db={db}
                available={hasDatabase}
                onRefresh={() => window.lvds.database.read().then(receiveDatabase)}
                onApplyParameters={() => {
                  setProject((p) => p.boards.reduce((q, b) => refreshBoard(q, b.id), applyParameters(p, db)));
                  setStatus('Applied Parameters.xlsx to this project');
                }}
              />
            )}
            {view === 'engines' && (
              <>
                <section className="stage"><h3>Load flow — engine comparison</h3></section>
                <EngineCompare project={project} />
              </>
            )}
            {view === 'voltage-drop' && <VoltageDropStudy project={project} onChange={setProject} onStatus={setStatus} />}
            {view === 'earthing' && <EarthingStudy project={project} onSelectFeeder={(id) => { setView('design'); selectFeeder(id); }} />}
            {view === 'selection' && <SelectionStudy project={project} onChange={setProject} />}
            {view === 'coordination' && <CoordinationStudy project={project} />}
            {view === 'sizing' && <TransformerGeneratorStudy project={project} onChange={setProject} />}
            {view === 'pfc' && <PfcStudy project={project} onChange={setProject} />}
            {view === 'db-schedule' && <DbScheduleView project={project} onStatus={setStatus} />}
            {view === 'cable-schedule' && <CableScheduleView project={project} onStatus={setStatus} />}
            {view === 'equipment' && <EquipmentScheduleView project={project} onStatus={setStatus} />}
            {view === 'report' && <ReportView project={project} onStatus={setStatus} />}
            {view === 'space-planning' && (
              <SpacePlanView
                project={project}
                onChange={(p, step) => setProject(p, step ? { step: true } : undefined)}
                onStatus={setStatus}
                onCreated={() => {
                  const first = project.boards[0]?.id;
                  setView('design');
                  setDiagramMode('system');
                  if (first) setActiveBoardId(first);
                }}
              />
            )}
            {view === 'revisions' && <RevisionsView project={project} onChange={setProject} onStatus={setStatus} />}
            {view === 'boq' && (
              <>
                <section className="stage"><h3>Cost estimate — whole project</h3></section>
                <BoqTable results={allResults} projectName={project.name} />
              </>
            )}
          </main>
        )}
      </div>

      <div className="foot">
        <span>Base: {project.voltageV} V, 3-phase, {project.frequencyHz} Hz</span>
        <span>Ambient: {project.ambientC} °C</span>
        <span>Vd limit: {project.vdLimitPct}%</span>
        <span className="sp" />
        <span>{hasBridge ? `Projects folder: ${projectsFolder}` : 'Run inside the Electron app to save/load projects'}</span>
      </div>

      {showFeederForm && board && (
        <FeederForm
          project={project}
          boardId={board.id}
          initial={showFeederForm === 'edit' ? selectedFeeder : undefined}
          preset={showFeederForm === 'new' ? feederPreset : undefined}
          library={db.loads}
          onSave={saveFeeder}
          onDelete={showFeederForm === 'edit' && selectedFeeder ? () => deleteFeeder(selectedFeeder.id) : undefined}
          onClose={() => setShowFeederForm(null)}
        />
      )}
      {editBoardId && project.boards.some((b) => b.id === editBoardId) && (() => {
        const b = project.boards.find((x) => x.id === editBoardId)!;
        const incomer = project.feeders.find((f) => f.feedsBoardId === b.id && f.boardId === b.upstreamId);
        const deletable = !!b.upstreamId || project.boards.filter((x) => !x.upstreamId).length > 1;
        return (
          <BoardEditForm
            key={b.id}
            project={project}
            board={b}
            onSave={saveBoardEdit}
            onDelete={deletable ? () => removeBoard(b.id) : undefined}
            onEditIncomer={incomer ? () => { setEditBoardId(null); editFeeder(incomer.id); } : undefined}
            onClose={() => setEditBoardId(null)}
          />
        );
      })()}
      {pasteTarget && copiedBoard && project.boards.some((b) => b.id === copiedBoard) && (
        <PasteBoardDialog
          project={project}
          sourceId={copiedBoard}
          targetId={pasteTarget}
          onClose={() => setPasteTarget(null)}
          onPaste={(r) => {
            const res = pasteBoard(project, copiedBoard, pasteTarget, r);
            setProject(res.project, { step: true });
            selectBoard(res.rootId);
            setStatus(res.message);
            setPasteTarget(null);
          }}
        />
      )}
      {showExport && (
        <SldExportDialog
          project={project}
          onSave={(d) => setProject((p) => ({ ...p, drawing: d }))}
          onStatus={setStatus}
          onClose={() => setShowExport(false)}
        />
      )}
      {showSettings && (
        <ProjectSettings
          project={project}
          // Minimum wire sizes may have changed: re-size every auto-sized schedule circuit.
          onSave={(p) => { setProject(p.boards.reduce((q, b) => refreshBoard(q, b.id), p)); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showBoardForm && board && (
        <BoardForm project={project} parentBoardId={board.id} onSave={addBoard} onClose={() => setShowBoardForm(false)} />
      )}
    </div>
  );
}
