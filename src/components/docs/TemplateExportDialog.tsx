import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../types';
import { Modal } from '../ui';
import { saveBinary, safeFileName } from '../../util/files';
import { scheduleCircuits } from '../../calc/loadSchedule';

/** Load schedule → "My Excel template…": fills your own .xlsx (placeholders
 * such as {{board.id}} and a repeated {{row.…}} row) for this DB or every DB.
 * The last template is kept on this computer for the next export. */

const KEY = 'lvds.scheduleTemplate';
interface Stored { name: string; data: string }

const toBase64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function loadStored(): { name: string; bytes: Uint8Array } | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    return v?.name && v.data ? { name: v.name, bytes: fromBase64(v.data) } : undefined;
  } catch { return undefined; }
}
function store(name: string, bytes: Uint8Array) {
  try { localStorage.setItem(KEY, JSON.stringify({ name, data: toBase64(bytes) } satisfies Stored)); } catch { /* too large or blocked: kept for this session only */ }
}

const template = () => import('../../docs/xlsxTemplate');

export default function TemplateExportDialog({ project, boardId, onStatus, onClose }: { project: Project; boardId: string; onStatus: (m: string) => void; onClose: () => void }) {
  const [tpl, setTpl] = useState(loadStored);
  const [scope, setScope] = useState<'this' | 'all'>('this');
  const [preview, setPreview] = useState<{ rows: string[][]; repeatRow?: number }>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<{ key: string; about: string }[]>([]);
  const dbCount = project.boards.filter((b) => scheduleCircuits(project, b.id).length > 0).length;
  const fileRef = useRef<HTMLInputElement>(null);
  const boardIds = scope === 'this' ? [boardId] : undefined;

  useEffect(() => {
    let live = true;
    void template().then((m) => { if (live) setFields(m.TEMPLATE_FIELDS); });
    return () => { live = false; };
  }, []);

  // Preview and a dry run, so unknown placeholders show before exporting.
  useEffect(() => {
    if (!tpl) return;
    let live = true;
    void (async () => {
      try {
        const m = await template();
        const p = await m.templatePreview(tpl.bytes);
        const r = await m.fillLoadScheduleTemplate(project, tpl.bytes, { boardIds: scope === 'this' ? [boardId] : undefined });
        if (live) { setPreview(p); setWarnings(r.warnings); setError(undefined); }
      } catch (e) {
        if (live) { setPreview(undefined); setWarnings([]); setError(e instanceof Error ? e.message : String(e)); }
      }
    })();
    return () => { live = false; };
  }, [tpl, project, scope, boardId]);

  async function choose(file: File) {
    if (!/\.xlsx$/i.test(file.name)) { setError('Choose an Excel workbook (.xlsx).'); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    setTpl({ name: file.name, bytes });
    store(file.name, bytes);
  }

  async function exportNow() {
    if (!tpl) return;
    setBusy(true);
    try {
      const m = await template();
      const { workbook } = await m.fillLoadScheduleTemplate(project, tpl.bytes, { boardIds });
      const { workbookBytes } = await import('../../docs/formWorkbook');
      const stem = tpl.name.replace(/\.xlsx$/i, '');
      const saved = await saveBinary(`${safeFileName(`${project.name} ${scope === 'this' ? boardId : 'DB schedules'} - ${stem}`)}.xlsx`, await workbookBytes(workbook), 'Excel workbook', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (saved) { onStatus(saved); onClose(); }
    } catch (e) {
      setError(`Excel export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} style={{ maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); void exportNow(); }}>
      <h3>DB schedules in your own Excel template</h3>
      <div className="tpl-file">
        <span>{tpl ? tpl.name : <span className="m">No template chosen yet</span>}</span>
        <button type="button" className="chip" onClick={() => fileRef.current?.click()}>{tpl ? 'Change…' : 'Choose…'}</button>
        <input ref={fileRef} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }} />
      </div>
      <div className="row">
        <label className="row"><input type="radio" name="tpl-scope" checked={scope === 'this'} onChange={() => setScope('this')} /> This DB ({boardId})</label>
        <label className="row"><input type="radio" name="tpl-scope" checked={scope === 'all'} onChange={() => setScope('all')} /> All DBs ({dbCount})</label>
      </div>
      {preview && (
        <div className="tpl-preview">
          <table><tbody>
            {preview.rows.map((r, i) => <tr key={i} className={i === preview.repeatRow ? 'rep' : undefined}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
          </tbody></table>
        </div>
      )}
      <p className="m">The row with {'{{row.…}}'} placeholders repeats for every circuit and spare. The template is remembered on this computer for the next export.</p>
      {error && <p className="warn">{error}</p>}
      {warnings.map((w) => <p key={w} className="warn">{w}</p>)}
      <details>
        <summary>Placeholder guide</summary>
        <p className="m">Write each one in braces, e.g. {'{{board.id}}'}.</p>
        <table className="compact"><tbody>{fields.map((f) => <tr key={f.key}><td><code>{f.key}</code></td><td>{f.about}</td></tr>)}</tbody></table>
      </details>
      <div className="modal-actions">
        <span className="sp" />
        <button type="button" className="chip" onClick={onClose}>Cancel</button>
        <button type="submit" className="chip primary" disabled={!tpl || !!error || busy}>{busy ? 'Exporting…' : 'Export'}</button>
      </div>
    </Modal>
  );
}
