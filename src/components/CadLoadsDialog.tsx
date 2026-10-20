import { useState } from 'react';
import type { LibraryLoad } from '../database/database';
import { applyCadLoads, pullCadLoads, type CadLoadPull } from '../model/cadLoads';
import type { CadBlockMap, Project } from '../types';

/** Loads from a CAD floor plan: fixture blocks on the drawing open in OpenCADStudio are counted per circuit
 * (circuit from the block's CCT attribute, library item from the block name or the project's block map), and
 * shown beside the design. Nothing changes until the engineer accepts rows. */
export default function CadLoadsDialog({ project, library, onApply, onClose }: {
  project: Project;
  library: LibraryLoad[];
  onApply: (next: Project, message: string) => void;
  onClose: () => void;
}) {
  const cad = window.lvds?.openCadStudio;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [blocks, setBlocks] = useState<Awaited<ReturnType<NonNullable<NonNullable<typeof cad>['blocks']>>> | null>(null);
  const [map, setMap] = useState<CadBlockMap[]>(project.cadBlocks ?? []);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const p = { ...project, cadBlocks: map };
  const pull: CadLoadPull | null = blocks ? pullCadLoads(p, blocks, library) : null;
  const mappable = library.filter((l) => l.reference && l.column);

  async function act(kind: string, run: () => Promise<void>) {
    setBusy(kind);
    setNote('');
    try { await run(); } catch (e) { setNote(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  }
  const openPlan = () => act('open', async () => {
    const r = await cad!.openPlan!();
    if (r) { setNote(`Opened ${r.file} in OpenCADStudio. Pull loads when the plan is ready.`); setBlocks(null); }
  });
  const read = () => act('pull', async () => { setBlocks(await cad!.blocks!()); setSkip(new Set()); });
  const mapBlock = (block: string, reference: string) => setMap((m) => [...m.filter((r) => r.block.toLowerCase() !== block.toLowerCase()), ...(reference ? [{ block, reference }] : [])]);

  function apply() {
    if (!pull) return;
    const accepted = pull.proposals.filter((x) => !skip.has(x.feederId));
    const mapped = map.length || project.cadBlocks?.length ? { cadBlocks: map.length ? map : undefined } : {};
    onApply({ ...applyCadLoads(project, accepted), ...mapped }, accepted.length
      ? `Loads from CAD: updated ${accepted.length} circuit${accepted.length === 1 ? '' : 's'}`
      : 'Loads from CAD: block mapping saved, no circuits changed');
  }

  if (!cad?.blocks || !cad.openPlan) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Loads from CAD floor plan</h3>
          <p className="m">Reading a floor plan needs the LV Design Studio desktop app and OpenCADStudio.</p>
          <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Close</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cad-loads" onClick={(e) => e.stopPropagation()}>
        <h3>Loads from CAD floor plan</h3>
        <p className="m">
          Fixtures on the drawing open in OpenCADStudio are counted per circuit. A block named like a library reference
          (L1, S13…) is that item; other block names are mapped once below. The circuit comes from the block’s
          CCT attribute, e.g. <b>DB-GF1/R3</b>. Nothing changes until you apply.
        </p>
        <div className="modal-actions">
          <button className="chip" disabled={!!busy} onClick={openPlan}>{busy === 'open' ? 'Opening…' : 'Open floor plan…'}</button>
          <button className="chip primary" disabled={!!busy} onClick={read}>{busy === 'pull' ? 'Reading…' : blocks ? 'Pull again' : 'Pull loads'}</button>
        </div>
        {note && <p className="m">{note}</p>}
        {!mappable.length && <p className="m">The load library has no items with a reference and schedule column, so no block can be counted yet. Connect the LV Database (Loads.xlsx) first.</p>}

        {pull && (
          <>
            <p className="m">
              {blocks!.length} blocks read · {pull.proposals.length} circuit{pull.proposals.length === 1 ? '' : 's'} differ · {pull.matching} already match
            </p>
            {pull.proposals.length > 0 && (
              <table className="bi-table compact">
                <thead><tr><th /><th>Circuit</th><th>Design now</th><th>From CAD</th><th>W</th></tr></thead>
                <tbody>
                  {pull.proposals.map((x) => (
                    <tr key={x.feederId}>
                      <td><input type="checkbox" aria-label={`Accept ${x.ref}`} checked={!skip.has(x.feederId)} onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(x.feederId); else n.add(x.feederId); return n; })} /></td>
                      <td>{x.ref}</td>
                      <td>{x.currentText}</td>
                      <td>{x.proposedText}</td>
                      <td>{x.currentW} → {x.proposedW}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pull.unmapped.length > 0 && (
              <>
                <h4>Blocks to map ({pull.unmapped.length})</h4>
                <table className="bi-table compact">
                  <thead><tr><th>Block</th><th>Count</th><th>Library item</th></tr></thead>
                  <tbody>
                    {pull.unmapped.map((u) => (
                      <tr key={u.block}>
                        <td>{u.block}</td>
                        <td>{u.count}</td>
                        <td>
                          <select aria-label={`Library item for ${u.block}`} value={map.find((r) => r.block.toLowerCase() === u.block.toLowerCase())?.reference ?? ''} onChange={(e) => mapBlock(u.block, e.target.value)}>
                            <option value="">— not a load —</option>
                            {mappable.map((l) => <option key={l.reference} value={l.reference}>{l.reference} · {l.name} ({l.watts} W)</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {pull.noCircuit.length > 0 && <p className="m">No CCT attribute (not counted): {pull.noCircuit.map((x) => `${x.count} × ${x.block}`).join(', ')}</p>}
            {pull.unknownCircuits.length > 0 && <p className="m">Circuit not in the design (not counted): {pull.unknownCircuits.map((x) => `${x.ref} (${x.count})`).join(', ')}</p>}
          </>
        )}

        <div className="modal-actions">
          <span className="sp" />
          <button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!pull || !!busy} onClick={apply}>
            Apply {pull ? pull.proposals.filter((x) => !skip.has(x.feederId)).length : 0} circuit changes
          </button>
        </div>
      </div>
    </div>
  );
}
