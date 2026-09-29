import { useEffect, useMemo, useRef, useState } from 'react';
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
import TrayScheduleView from './components/docs/TrayScheduleView';
import SubstationAreaView from './components/docs/SubstationAreaView';
import UpsStudy from './components/studies/UpsStudy';
import SolarStudy from './components/studies/SolarStudy';
import StudyReportsView from './components/docs/StudyReportsView';
import QuickCalcs from './components/QuickCalcs';
import CoordinationStudy from './components/studies/CoordinationStudy';
import { TransformerGeneratorStudy } from './components/studies/SizingStudy';
import PfcStudy from './components/studies/PfcStudy';
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
import SldExportDialog from './components/SldExportDialog';
import PasteBoardDialog from './components/PasteBoardDialog';
import DiscriminationPanel from './components/DiscriminationPanel';
import { discriminationChain } from './calc/protection';
import { pasteBoard } from './model/copyBoard';
import { applyDefaults, applyProfile, initialsOf, loadPrefs, savePrefs, signature, type Preferences } from './model/profile';
import { clearRecovery, deleteProjectFile, inDesktop, listProjects, loadProject, readRecovery, recentFiles, saveProjectFile, touchRecent, whenText, writeRecovery, type ProjectMeta, type Recovery } from './model/projectStore';
import PreferencesDialog from './components/PreferencesDialog';
import ProjectsDashboard from './components/ProjectsDashboard';
import { NameDialog, UnsavedDialog } from './components/FileDialogs';
import type { ProjectStatus } from './types';
type DiagramMode = 'system' | 'board';

/** Pages that show network study results (they follow the last run). */
const STUDY_VIEWS: MainView[] = ['voltage-drop', 'earthing', 'selection', 'coordination', 'sizing', 'db-schedule', 'cable-schedule', 'report'];

export default function App() {
  // The project, with undo / redo. Opening or starting a project clears the history.
  const history = useHistory<Project>(sampleProject);
  const project = history.value;
  const setProject = history.set;
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);
  const [projectsFolder, setProjectsFolder] = useState<string>('');
  const [projectList, setProjectList] = useState<ProjectMeta[]>([]);
  // Unsaved changes: the project differs from the one last saved or opened.
  const [saved, setSaved] = useState<Project | null>(project);
  const dirty = project !== saved;
  const [prefs, setPrefs] = useState<Preferences>(loadPrefs);
  const [showPrefs, setShowPrefs] = useState(false);
  const [recent, setRecent] = useState<string[]>(recentFiles);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  /** Asking what to do with unsaved changes before `then`. */
  const [ask, setAsk] = useState<{ action: string; then: () => void } | null>(null);
  const [nameAsk, setNameAsk] = useState<{ title: string; note?: string; initial: string; okLabel: string; then: (name: string) => void } | null>(null);
  // For timers and window events, which outlive a render.
  const live = useRef({ project, saved, currentFile });
  live.current = { project, saved, currentFile };
  // Changes the app makes by itself (the database syncing) don't count as
  // the user's unsaved changes when there were none.
  const adoptNext = useRef(false);
  useEffect(() => {
    if (adoptNext.current) { adoptNext.current = false; setSaved(project); }
  }, [project]);
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

  // Network studies run on demand (Run calculations / F5): results come from
  // the last run, and a study shows as out of date once one of its own
  // inputs changes. Auto-run (project setting) runs them on every change.
  const [run, setRun] = useState<CalcRun | undefined>(() => runCalculations(project));
  const autoRun = !!project.calc?.autoRun;
  useEffect(() => { if (autoRun && run?.project !== project) setRun(runCalculations(project)); }, [autoRun, project]);
  const staleKeys = useMemo(() => staleStudies(run, project), [run, project]);
  const stale = staleKeys.map((k) => STUDY_LABEL[k]);
  // What the studies show: the project as last run while out of date,
  // otherwise the live one (same results, current names).
  const calcProject = staleKeys.length && run ? run.project : project;
  const runNow = () => {
    const r = runCalculations(project);
    setRun(r);
    const fails = r.results.filter((x) => x.status === 'bad').length;
    setStatus(`Calculated ${r.results.length} feeders in ${Math.max(1, Math.round(r.ms))} ms — ${fails ? `${fails} failing` : 'all passing'}`);
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
    readRecovery().then((r) => r && setRecovery(r));
    if (!hasBridge) return;
    window.lvds.settings.get().then((s) => setProjectsFolder(s.projectsFolder));
  }, []);

  // Recovery copy of unsaved work, every few minutes (Profile & preferences).
  // Paused while a recovered copy is waiting to be restored or discarded.
  useEffect(() => {
    const min = prefs.app.autosaveMin;
    if (!min || recovery) return;
    const t = setInterval(() => {
      const { project: p, saved: s, currentFile: f } = live.current;
      if (p !== s) writeRecovery({ file: f, at: Date.now(), project: p });
    }, min * 60000);
    return () => clearInterval(t);
  }, [prefs.app.autosaveMin, recovery]);

  // Closing the window (or reloading) with unsaved changes: keep a recovery
  // copy and ask first.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      const { project: p, saved: s, currentFile: f } = live.current;
      if (p === s) return;
      writeRecovery({ file: f, at: Date.now(), project: p });
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${project.name} — LV Design Studio`;
  }, [dirty, project.name]);

  function restoreRecovery() {
    if (!recovery) return;
    loadIntoApp(recovery.project, recovery.file, `Restored your unsaved work from ${whenText(recovery.at)} — save it to keep it`);
    setSaved(null); // restored work is unsaved
    setRecovery(null);
  }

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
    listProjects().then(setProjectList).catch(() => setProjectList([]));
  }

  /** Saves the open project (Ctrl+S); with a name, as a new project file
   * (Save as). Resolves to false when it couldn't be saved. */
  async function saveProject(asName?: string): Promise<boolean> {
    const named = asName ? { ...project, name: asName } : project;
    const toSave = { ...named, updatedAt: new Date().toISOString(), updatedBy: prefs.profile.name || named.updatedBy };
    try {
      const file = await saveProjectFile(asName ? undefined : currentFile, toSave);
      if (named !== project) setProject(named, { step: true });
      setSaved(named);
      setCurrentFile(file);
      setRecent(touchRecent(file));
      clearRecovery();
      setStatus(`Saved ${named.name} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
      refreshList();
      return true;
    } catch (e) {
      setStatus(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** Runs `then` now, or after asking about unsaved changes. */
  function guard(action: string, then: () => void) {
    if (!dirty) return then();
    setAsk({ action, then });
  }

  function loadIntoApp(p: Project, file: string | undefined, message: string) {
    history.load(p);
    setSaved(p);
    setRun(runCalculations(p)); // results for the project as opened
    // Presets saved with the project join this computer's presets.
    if (p.feederPresets?.length) {
      const m = mergePresets(loadUserPresets(), p.feederPresets);
      if (m.added) { setUserPresets(m.list); saveUserPresets(m.list); }
    }
    setCurrentFile(file);
    setActiveBoardId(p.boards[0]?.id ?? '');
    setSelected(null);
    setStatus(message);
    if (view === 'projects') setView('design');
  }

  function openProject(file: string) {
    if (file === currentFile && !dirty) { if (view === 'projects') setView('design'); return; }
    guard('opening another project', async () => {
      try {
        const p = await loadProject(file);
        loadIntoApp(p, file, `Opened ${p.name}`);
        setRecent(touchRecent(file));
        clearRecovery();
      } catch (e) {
        setStatus(`Could not open ${file}: ${e instanceof Error ? e.message : String(e)}`);
        refreshList();
      }
    });
  }

  function saveAs() {
    setNameAsk({ title: 'Save as a new project', note: 'A new project file; the current one stays as it was last saved.', initial: `${project.name} (copy)`, okLabel: 'Save', then: (n) => saveProject(n) });
  }

  function duplicateFile(file: string) {
    const m = projectList.find((x) => x.file === file);
    setNameAsk({
      title: 'Duplicate project',
      note: 'A copy to start a similar job. Its revision history is not copied, and its status starts at Design.',
      initial: `${m?.name ?? 'Project'} (copy)`,
      okLabel: 'Create copy',
      then: async (name) => {
        try {
          const p = await loadProject(file);
          const copy: Project = { ...p, name, revisions: undefined, status: undefined, createdBy: prefs.profile.name || p.createdBy, updatedAt: new Date().toISOString(), updatedBy: prefs.profile.name || p.updatedBy };
          await saveProjectFile(undefined, copy);
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
    if (!window.confirm(`Delete the project “${m?.name ?? file}”? The file is removed from the projects folder.`)) return;
    try {
      await deleteProjectFile(file);
      setRecent(touchRecent(file, true));
      if (file === currentFile) { setCurrentFile(undefined); setSaved(null); } // still open, now unsaved
      setStatus(`Deleted ${m?.name ?? file}`);
    } catch (e) {
      setStatus(`Not deleted: ${e instanceof Error ? e.message : String(e)}`);
    }
    refreshList();
  }

  async function setFileStatus(file: string, st: ProjectStatus) {
    try {
      if (file === currentFile) {
        const next = { ...project, status: st };
        setProject(next, { step: true });
        if (dirty) { setStatus('Status changed — save the project to keep it'); return; }
        await saveProjectFile(file, { ...next, updatedAt: new Date().toISOString(), updatedBy: prefs.profile.name || next.updatedBy });
        setSaved(next);
      } else {
        const p = await loadProject(file);
        await saveProjectFile(file, { ...p, status: st });
      }
      refreshList();
    } catch (e) {
      setStatus(`Status not saved: ${e instanceof Error ? e.message : String(e)}`);
    }
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

  function startNewProject() {
    guard('starting a new project', () => setNameAsk({
      title: 'New project',
      note: prefs.profile.name ? `Starts with your design defaults, and your details in the title block (Profile & preferences).` : 'Tip: set your name, company and design defaults in Profile & preferences — every new project then starts with them.',
      initial: 'Untitled project',
      okLabel: 'Create',
      then: (name) => {
        // Your Parameters.xlsx defaults, then your profile's defaults and details.
        const p = applyDefaults(applyParameters(newProject(name), db), prefs);
        loadIntoApp(p, undefined, 'New project — not saved yet');
        clearRecovery();
      }
    }));
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
    showResult(dropMany(project, item, target, dropQty, db.loads));
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

  // Left menu: the recently opened projects, else the latest saved.
  const navRecent = [...recent.map((f) => projectList.find((m) => m.file === f)).filter((m): m is ProjectMeta => !!m), ...projectList]
    .filter((m, i, a) => a.indexOf(m) === i).slice(0, 5);

  return (
    <div className="app-root">
      <div className="top">
        <div className="brand">
          LV Design Studio
          <small>Low-voltage power design suite</small>
        </div>
        <div className="crumb">
          <button className="linkish" style={{ marginLeft: 0, color: 'inherit' }} onClick={() => setView('projects')} title="All projects">Projects</button> / <b>{project.name}</b>
          {dirty && <span className="dirty-dot" title={currentFile ? 'Unsaved changes — Ctrl+S / ⌘S to save' : 'Not saved yet — Ctrl+S / ⌘S to save'}>●</span>}
          {status && <span className="saved">{status}</span>}
        </div>
        <div className="sp" />
        <button className="chip" onClick={startNewProject}>New</button>
        <button className="chip" onClick={() => setView('projects')} title="All projects: open, duplicate, status">Open…</button>
        <button className="chip" onClick={() => saveProject()} title="Save (Ctrl+S / ⌘S)">Save{dirty ? ' ●' : ''}</button>
        <button className="chip" onClick={saveAs} title="Save as a new project (Ctrl+Shift+S / ⇧⌘S)">Save as…</button>
        <button className="chip user-chip" onClick={() => setShowPrefs(true)} title={prefs.profile.name ? `${signature(prefs.profile)} — profile & preferences` : 'Set up your profile: name, designation, company, logo and design defaults'}>
          <span className="av">{initialsOf(prefs.profile.name)}</span>{prefs.profile.name ? prefs.profile.name.split(/\s+/)[0] : 'Profile'}
        </button>
      </div>
      {recovery && (
        <div className="recover-bar" role="alert">
          <span>Unsaved work on <b>{recovery.project.name}</b> from {whenText(recovery.at)} was kept when the app closed.</span>
          <button className="chip primary" onClick={() => guard('restoring the recovered work', restoreRecovery)}>Restore it</button>
          <button className="chip" onClick={() => { clearRecovery(); setRecovery(null); }}>Discard</button>
        </div>
      )}

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
          onRun: runNow,
          staleCount: staleKeys.length,
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
          <button className={view === 'substation-area' ? 'on' : ''} onClick={() => setView('substation-area')}>Substation area (DM)</button>
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

          <h4>Tools</h4>
          <button className={view === 'calculators' ? 'on' : ''} onClick={() => setView('calculators')}>Quick calculators</button>

          <h4>Documents</h4>
          {DOCUMENTS.map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{label}</button>
          ))}
          <button onClick={exportOpenDss} title="Export the network as an OpenDSS script to cross-check load flow and fault levels">Export OpenDSS (.dss)</button>

          <h4>Database</h4>
          <button className={view === 'database' ? 'on' : ''} onClick={() => setView('database')}>
            Equipment &amp; data {db.issues.length > 0 && <span className="warn">({db.issues.length} ⚠)</span>}
          </button>

          <h4>Projects</h4>
          <button className={view === 'projects' ? 'on' : ''} onClick={() => setView('projects')}>All projects ({projectList.length})</button>
          {navRecent.map((p) => (
            <button key={p.file} className={currentFile === p.file ? 'on' : ''} onClick={() => openProject(p.file)} title={`${p.name} — saved ${whenText(p.updatedAt)}`}>
              {p.name}{currentFile === p.file && dirty ? ' ●' : ''}
            </button>
          ))}
          <button className="nav-more" onClick={chooseFolder} title={projectsFolder}>
            {hasBridge ? `Folder: ${projectsFolder.split(/[\\/]/).pop() || 'choose…'}` : 'Saved in this browser'}
          </button>

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
                    {panel === 'board' && board && (
                      <select
                        className="chip"
                        value=""
                        title={`Set the cable type of every outgoing cable of ${board.id} (not its load schedule circuits)`}
                        onChange={(e) => {
                          const t = e.target.value;
                          if (!t) return;
                          const ids = project.feeders.filter((f) => f.boardId === board.id && !isScheduleCircuit(f)).map((f) => f.id);
                          setProject((p) => ({ ...p, feeders: p.feeders.map((f) => (ids.includes(f.id) ? { ...f, cableType: t === 'auto' ? undefined : t } : f)) }), { step: true });
                          setStatus(`${ids.length} cable${ids.length === 1 ? '' : 's'} from ${board.id}: ${t === 'auto' ? 'automatic type (fire-rated for life safety)' : cableTypeDef(t).label}`);
                        }}
                      >
                        <option value="">Cable type for all of {board.id}…</option>
                        <option value="auto">Automatic (fire-rated for life safety)</option>
                        {CABLE_TYPE_DEFS.filter((d) => d.value !== 'XLPE/SWA/PVC').map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                    )}
                    {panel === 'board' && board && <button className="chip" onClick={() => copyBoard(board.id)} title="Copy this board with its sub-boards, feeders and load schedule circuits (⌘C)">Copy {board.id}</button>}
                    {panel === 'board' && board && copiedBoard && project.boards.some((b) => b.id === copiedBoard) && (
                      <button className="chip" onClick={() => setPasteTarget(board.id)} title={`Paste ${copiedBoard} on ${board.id}'s busbar (⌘V)`}>Paste {copiedBoard} here</button>
                    )}
                    {diagramMode === 'system' && <button className="chip" onClick={() => setShowExport(true)} title="PDF sheet with title block, DXF for CAD, or SVG">Export drawing…</button>}
                    {selectedFeeder && panel === 'feeder' && <button className="chip" onClick={() => setShowFeederForm('edit')}>Edit {selectedFeeder.id}</button>}
                    {selectedFeeder && panel === 'feeder' && <button className="chip" onClick={() => saveAsPreset(selectedFeeder)} title="Save this way (breaker, RCD, meter, isolator and its load or sub-board) as a preset to drag onto any busbar">Save as preset</button>}
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
                  <div className={`sld-edit${sldFull ? ' full' : ''}`}>
                  <EquipmentPalette onHint={setStatus} library={libraryEntries(db.loads)} presets={userPresets} qty={dropQty} onQty={setDropQty}
                    onDeletePreset={(id) => savePresets(userPresets.filter((p) => p.id !== id), 'Deleted the preset')}
                    onEditPreset={openPresetEditor} onExportPresets={exportPresets} onImportPresets={importPresets} />
                  <SystemDiagram
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
                  </div>
                ) : (
                  <SingleLineDiagram board={board} voltageV={project.voltageV} results={boardResults} selected={selected} onSelect={selectFeeder} />
                )}
              </section>
              <SystemSummaryCards
                project={calcProject}
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
                <BoardPanel project={calcProject} board={board} results={allResults} onChange={updateBoard} onSelectFeeder={selectFeeder} tab={boardTab} onTab={setBoardTab} />
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
            {STUDY_VIEWS.includes(view) && <StaleBanner stale={stale} onRun={runNow} what="the results on this page" />}
            {view === 'voltage-drop' && <VoltageDropStudy project={project} calcProject={calcProject} stale={staleKeys.length > 0} onChange={setProject} onStatus={setStatus} />}
            {view === 'earthing' && <EarthingStudy project={calcProject} onSelectFeeder={(id) => { setView('design'); selectFeeder(id); }} />}
            {/* Pages that also change the design act on the live project, so
                they only apply changes while their results are up to date. */}
            {view === 'selection' && <SelectionStudy project={calcProject} onChange={staleKeys.length ? blocked : setProject} />}
            {view === 'coordination' && <CoordinationStudy project={calcProject} />}
            {view === 'sizing' && <TransformerGeneratorStudy project={calcProject} onChange={staleKeys.length ? blocked : setProject} />}
            {view === 'pfc' && <PfcStudy project={project} onChange={(p) => setProject(p, { step: true })} onStatus={setStatus} />}
            {view === 'db-schedule' && <DbScheduleView project={calcProject} onStatus={setStatus} />}
            {view === 'cable-schedule' && <CableScheduleView project={calcProject} onStatus={setStatus} />}
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
            {view === 'substation-area' && <SubstationAreaView project={project} onChange={(p, step) => setProject(p, step ? { step: true } : undefined)} onStatus={setStatus} />}
            {view === 'ups' && <UpsStudy project={project} onChange={(p, step) => setProject(p, step ? { step: true } : undefined)} onStatus={setStatus} />}
            {view === 'solar' && <SolarStudy project={project} onChange={(p, step) => setProject(p, step ? { step: true } : undefined)} onStatus={setStatus} />}
            {view === 'cable-tray' && (
              <TrayScheduleView project={project} onChange={(p, step) => setProject(p, step ? { step: true } : undefined)} onStatus={setStatus} />
            )}
            {view === 'revisions' &&<RevisionsView project={project} me={prefs.profile.name ? initialsOf(prefs.profile.name) : ''} onChange={setProject} onStatus={setStatus} />}
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
              />
            )}
            {view === 'boq' && (
              <>
                <section className="stage"><h3>Cost estimate — whole project</h3></section>
                <BoqTable results={allResults} projectName={project.name} project={project} />
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
        <span className={`calc-state ${staleKeys.length ? 'warn' : 'ok'}`} title={staleKeys.length ? `Out of date: ${stale.join(', ')}` : undefined}>
          {staleKeys.length ? `⚠ ${staleKeys.length} stud${staleKeys.length === 1 ? 'y' : 'ies'} out of date` : `✓ Calculations up to date${run ? ` (${new Date(run.at).toLocaleTimeString()})` : ''}`}
        </span>
        <button className={`chip run-chip${staleKeys.length ? ' stale' : ''}`} onClick={runNow} title="Run the network studies (F5)">▶ Run (F5)</button>
        <button className="chip" onClick={() => setProject({ ...project, calc: { ...project.calc, autoRun: !autoRun } })} title="Run the studies on every change (small projects)">
          Auto-run: {autoRun ? 'on' : 'off'}
        </button>
        <span>{hasBridge ? `Projects folder: ${projectsFolder}` : 'Web version — projects are saved in this browser'}</span>
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
        <SldExportDialog
          project={project}
          stale={staleKeys.length > 0}
          onSave={(d) => setProject((p) => ({ ...p, drawing: d }))}
          onStatus={setStatus}
          onClose={() => setShowExport(false)}
        />
      )}
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
          onDiscard={() => { const then = ask.then; setAsk(null); clearRecovery(); then(); }}
          onSave={async () => { const then = ask.then; setAsk(null); if (await saveProject()) then(); }}
        />
      )}
      {nameAsk && (
        <NameDialog
          title={nameAsk.title}
          note={nameAsk.note}
          initial={nameAsk.initial}
          okLabel={nameAsk.okLabel}
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
        <BoardForm project={project} parentBoardId={board.id} onSave={addBoard} onClose={() => setShowBoardForm(false)} />
      )}
    </div>
  );
}
