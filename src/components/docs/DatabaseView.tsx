import { useState } from 'react';
import { ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import { BOOKS, DATABASE_FOLDER, PARAMETERS, type Database } from '../../database/database';
import { cables } from '../../calc/cableTable';
import { POINT_TYPES } from '../../types';
import { Page } from '../ui';

type BookId = 'loads' | 'cables' | 'breakers' | 'parameters';

/** The LV Database: Excel workbooks in the projects folder (synced by
 * Google Drive). Edit them in Excel; saving updates the app automatically. */
export default function DatabaseView({
  db,
  available,
  onRefresh,
  onApplyParameters
}: {
  db: Database;
  available: boolean;
  onRefresh: () => void;
  onApplyParameters: () => void;
}) {
  const [tab, setTab] = useState<BookId>('loads');
  const open = (file?: string) => window.lvds?.database.open(file);
  const book = BOOKS.find((b) => b.id === tab)!;
  const rawBook = db.raw?.books[tab];
  const synced = db.raw ? new Date(db.raw.readAt).toLocaleTimeString() : '—';

  return (
    <Page
      title="Database"
      intro={
        <>
          Your reusable data lives in Excel workbooks in the <b>{DATABASE_FOLDER}</b> folder inside your projects folder, so
          Google Drive syncs it to every PC and anyone sharing the folder. Edit a workbook in Excel and save — the app picks
          up the change automatically. Loads start empty: add your own equipment. Cables and breakers start with the app's
          reference values for you to replace.
        </>
      }
      actions={
        available && (
          <>
            <span className="m">Last synced {synced}</span>
            <button className="chip" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>
            <button className="chip" onClick={() => open()}><FolderOpen size={14} /> Open folder</button>
          </>
        )
      }
    >
      {!available && (
        <p className="warn">
          The database needs the desktop app (it reads Excel files from your projects folder). If you're in the desktop app,
          close it and start it again with <code>npm run dev</code> to load the database support.
        </p>
      )}
      {db.issues.length > 0 && (
        <div className="db-issues">
          <b className="warn">{db.issues.length} problem(s) found — these rows are ignored until fixed:</b>
          <ul>{db.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </div>
      )}

      <div className="tabs" role="tablist">
        {BOOKS.map((b) => (
          <button key={b.id} role="tab" aria-selected={tab === b.id} className={tab === b.id ? 'on' : ''} onClick={() => setTab(b.id as BookId)}>
            {b.file}
            <span className="m"> ({b.id === 'loads' ? db.loads.length : b.id === 'cables' ? db.cables.length : b.id === 'breakers' ? db.breakers.length : Object.keys(db.parameters).length})</span>
          </button>
        ))}
      </div>

      <div className="db-bar">
        <span className="m">{book.about[0]}</span>
        {available && <button className="chip primary" onClick={() => open(book.file)}><ExternalLink size={14} /> Open {book.file} in Excel</button>}
      </div>
      {rawBook?.error && <p className="bad">{rawBook.file}: {rawBook.error}</p>}

      {tab === 'loads' && (
        db.loads.length === 0 ? (
          <p className="m">No equipment yet. Open Loads.xlsx, add one row per item (Name and Power (W) are required), and save.</p>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Category</th><th>Schedule column</th><th>Power (W)</th><th>PF</th><th>Phases</th><th>DF</th><th>Starting</th><th>Manufacturer / model</th></tr></thead>
            <tbody>
              {db.loads.map((l) => (
                <tr key={l.name}>
                  <td>{l.name}</td><td>{l.category ?? ''}</td>
                  <td>{l.column ? POINT_TYPES.find((p) => p.value === l.column)?.label : ''}</td>
                  <td>{l.watts}</td><td>{l.pf ?? ''}</td><td>{l.phases ?? ''}</td><td>{l.demandFactor ?? ''}</td><td>{l.starting ?? ''}</td>
                  <td>{[l.manufacturer, l.model].filter(Boolean).join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === 'cables' && (
        <>
          <p className={db.cables.length ? 'ok' : 'warn'}>
            {db.cables.length ? `Calculations use ${db.cables.length} cable sizes from Cables.xlsx.` : "Cables.xlsx has no valid rows — calculations use the app's reference values."}
          </p>
          <table>
            <thead><tr><th>Size (mm²)</th><th>R at 20 °C (Ω/km)</th><th>X (Ω/km)</th><th>Current rating (A)</th><th>Rate per m</th></tr></thead>
            <tbody>
              {cables().map((c) => (
                <tr key={c.csaMm2}><td>{c.csaMm2}</td><td>{c.rOhmPerKm20C}</td><td>{c.xOhmPerKm}</td><td>{c.ampacityA}</td><td>{c.ratePerM ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === 'breakers' && (
        <table>
          <thead><tr><th>Rating (A)</th><th>Type</th><th>Icu (kA)</th><th>Price</th></tr></thead>
          <tbody>
            {db.breakers.length === 0 && <tr><td colSpan={4} className="m">No rows — sizing uses the standard ratings.</td></tr>}
            {db.breakers.map((b) => <tr key={b.ratingA}><td>{b.ratingA}</td><td>{b.type ?? ''}</td><td>{b.icuKa ?? ''}</td><td>{b.price ?? ''}</td></tr>)}
          </tbody>
        </table>
      )}

      {tab === 'parameters' && (
        <>
          <table>
            <thead><tr><th>Parameter</th><th>Value from Parameters.xlsx</th></tr></thead>
            <tbody>
              {PARAMETERS.map((p) => (
                <tr key={p.key}><td>{p.label}</td><td>{db.parameters[p.key] !== undefined ? `${db.parameters[p.key]} ${p.unit}` : <span className="m">blank — app default</span>}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="m note">New projects start with these values. To apply them to the project that's open now:</p>
          <button className="chip" disabled={!Object.keys(db.parameters).length} onClick={onApplyParameters}>Apply parameters to this project</button>
        </>
      )}
    </Page>
  );
}
