import { useMemo, useState } from 'react';
import type { Project } from '../types';
import { anonymizeProject, anonymizedFileName } from '../model/anonymize';
import { savePdf, saveText } from '../util/files';
import { Modal } from './ui';

/** Export anonymized sample: one sanitized copy of the open project (model/anonymize.ts), saved as a project
 * file and / or a calculation report, so a technical issue can be shared without the client, site or people.
 * The open project is not changed. Drawings are not offered: their title blocks and sheets are built from the
 * full project, and this copy has none of that to draw. */
export default function AnonymizedSampleDialog({ project, onClose, onStatus }: { project: Project; onClose: () => void; onStatus: (m: string) => void }) {
  const r = useMemo(() => anonymizeProject(project), [project]);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (what: () => Promise<string | null>) => {
    setBusy(true);
    try { const m = await what(); if (m) onStatus(`${m} — anonymized sample; review it before sharing`); }
    finally { setBusy(false); }
  };
  const json = () => run(() => saveText(anonymizedFileName('json'), JSON.stringify(r.project, null, 2), 'LV Design Studio project', 'json'));
  // The report code loads when the PDF is asked for, not at start-up.
  const pdf = () => run(async () => savePdf(anonymizedFileName('pdf', 'calculation-report'), (await import('../docs/calcReport')).buildReportHtml(r.project),
    { pageSize: 'A4', landscape: true, cssPages: true, selfNumbered: true, anonymous: true }));

  return (
    <Modal onClose={onClose} style={{ maxWidth: 620 }}>
      <h3>Export anonymized sample</h3>
      <p>A copy of this project for reporting a technical issue: the panels, circuits, cables, breakers, loads, cable trays and calculation settings are kept, so the results are the same. Panels become P01…, circuits C001…, with neutral names. Your open project is not changed.</p>
      <p><b>Left out:</b> project and file name, owner, consultant, contractor, contacts, plot and area, people (designed / checked / approved by), logos and title blocks, notes, tags, revisions, comments, changes, submissions, documents, building and room data, and anything this version does not recognise.</p>
      {r.removed.length > 0 && (
        <details style={{ margin: '6px 0' }}>
          <summary>Removed from this project ({r.removed.length})</summary>
          <ul className="m" style={{ maxHeight: 160, overflow: 'auto', margin: '6px 0' }}>{r.removed.map((x) => <li key={x}>{x}</li>)}</ul>
        </details>
      )}
      <div role="note" style={{ margin: '8px 0', padding: '6px 10px', border: '1px solid var(--warn)', borderRadius: 6 }}>
        {r.warnings.map((w) => <p key={w} style={{ margin: '4px 0' }}>{w}</p>)}
        <p style={{ margin: '4px 0' }}>Drawings (SLD, earthing, DXF) are not exported here. The PDF names no author; the browser version opens the print dialog instead, where you choose what is saved.</p>
      </div>
      <label className="row" style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I will check the file before sharing it: a distinctive layout can still point to a real project.</label>
      <div className="modal-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
        <button className="chip" onClick={onClose}>Close</button>
        <span className="sp" />
        <button className="chip" disabled={!reviewed || busy} onClick={pdf} title="Calculation report of the anonymized copy, with no author in the PDF information">Calculation report (PDF)</button>
        <button className="chip primary" disabled={!reviewed || busy} onClick={json} title="The anonymized copy as a project file (anonymized-sample.json)">Sample project (.json)</button>
      </div>
    </Modal>
  );
}
