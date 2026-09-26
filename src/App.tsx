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

// window.lvds is only present when running inside Electron. Fall back to
// in-memory-only mode so the same UI still runs in a plain browser tab
// during development (`vite` alone, without `electron .`).
const hasBridge = typeof window !== 'undefined' && !!window.lvds;

type MainView = 'design' | 'boq';

export default function App() {
  const [project, setProject] = useState<Project>(sampleProject);
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);
  const [projectsFolder, setProjectsFolder] = useState<string>('');
  const [projectList, setProjectList] = useState<{ file: string; name: string; updatedAt: number }[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string>(project.boards[0]?.id ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [view, setView] = useState<MainView>('design');
  const [showFeederForm, setShowFeederForm] = useState<'new' | 'edit' | null>(null);
  const [showBoardForm, setShowBoardForm] = useState(false);

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

  function deleteFeeder(id: string) {
    setProject((prev) => ({ ...prev, feeders: prev.feeders.filter((x) => x.id !== id) }));
    setSelected(null);
    setShowFeederForm(null);
  }

  function addBoard(b: Board, incomer: Feeder) {
    setProject((prev) => ({ ...prev, boards: [...prev.boards, b], feeders: [...prev.feeders, incomer] }));
    setActiveBoardId(b.id);
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

      <div className="app">
        <nav className="nav" aria-label="Navigation">
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

          <h4>Boards</h4>
          {project.boards.map((b) => (
            <button key={b.id} className={view === 'design' && board?.id === b.id ? 'on' : ''} onClick={() => { setView('design'); setActiveBoardId(b.id); }}>
              {b.id}
            </button>
          ))}
          <button onClick={() => setShowBoardForm(true)}>+ Add board</button>

          <h4>Reports</h4>
          <button className={view === 'boq' ? 'on' : ''} onClick={() => setView('boq')}>Cost estimate (BOQ)</button>
        </nav>

        {view === 'design' && board ? (
          <>
            <main className="mid">
              <section className="stage">
                <div className="stage-head">
                  <h3>Single line diagram – {board.id}</h3>
                  <div>
                    <button className="chip" onClick={() => setShowFeederForm('new')}>+ Add feeder</button>
                    {selectedFeeder && <button className="chip" onClick={() => setShowFeederForm('edit')}>Edit selected</button>}
                  </div>
                </div>
                <SingleLineDiagram board={board} results={boardResults} selected={selected} onSelect={setSelected} />
              </section>
              <ResultsTable results={boardResults} vdLimitPct={project.vdLimitPct} selected={selected} onSelect={setSelected} />
            </main>

            <aside className="side">
              <SidePanel results={boardResults} selected={selected} />
            </aside>
          </>
        ) : (
          <main className="mid" style={{ gridColumn: '2 / span 2' }}>
            <section className="stage">
              <h3>Cost estimate — whole project</h3>
            </section>
            <BoqTable results={allResults} projectName={project.name} />
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
          onSave={saveFeeder}
          onDelete={showFeederForm === 'edit' && selectedFeeder ? () => deleteFeeder(selectedFeeder.id) : undefined}
          onClose={() => setShowFeederForm(null)}
        />
      )}
      {showBoardForm && board && (
        <BoardForm project={project} parentBoardId={board.id} onSave={addBoard} onClose={() => setShowBoardForm(false)} />
      )}
    </div>
  );
}
