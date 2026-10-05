import { useState } from 'react';
import { PROJECT_STATUSES, type Project, type ProjectStatus } from '../types';
import { detailsOf, parseTags, type ProjectDetails } from '../model/projectList';

/** Name, status, client, parties, plot, tags and notes of one project, edited from the Projects list. */
export default function ProjectDetailsDialog({ file, project, onSave, onCancel }: { file: string; project: Project; onSave: (details: ProjectDetails) => void; onCancel: () => void }) {
  const d0 = detailsOf(project);
  const [d, setD] = useState({ ...d0, tags: d0.tags.join(', ') });
  const up = (k: keyof typeof d, v: string) => setD((cur) => ({ ...cur, [k]: v }));
  const created = project.createdAt ? new Date(project.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (d.name.trim()) onSave({ ...d, status: d.status as ProjectStatus, tags: parseTags(d.tags) }); }}>
        <h3>Project details</h3>
        <label>Project name<input autoFocus value={d.name} onChange={(e) => up('name', e.target.value)} /></label>
        <div className="grid2">
          <label>Status<select value={d.status} onChange={(e) => up('status', e.target.value)}>{PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
          <label>Owner / client<input value={d.owner} onChange={(e) => up('owner', e.target.value)} /></label>
          <label>Consultant<input value={d.consultant} onChange={(e) => up('consultant', e.target.value)} /></label>
          <label>Contractor<input value={d.contractor} onChange={(e) => up('contractor', e.target.value)} /></label>
          <label>Plot no.<input value={d.plotNo} onChange={(e) => up('plotNo', e.target.value)} /></label>
          <label>Area<input value={d.area} onChange={(e) => up('area', e.target.value)} placeholder="e.g. VILLA, UAE" /></label>
        </div>
        <label>Tags <span className="m">(comma separated, for finding projects)</span><input value={d.tags} onChange={(e) => up('tags', e.target.value)} placeholder="villa, DEWA, 2026" /></label>
        <label>Notes<textarea rows={3} value={d.notes} onChange={(e) => up('notes', e.target.value)} /></label>
        <p className="m">File: {file} · created {created}{project.origin?.copiedFromName ? ` · copied from ${project.origin.copiedFromName}` : ''}. The file name stays the same when a project is renamed.</p>
        <div className="modal-actions"><span className="sp" /><button type="button" className="chip" onClick={onCancel}>Cancel</button><button type="submit" className="chip primary" disabled={!d.name.trim()}>Save details</button></div>
      </form>
    </div>
  );
}
