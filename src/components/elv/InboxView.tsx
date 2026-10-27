import { useRef, useState } from 'react';
import type { ExchangePackage, PackageKind } from '../../exchange/contracts';
import { decide, exchangeOf, readPackage, reviewPackage, type ChangeKind } from '../../exchange/inbox';
import type { Project } from '../../types';
import { sha256Hex } from '../../util/sha256';
import { Page } from '../ui';

export interface InboxItem { pkg: ExchangePackage; hash: string }

const KIND_LABEL: Record<PackageKind, string> = { rooms: 'Rooms', fixtures: 'Luminaires', loads: 'ELV loads' };
const CHANGE_LABEL: Record<ChangeKind, string> = { added: 'New', changed: 'Changed', renamed: 'Renamed', removed: 'Removed', same: 'Same' };
const NOTE: Partial<Record<PackageKind, Partial<Record<ChangeKind, string>>>> = {
  loads: { changed: 'Placed circuits: becomes a proposal in Changes', removed: 'Placed circuit is kept; listed to delete by hand' }
};
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Packages from other programs (CAD, IFC, DIALux, the ELV estimate) waiting for review: what each would add, change
 * or remove, the engineer ticks what to take, and the decision is logged with the package hash (decide()). */
export default function InboxView({ project, pending, me, onOpen, onDecided, onPlace, onStatus }: {
  project: Project;
  pending: InboxItem[];
  me: string;
  onOpen: (item: InboxItem) => void;
  onDecided: (next: Project, item: InboxItem, message: string) => void;
  onPlace: () => void;
  onStatus: (m: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState(0);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [by, setBy] = useState(me);
  const [placeNext, setPlaceNext] = useState(false);
  const item = pending[Math.min(current, pending.length - 1)];
  const review = item ? reviewPackage(project, item.pkg, item.hash) : undefined;
  const offered = review?.changes.filter((c) => c.kind !== 'same') ?? [];
  const take = offered.filter((c) => !skip.has(c.key));
  const log = exchangeOf(project).log;

  const choose = (i: number) => { setCurrent(i); setSkip(new Set()); };
  const act = (accept: string[]) => {
    if (!item) return;
    try {
      const r = decide(project, item.pkg, item.hash, { accept, by, at: new Date().toISOString() });
      const n = accept.length;
      onDecided(r.project, item, `${r.record.id}: ${KIND_LABEL[item.pkg.kind]} ${r.record.decision}${n ? ` (${n} change${n === 1 ? '' : 's'})` : ''} by ${by.trim()}.`);
      setSkip(new Set());
      setCurrent(0);
      setPlaceNext(item.pkg.kind === 'loads' && n > 0);
    } catch (e) { onStatus(e instanceof Error ? e.message : String(e)); }
  };
  const open = async (f: File) => {
    try {
      const r = readPackage(JSON.parse(await f.text()), sha256Hex);
      if (!r.ok) { onStatus(`${f.name} is not a valid package: ${r.errors.slice(0, 5).map((e) => `${e.row !== undefined ? `row ${e.row} ` : ''}${e.field ? `${e.field}: ` : ''}${e.message}`).join('; ')}`); return; }
      if (pending.some((p) => p.hash === r.hash)) { onStatus(`${f.name} is already in the inbox.`); return; }
      onOpen({ pkg: r.pkg, hash: r.hash });
      choose(pending.length);
      onStatus(`${f.name} added to the inbox${r.warnings.length ? ` · ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}` : ''}.`);
    } catch (e) { onStatus(`${f.name} could not be read: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <Page title="Inbox" intro="Packages from other programs. Nothing changes the project until you accept it."
      actions={<>
        <button className="chip" onClick={() => fileRef.current?.click()}>Open package file…</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void open(f); }} />
      </>}>
      <div className="tool-panel">
        {placeNext && (
          <p className="row" style={{ gap: 8 }}>The ELV loads are accepted. <button className="chip primary" onClick={() => { setPlaceNext(false); onPlace(); }}>Place on boards…</button></p>
        )}
        {pending.length > 1 && (
          <div className="card">
            <h4>Waiting <span className="m">{pending.length}</span></h4>
            <table className="tbl"><tbody>
              {pending.map((p, i) => (
                <tr key={p.hash}>
                  <td>{i === current ? <b>{KIND_LABEL[p.pkg.kind]}</b> : KIND_LABEL[p.pkg.kind]}<span className="m"> · {p.pkg.source.file ?? p.pkg.source.app} · {when(p.pkg.exportedAt)}</span></td>
                  <td className="num">{p.pkg.items.length} items</td>
                  <td>{i !== current && <button onClick={() => choose(i)}>Review</button>}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
        {!item || !review ? <p className="m">Nothing waiting. Send the ELV estimate to LV from ELV systems, or open a package file.</p> : (
          <div className="card">
            <h4>{KIND_LABEL[item.pkg.kind]} · {item.pkg.source.file ?? item.pkg.source.app} <span className="m">{when(item.pkg.exportedAt)} · sha {item.hash.slice(0, 4)}…{item.hash.slice(-4)}</span></h4>
            {review.seenBefore && <p className="warn">⚠ This package was seen before: {review.seenBefore.id}, {review.seenBefore.decision} on {when(review.seenBefore.at)} by {review.seenBefore.by}.</p>}
            {review.problems.map((p, i) => <p key={i} className="warn">⚠ {p.row !== undefined ? `Row ${p.row}: ` : ''}{p.message}</p>)}
            {!offered.length ? <p className="m">No changes: the project already matches this package ({review.counts.same} unchanged).</p> : (
              <table className="tbl"><thead><tr>
                <th><input type="checkbox" aria-label="All" checked={!skip.size} onChange={(e) => setSkip(e.target.checked ? new Set() : new Set(offered.map((c) => c.key)))} /></th>
                <th>Change</th><th>Item</th><th>Before</th><th>After</th><th>Note</th>
              </tr></thead><tbody>
                {offered.map((c) => (
                  <tr key={c.key}>
                    <td><input type="checkbox" aria-label={c.label} checked={!skip.has(c.key)} onChange={(e) => { const s = new Set(skip); if (e.target.checked) s.delete(c.key); else s.add(c.key); setSkip(s); }} /></td>
                    <td className={c.kind === 'removed' ? 'bad' : c.kind === 'added' ? 'ok' : ''}>{CHANGE_LABEL[c.kind]}</td>
                    <td>{c.label}</td><td className="m">{c.before ?? ''}</td><td>{c.after ?? ''}</td>
                    <td className="m">{NOTE[item.pkg.kind]?.[c.kind] ?? ''}</td>
                  </tr>
                ))}
                {review.counts.same > 0 && <tr><td /><td colSpan={5} className="m">+ {review.counts.same} unchanged</td></tr>}
              </tbody></table>
            )}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <label className="m">Decided by <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" style={{ width: 180 }} /></label>
              <span style={{ flex: 1 }} />
              <button onClick={() => act([])} disabled={by.trim().length < 2}>Reject package</button>
              <button className="primary" onClick={() => act(take.map((c) => c.key))} disabled={by.trim().length < 2 || !take.length}>Accept selected ({take.length})</button>
            </div>
          </div>
        )}
        <div className="card">
          <h4>History</h4>
          {!log.length ? <p className="m">No packages decided yet.</p> : (
            <table className="tbl"><thead><tr><th>No.</th><th>Package</th><th>Decision</th><th>By</th><th>When</th></tr></thead><tbody>
              {[...log].reverse().map((r) => {
                const n = Object.values(r.accepted).reduce((t, x) => t + (x ?? 0), 0);
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td><td>{KIND_LABEL[r.kind]} · {r.source.file ?? r.source.app}</td>
                    <td className={r.decision === 'rejected' ? 'bad' : 'ok'}>{r.decision === 'rejected' ? 'Rejected' : `${r.decision === 'accepted' ? 'Accepted' : 'Partly accepted'} ${n}`}</td>
                    <td>{r.by}</td><td>{when(r.at)}</td>
                  </tr>
                );
              })}
            </tbody></table>
          )}
          <p className="m">The same package opened twice is recognised by its hash.</p>
        </div>
      </div>
    </Page>
  );
}
