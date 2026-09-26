import { useEffect, useMemo, useState } from 'react';
import { Feeder, Board, Project, newProject } from './types';
import { sampleProject } from './data/sampleProject';
import { evaluateProject } from './calc/electrical';
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
import CoordinationStudy from './components/studies/CoordinationStudy';
import { PfcStudy, TransformerGeneratorStudy } from './components/studies/SizingStudy';
import { CableScheduleView, DbScheduleView, EquipmentScheduleView, ReportView } from './components/docs/Documents';

// window.lvds is only present when running inside Electron. Fall back to
// in-memory-only mode so the same UI still runs in a plain browser tab
// during development (`vite` alone, without `electron .`).
const hasBridge = typeof window !== 'undefined' && !!window.lvds;

import { DOCUMENTS, STUDIES, type MainView } from './views';
import Ribbon, { tabForView, type DiagramTool, type RibbonTab } from './components/Ribbon';
import ProjectSettings from './components/ProjectSettings';
import type { BoardTab } from './components/BoardPanel';
type DiagramMode = 'system' | 'board';

export default function App() {
  const [project, setProject] = useState<Project>(sampleProject);
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
    setProject(p);
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
    const p = newProject('Untitled project');
    setProject(p);
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

  function deleteFeeder(id: string) {
    setProject((prev) => ({ ...prev, feeders: prev.feeders.filter((x) => x.id !== id) }));
    setSelected(null);
    setShowFeederForm(null);
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
          onSettings: () => setShowSettings(true)
        }}
      />

      <div className="app">
        <nav className="nav" aria-label="Navigation">
          <h4>Design</h4>
          <button className={view === 'design' ? 'on' : ''} onClick={() => setView('design')}>Single line diagram</button>

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
                    {selectedFeeder && panel === 'feeder' && <button className="chip" onClick={() => setShowFeederForm('edit')}>Edit {selectedFeeder.id}</button>}
                  </div>
                </div>
                {diagramMode === 'system' ? (
                  <SystemDiagram
                    project={project}
                    results={allResults}
                    selectedFeederId={panel === 'feeder' ? selected : null}
                    selectedBoardId={panel === 'board' ? board.id : null}
                    onSelectFeeder={selectFeeder}
                    onSelectBoard={selectBoard}
                    tool={tool}
                  />
                ) : (
                  <SingleLineDiagram board={board} results={boardResults} selected={selected} onSelect={selectFeeder} />
                )}
              </section>
              <SystemSummaryCards project={project} selectedBoardId={panel === 'board' ? board.id : null} onSelectBoard={selectBoard} />
              <h3 className="section-title">Feeders on {board.id}</h3>
              <ResultsTable results={boardResults} vdLimitPct={project.vdLimitPct} selected={selected} onSelect={selectFeeder} />
            </main>

            <aside className="side">
              {panel === 'board' ? (
                <BoardPanel project={project} board={board} results={allResults} onChange={updateBoard} onSelectFeeder={selectFeeder} tab={boardTab} onTab={setBoardTab} />
              ) : (
                <SidePanel results={boardResults} selected={selected} />
              )}
            </aside>
          </>
        ) : (
          <main className="mid" style={{ gridColumn: '2 / span 2' }}>
            {view === 'engines' && (
              <>
                <section className="stage"><h3>Load flow — engine comparison</h3></section>
                <EngineCompare project={project} />
              </>
            )}
            {view === 'earthing' && <EarthingStudy project={project} onSelectFeeder={(id) => { setView('design'); selectFeeder(id); }} />}
            {view === 'selection' && <SelectionStudy project={project} onChange={setProject} />}
            {view === 'coordination' && <CoordinationStudy project={project} />}
            {view === 'sizing' && <TransformerGeneratorStudy project={project} onChange={setProject} />}
            {view === 'pfc' && <PfcStudy project={project} onChange={setProject} />}
            {view === 'db-schedule' && <DbScheduleView project={project} onStatus={setStatus} />}
            {view === 'cable-schedule' && <CableScheduleView project={project} onStatus={setStatus} />}
            {view === 'equipment' && <EquipmentScheduleView project={project} onStatus={setStatus} />}
            {view === 'report' && <ReportView project={project} onStatus={setStatus} />}
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
          onSave={saveFeeder}
          onDelete={showFeederForm === 'edit' && selectedFeeder ? () => deleteFeeder(selectedFeeder.id) : undefined}
          onClose={() => setShowFeederForm(null)}
        />
      )}
      {showSettings && (
        <ProjectSettings project={project} onSave={(p) => { setProject(p); setShowSettings(false); }} onClose={() => setShowSettings(false)} />
      )}
      {showBoardForm && board && (
        <BoardForm project={project} parentBoardId={board.id} onSave={addBoard} onClose={() => setShowBoardForm(false)} />
      )}
    </div>
  );
}
