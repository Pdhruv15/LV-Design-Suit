import { pickProject } from './model/projectStore';
import { chooseProjectFile, downloadProjectFile } from './util/webApp';
import WebBanner from './components/WebBanner';
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Feeder, Board, Project, newProject } from './types';
import { sampleProject } from './data/sampleProject';
import { evaluateProject, type Status } from './calc/electrical';
import { boardIncomerLabel } from './docs/loadScheduleDoc';
import SingleLineDiagram from './components/SingleLineDiagram';
import ResultsTable from './components/ResultsTable';
import SidePanel from './components/SidePanel';
import FeederForm from './components/FeederForm';
import BoardForm from './components/BoardForm';
const BomView = lazy(() => import('./components/docs/BomView'));
import { exportDss } from './engines/opendss/exportDss';
const EngineCompare = lazy(() => import('./components/EngineCompare'));
import SystemDiagram from './components/SystemDiagram';
import SystemSummaryCards from './components/SystemSummaryCards';
import BoardPanel from './components/BoardPanel';
const EarthingStudy = lazy(() => import('./components/studies/EarthingStudy'));
const SelectionStudy = lazy(() => import('./components/studies/SelectionStudy'));
const VoltageDropStudy = lazy(() => import('./components/studies/VoltageDropStudy'));
const RevisionsView = lazy(() => import('./components/docs/RevisionsView'));
const SpacePlanView = lazy(() => import('./components/docs/SpacePlanView'));
const TrayScheduleView = lazy(() => import('./components/docs/TrayScheduleView'));
const SubstationAreaView = lazy(() => import('./components/docs/SubstationAreaView'));
const UpsStudy = lazy(() => import('./components/studies/UpsStudy'));
const SolarStudy = lazy(() => import('./components/studies/SolarStudy'));
const StudyReportsView = lazy(() => import('./components/docs/StudyReportsView'));
const QuickCalcs = lazy(() => import('./components/QuickCalcs'));
const CoordinationStudy = lazy(() => import('./components/studies/CoordinationStudy'));
const TransformerGeneratorStudy = lazy(() => import('./components/studies/SizingStudy').then((m) => ({ default: m.TransformerGeneratorStudy })));
const PfcStudy = lazy(() => import('./components/studies/PfcStudy'));
const BusbarStudy = lazy(() => import('./components/studies/BusbarStudy'));
const BuildingView = lazy(() => import('./components/docs/BuildingView'));
const ProjectDashboard = lazy(() => import('./components/docs/ProjectDashboard'));
const HelpView = lazy(() => import('./components/HelpView'));
const ParametersView = lazy(() => import('./components/docs/ParametersView'));
const TitleBlockDesigner = lazy(() => import('./components/docs/TitleBlockDesigner'));
import DrawingsView from './components/docs/DrawingsView';
import { withCableRefs } from './model/cableRefs';
import { withEarthPitIds } from './model/earthingPlan';
import { SheetTabs, SheetWorkspace, sheetOutlines } from './components/sld/SheetWorkspace';
import { movePanelToSheet, setOf } from './model/drawingSet';
import { boardsInSupplyOrder } from './calc/summary';
import ComponentEditor from './components/ComponentEditor';
import { componentPreset, newComponent, syncComponent, type UserComponent } from './model/components';
const documents = () => import('./components/docs/Documents');
const CableScheduleView = lazy(() => documents().then((m) => ({ default: m.CableScheduleView })));
const DbScheduleView = lazy(() => documents().then((m) => ({ default: m.DbScheduleView })));
const EquipmentScheduleView = lazy(() => documents().then((m) => ({ default: m.EquipmentScheduleView })));
const ReportView = lazy(() => documents().then((m) => ({ default: m.ReportView })));
const LoadScheduleView = lazy(() => import('./components/docs/LoadScheduleView'));
import { refreshBoard } from './model/schedule';
const DatabaseView = lazy(() => import('./components/docs/DatabaseView'));
import { pullLibrary } from './database/librarySync';
import { applyDatabase, applyParameters, databaseSeeds, EMPTY_DATABASE, parseDatabase, syncLibrary, type Database, type RawDatabase } from './database/database';

// window.lvds is only present when running inside Electron. Fall back to
// in-memory-only mode so the same UI still runs in a plain browser tab
// during development (`vite` alone, without `electron .`).
const hasBridge = typeof window !== 'undefined' && !!window.lvds;
// The database needs the desktop app's main process to be up to date too
// (an older running instance has the bridge but no database handlers).
const hasDatabase = hasBridge && !!window.lvds.database;

import type { MainView } from './views';
import Ribbon, { type BomCommand, tabForView, type DiagramTool, type RibbonTab } from './components/Ribbon';
import ProjectSettings from './components/ProjectSettings';
import type { BoardTab } from './components/BoardPanel';
import BoardEditForm from './components/BoardEditForm';
import MenuButton from './components/MenuButton';
import DiagramResultsBar, { type ResultSource } from './components/DiagramResultsBar';
import { buildAnnotations, DEFAULT_LAYERS, type ResultLayers } from './diagram/annotations';
import { EXTERNAL_ENGINES } from './engines';
import type { StudyResults } from './engines/types';
import { deleteBoard } from './model/edit';
import { useHistory } from './model/history';
import { runCalculations, staleStudies, STUDY_LABEL, type CalcRun } from './calc/runs';
import { StaleBanner } from './components/ui';
import { generatorScenario, transformerOutage, type SupplyMode } from './calc/scenario';
import { removeTie } from './model/sldEdit';
import type { ColorBy } from './diagram/heatmap';
import { applyMove, dropMany, libraryEntries, type DropResult, type DropTarget, type MoveItem, type PaletteItem } from './model/sldEdit';
import EquipmentPalette from './components/EquipmentPalette';
import { loadUserPresets, mergePresets, presetFromFeeder, presetsFile, readPresetsFile, saveUserPresets, type FeederPreset } from './model/presets';
import PresetEditor from './components/PresetEditor';
import { isScheduleCircuit } from './calc/loadSchedule';
import { CABLE_TYPE_DEFS, cableTypeDef } from './model/cableTypes';
import { saveText } from './util/files';
const SldExportDialog = lazy(() => import('./components/SldExportDialog'));
import PasteBoardDialog from './components/PasteBoardDialog';
const EnclosureSizing = lazy(() => import('./components/EnclosureSizing'));
import EarthingView from './components/EarthingView';
import PanelsPage from './components/PanelsPage';
import DiscriminationPanel from './components/DiscriminationPanel';
import { discriminationChain } from './calc/protection';
import { pasteBoard } from './model/copyBoard';
import { applyDefaults, applyProfile, initialsOf, loadPrefs, savePrefs, signature, type Preferences } from './model/profile';
import { clearRecovery, deleteProjectFile, inDesktop, listProjects, loadProject, emptyTrash, listTrash, loadProjectStamped, readRecoveries, recentFiles, restoreProject, saveProjectFile, statProject, touchRecent, whenText, writeRecovery, type ProjectMeta, type Recovery, type TrashedProject } from './model/projectStore';
import { applyDetails, withArchived, type ProjectDetails } from './model/projectList';
import ProjectDetailsDialog from './components/ProjectDetailsDialog';
import { BriefDialog, NewProjectWizard } from './components/BriefEditor';
import BaselineBar from './components/BaselineBar';
const ChangesView = lazy(() => import('./components/docs/ChangesView'));
const ReviewView = lazy(() => import('./components/docs/ReviewView'));
import { applyTemplateSystem, loadTemplates, saveTemplates, templateFrom, type SetupTemplate } from './model/setupTemplate';
import CheckpointsPanel from './components/docs/CheckpointsPanel';
const ReceivedDocsView = lazy(() => import('./components/docs/ReceivedDocsView'));
import { applyBrief, type ProjectBrief } from './model/brief';
import { defaultsPreview } from './model/setupPreview';
import { copyProject, isFutureSchema, migrateProject } from './model/projectMigrate';
import { projectFingerprint, type FileStamp } from './model/saveSafety';
import { CompareDialog, ConflictDialog, ExternalChangeBar } from './components/SaveDialogs';
import PreferencesDialog from './components/PreferencesDialog';
import PanelTree from './components/PanelTree';
import { moveBoard, moveSummary, reorderBoard } from './model/moveBoard';
const ProjectsDashboard = lazy(() => import('./components/ProjectsDashboard'));
import { NameDialog, UnsavedDialog } from './components/FileDialogs';
import type { BoardKind, ProjectStatus } from './types';
type DiagramMode = 'system' | 'board';

/** Pages that show network study results (they follow the last run). */
/** Pages the panel tree filters to a board and the boards below it. */
const FOCUS_VIEWS: MainView[] = ['earthing', 'selection', 'cable-schedule'];

const STUDY_VIEWS: MainView[] = ['voltage-drop', 'earthing', 'selection', 'coordination', 'db-schedule', 'cable-schedule', 'report'];

/** A project as the app holds it once opened: with its id and version, earth pit IDs and cable reference
 * numbers already in place — so opening never counts as an unsaved change (these are bookkeeping, not edits). */
const normalised = (p: Project, file?: string): Project => withCableRefs(withEarthPitIds(migrateProject(p, file)));

export default function App() {
  // The project, with undo / redo. Opening or starting a project clears the history.
  const history = useHistory<Project>(normalised(sampleProject));
  const project = history.value;
  const setHistory = history.set;
  const setProject: typeof history.set = useCallback((value, opts) => setHistory((prev) => {
    const before = withEarthPitIds(prev);
    const next = typeof value === 'function' ? value(before) : value;
    return withEarthPitIds(next, before);
  }, opts), [setHistory]);
  // SLD tabs: null = Design (the working canvas), else a drawing sheet.
  const [sheetTab, setSheetTab] = useState<string | null>(null);
  const [sheetOutlinesOn, setSheetOutlinesOn] = useState(false);
  // Results under the SLD: open / closed (remembered); a row click centres the drawing on it.
  const [resTab, setResTab] = useState<'summary' | 'buses' | 'feeders' | null>(() => { try { const v = localStorage.getItem('lvds.resTab'); return v === 'summary' || v === 'buses' || v === 'feeders' ? v : null; } catch { return null; } });
  const [sldFocus, setSldFocus] = useState<{ kind: 'board' | 'feeder'; id: string; n: number } | undefined>();
  // A cable type new to the project gets the next free reference number (kept).
  const patchHistory = history.patch;
  useEffect(() => { patchHistory(withCableRefs); }, [patchHistory, project.feeders, project.cableRefs]);
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);
  const [projectsFolder, setProjectsFolder] = useState<string>('');
  const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
  const [trashList, setTrashList] = useState<TrashedProject[]>([]);
  const [wizard, setWizard] = useState(false);
  const [briefDialog, setBriefDialog] = useState(false);
  const [detailsFor, setDetailsFor] = useState<{ file: string; project: Project } | null>(null);
  // Unsaved changes: the project differs from the one last saved or opened.
  const [saved, setSaved] = useState<Project | null>(project);
  // "Unsaved" means the content differs from what was saved — undoing back to the saved state is clean again.
  // The comparison runs on a deferred copy so typing stays responsive; until it catches up an edit counts as unsaved.
  const deferredProject = useDeferredValue(project);
  const savedFp = useMemo(() => (saved ? projectFingerprint(saved) : ''), [saved]);
  const projectFp = useMemo(() => (project === saved ? '' : projectFingerprint(deferredProject)), [deferredProject, project, saved]);
  const dirty = project !== saved && (saved === null || deferredProject !== project || projectFp !== savedFp);
  /** What the open file was when read or last saved (desktop): a different file on disk is a conflict. */
  const fileStamp = useRef<FileStamp | null | undefined>(undefined);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'failed'; msg?: string }>({ kind: 'idle' });
  const [conflict, setConflict] = useState<{ file: string; mine: Project; disk: Project | null; diskStamp?: FileStamp | null } | null>(null);
  const [external, setExternal] = useState<'changed' | 'missing' | null>(null);
  const [readOnly, setReadOnly] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ aName: string; bName: string; a: Project; b: Project } | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  const [showPrefs, setShowPrefs] = useState(false);
  const [recent, setRecent] = useState<string[]>(recentFiles);
  // One recovery copy per project; the newest is offered first.
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const recovery = recoveries[0] ?? null;
  /** Asking what to do with unsaved changes before `then`. */
  const [ask, setAsk] = useState<{ action: string; then: () => void } | null>(null);
  const [nameAsk, setNameAsk] = useState<{ title: string; note?: string; initial: string; okLabel: string; then: (name: string) => void } | null>(null);
  // For timers and window events, which outlive a render.
  const live = useRef({ project, saved, currentFile, recoveries });
  live.current = { project, saved, currentFile, recoveries };
  // Changes the app makes by itself (the database syncing) don't count as
  // the user's unsaved changes when there were none.
  const adoptNext = useRef(false);
  useEffect(() => {
    if (adoptNext.current) { adoptNext.current = false; setSaved(project); }
  }, [project]);
  const [activeBoardId, setActiveBoardId] = useState<string>(project.boards[0]?.id ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [view, setViewState] = useState<MainView>('projects'); // the app starts on the projects list
  const [ribbonTab, setRibbonTab] = useState<RibbonTab>('home');
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
  const [createdPanelIds, setCreatedPanelIds] = useState<string[]>([]);
  // Study pages filtered to a board and the boards below it (panel tree).
  const [focus, setFocus] = useState<string | null>(null);
  const [dbScheduleAll, setDbScheduleAll] = useState(true);
  const [bomCmd, setBomCmd] = useState<{ cmd: BomCommand; n: number } | undefined>();

  // LV Database: Excel workbooks in the projects folder. Every save in Excel
  // arrives here; the data is applied to the calculations, library-linked
  // WATT/UNIT values are synced, and the project is re-evaluated.
  function receiveDatabase(raw: RawDatabase & { created?: string[] }) {
    const parsed = parseDatabase(raw);
    applyDatabase(parsed);
    setDb(parsed);
    adoptNext.current = live.current.project === live.current.saved;
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
    window.lvds.database.init(databaseSeeds()).then(receiveDatabase).then(() => pullLibrary()).catch((e) => setStatus(`Database: ${e.message}`));
  }

  // The latest handlers, so the listener registered once on start never runs an old render's copy.
  const dbHandlers = useRef({ initDatabase, receiveDatabase });
  dbHandlers.current = { initDatabase, receiveDatabase };
  useEffect(() => {
    if (!hasDatabase) return;
    dbHandlers.current.initDatabase();
    return window.lvds.database.onChange((raw) => dbHandlers.current.receiveDatabase(raw));
  }, []);
  // Navigating (left menu or ribbon) keeps the ribbon on the matching tab.
  const setView = (v: MainView) => {
    setViewState(v);
    setRibbonTab(tabForView(v));
  };
  const [showFeederForm, setShowFeederForm] = useState<'new' | 'edit' | null>(null);
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [boardPreset, setBoardPreset] = useState<{ kind: BoardKind; ratingA: number } | undefined>();
  const [diagramMode, setDiagramMode] = useState<DiagramMode>('system');
  const [panel, setPanel] = useState<'feeder' | 'board'>('board');

  // Network studies run on demand (Run calculations / F5): results come from
  // the last run, and a study shows as out of date once one of its own
  // inputs changes. Auto-run (project setting) runs them on every change.
  const [run, setRun] = useState<CalcRun | undefined>(() => runCalculations(project));
  const autoRun = !!project.calc?.autoRun;
  useEffect(() => { if (autoRun && run?.project !== project) setRun(runCalculations(project)); }, [autoRun, project, run?.project]);
  const staleKeys = useMemo(() => staleStudies(run, project), [run, project]);
  const stale = staleKeys.map((k) => STUDY_LABEL[k]);
  // What the studies show: the project as last run while out of date,
  // otherwise the live one (same results, current names).
  const calcProject = staleKeys.length && run ? run.project : project;
  const runNow = () => {
    const r = runCalculations(project);
    setRun(r);
    const fails = r.results.filter((x) => x.status === 'bad').length;
    setStatus(`Calculated ${r.results.length} feeders in ${Math.max(1, Math.round(r.ms))} ms — ${fails ? `${fails} failing` : 'all within the calculated limits'}`);
  };
  const allResults = useMemo(() => {
    const live = new Map(project.feeders.map((f) => [f.id, f]));
    return (run?.results ?? []).map((r) => ({ ...r, feeder: live.get(r.feeder.id) ?? r.feeder }));
  }, [run, project]);
  const board = project.boards.find((b) => b.id === activeBoardId) ?? project.boards[0];
  const boardResults = useMemo(() => allResults.filter((r) => r.feeder.boardId === board?.id), [allResults, board]);
  const selectedFeeder = project.feeders.find((f) => f.id === selected);

  // Engine results are used only while they match the current project and
  // the chosen source; any edit falls back to the instant built-in values.
  const engineFresh = !!engineRun && engineRun.project === project && engineRun.results.engineId === resultSource;
  const annotations = useMemo(
    () => buildAnnotations(calcProject, allResults, engineFresh ? engineRun!.results : undefined),
    [calcProject, allResults, engineFresh, engineRun]
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
    () => (onGenerator ? generatorScenario(calcProject) : outageId ? transformerOutage(calcProject, outageId) : undefined),
    [calcProject, onGenerator, outageId]
  );
  const genResults = useMemo(() => (genScenario ? evaluateProject(genScenario.project) : undefined), [genScenario]);
  const genAnnotations = useMemo(() => (genScenario && genResults ? buildAnnotations(genScenario.project, genResults) : undefined), [genScenario, genResults]);

  // The selected feeder's breaker chain, highlighted on the SLD.
  const chain = useMemo(() => {
    if (panel !== 'feeder' || !selectedFeeder) return undefined;
    const m = new Map<string, Status>();
    const f = calcProject.feeders.find((x) => x.id === selectedFeeder.id);
    if (!f) return undefined;
    for (const r of discriminationChain(calcProject, f)) {
      m.set(r.upstream.id, r.status);
      if (!m.has(r.downstream.id)) m.set(r.downstream.id, r.status);
    }
    return m;
  }, [calcProject, panel, selectedFeeder]);

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
    refreshList();
    readRecoveries().then(setRecoveries);
    if (!hasBridge) return;
    window.lvds.settings.get().then((s) => setProjectsFolder(s.projectsFolder));
  }, []);

  // Recovery copy of unsaved work, every few minutes (Profile & preferences).
  // Paused while a recovered copy is waiting to be restored or discarded.
  useEffect(() => {
    const min = prefs.app.autosaveMin;
    if (!min) return;
    const t = setInterval(() => {
      const { project: p, saved: s, currentFile: f, recoveries: pending } = live.current;
      // Not while a recovered copy of this same project is still waiting to be restored or discarded.
      if (p !== s && !pending.some((r) => r.projectId === p.id)) writeRecovery({ file: f, at: Date.now(), project: p });
    }, min * 60000);
    return () => clearInterval(t);
  }, [prefs.app.autosaveMin]);

  // Closing the window (or reloading) with unsaved changes: keep a recovery
  // copy and ask first.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const { project: p, saved: s, currentFile: f, recoveries: pending } = live.current;
      if (p === s) return;
      if (!pending.some((r) => r.projectId === p.id)) writeRecovery({ file: f, at: Date.now(), project: p });
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${project.name} — LV Design Studio v${__APP_VERSION__}`;
  }, [dirty, project.name]);

  // Back in the window: did the open project's file change meanwhile (another computer, a sync, another program)?
  useEffect(() => {
    if (!hasBridge) return;
    const check = async () => {
      const { currentFile: f } = live.current;
      const known = fileStamp.current;
      if (!f || !known) return;
      const now = await statProject(f);
      if (now === undefined) return;
      if (now === null) setExternal('missing');
      else if (now.hash !== known.hash) setExternal('changed');
    };
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  /** The file on disk next to what is open: the same review as a save conflict. */
  async function reviewDiskChanges() {
    const f = currentFile;
    if (!f) return;
    try {
      const r = await loadProjectStamped(f);
      setConflict({ file: f, mine: project, disk: r.project, diskStamp: r.stamp });
    } catch (e) { setStatus(`Could not read ${f}: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async function reloadFromDisk(file: string) {
    try {
      const { project: p, stamp } = await loadProjectStamped(file);
      loadIntoApp(p, file, `Loaded the version of ${p.name} on disk`, stamp);
    } catch (e) { setStatus(`Could not open ${file}: ${e instanceof Error ? e.message : String(e)}`); }
  }

  /** Conflict dialog: take the file on disk, and keep what is open here as recoverable work. */
  async function useDiskVersion() {
    const c = conflict;
    if (!c?.disk) return;
    const rec: Recovery = { projectId: project.id, file: c.file, at: Date.now(), project };
    if (project.id && await writeRecovery(rec)) setRecoveries((l) => [rec, ...l.filter((x) => x.projectId !== rec.projectId)]);
    loadIntoApp(c.disk, c.file, `Loaded the version on disk — your unsaved version is kept as recoverable work`, c.diskStamp);
  }

  async function compareFiles(file: string, other: string) {
    try {
      const [a, b] = await Promise.all([loadProject(file), loadProject(other)]);
      setCompare({ aName: file, bName: other, a, b });
    } catch (e) { setStatus(`Could not compare: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async function restoreRecovery() {
    const r = recovery;
    if (!r) return;
    // The file's baseline: what it is now — or, when it was saved again after this copy was made, a stamp that
    // can never match, so the first save asks what to do instead of overwriting.
    const now = r.file ? await statProject(r.file) : undefined;
    const stamp = r.file ? (r.fileChangedSince ? { mtimeMs: 0, size: 0, hash: 'file-changed-after-recovery-copy' } : now) : undefined;
    loadIntoApp(r.project, r.file, `Restored your unsaved work from ${whenText(r.at)}${r.fileChangedSince ? ' — the file was saved again since; saving will ask what to do' : ' — save it to keep it'}`, stamp);
    setSaved(null); // restored work is unsaved
    setRecoveries((list) => list.filter((x) => x !== r));
  }

  // When another board opens, select its first circuit unless the selection is already on it.
  // Only on a board change: picking or clearing a circuit on the same board must not re-select one.
  const lastBoardId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (board?.id === lastBoardId.current) return;
    lastBoardId.current = board?.id;
    if (!board) return;
    if (!boardResults.find((r) => r.feeder.id === selected)) {
      setSelected(boardResults[0]?.feeder.id ?? null);
    }
  }, [board, boardResults, selected]);

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
    listProjects().then(setProjectList).catch(() => setProjectList([]));
    listTrash().then(setTrashList).catch(() => setTrashList([]));
  }

  /** Saves the open project (Ctrl+S); with a name, as a new project file (Save as: its own project,
   * with the current one left as it was last saved). A file that someone else changed since it was opened
   * is not overwritten: the conflict dialog asks (force = the user chose to overwrite). Resolves to false
   * when it couldn't be saved. */
  async function saveProject(asName?: string, force = false): Promise<boolean> {
    if (readOnly && !asName) {
      setStatus(`Not saved: ${readOnly} Use Save as to keep your own copy.`);
      setSaveState({ kind: 'failed', msg: readOnly });
      return false;
    }
    const named = asName ? copyProject(project, 'save-as', asName, prefs.profile.name) : project;
    const toSave = { ...named, updatedAt: new Date().toISOString(), updatedBy: prefs.profile.name || named.updatedBy };
    setSaveState({ kind: 'saving' });
    try {
      const out = await saveProjectFile(asName ? undefined : currentFile, toSave, { expected: asName ? undefined : fileStamp.current, force });
      if (out.conflict) {
        const disk = await loadProjectStamped(out.file).then((r) => r.project).catch(() => null);
        setConflict({ file: out.file, mine: project, disk, diskStamp: out.disk });
        setSaveState({ kind: 'idle' });
        setStatus('Not saved — the file changed on disk. Choose what to keep.');
        return false;
      }
      if (named !== project) setProject(named, { step: true });
      setSaved(named);
      setCurrentFile(out.file);
      fileStamp.current = out.stamp;
      setExternal(null);
      setReadOnly(null);
      setRecent(touchRecent(out.file));
      void clearRecovery(project.id);
      void clearRecovery(named.id);
      setSaveState({ kind: 'idle' });
      setStatus(`Saved ${named.name} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      refreshList();
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveState({ kind: 'failed', msg });
      setStatus(`Not saved: ${msg}`);
      return false;
    }
  }

  /** Runs `then` now, or after asking about unsaved changes. */
  function guard(action: string, then: () => void) {
    if (!dirty) return then();
    setAsk({ action, then });
  }

  function loadIntoApp(p: Project, file: string | undefined, message: string, stamp?: FileStamp | null) {
    // Older files get an id and version here; opening alone never counts as an unsaved change.
    const opened = normalised(p, file);
    history.load(opened);
    setSaved(opened);
    fileStamp.current = file ? stamp : undefined;
    setExternal(null);
    setConflict(null);
    setSaveState({ kind: 'idle' });
    setReadOnly(isFutureSchema(p) ? 'This project was saved by a newer version of LV Design Studio, so it is open read-only.' : null);
    setRun(runCalculations(opened)); // results for the project as opened
    // Presets saved with the project join this computer's presets.
    if (p.feederPresets?.length) {
      const m = mergePresets(loadUserPresets(), p.feederPresets);
      if (m.added) { setUserPresets(m.list); saveUserPresets(m.list); }
    }
    setCurrentFile(file);
    setActiveBoardId(p.boards[0]?.id ?? '');
    setCreatedPanelIds([]);
    setSelected(null);
    setStatus(isFutureSchema(p) ? `${message} — read-only (saved by a newer version)` : message);
    setView('dashboard'); // a project opens on its dashboard
  }

  /** Open project…: the desktop file picker; in the browser, the list below. */
  async function pickAndOpen() {
    if (!hasBridge) {
      try {
        const r = await chooseProjectFile();
        if (r) guard('opening another project', () => loadIntoApp(r.project, undefined, `Opened ${r.name} — saved in this browser when you press Save; Download file keeps a copy on your computer`));
      } catch (e) { setStatus(`Could not open the file: ${e instanceof Error ? e.message : String(e)}`); }
      return;
    }
    try {
      const r = await pickProject();
      if (!r) return;
      if (r.file) return openProject(r.file);
      if (r.data) guard('opening another project', () => { loadIntoApp(r.data!, undefined, `Opened ${r.data!.name} from ${r.from} — Save keeps it in the projects folder`); });
    } catch (e) {
      setStatus(`Could not open the project: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function openProject(file: string) {
    if (file === currentFile && !dirty) { setView('dashboard'); return; } // the project's Overview, like any opened project
    guard('opening another project', async () => {
      try {
        const { project: p, stamp } = await loadProjectStamped(file);
        loadIntoApp(p, file, `Opened ${p.name}`, stamp);
        setRecent(touchRecent(file));
      } catch (e) {
        setStatus(`Could not open ${file}: ${e instanceof Error ? e.message : String(e)}`);
        refreshList();
      }
    });
  }

  function saveAs(initial = `${project.name} (copy)`) {
    setNameAsk({ title: 'Save as a new project', note: 'A new project with its own identity (revision history is kept); the current one stays as it was last saved.', initial, okLabel: 'Save', then: (n) => saveProject(n) });
  }

  function duplicateFile(file: string) {
    const m = projectList.find((x) => x.file === file);
    setNameAsk({
      title: 'Duplicate project',
      note: 'A copy to start a similar job: a new project with its own identity. Its revision history and transmittals are not copied, and its status starts at Design.',
      initial: `${m?.name ?? 'Project'} (copy)`,
      okLabel: 'Create copy',
      then: async (name) => {
        try {
          const p = await loadProject(file);
          await saveProjectFile(undefined, copyProject(migrateProject(p, file), 'duplicate', name, prefs.profile.name));
          refreshList();
          setStatus(`Created “${name}” — it’s in the projects list`);
        } catch (e) {
          setStatus(`Not copied: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });
  }

  async function deleteFile(file: string) {
    const m = projectList.find((x) => x.file === file);
    if (!window.confirm(`Delete the project “${m?.name ?? file}”? It moves to the trash and can be restored for 30 days.`)) return;
    try {
      await deleteProjectFile(file);
      setRecent(touchRecent(file, true));
      if (file === currentFile) { setCurrentFile(undefined); setSaved(null); } // still open, now unsaved
      setStatus(`Moved ${m?.name ?? file} to the trash — Projects → Trash restores it for 30 days`);
    } catch (e) {
      setStatus(`Not deleted: ${e instanceof Error ? e.message : String(e)}`);
    }
    refreshList();
  }

  /** Changes some details of a project file — the open one through the app's own state (and save), another one by
   * reading it fresh, changing it and saving with the changed-on-disk check. */
  async function patchProjectFile(file: string, change: (p: Project) => Project, what: string) {
    const changedOnDisk = () => setStatus(`${what} not saved — the file changed on disk. Open the project and save to review the differences.`);
    try {
      if (file === currentFile) {
        const next = change(project);
        setProject(next, { step: true });
        if (dirty) { setStatus(`${what} changed — save the project to keep it`); return; }
        const out = await saveProjectFile(file, { ...next, updatedAt: new Date().toISOString(), updatedBy: prefs.profile.name || next.updatedBy }, { expected: fileStamp.current });
        if (out.conflict) { changedOnDisk(); return; }
        fileStamp.current = out.stamp;
        setSaved(next);
      } else {
        const { project: p, stamp } = await loadProjectStamped(file);
        const out = await saveProjectFile(file, { ...change(p), updatedAt: new Date().toISOString(), updatedBy: prefs.profile.name || p.updatedBy }, { expected: stamp });
        if (out.conflict) { changedOnDisk(); return; }
      }
      refreshList();
    } catch (e) {
      setStatus(`${what} not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const setFileStatus = (file: string, st: ProjectStatus) => patchProjectFile(file, (p) => ({ ...p, status: st }), 'Status');
  const archiveFile = (file: string, archived: boolean) => patchProjectFile(file, (p) => withArchived(p, archived), archived ? 'Archive' : 'Restore from archive');

  async function openDetails(file: string) {
    try {
      const p = file === currentFile ? project : (await loadProjectStamped(file)).project;
      setDetailsFor({ file, project: p });
    } catch (e) { setStatus(`Could not open the details: ${e instanceof Error ? e.message : String(e)}`); }
  }

  async function restoreFromTrash(trashFile: string) {
    try {
      const file = await restoreProject(trashFile);
      setStatus(`Restored ${file}`);
    } catch (e) { setStatus(`Not restored: ${e instanceof Error ? e.message : String(e)}`); }
    refreshList();
  }

  async function emptyTheTrash() {
    if (!window.confirm(`Delete the ${trashList.length} project${trashList.length === 1 ? '' : 's'} in the trash for good? This cannot be undone.`)) return;
    await emptyTrash();
    refreshList();
  }

  function savePreferences(p: Preferences) {
    setPrefs(p);
    setShowPrefs(false);
    setStatus(savePrefs(p) ? 'Preferences saved' : 'Preferences could not be stored on this computer (is the logo very large?)');
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

  /** New project: the wizard (role, parties, scope, deliverables) or Quick create from the name alone. */
  function startNewProject() {
    guard('starting a new project', () => setWizard(true));
  }

  function createProject(name: string, brief?: ProjectBrief, template?: SetupTemplate) {
    setWizard(false);
    // Your Parameters.xlsx defaults, then your profile's defaults and details, then a setup template, then the brief.
    const base0 = applyDefaults(applyParameters(newProject(name), db), prefs);
    const base = template ? applyTemplateSystem(base0, template) : base0;
    loadIntoApp(brief ? applyBrief(base, brief) : base, undefined, 'New project — not saved yet');
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

  /** The main board (with the transformer) that supplies the selected board. */
  const mainOfSelected = () => {
    let b: Board | undefined = board;
    for (let i = 0; b?.upstreamId && i < 50; i++) { const up: string = b.upstreamId; b = project.boards.find((x) => x.id === up); }
    return b ?? project.boards.find((x) => !x.upstreamId);
  };
  function openTransformer() {
    const main = mainOfSelected();
    if (!main) return;
    setView('design');
    selectBoard(main.id);
    setBoardTab('electrical');
  }

  function confirmDeleteSelected() {
    if (panel === 'feeder' && selectedFeeder) { if (window.confirm(`Delete feeder ${selectedFeeder.id}?`)) deleteFeeder(selectedFeeder.id); return; }
    if (board && window.confirm(`Delete ${board.id} and everything fed from it?`)) removeBoard(board.id);
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

  // Study changes made from a page whose results are out of date would act
  // on the last-run copy of the project: ask for a run first.
  const blocked = () => setStatus('Results are out of date — run the calculations first (F5), then apply');

  /** An item from the equipment library dropped on the SLD. */
  const [userPresets, setUserPresets] = useState<FeederPreset[]>(loadUserPresets);
  const [sldFull, setSldFull] = useState(false);
  const [editPreset, setEditPreset] = useState<FeederPreset | null>(null);
  function savePresets(next: FeederPreset[], message: string) {
    setUserPresets(next);
    // A copy goes into the project, so the presets travel with it to another PC.
    setProject((p) => ({ ...p, feederPresets: next.length ? next : undefined }));
    setStatus(saveUserPresets(next) ? message : `${message} — but it could not be stored on this computer`);
  }
  function openPresetEditor(p: FeederPreset | null, mode: 'edit' | 'copy') {
    const id = `up-${Date.now().toString(36)}`;
    if (!p) return setEditPreset({ id, name: '', kind: 'load', loadType: 'general', loadName: 'Load', loadKw: 5, powerFactor: 0.9, demandFactor: 1, lengthM: 30 });
    const { builtIn: _b, ...rest } = p;
    setEditPreset(mode === 'copy' ? { ...rest, id, name: `${p.name} (copy)` } : rest);
  }
  async function exportPresets() {
    const m = await saveText('feeder-presets.json', presetsFile(userPresets), 'Feeder presets', 'json');
    if (m) setStatus(`${m} — import it on another PC from My presets`);
  }
  function importPresets(text: string) {
    const arr = readPresetsFile(text);
    if (!arr) return setStatus('That file is not a feeder presets file');
    const { list, added, updated } = mergePresets(userPresets, arr);
    savePresets(list, `Imported presets: ${added} new, ${updated} updated`);
  }
  function saveAsPreset(f: Feeder) {
    // Opens the preset editor (the desktop app has no prompt box) with the feeder's parts.
    const name = f.feedsBoardId ? `${project.boards.find((b) => b.id === f.feedsBoardId)?.kind ?? 'DB'} ${f.breakerRatingA} A` : `${f.name} ${f.loadKw} kW`;
    setEditPreset(presetFromFeeder(project, f, name));
  }

  const [dropQty, setDropQty] = useState(1);
  function dropItem(item: PaletteItem, target: DropTarget) {
    const r = dropMany(project, item, target, dropQty, db.loads);
    // A component dropped: its new ways remember it, so editing it updates them.
    if (item.kind === 'preset' && item.preset.id.startsWith('cmp-') && r.project !== project) {
      const old = new Set(project.feeders.map((f) => f.id));
      const cid = item.preset.id.slice(4);
      r.project = { ...r.project, feeders: r.project.feeders.map((f) => (!old.has(f.id) && !f.feedsBoardId ? { ...f, componentId: cid } : f)) };
    }
    showResult(r);
  }

  const [editComponent, setEditComponent] = useState<UserComponent | null>(null);
  const componentPresets = useMemo(() => (project.components ?? []).map((c) => componentPreset(project, c)), [project]);
  function saveComponent(c: UserComponent) {
    const list = project.components ?? [];
    const next = { ...project, components: list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c] };
    const s = syncComponent(next, c);
    setProject(s.project, { step: true });
    setEditComponent(null);
    setStatus(`Saved the component “${c.name}”${s.updated ? ` — ${s.updated} cop${s.updated > 1 ? 'ies' : 'y'} on the SLD updated` : ' — drag it from My components onto a busbar'}`);
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
      if (e.key === 'F5') {
        // Run the network studies, from anywhere (also while typing).
        e.preventDefault();
        runNow();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        // Save / Save as, from anywhere (also while typing).
        e.preventDefault();
        if (e.shiftKey) saveAs();
        else saveProject();
        return;
      }
      const t = e.target instanceof HTMLElement ? e.target : null;
      // Table cells save straight into the project, so ⌘Z there is the app's
      // undo (a whole paste or fill is one step); other fields keep their own.
      const inGrid = !!t?.closest('.gx-wrap, .ls-wrap');
      const typing = !!t && !inGrid && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (typing) return;
      if (inGrid && !((e.metaKey || e.ctrlKey) && /^[zy]$/i.test(e.key))) return;
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
      } else if (!mod && !e.altKey && view === 'design' && (e.key === 'v' || e.key === 'V')) {
        setTool('select'); // V: select tool
      } else if (!mod && !e.altKey && view === 'design' && (e.key === 'h' || e.key === 'H')) {
        setTool('pan'); // H: pan tool
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

  /** A board clicked in the panel tree: what it does depends on the page. */
  function pickBoard(id: string) {
    if (view === 'design') return selectBoard(id);
    if (FOCUS_VIEWS.includes(view)) return setFocus(focus === id ? null : id);
    setActiveBoardId(id);
    if (view === 'db-schedule') setDbScheduleAll(false);
    if (view !== 'load-schedule' && view !== 'db-schedule' && view !== 'coordination') setStatus(`${id} selected — double-click it to open it on the SLD`);
  }

  // Recent projects (Home ▸ Recent): the recently opened, else the latest saved.
  const navRecent = [...recent.map((f) => projectList.find((m) => m.file === f)).filter((m): m is ProjectMeta => !!m), ...projectList]
    .filter((m, i, a) => a.indexOf(m) === i).slice(0, 5);

  const home = view === 'projects';
  // The panel tree where clicking a board does something; not on Projects, Overview, Help or settings pages.
  const equipment = (docked: boolean) => (
    <EquipmentPalette docked={docked} onHint={setStatus} library={libraryEntries(db.loads)} presets={userPresets} qty={dropQty} onQty={setDropQty}
                    onDeletePreset={(id) => savePresets(userPresets.filter((p) => p.id !== id), 'Deleted the preset')}
                    onEditPreset={openPresetEditor} onExportPresets={exportPresets} onImportPresets={importPresets}
                    components={componentPresets}
                    onEditComponent={(id) => setEditComponent(id ? project.components?.find((c) => c.id === id) ?? null : newComponent(`c${Date.now().toString(36)}`))}
                    onDeleteComponent={(id) => setProject((p) => ({ ...p, components: (p.components ?? []).filter((c) => c.id !== id), feeders: p.feeders.map((f) => (f.componentId === id ? { ...f, componentId: undefined, componentValues: undefined } : f)) }), { step: true })} />
  );
  const showTree = !['projects', 'dashboard', 'help', 'parameters', 'titleblock', 'database', 'calculators'].includes(view);

  return (
    <div className={`app-root${home ? ' home' : ''}`}>
      <div className="top">
        <div className="brand">
          LV Design Studio <span className="app-ver">v{__APP_VERSION__}</span>
          <small>Low-voltage power design suite</small>
        </div>
        <div className="crumb">
          {home ? <b>Projects</b> : <>
            <button className="linkish" onClick={() => setView('projects')} title="All projects">Projects</button> / <button className="linkish crumb-project" onClick={() => setView('dashboard')} title={`${project.name} — Overview`}><b>{project.name}</b></button>
            {' / '}{view === 'dashboard' ? <b>Overview</b> : <button className="linkish" onClick={() => setView('dashboard')} title="This project's overview">Overview</button>}
          </>}
          {!home && dirty && <span className="dirty-dot" title={currentFile ? 'Unsaved changes — Ctrl+S / ⌘S to save' : 'Not saved yet — Ctrl+S / ⌘S to save'}>●</span>}
          {status && <span className="saved">{status}</span>}
        </div>
        <div className="sp" />
        {home
          ? <button className="chip" onClick={() => setView('help')} title="Help">Help</button>
          : <>
            {saveState.kind === 'failed' && <span className="save-failed" role="alert" title={saveState.msg}>Not saved — {saveState.msg && saveState.msg.length > 60 ? `${saveState.msg.slice(0, 60)}…` : saveState.msg}</span>}
            <button className="chip" disabled={saveState.kind === 'saving'} onClick={() => saveProject()} title="Save (Ctrl+S / ⌘S) — New, Open and Save as are on the Project tab">{saveState.kind === 'saving' ? 'Saving…' : saveState.kind === 'failed' ? 'Retry save' : `Save${dirty ? ' ●' : ''}`}</button>
          </>}
        {!home && !hasBridge && <button className="chip" onClick={() => setStatus(downloadProjectFile(project))} title="Download this project as a file to keep on your computer (opens here or in the desktop app)">Download file</button>}
        <button className="chip user-chip" onClick={() => setShowPrefs(true)} title={prefs.profile.name ? `${signature(prefs.profile)} — profile & preferences` : 'Set up your profile: name, designation, company, logo and design defaults'}>
          <span className="av">{initialsOf(prefs.profile.name)}</span>{prefs.profile.name ? prefs.profile.name.split(/\s+/)[0] : 'Profile'}
        </button>
      </div>
      {!hasBridge && <WebBanner />}
      {recovery && (
        <div className="recover-bar" role="alert">
          <span>Unsaved work on <b>{recovery.project.name}</b> from {whenText(recovery.at)} was kept{recoveries.length > 1 ? ` (${recoveries.length} projects have recovered work)` : ' when the app closed'}.{recovery.fileChangedSince ? ' The project file was saved again after that, so restoring will ask before it overwrites anything.' : ''}</span>
          <button className="chip primary" onClick={() => guard('restoring the recovered work', restoreRecovery)}>Restore it</button>
          <button className="chip" onClick={() => { void clearRecovery(recovery.projectId); setRecoveries((l) => l.slice(1)); }}>Discard</button>
        </div>
      )}

      {!home && external && <ExternalChangeBar kind={external} dirty={dirty} onReload={() => currentFile && reloadFromDisk(currentFile)} onReview={reviewDiskChanges} onDismiss={() => setExternal(null)} />}
      {!home && readOnly && <div className="recover-bar" role="alert"><span>{readOnly} Use Save as to keep your own copy.</span></div>}

      {!home && <Ribbon
        tab={ribbonTab}
        onTab={setRibbonTab}
        a={{
          view,
          onView: setView,
          onBom: (cmd) => { setView('boq'); setBomCmd((c) => ({ cmd, n: (c?.n ?? 0) + 1 })); },
          hasPriceList: !!project.priceList,
          hasRevisions: !!project.revisions?.length,
          tool,
          onTool: setTool,
          boardId: board?.id ?? '',
          selectedFeederId: panel === 'feeder' ? selected : null,
          selection: panel === 'feeder' && selected ? { kind: 'feeder', id: selected } : board ? { kind: 'board', id: board.id } : null,
          transformerBoardId: mainOfSelected()?.id,
          onAddFeeder: openAddFeeder,
          onAddBoard: (preset) => { setBoardPreset(preset); setShowBoardForm(true); },
          onTransformer: openTransformer,
          onBoardProperties: () => { setView('design'); if (board) selectBoard(board.id); setBoardTab('general'); },
          onEditSelected: () => { setView('design'); if (panel === 'feeder' && selectedFeeder) setShowFeederForm('edit'); else if (board) setEditBoardId(board.id); },
          onDeleteSelected: confirmDeleteSelected,
          onExportDss: exportOpenDss,
          onSettings: () => setShowSettings(true),
          onRun: runNow,
          staleCount: staleKeys.length,
          onUndo: history.undo,
          onRedo: history.redo,
          canUndo: history.canUndo,
          canRedo: history.canRedo,
          onNew: startNewProject,
          onSave: () => saveProject(),
          onSaveAs: () => saveAs(),
          onProfile: () => setShowPrefs(true),
          onChooseFolder: chooseFolder,
          folderLabel: hasBridge ? `Folder: ${projectsFolder.split(/[\\/]/).pop() || 'choose…'}` : 'This browser',
          dirty,
          recent: navRecent.map((m) => ({ file: m.file, name: m.name, when: whenText(m.updatedAt) })),
          currentFile,
          onOpenRecent: openProject,
          dbIssues: db.issues.length
        }}
      />}

      <div className="app">
        {!showTree ? <span /> : <PanelTree
          project={project}
          results={allResults}
          view={view}
          activeId={FOCUS_VIEWS.includes(view) ? focus ?? undefined : board?.id}
          focusId={FOCUS_VIEWS.includes(view) ? focus : null}
          copiedId={copiedBoard}
          highlightedIds={createdPanelIds}
          onClearHighlights={() => setCreatedPanelIds([])}
          equipment={view === 'design' && diagramMode === 'system' && !sldFull ? equipment(true) : undefined}
          onPick={pickBoard}
          onOpen={(id) => { setView('design'); selectBoard(id); }}
          menu={{
            onAddBoard: (id) => { setActiveBoardId(id); setBoardPreset(undefined); setShowBoardForm(true); },
            onAddFeeder: (id) => { setActiveBoardId(id); openAddFeeder({}); },
            onProperties: (id) => { setView('design'); selectBoard(id); setBoardTab('general'); },
            onSchedule: (id) => { setActiveBoardId(id); setView('load-schedule'); },
            onCopy: copyBoard,
            onPaste: (id) => { setActiveBoardId(id); setPasteTarget(id); },
            onDelete: (id) => { if (window.confirm(`Delete ${id} and everything fed from it?`)) removeBoard(id); },
            onMove: (id, to) => {
              if (!window.confirm(`${moveSummary(project, id, to)}\n\nMove it? (Ctrl+Z undoes.)`)) return;
              setProject(moveBoard(project, id, to), { step: true });
              setStatus(`${id} is now supplied from ${to} — check the incomer cable length.`);
            },
            onReorder: (id, dir) => setProject(reorderBoard(project, id, dir), { step: true }),
            onLengthChecked: (id) => setProject({ ...project, feeders: project.feeders.map((f) => (f.feedsBoardId === id ? { ...f, lengthToCheck: undefined } : f)) }, { step: true })
          }}
        />}

        {view === 'design' && board ? (
          <>
            <main className="mid">
              {!!project.revisions?.length && <BaselineBar project={project} onCompare={() => setView('revisions')} onImpact={() => setView('modifications')} />}
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
                  <div className="sld-bar">
                    <MenuButton label="+ Add" title="Add a feeder, a board, or paste a copied board">
                      {(close) => (
                        <>
                          <button onClick={() => { close(); openAddFeeder({}); }}>Feeder on {board.id}</button>
                          <button onClick={() => { close(); setShowBoardForm(true); }}>Board</button>
                          {copiedBoard && project.boards.some((b) => b.id === copiedBoard) && <button onClick={() => { close(); setPasteTarget(board.id); }}>Paste {copiedBoard} on {board.id} (⌘V)</button>}
                        </>
                      )}
                    </MenuButton>
                    {panel === 'board' && board && (
                      <MenuButton label={board.id} title={`${board.id}: copy, cable type of its outgoing cables`}>
                        {(close) => (
                          <>
                            <button onClick={() => { close(); setEditBoardId(board.id); }}>Edit {board.id}…</button>
                            <button onClick={() => { close(); copyBoard(board.id); }}>Copy with sub-boards (⌘C)</button>
                            <div className="mp-h">Cable type for all outgoing cables</div>
                            <label>
                              <select value="" onChange={(e) => {
                                const t = e.target.value;
                                if (!t) return;
                                close();
                                const ids = project.feeders.filter((f) => f.boardId === board.id && !isScheduleCircuit(f)).map((f) => f.id);
                                setProject((p) => ({ ...p, feeders: p.feeders.map((f) => (ids.includes(f.id) ? { ...f, cableType: t === 'auto' ? undefined : t } : f)) }), { step: true });
                                setStatus(`${ids.length} cable${ids.length === 1 ? '' : 's'} from ${board.id}: ${t === 'auto' ? 'automatic type (fire-rated for life safety)' : cableTypeDef(t).label}`);
                              }}>
                                <option value="">Choose…</option>
                                <option value="auto">Automatic (fire-rated for life safety)</option>
                                {CABLE_TYPE_DEFS.filter((d) => d.value !== 'XLPE/SWA/PVC').map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                              </select>
                            </label>
                          </>
                        )}
                      </MenuButton>
                    )}
                    {selectedFeeder && panel === 'feeder' && (
                      <MenuButton label={selectedFeeder.id} title={`${selectedFeeder.id}: edit, save as preset`}>
                        {(close) => (
                          <>
                            <button onClick={() => { close(); setShowFeederForm('edit'); }}>Edit {selectedFeeder.id}…</button>
                            <button onClick={() => { close(); saveAsPreset(selectedFeeder); }} title="Save this way (breaker, RCD, meter, isolator and its load or sub-board) as a preset to drag onto any busbar">Save as preset</button>
                          </>
                        )}
                      </MenuButton>
                    )}
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
                    <span className="sp" />
                    {diagramMode === 'system' && <button className="chip" onClick={() => setShowExport(true)} title="PDF sheet with title block, DXF for CAD, or SVG">Export…</button>}
                  </div>
                </div>
                {diagramMode === 'system' ? (
                  <div className={`sld-edit${sldFull ? ' full' : ''}`}>
                  {sldFull && equipment(false)}
                  {(() => {
                    const diagram = (
                  <SystemDiagram
                    cull
                    // The design canvas is not published: the symbol legend is on the drawing sheets. The
                    // Export dialog prints the canvas as a drawing, so the legend is drawn while it is open.
                    hideLegend={!showExport}
                    project={project}
                    calcProject={calcProject}
                    stale={staleKeys.length > 0}
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
                    resizable
                    fullScreen={sldFull}
                    onToggleFullScreen={() => setSldFull((v) => !v)}
                    outlines={sheetOutlinesOn ? sheetOutlines(project) : undefined}
                    onOutline={setSheetTab}
                    focus={sldFocus}
                    onFixFeeder={(id, patch, label) => {
                      setProject((p) => ({ ...p, feeders: p.feeders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }), { step: true });
                      selectFeeder(id);
                      setStatus(`${id}: ${label} (undo with ⌘Z)`);
                    }}
                    onMoveToSheet={sheetOutlinesOn ? (boardId, sheetId) => {
                      const set = setOf(project);
                      setProject({ ...project, drawingSet: movePanelToSheet(set, boardId, sheetId, boardsInSupplyOrder(project).map((b) => b.id)) }, { step: true });
                      setStatus(`${boardId} moved to ${set.sheets.find((x) => x.id === sheetId)?.number}`);
                    } : undefined}
                    onDrawing={(d) => setProject((p) => ({ ...p, drawing: { ...p.drawing, ...d } }))}
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
                    );
                    return sheetTab && setOf(project).sheets.some((x) => x.id === sheetTab)
                      ? <SheetWorkspace project={project} run={run} sheetId={sheetTab} design={diagram} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} onActive={setSheetTab} />
                      : diagram;
                  })()}
                  <SheetTabs project={project} run={run} active={sheetTab} selectedBoardId={panel === 'board' ? board.id : null} outlinesOn={sheetOutlinesOn}
                    onActive={setSheetTab} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} onToggleOutlines={() => setSheetOutlinesOn((v) => !v)} />
                  </div>
                ) : (
                  <SingleLineDiagram board={board} voltageV={project.voltageV} incomerLabel={boardIncomerLabel(project, board)} results={boardResults} selected={selected} onSelect={selectFeeder} />
                )}
              </section>
              <section className={`res-drawer${resTab ? ' open' : ''}`}>
                <div className="rd-tabs" role="tablist" aria-label="Results">
                  {([['summary', 'System summary'], ['buses', 'Bus voltages & loading'], ['feeders', `Feeders on ${board.id}`]] as const).map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={resTab === k} className={resTab === k ? 'on' : ''}
                      onClick={() => setResTab((t) => { const v = t === k ? null : k; try { localStorage.setItem('lvds.resTab', v ?? ''); } catch { /* ignore */ } return v; })}>{label}</button>
                  ))}
                  <span className="sp" />
                  {(() => { const bad = allResults.filter((r) => r.status === 'bad').length, warn = allResults.filter((r) => r.status === 'warn').length; return <>{bad > 0 && <span className="rd-chip bad">{bad} fail</span>}{warn > 0 && <span className="rd-chip warn">{warn} to check</span>}{!bad && !warn && <span className="rd-chip">all within limits</span>}</>; })()}
                  {resTab && <button className="icon-btn" title="Close" onClick={() => { setResTab(null); try { localStorage.setItem('lvds.resTab', ''); } catch { /* ignore */ } }}>✕</button>}
                </div>
                {resTab && (
                  <div className="rd-body">
                    {resTab !== 'feeders' ? (
                      <SystemSummaryCards
                        only={resTab}
                        project={calcProject}
                        selectedBoardId={panel === 'board' ? board.id : null}
                        onSelectBoard={(id) => { selectBoard(id); setSldFocus({ kind: 'board', id, n: Date.now() }); }}
                        annotations={engineFresh ? annotations : undefined}
                        sourceLabel={engineFresh ? `${EXTERNAL_ENGINES.find((e) => e.id === resultSource)?.name} load flow: voltages include the transformer's own drop; fault levels from the engine's fault study.` : undefined}
                      />
                    ) : (
                      <ResultsTable results={boardResults} vdLimitPct={project.vdLimitPct} selected={selected} onSelect={(id) => { selectFeeder(id); setSldFocus({ kind: 'feeder', id, n: Date.now() }); }} />
                    )}
                  </div>
                )}
              </section>
            </main>

            <aside className="side">
              {panel === 'board' ? (
                <BoardPanel project={calcProject.boards.some((b) => b.id === board.id) ? calcProject : project} board={board} results={allResults} onChange={updateBoard} onSelectFeeder={selectFeeder} tab={boardTab} onTab={setBoardTab} onEnclosure={() => setView('enclosure')} />
              ) : (
                <>
                  <SidePanel results={boardResults} selected={selected} />
                  {staleKeys.length > 0 && <StaleBanner stale={stale} onRun={runNow} what="the feeder results" />}
                  {selectedFeeder && calcProject.feeders.some((f) => f.id === selectedFeeder.id) && (
                    <DiscriminationPanel project={calcProject} feeder={calcProject.feeders.find((f) => f.id === selectedFeeder.id)!} />
                  )}
                </>
              )}
            </aside>
          </>
        ) : (
          <main className="mid wide">
            <Suspense fallback={<p className="m">Loading…</p>}>
            {view === 'load-schedule' && board && (
              <LoadScheduleView project={project} onOpenRiser={() => setView('busbar')} boardId={board.id} db={db} onBoard={(id) => setActiveBoardId(id)} onChange={setProject} onStatus={setStatus} onSettings={() => setShowSettings(true)} />
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
                onStatus={setStatus}
              />
            )}
            {view === 'engines' && (
              <>
                <section className="stage"><h3>Load flow — engine comparison</h3></section>
                <EngineCompare project={project} />
              </>
            )}
            {STUDY_VIEWS.includes(view) && <StaleBanner stale={stale} onRun={runNow} what="the results on this page" />}
            {view === 'voltage-drop' && <VoltageDropStudy project={project} calcProject={calcProject} stale={staleKeys.length > 0} onChange={setProject} onStatus={setStatus} />}
            {view === 'earthing' && <EarthingStudy project={calcProject} focus={focus} onClearFocus={() => setFocus(null)} onSelectFeeder={(id) => { setView('design'); selectFeeder(id); }} />}
            {/* Pages that also change the design act on the live project, so
                they only apply changes while their results are up to date. */}
            {view === 'selection' && <SelectionStudy project={calcProject} focus={focus} onClearFocus={() => setFocus(null)} onChange={staleKeys.length ? blocked : setProject} />}
            {view === 'coordination' && <CoordinationStudy project={calcProject} board={board?.id} onBoard={setActiveBoardId} />}
            {view === 'sizing' && <TransformerGeneratorStudy project={project} onStatus={setStatus} onChange={(p) => setProject(p, { step: true })} />}
            {(view === 'drawings' || view === 'drawing-register') && <DrawingsView project={project} run={run} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} onOpen={setView} />}
            {view === 'parameters' && <ParametersView project={project} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} onTitleBlock={() => setView('titleblock')} />}
            {view === 'titleblock' && <TitleBlockDesigner project={project} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} onParams={() => setView('parameters')} />}
            {view === 'help' && <HelpView project={project} run={run} stale={staleKeys} saved={!!currentFile && !dirty} onGo={(v) => (v === 'settings' ? setShowSettings(true) : setView(v))} />}
            {view === 'dashboard' && (
              <ProjectDashboard
                project={project}
                run={run}
                stale={staleKeys}
                saved={!!currentFile && !dirty}
                onOpen={(v) => (v === 'settings' ? setShowSettings(true) : setView(v))}
                onEditBrief={() => setBriefDialog(true)}
                onChangeProject={(p) => setProject(p, { step: true })}
                onRun={runNow}
                onStatus={setStatus}
                onGo={(g) => {
                  if (g.feederId) { setView('design'); selectFeeder(g.feederId); return; }
                  if (g.boardId) setActiveBoardId(g.boardId);
                  setView(g.view);
                }}
              />
            )}
            {view === 'building' && <BuildingView project={project} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} />}
            {view === 'busbar' && <BusbarStudy project={project} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} />}
            {view === 'pfc' && <PfcStudy project={project} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} />}
            {view === 'db-schedule' && <DbScheduleView project={calcProject} board={dbScheduleAll ? '' : board?.id} onBoard={(id) => { setDbScheduleAll(!id); if (id) setActiveBoardId(id); }} onStatus={setStatus} />}
            {view === 'cable-schedule' && <CableScheduleView project={calcProject} focus={focus} onClearFocus={() => setFocus(null)} onStatus={setStatus} />}
            {view === 'equipment' && <EquipmentScheduleView project={calcProject} onStatus={setStatus} />}
            {view === 'report' && <ReportView project={calcProject} stale={staleKeys.length > 0} onRun={runNow} onStatus={setStatus} />}
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
            {view === 'study-reports' && <StudyReportsView project={project} me={{ preparedBy: signature(prefs.profile), checkedBy: prefs.profile.checkedBy }} run={run} stale={stale} onRun={runNow} onChange={setProject} onStatus={setStatus} />}
            {view === 'calculators' && <QuickCalcs project={project} />}
            {view === 'panels' && <PanelsPage project={project} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} onBuilding={() => setView('building')}
              onCreated={(next, m, added) => { setProject(next, { step: true }); setCreatedPanelIds(added); setStatus(m); }} />}
            {view === 'earth-schematic' && <EarthingView project={project} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} />}
            {view === 'enclosure' && <EnclosureSizing key={board?.id} project={project} boardId={board?.id} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} />}
            {view === 'substation-area' && <SubstationAreaView project={project} onChange={(p, step) => setProject(p, step ? { step: true } : undefined)} onStatus={setStatus} />}
            {view === 'ups' && <UpsStudy project={project} onChange={(p, step) => setProject(p, step ? { step: true } : undefined)} onStatus={setStatus} />}
            {view === 'solar' && <SolarStudy project={project} onChange={(p, step) => setProject(p, step ? { step: true } : undefined)} onStatus={setStatus} />}
            {view === 'cable-tray' && (
              <TrayScheduleView project={project} onChange={(p, step) => setProject(p, step ? { step: true } : undefined)} onStatus={setStatus} />
            )}
            {view === 'received-docs' && <ReceivedDocsView project={project} onChange={(p) => setProject(p)} onStatus={setStatus} />}
            {view === 'review' && <ReviewView project={project} me={prefs.profile.name} run={run} stale={staleKeys} onChange={(p) => setProject(p)} onStatus={setStatus} onGo={(v) => setView(v)} />}
            {view === 'modifications' && <ChangesView project={project} me={prefs.profile.name} run={run} onChange={(p) => setProject(p)} onApply={(p) => setProject(p, { step: true })} onStatus={setStatus} onGo={(v) => setView(v)} />}
            {view === 'revisions' && <><RevisionsView project={project} me={prefs.profile.name ? initialsOf(prefs.profile.name) : ''} onChange={setProject} onStatus={setStatus} /><div style={{ padding: '0 16px 16px' }}><CheckpointsPanel project={project} onRestore={(p) => setProject(p, { step: true })} onStatus={setStatus} /></div></>}
            {view === 'projects' && (
              <ProjectsDashboard
                list={projectList}
                recent={recent}
                currentFile={currentFile}
                currentName={project.name}
                dirty={dirty}
                folder={projectsFolder}
                desktop={inDesktop()}
                onOpen={openProject}
                onNew={startNewProject}
                onDuplicate={duplicateFile}
                onDelete={deleteFile}
                onStatus={setFileStatus}
                onChooseFolder={chooseFolder}
                onPick={pickAndOpen}
                onContinue={() => setView('dashboard')}
                onCompare={compareFiles}
                onDetails={openDetails}
                onArchive={archiveFile}
                trash={trashList}
                onRestore={restoreFromTrash}
                onEmptyTrash={emptyTheTrash}
                onSample={() => guard('opening the sample', () => loadIntoApp(JSON.parse(JSON.stringify(sampleProject)), undefined, 'Sample project — explore freely; Save keeps your own copy'))}
              />
            )}
            {view === 'boq' && (
              <>
                <section className="stage"><h3>Bill of quantities — whole project</h3></section>
                <BomView command={bomCmd} project={project} results={allResults} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} />
              </>
            )}
            </Suspense>
          </main>
        )}
      </div>

      {!home && <div className="foot">
        <span>Base: {project.voltageV} V, 3-phase, {project.frequencyHz} Hz</span>
        <span>Ambient: {project.ambientC} °C</span>
        <span>Vd limit: {project.vdLimitPct}%</span>
        <span className="sp" />
        <span className={`calc-state ${staleKeys.length ? 'warn' : 'ok'}`} title={staleKeys.length ? `Out of date: ${stale.join(', ')}` : undefined}>
          {staleKeys.length ? `⚠ ${staleKeys.length} stud${staleKeys.length === 1 ? 'y' : 'ies'} out of date` : `✓ Calculations up to date${run ? ` (${new Date(run.at).toLocaleTimeString()})` : ''}`}
        </span>
        <button className={`chip run-chip${staleKeys.length ? ' stale' : ''}`} onClick={runNow} title="Run the network studies (F5)">▶ Run (F5)</button>
        <button className="chip" onClick={() => setProject({ ...project, calc: { ...project.calc, autoRun: !autoRun } })} title="Run the studies on every change (small projects)">
          Auto-run: {autoRun ? 'on' : 'off'}
        </button>
        <span>{hasBridge ? `Projects folder: ${projectsFolder}` : 'Web version — projects are saved in this browser'}</span>
      </div>}

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
      {editPreset && (
        <PresetEditor
          initial={editPreset}
          onClose={() => setEditPreset(null)}
          onSave={(p) => {
            const exists = userPresets.some((x) => x.id === p.id);
            savePresets(exists ? userPresets.map((x) => (x.id === p.id ? p : x)) : [...userPresets, p], `${exists ? 'Updated' : 'Saved'} the preset “${p.name}”`);
            setEditPreset(null);
          }}
        />
      )}
      {showExport && (
        <Suspense fallback={null}><SldExportDialog
          project={project}
          stale={staleKeys.length > 0}
          onSave={(d) => setProject((p) => ({ ...p, drawing: d }))}
          onStatus={setStatus}
          onClose={() => setShowExport(false)}
        /></Suspense>
      )}
      {editComponent && <ComponentEditor project={project} initial={editComponent} onSave={saveComponent} onClose={() => setEditComponent(null)} />}
      {showPrefs && (
        <PreferencesDialog
          prefs={prefs}
          project={project}
          onSave={savePreferences}
          onApplyToProject={(u) => { setProject((p) => applyProfile(p, u, true), { step: true }); setStatus(`Your details are in “${project.name}”’s title block and reports`); }}
          onClose={() => setShowPrefs(false)}
        />
      )}
      {ask && (
        <UnsavedDialog
          name={project.name}
          action={ask.action}
          onCancel={() => setAsk(null)}
          onDiscard={() => { const then = ask.then; setAsk(null); void clearRecovery(project.id); then(); }}
          onSave={async () => { const then = ask.then; setAsk(null); if (await saveProject()) then(); }}
        />
      )}
      {conflict && (
        <ConflictDialog name={conflict.mine.name} mine={conflict.mine} disk={conflict.disk}
          onCancel={() => setConflict(null)}
          onOverwrite={() => { setConflict(null); void saveProject(undefined, true); }}
          onSaveCopy={() => { setConflict(null); saveAs(`${conflict.mine.name} (my changes)`); }}
          onLoadDisk={useDiskVersion} />
      )}
      {wizard && (
        <NewProjectWizard templates={loadTemplates()} initialName="Untitled project" company={prefs.profile.company} taken={projectList.map((m) => m.name)}
          defaults={defaultsPreview(db, prefs)} storage={hasBridge ? projectsFolder || 'the projects folder' : 'this browser (use Download file to keep a copy)'} onChooseFolder={hasBridge ? chooseFolder : undefined}
          onCancel={() => setWizard(false)} onQuick={(n) => createProject(n)} onCreate={createProject} />
      )}
      {briefDialog && (
        <BriefDialog initial={project.brief} company={prefs.profile.company}
          onSaveTemplate={(b) => { const n = window.prompt('Name this setup template (e.g. Villa, DEWA consultant)')?.trim(); if (!n) return; const t = templateFrom(applyBrief(project, b), n); setStatus(saveTemplates([...loadTemplates(), t]) ? `Saved setup template “${n}”: scope, deliverables and system defaults. No party names or project data are kept.` : 'Could not save the template in this browser'); }}
          onCancel={() => setBriefDialog(false)}
          onSave={(b) => { setBriefDialog(false); setProject(applyBrief(project, b), { step: true }); setStatus('Scope and deliverables updated — save the project to keep them'); }} />
      )}
      {detailsFor && (
        <ProjectDetailsDialog file={detailsFor.file} project={detailsFor.project} onCancel={() => setDetailsFor(null)}
          onSave={(d: ProjectDetails) => { const f = detailsFor.file; setDetailsFor(null); void patchProjectFile(f, (p) => applyDetails(p, d), 'Details'); }} />
      )}
      {compare && <CompareDialog {...compare} onClose={() => setCompare(null)} />}
      {nameAsk && (
        <NameDialog
          title={nameAsk.title}
          note={nameAsk.note}
          initial={nameAsk.initial}
          okLabel={nameAsk.okLabel}
          taken={projectList.map((m) => m.name)}
          onCancel={() => setNameAsk(null)}
          onOk={(n) => { const then = nameAsk.then; setNameAsk(null); then(n); }}
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
        <BoardForm project={project} parentBoardId={board.id} preset={boardPreset} onSave={addBoard} onClose={() => { setShowBoardForm(false); setBoardPreset(undefined); }} />
      )}
    </div>
  );
}
