import { useState } from 'react';
import { nextRev, SHEET_STATUSES, sheetRev, type DrawingSheet, type IssueInput } from '../../model/drawingSet';
import { Modal } from '../ui';

/** Issue sheets: date, purpose, what changed and the revision each sheet goes out at.
 * Its own file so the SLD workspace can open it without loading the Drawings view. */
export function IssueDialog({ sheets, projectRev, onClose, onIssue }: { sheets: DrawingSheet[]; projectRev?: string; onClose: () => void; onIssue: (o: IssueInput, pdf: boolean) => void }) {
  const [o, setO] = useState<IssueInput>({ date: new Date().toISOString().slice(0, 10), purpose: 'FOR APPROVAL', description: '', to: '', bump: sheets.some((s) => s.history?.length || s.rev) });
  const [pdf, setPdf] = useState(true);
  const after = (s: DrawingSheet) => { const cur = sheetRev(s, projectRev); return o.bump && (s.history?.length || s.rev) ? nextRev(cur) : (cur || 'A'); };
  return (
    <Modal onClose={onClose} onSubmit={(e) => { e.preventDefault(); onIssue(o, pdf); }}>
      <h3>Issue {sheets.length} sheet{sheets.length === 1 ? '' : 's'}</h3>
      <div className="grid2">
        <label>Date<input type="date" required value={o.date} onChange={(e) => setO({ ...o, date: e.target.value })} /></label>
        <label>Purpose of issue<select value={o.purpose} onChange={(e) => setO({ ...o, purpose: e.target.value })}>{SHEET_STATUSES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label style={{ gridColumn: '1 / -1' }}>What changed (revision table and transmittal)<input value={o.description} placeholder="e.g. Updated MDB feeder sizes per DEWA comments" onChange={(e) => setO({ ...o, description: e.target.value })} /></label>
        <label>To<input value={o.to ?? ''} placeholder="e.g. DEWA, client, contractor" onChange={(e) => setO({ ...o, to: e.target.value })} /></label>
        <label className="row"><input type="checkbox" checked={o.bump} onChange={(e) => setO({ ...o, bump: e.target.checked })} /> Move to the next revision</label>
      </div>
      <div className="tw dr-issue-list">
        <table className="ds-table"><thead><tr><th>Drawing no.</th><th>Title</th><th>Rev now</th><th>Issued as</th></tr></thead>
          <tbody>{sheets.map((s) => <tr key={s.id}><td>{s.number}</td><td>{s.title}</td><td>{sheetRev(s, projectRev) || '—'}</td><td><b>{after(s)}</b></td></tr>)}</tbody>
        </table>
      </div>
      <label className="row"><input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} /> Save the transmittal and the issued sheets as PDF now</label>
      <div className="modal-actions"><span className="sp" /><button type="button" className="chip" onClick={onClose}>Cancel</button><button type="submit" className="chip primary" disabled={!sheets.length}>Issue</button></div>
    </Modal>
  );
}
