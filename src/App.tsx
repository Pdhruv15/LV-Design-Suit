import { useEffect, useMemo, useState } from 'react';
import { Project, newProject } from './types';
import { sampleProject } from './data/sampleProject';
import { evaluateProject } from './calc/electrical';
import SingleLineDiagram from './components/SingleLineDiagram';
import ResultsTable from './components/ResultsTable';
import SidePanel from './components/SidePanel';

// window.lvds is only present when running inside Electron. Fall back to
// in-memory-only mode so the same UI still runs in a plain browser tab
// during development (`vite` alone, without `electron .`).
const hasBridge = typeof window !== 'undefined' && !!window.lvds;

export default function App() {
  const [project, setProject] = useState<Project>(sampleProject);
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined);
  const [projectsFolder, setProjectsFolder] = useState<string>('');
  const [projectList, setProjectList] = useState<{ file: string; name: string; updatedAt: number }[]>([]);
  const [selected, setSelected] = useState<string | null>(project.feeders[0]?.id ?? null);
  const [status, setStatus] = useState<string>('');

  const results = useMemo(() => evaluateProject(project), [project]);
  const board = project.boards[0];

  useEffect(() => {
    if (!hasBridge) return;
    window.lvds.settings.get().then((s) => setProjectsFolder(s.projectsFolder));
    refreshList();
  }, []);

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
    setSelected(p.feeders[0]?.id ?? null);
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
    setSelected(null);
    setStatus('New project — not saved yet');
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
        <nav className="nav" aria-label="Projects">
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

        <main className="mid">
          <section className="stage">
            <h3>Single line diagram – {board.id}</h3>
            <SingleLineDiagram board={board} results={results} selected={selected} onSelect={setSelected} />
          </section>
          <ResultsTable results={results} vdLimitPct={project.vdLimitPct} selected={selected} onSelect={setSelected} />
        </main>

        <aside className="side">
          <SidePanel results={results} selected={selected} />
        </aside>
      </div>

      <div className="foot">
        <span>Base: {project.voltageV} V, 3-phase, {project.frequencyHz} Hz</span>
        <span>Ambient: {project.ambientC} °C</span>
        <span>Vd limit: {project.vdLimitPct}%</span>
        <span className="sp" />
        <span>{hasBridge ? `Projects folder: ${projectsFolder}` : 'Run inside the Electron app to save/load projects'}</span>
      </div>
    </div>
  );
}
