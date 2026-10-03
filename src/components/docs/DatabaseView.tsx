import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import { BOOKS, DATABASE_FOLDER, type Database } from '../../database/database';
import { Page } from '../ui';

type Row = Record<string, string | number>;
interface Col { key: string; header: string; width?: number; required?: boolean; number?: boolean; list?: string[]; help?: string }
interface Book { id: string; file: string; sheet: string; about: string[]; columns: Col[] }

/** What each workbook is used for (shown above its table). */
const USED_FOR: Record<string, string> = {
  loads: 'Equipment library for the load schedules (From library).',
  cables: 'Cable data for every calculation (R, X, current rating) and cable prices.',
  breakers: 'Breaker ratings the sizing may choose, Icu steps, breaker prices.',
  parameters: 'Design parameters for new projects (Apply to this project below).',
  transformers: 'Transformer ratings for sizing, impedance for fault levels, prices for the BOQ.',
  generators: 'Generator ratings for sizing, prices for the BOQ.',
  busbar: 'Busbar trunking catalogue for the riser study; rate per m for the BOQ.',
  equipment: 'Prices of other equipment for the BOQ (matched by BOQ key).',
  roomTypes: 'Room types and generation rules for Building information (new projects).',
  unitTypes: 'Flat / tenant layouts (Building → Flats / tenants → From library).',
  prices: 'BOQ price lists (BOQ → Use a saved price list).',
  rules: 'Authority / company rules: minimum PF, motor start drop, points per circuit, meters, watts per point.',
  cableSchedule: 'Cable reference numbers: the CABLE SCHEDULE legend on the SLD sheets and the Ref column of the cable schedule. Edit and save — the drawings follow.'
};

const sig = (r: Row, cols: Col[]) => cols.map((c) => String(r[c.key] ?? '')).join('|');
const SEEN = 'lvds.dbSeen';
const loadSeen = (): Record<string, string[]> => { try { return JSON.parse(localStorage.getItem(SEEN) ?? '{}'); } catch { return {}; } };

/** The LV Database: Excel workbooks in the projects folder (synced by
 * Google Drive). Edit them in Excel or in the table here — saving from here
 * backs the file up first. Changes since you last looked are listed. */
export default function DatabaseView({ db, available, onRefresh, onApplyParameters, onStatus }: {
  db: Database;
  available: boolean;
  onRefresh: () => void;
  onApplyParameters: () => void;
  onStatus?: (m: string) => void;
}) {
  const books = BOOKS as unknown as Book[];
  const [tab, setTab] = useState(books[0].id);
  const [draft, setDraft] = useState<Row[] | null>(null); // editing copy
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(loadSeen);
  const [dbFolder, setDbFolder] = useState<string | undefined>();
  useEffect(() => { window.lvds?.settings.get().then((x) => setDbFolder(x.databaseFolder)); }, []);
  const open = (file?: string) => window.lvds?.database.open(file);
  const book = books.find((b) => b.id === tab)!;
  const rawBook = db.raw?.books[tab];
  const rows = (rawBook?.rows ?? []) as Row[];
  const synced = db.raw ? new Date(db.raw.readAt).toLocaleTimeString() : '—';
  const canWrite = available && !!window.lvds?.database.write;

  // First time a workbook is seen on this computer: remember it silently.
  useEffect(() => {
    if (!db.raw) return;
    const s = loadSeen();
    let changed = false;
    for (const b of books) if (!s[b.id] && db.raw.books[b.id]) { s[b.id] = (db.raw.books[b.id].rows as Row[]).map((r) => sig(r, b.columns)); changed = true; }
    if (changed) { try { localStorage.setItem(SEEN, JSON.stringify(s)); } catch { /* ignore */ } setSeen(s); }
  }, [db.raw]); // eslint-disable-line react-hooks/exhaustive-deps

  const changes = useMemo(() => {
    const out: Record<string, { added: Row[]; removed: string[] }> = {};
    for (const b of books) {
      const now = (db.raw?.books[b.id]?.rows ?? []) as Row[];
      const before = new Set(seen[b.id] ?? []);
      const nowSigs = new Set(now.map((r) => sig(r, b.columns)));
      if (!seen[b.id]) continue;
      const added = now.filter((r) => !before.has(sig(r, b.columns)));
      const removed = [...before].filter((x) => !nowSigs.has(x));
      if (added.length || removed.length) out[b.id] = { added, removed };
    }
    return out;
  }, [db.raw, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  const markSeen = (id: string) => {
    const s = { ...seen, [id]: rows.map((r) => sig(r, book.columns)) };
    try { localStorage.setItem(SEEN, JSON.stringify(s)); } catch { /* ignore */ }
    setSeen(s);
  };

  async function save() {
    if (!draft || !window.lvds?.database.write) return;
    const missing = draft.findIndex((r) => book.columns.some((c) => c.required && String(r[c.key] ?? '').trim() === '') && book.columns.some((c) => String(r[c.key] ?? '').trim() !== ''));
    if (missing >= 0) { onStatus?.(`Row ${missing + 2}: fill the required columns (${book.columns.filter((c) => c.required).map((c) => c.header).join(', ')})`); return; }
    const bad = draft.findIndex((r) => book.columns.some((c) => c.number && String(r[c.key] ?? '').trim() !== '' && Number.isNaN(Number(String(r[c.key]).replace(/,/g, '')))));
    if (bad >= 0) { onStatus?.(`Row ${bad + 2}: a number column has text`); return; }
    setBusy(true);
    try {
      const clean = draft.filter((r) => book.columns.some((c) => String(r[c.key] ?? '').trim() !== ''));
      await window.lvds.database.write(book.id, clean);
      onStatus?.(`Saved ${book.file} (${clean.length} rows) — the previous version is in Backups/`);
      // Saving here isn't "someone else's change".
      const s = { ...seen, [book.id]: clean.map((r) => sig(r, book.columns)) };
      try { localStorage.setItem(SEEN, JSON.stringify(s)); } catch { /* ignore */ }
      setSeen(s);
      setDraft(null);
      onRefresh();
    } catch (e) {
      onStatus?.(`Could not save ${book.file}: ${e instanceof Error ? e.message : String(e)} — is it open in Excel?`);
    } finally {
      setBusy(false);
    }
  }

  const list = draft ?? rows;
  const ch = changes[tab];
  const label = (r: Row) => book.columns.slice(0, 2).map((c) => r[c.key]).filter((v) => v !== '' && v !== undefined).join(' · ');

  return (
    <Page
      title="Database"
      intro={<>Your reusable data lives in Excel workbooks in {dbFolder ? <b title={dbFolder}>{dbFolder}</b> : <>the <b>{DATABASE_FOLDER}</b> folder inside your projects folder</>} — put it in a Google Drive folder and every PC gets the changes; the app reloads as soon as a workbook is saved. Edit a workbook in Excel and save, or edit it here — the app makes a backup before it saves. Title blocks, components, presets and notes sync in <b>Library.json</b> in the same folder.</>}
      actions={available && (
        <>
          <span className="m">Last synced {synced}</span>
          <button className="chip" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>
          <button className="chip" onClick={() => open()}><FolderOpen size={14} /> Open folder</button>
          <button className="chip" title="Use a folder of your own for the workbooks (e.g. on Google Drive); projects stay where they are" onClick={async () => { await window.lvds?.settings.chooseDatabaseFolder?.(); location.reload(); }}>Database folder…</button>
          {dbFolder && <button className="chip" title={`Back to ${DATABASE_FOLDER} inside the projects folder`} onClick={async () => { await window.lvds?.settings.chooseDatabaseFolder?.(true); location.reload(); }}>Use projects folder</button>}
        </>
      )}
    >
      {!available && <p className="warn">The database needs the desktop app (it reads Excel files from your projects folder).</p>}
      {db.issues.length > 0 && (
        <div className="db-issues">
          <b className="warn">{db.issues.length} problem(s) found — these rows are ignored until fixed:</b>
          <ul>{db.issues.slice(0, 30).map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}
      {Object.keys(changes).length > 0 && (
        <div className="db-changes">
          <b>Changed since you last looked:</b>{' '}
          {Object.entries(changes).map(([id, c]) => (
            <button key={id} className="linkish" onClick={() => { setTab(id); setDraft(null); }}>{books.find((b) => b.id === id)!.file} ({c.added.length ? `${c.added.length} new / changed` : ''}{c.added.length && c.removed.length ? ', ' : ''}{c.removed.length ? `${c.removed.length} removed` : ''})</button>
          ))}
        </div>
      )}

      <div className="db-tabs" role="tablist">
        {books.map((b) => (
          <button key={b.id} role="tab" aria-selected={tab === b.id} className={tab === b.id ? 'on' : ''} onClick={() => { if (draft && !window.confirm('Leave without saving your edits?')) return; setTab(b.id); setDraft(null); }}>
            {b.file.replace('.xlsx', '')} <span className="m">({(db.raw?.books[b.id]?.rows ?? []).length})</span>{changes[b.id] && <span className="db-dot" title="Changed since you last looked" />}
          </button>
        ))}
      </div>

      <div className="db-bar">
        <span>{USED_FOR[book.id] ?? book.about[0]}</span>
        <span className="sp" />
        {available && <button className="chip" onClick={() => open(book.file)}><ExternalLink size={14} /> Open in Excel</button>}
        {canWrite && !draft && <button className="chip primary" onClick={() => setDraft(rows.map((r) => ({ ...r })))}>Edit here</button>}
        {draft && <>
          <button className="chip" onClick={() => setDraft([...draft, {}])}>+ Row</button>
          <button className="chip" onClick={() => setDraft(null)}>Cancel</button>
          <button className="chip primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save to Excel'}</button>
        </>}
        {book.id === 'parameters' && <button className="chip" disabled={!Object.keys(db.parameters).length} onClick={onApplyParameters}>Apply to this project</button>}
      </div>
      {rawBook?.error && <p className="bad">{rawBook.file}: {rawBook.error}</p>}
      {ch && !draft && (
        <div className="db-changes small">
          {ch.added.length > 0 && <span>New / changed: {ch.added.slice(0, 8).map(label).join('; ')}{ch.added.length > 8 ? ` +${ch.added.length - 8}` : ''}</span>}
          {ch.removed.length > 0 && <span> Removed: {ch.removed.slice(0, 8).map((x) => x.split('|').slice(0, 2).filter(Boolean).join(' · ')).join('; ')}</span>}
          <button className="linkish" onClick={() => markSeen(book.id)}>Mark as seen</button>
        </div>
      )}

      <div className="tw">
        <table className="db-table">
          <thead><tr>{book.columns.map((c) => <th key={c.key} title={[c.help, c.list ? `One of: ${c.list.join(', ')}` : ''].filter(Boolean).join(' — ')}>{c.header}{c.required ? ' *' : ''}</th>)}{draft && <th />}</tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={book.columns.length + 1} className="m">No rows yet{canWrite ? ' — Edit here, + Row, or open the workbook in Excel.' : '.'}</td></tr>}
            {list.map((r, i) => (
              <tr key={i} className={!draft && ch?.added.includes(r) ? 'db-new' : undefined}>
                {book.columns.map((c) => (
                  <td key={c.key}>
                    {draft ? (
                      c.list ? (
                        <select className="bi-sel" value={String(r[c.key] ?? '')} onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, [c.key]: e.target.value } : x)))}>
                          <option value="" />{c.list.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input className={c.number ? 'bi-num' : 'bi-text'} style={{ width: c.number ? 80 : Math.max(90, (c.width ?? 14) * 7) }} inputMode={c.number ? 'decimal' : undefined}
                          value={String(r[c.key] ?? '')} aria-invalid={c.number && String(r[c.key] ?? '').trim() !== '' && Number.isNaN(Number(String(r[c.key]).replace(/,/g, '')))}
                          onChange={(e) => setDraft(draft.map((x, k) => (k === i ? { ...x, [c.key]: e.target.value } : x)))} />
                      )
                    ) : String(r[c.key] ?? '')}
                  </td>
                ))}
                {draft && <td><button className="icon-btn" title="Delete row" onClick={() => setDraft(draft.filter((_, k) => k !== i))}>✕</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m">* required. Hover a heading for its meaning. Each workbook also has a “Read me” sheet. Saving from here keeps your Excel formatting and dropdowns; the last 20 versions are kept in {DATABASE_FOLDER}/Backups.</p>
    </Page>
  );
}
