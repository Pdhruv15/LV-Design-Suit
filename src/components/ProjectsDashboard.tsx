import { useState } from 'react';
import { FolderOpen, Copy, Trash2, Plus, Search, ArrowRight } from 'lucide-react';
import { PROJECT_STATUSES, type ProjectStatus } from '../types';
import { whenText, type ProjectMeta } from '../model/projectStore';
import { Page } from './ui';

const statusLabel = (s?: ProjectStatus) => PROJECT_STATUSES.find((x) => x.value === (s ?? 'design'))!.label;

/** All saved projects: recent ones first as cards, then a searchable table
 * with where each job is (status), client, plot, revision and who saved it
 * last. Open, duplicate, delete, change status. */
export default function ProjectsDashboard({ list, recent, currentFile, currentName, dirty, folder, desktop, onOpen, onNew, onDuplicate, onDelete, onStatus, onChooseFolder, onPick, onContinue }: {
  list: ProjectMeta[];
  recent: string[];
  currentFile?: string;
  currentName: string;
  dirty: boolean;
  folder: string;
  desktop: boolean;
  onOpen: (file: string) => void;
  onNew: () => void;
  onDuplicate: (file: string) => void;
  onDelete: (file: string) => void;
  onStatus: (file: string, s: ProjectStatus) => void;
  onChooseFolder: () => void;
  /** Open project… (desktop file picker; browser: jump to the list). */
  onPick: () => void;
  /** Back to the project open now (its Overview). */
  onContinue: () => void;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | ProjectStatus>('');
  const byFile = new Map(list.map((m) => [m.file, m]));
  const recentCards = recent.map((f) => byFile.get(f)).filter((m): m is ProjectMeta => !!m).slice(0, 6);
  const words = q.trim().toLowerCase();
  const rows = list.filter((m) =>
    (!status || (m.status ?? 'design') === status) &&
    (!words || [m.name, m.owner, m.plotNo, m.area, m.updatedBy, m.file].filter(Boolean).join(' ').toLowerCase().includes(words)));
  const counts = PROJECT_STATUSES.map((s) => ({ ...s, n: list.filter((m) => (m.status ?? 'design') === s.value).length })).filter((s) => s.n);

  // Continue: the project open now, else the most recent one.
  const last = currentFile ? byFile.get(currentFile) : recentCards[0];
  const continueName = currentFile || dirty ? currentName : last?.name;
  const continueAct = currentFile || dirty ? onContinue : last ? () => onOpen(last.file) : undefined;

  return (
    <Page
      title="Projects"
      intro={<>
        {desktop
          ? <>Saved in <button className="linkish" style={{ marginLeft: 0 }} onClick={onChooseFolder} title="Choose another folder, e.g. a Google Drive or OneDrive folder">{folder || 'the projects folder'}</button>.</>
          : 'Web version: projects are saved in this browser. Use the desktop app to save them as files in a folder.'}
      </>}
    >
      <div className="home-actions">
        <button className="home-act primary" onClick={onNew}><Plus size={22} /><b>New project</b><span>Start from your profile's defaults</span></button>
        <button className="home-act" onClick={onPick}><FolderOpen size={22} /><b>Open project…</b><span>{desktop ? 'Choose a project file' : 'Pick from all projects below'}</span></button>
        <button className="home-act" onClick={continueAct} disabled={!continueAct}>
          <ArrowRight size={22} /><b>Continue{continueName ? ` ${continueName}` : ''}</b>
          <span>{!continueAct ? 'No recent project yet' : currentFile || dirty ? `Open now${dirty ? ' · unsaved changes' : ''}${!currentFile ? ' · not saved yet' : ''}` : `Last opened ${whenText(last!.updatedAt)}`}</span>
        </button>
      </div>

      {recentCards.length > 0 && (
        <>
          <h4 className="projects-h">Recent</h4>
          <div className="project-cards">
            {recentCards.map((m) => (
              <button key={m.file} className={`project-card${m.file === currentFile ? ' on' : ''}`} onClick={() => onOpen(m.file)} title={`Open ${m.name}`}>
                <b>{m.name}</b>
                <span className={`pstat s-${m.status ?? 'design'}`}>{statusLabel(m.status)}</span>
                <span className="m">{[m.owner, m.plotNo && `Plot ${m.plotNo}`].filter(Boolean).join(' · ') || '—'}</span>
                <span className="m">{m.revision ? `Rev ${m.revision} · ` : ''}{whenText(m.updatedAt)}{m.updatedBy ? ` · ${m.updatedBy}` : ''}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <h4 className="projects-h" id="all-projects">All projects</h4>
      <div className="projects-tools">
        <label className="search"><Search size={14} /><input type="search" placeholder="Search name, client, plot, engineer…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select value={status} onChange={(e) => setStatus(e.target.value as '' | ProjectStatus)}>
          <option value="">All statuses ({list.length})</option>
          {counts.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.n})</option>)}
        </select>
      </div>

      {list.length === 0 ? (
        <p className="m">No projects saved yet — press Save (Ctrl+S / ⌘S) to save the open one.</p>
      ) : (
        <table className="projects-table">
          <thead>
            <tr><th>Project</th><th>Status</th><th>Owner / client</th><th>Plot · area</th><th>Rev</th><th>Boards</th><th>Last saved</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.file} className={m.file === currentFile ? 'on' : ''} onDoubleClick={() => onOpen(m.file)}>
                <td><button className="linkish" onClick={() => onOpen(m.file)}>{m.name}</button>{m.file === currentFile && <span className="m"> · open{dirty ? ', unsaved changes' : ''}</span>}</td>
                <td>
                  <select className={`pstat-sel s-${m.status ?? 'design'}`} value={m.status ?? 'design'} onChange={(e) => onStatus(m.file, e.target.value as ProjectStatus)}>
                    {PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </td>
                <td>{m.owner ?? ''}</td>
                <td>{[m.plotNo, m.area].filter(Boolean).join(' · ')}</td>
                <td>{m.revision ?? '—'}</td>
                <td>{m.boards ?? ''}</td>
                <td title={new Date(m.updatedAt).toLocaleString()}>{whenText(m.updatedAt)}{m.updatedBy ? <span className="m"> · {m.updatedBy}</span> : null}</td>
                <td className="acts">
                  <button className="icon-btn" title="Open" onClick={() => onOpen(m.file)}><FolderOpen size={14} /></button>
                  <button className="icon-btn" title="Duplicate — a copy to start a similar job" onClick={() => onDuplicate(m.file)}><Copy size={14} /></button>
                  <button className="icon-btn" title="Delete this project file" onClick={() => onDelete(m.file)}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="m">Nothing matches.</td></tr>}
          </tbody>
        </table>
      )}
    </Page>
  );
}
