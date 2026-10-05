import { useState } from 'react';
import { FolderOpen, Copy, Trash2, Plus, Search, ArrowRight, Sparkles, Archive, ArchiveRestore, Pencil, ChevronUp, ChevronDown, Undo2 } from 'lucide-react';
import { PROJECT_STATUSES, type ProjectStatus } from '../types';
import { whenText, type ProjectMeta, type TrashedProject } from '../model/projectStore';
import { facets, filterProjects, NO_FILTERS, sortProjects, type ArchiveFilter, type ListFilters, type SortBy, type SortKey } from '../model/projectList';
import { Page } from './ui';

const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const statusLabel = (s?: ProjectStatus) => PROJECT_STATUSES.find((x) => x.value === (s ?? 'design'))!.label;

/** All saved projects: recent ones first as cards, then a searchable table
 * with where each job is (status), client, plot, revision and who saved it
 * last. Open, duplicate, delete, change status. */
export default function ProjectsDashboard({ list, recent, currentFile, currentName, dirty, folder, desktop, onOpen, onNew, onDuplicate, onDelete, onStatus, onChooseFolder, onPick, onContinue, onSample, onCompare, onDetails, onArchive, trash, onRestore, onEmptyTrash }: {
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
  /** Open the sample villa project to look around. */
  onSample: () => void;
  /** Compare a project file with another (a sync tool's conflicted copy and its original). */
  onCompare: (file: string, other: string) => void;
  /** Edit name, status, client, tags and notes without opening the project. */
  onDetails: (file: string) => void;
  /** Hide a project from the active list (or bring it back); nothing is deleted. */
  onArchive: (file: string, archived: boolean) => void;
  /** Deleted projects, kept 30 days. */
  trash: TrashedProject[];
  onRestore: (trashFile: string) => void;
  onEmptyTrash: () => void;
}) {
  const [f, setF] = useState<ListFilters>(NO_FILTERS);
  const [sort, setSort] = useState<SortBy>({ key: 'updatedAt', dir: 'desc' });
  const [showTrash, setShowTrash] = useState(false);
  const set = (p: Partial<ListFilters>) => setF((cur) => ({ ...cur, ...p }));
  const byFile = new Map(list.map((m) => [m.file, m]));
  const active = list.filter((m) => !m.archivedAt);
  const recentCards = recent.map((x) => byFile.get(x)).filter((m): m is ProjectMeta => !!m && !m.archivedAt).slice(0, 6);
  const rows = sortProjects(filterProjects(list, f), sort);
  const archivedCount = list.length - active.length;
  const fx = facets(list);
  const counts = PROJECT_STATUSES.map((s) => ({ ...s, n: active.filter((m) => (m.status ?? 'design') === s.value).length })).filter((s) => s.n);
  const filtered = f.text.trim() || f.status || f.client || f.year || f.tag || f.archived !== 'active';
  const sortBy = (key: SortKey) => setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'updatedAt' || key === 'boards' ? 'desc' : 'asc' }));
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th><button className="linkish th-sort" style={{ marginLeft: 0 }} onClick={() => sortBy(k)} title="Sort by this column">{children}{sort.key === k && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</button></th>
  );

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
        <button className="home-act" onClick={onPick}><FolderOpen size={22} /><b>Open project…</b><span>{desktop ? 'Choose a project file' : 'A project file from this computer'}</span></button>
        <button className="home-act" onClick={onSample}><Sparkles size={22} /><b>Explore sample</b><span>A villa with an MDB, SMDBs and studies</span></button>
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
        <label className="search"><Search size={14} /><input type="search" placeholder="Search name, client, consultant, plot, tag, engineer…" value={f.text} onChange={(e) => set({ text: e.target.value })} /></label>
        <select value={f.status} onChange={(e) => set({ status: e.target.value as ListFilters['status'] })} title="Status">
          <option value="">All statuses ({active.length})</option>
          {counts.map((s) => <option key={s.value} value={s.value}>{s.label} ({s.n})</option>)}
        </select>
        {fx.clients.length > 0 && <select value={f.client} onChange={(e) => set({ client: e.target.value })} title="Client / owner"><option value="">All clients</option>{fx.clients.map((c) => <option key={c}>{c}</option>)}</select>}
        {fx.years.length > 1 && <select value={f.year} onChange={(e) => set({ year: e.target.value })} title="Year of the last save"><option value="">All years</option>{fx.years.map((y) => <option key={y}>{y}</option>)}</select>}
        {fx.tags.length > 0 && <select value={f.tag} onChange={(e) => set({ tag: e.target.value })} title="Tag"><option value="">All tags</option>{fx.tags.map((t) => <option key={t}>{t}</option>)}</select>}
        <select value={f.archived} onChange={(e) => set({ archived: e.target.value as ArchiveFilter })} title="Archived projects are hidden from the active list; nothing is deleted">
          <option value="active">Active</option>
          <option value="archived">Archived ({archivedCount})</option>
          <option value="all">Active and archived</option>
        </select>
        {filtered && <button className="linkish" onClick={() => setF(NO_FILTERS)}>Clear filters</button>}
      </div>

      {list.length === 0 ? (
        <p className="m">No projects saved yet — press Save (Ctrl+S / ⌘S) to save the open one.</p>
      ) : (
        <table className="projects-table">
          <thead>
            <tr><Th k="name">Project</Th><Th k="status">Status</Th><Th k="owner">Owner / client</Th><Th k="plot">Plot · area</Th><Th k="revision">Rev</Th><Th k="boards">Boards</Th><Th k="updatedAt">Last saved</Th><th /></tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.file} className={`${m.file === currentFile ? 'on' : ''}${m.archivedAt ? ' archived' : ''}`} onDoubleClick={() => onOpen(m.file)}>
                <td>
                  <button className="linkish" onClick={() => onOpen(m.file)} title={m.file}>{m.name}</button>{m.file === currentFile && <span className="m"> · open{dirty ? ', unsaved changes' : ''}</span>}{m.archivedAt && <span className="m"> · archived</span>}
                  {m.tags && <div className="ptags">{m.tags.map((t) => <button key={t} className="chip-lite" onClick={() => set({ tag: t })} title={`Show projects tagged ${t}`}>{t}</button>)}</div>}
                  {!m.file.toLowerCase().startsWith(slugOf(m.name)) && <div className="m" title="The file name does not change when a project is renamed">File: {m.file}</div>}
                  {m.conflictOf && <div className="m" style={{ color: 'var(--warn, #e2a03f)' }}>⚠ Looks like a sync conflict copy of {m.conflictOf} <button className="linkish" onClick={() => onCompare(m.conflictOf!, m.file)}>Compare</button></div>}
                </td>
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
                  <button className="icon-btn" title="Details — name, status, client, tags, notes" onClick={() => onDetails(m.file)}><Pencil size={14} /></button>
                  <button className="icon-btn" title="Duplicate — a copy to start a similar job" onClick={() => onDuplicate(m.file)}><Copy size={14} /></button>
                  <button className="icon-btn" title={m.archivedAt ? 'Bring back to the active list' : 'Archive — hide from the active list, nothing is deleted'} onClick={() => onArchive(m.file, !m.archivedAt)}>{m.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>
                  <button className="icon-btn" title="Delete — moves to the trash for 30 days" onClick={() => onDelete(m.file)}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="m">{f.archived === 'active' && archivedCount && !filtered ? 'No active projects.' : 'Nothing matches.'}{filtered && <> <button className="linkish" onClick={() => setF(NO_FILTERS)}>Clear filters</button></>}</td></tr>}
          </tbody>
        </table>
      )}

      {trash.length > 0 && (
        <>
          <h4 className="projects-h"><button className="linkish" style={{ marginLeft: 0, color: 'inherit', font: 'inherit' }} onClick={() => setShowTrash(!showTrash)}>{showTrash ? '▾' : '▸'} Trash ({trash.length})</button></h4>
          {showTrash && (
            <>
              <p className="m">Deleted projects are kept for 30 days, then removed for good.</p>
              <table className="projects-table">
                <tbody>
                  {trash.map((t) => (
                    <tr key={t.trashFile}>
                      <td>{t.name}<div className="m">{t.file}</div></td>
                      <td className="m">Deleted {whenText(t.deletedAt)} · {t.daysLeft} day{t.daysLeft === 1 ? '' : 's'} left</td>
                      <td className="acts"><button className="chip" onClick={() => onRestore(t.trashFile)}><Undo2 size={12} /> Restore</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="chip" onClick={onEmptyTrash}>Empty trash now…</button>
            </>
          )}
        </>
      )}
    </Page>
  );
}
