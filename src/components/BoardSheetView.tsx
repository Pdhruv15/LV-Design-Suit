import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { Board, Project } from '../types';
import { evaluateFeeder, type FeederResult } from '../calc/electrical';
import { circuitRef } from '../calc/loadSchedule';
import { phaseBalance, PHASE_UNBALANCE_CHECK_PCT } from '../calc/phaseBalance';
import { boardsInSupplyOrder } from '../calc/summary';
import { boardEarth } from '../model/boardEarth';
import { balanceBoardPhases, feederPhaseKw, nextPhase, phaseTag, setCircuitPhase } from '../model/phases';
import { boardSheetHtml, boardSheetPages } from '../docs/boardSheets';
import { buildSheetDxfPages } from '../docs/sheetDxf';
import { dxfExportNotice, namedDxfFiles, uniqueDxfFiles } from '../docs/dxfFiles';
import { renderPdf, safeFileName, saveBinary, savePdf, saveText } from '../util/files';
import { deviceKind, devicePoles } from '../diagram/deviceText';
import SingleLineDiagram from './SingleLineDiagram';
import MenuButton from './MenuButton';

const PH = ['R', 'Y', 'B'] as const;

/** Design ▸ Board: one board's SLD with its phases — previous / next board
 * in supply order, R / Y / B loading against the unbalance check, a phase tag
 * on each circuit (click to move it to the next phase), Balance phases, the
 * circuit table with R / Y / B kW, and the printed board sheets (PDF, DXF). */
export default function BoardSheetView({ project, board, results, selected, onSelect, onBoard, onChange, onStatus, onOpenEarthing, diagram }: {
  project: Project;
  board: Board;
  /** Results of every feeder (the table and the sheets use this board's). */
  results: FeederResult[];
  selected: string | null;
  onSelect: (feederId: string) => void;
  onBoard: (boardId: string) => void;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
  /** Opens Design ▸ Earth pits (the earthing schematic). */
  onOpenEarthing?: () => void;
  /** Extra props for the drawing (incomer label, panel summary box). */
  diagram: Pick<React.ComponentProps<typeof SingleLineDiagram>, 'incomerLabel' | 'summary'>;
}) {
  const [busy, setBusy] = useState('');
  const order = useMemo(() => boardsInSupplyOrder(project), [project]);
  const at = order.findIndex((b) => b.id === board.id);
  const prev = at > 0 ? order[at - 1] : undefined, next = at >= 0 && at < order.length - 1 ? order[at + 1] : undefined;
  const pb = useMemo(() => phaseBalance(project, board.id), [project, board.id]);
  // The board's circuits as they are now (a phase move renames a schedule circuit before the next run):
  // each with its last result, or evaluated on the spot when it has none yet.
  const own = useMemo(() => {
    const byId = new Map(results.map((r) => [r.feeder.id, r]));
    return project.feeders.filter((f) => f.boardId === board.id).map((f) => ({ ...(byId.get(f.id) ?? evaluateFeeder(project, f)), feeder: f }));
  }, [results, project, board.id]);
  const earth = useMemo(() => boardEarth(project, board), [project, board]);
  const maxA = Math.max(1, ...PH.map((p) => pb.currentA[p]));
  const over = pb.unbalancePct > PHASE_UNBALANCE_CHECK_PCT + 1e-9;

  // A moved circuit may be renamed: select it once the project with its new id is in.
  const pendingSelect = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingSelect.current;
    if (id && project.feeders.some((f) => f.id === id)) { pendingSelect.current = null; onSelect(id); }
  }, [project, onSelect]);
  const cyclePhase = (id: string) => {
    const f = project.feeders.find((x) => x.id === id);
    if (!f) return;
    const to = nextPhase(phaseTag(f));
    const r = setCircuitPhase(project, id, to);
    if (r.project === project) return onStatus(`${id}: no free way on ${to}`);
    pendingSelect.current = r.id;
    onChange(r.project);
    onStatus(`${circuitRef(r.project.feeders.find((x) => x.id === r.id)!) ?? r.id} now on phase ${to} (undo with ⌘Z)`);
  };
  const balance = () => {
    const p = balanceBoardPhases(project, board.id);
    if (p === project) return onStatus(`${board.id} has no single-phase circuits to balance`);
    onChange(p);
    const after = phaseBalance(p, board.id);
    onStatus(after.unbalancePct < pb.unbalancePct - 0.05
      ? `${board.id} balanced: unbalance ${pb.unbalancePct.toFixed(1)} % → ${after.unbalancePct.toFixed(1)} % (undo with ⌘Z)`
      : `${board.id} is already as balanced as its circuits allow (${after.unbalancePct.toFixed(1)} %)`);
  };

  async function exportSheets(kind: 'pdf' | 'dxf', all: boolean) {
    setBusy(kind);
    try {
      const pages = boardSheetPages(project, results, all ? undefined : [board.id]);
      const name = safeFileName(`${project.name} ${all ? 'board SLDs' : `${board.id} SLD`}`);
      let m: string | null = null;
      if (kind === 'pdf') {
        const parts: Uint8Array[] = [];
        for (const pg of pages) {
          const bytes = await renderPdf(boardSheetHtml(project, pg), { pageSize: 'A3', landscape: true }, pg.info.title);
          if (!bytes) break;
          parts.push(bytes);
        }
        if (parts.length === pages.length) {
          const { PDFDocument } = await import('pdf-lib');
          const doc = await PDFDocument.create();
          for (const b of parts) { const src = await PDFDocument.load(b); for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p); }
          doc.setTitle(`${project.name} — board single line diagrams`);
          m = await saveBinary(`${name}.pdf`, await doc.save(), 'PDF', 'pdf', 'application/pdf');
        } else {
          // Browser: the print dialog takes one sheet at a time.
          const pg = pages.find((x) => x.boardId === board.id) ?? pages[0];
          m = await savePdf(`${name}.pdf`, boardSheetHtml(project, pg), { pageSize: 'A3', landscape: true });
          if (m && pages.length > 1) m += ` (this board only — the desktop app saves every board in one PDF)`;
        }
      } else {
        const files = uniqueDxfFiles(pages.flatMap((pg) => namedDxfFiles(safeFileName(`${pg.info.no} ${pg.boardId}`), buildSheetDxfPages(project, pg.svg, 'A3', pg.info))));
        if (files.length === 1) m = await saveText(files[0].name, files[0].data, 'DXF drawing (AutoCAD R12)', 'dxf');
        else {
          const zip = new JSZip();
          files.forEach((f) => zip.file(f.name, f.data));
          m = await saveBinary(`${name}-DXF.zip`, await zip.generateAsync({ type: 'uint8array' }), 'ZIP', 'zip', 'application/zip');
        }
        const notice = dxfExportNotice(files);
        if (m && notice) m += ` — ${notice}`;
      }
      if (m) onStatus(m);
    } catch (e) {
      onStatus(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="board-sheet">
      <div className="bs-bar">
        <button className="chip" disabled={!prev} onClick={() => prev && onBoard(prev.id)} title={prev ? `Previous board in supply order: ${prev.id}` : 'First board'}>◀ {prev?.id ?? ''}</button>
        <b>{board.id}</b>
        <span className="m">{board.name && board.name !== board.id ? board.name : ''}{board.upstreamId ? ` · fed from ${board.upstreamId}` : ' · main board'}{at >= 0 ? ` · ${at + 1} of ${order.length}` : ''}</span>
        <button className="chip" disabled={!next} onClick={() => next && onBoard(next.id)} title={next ? `Next board in supply order: ${next.id}` : 'Last board'}>{next?.id ?? ''} ▶</button>
        <span className="sp" />
        <button className="chip" onClick={balance} title="Spread the single-phase circuits over R / Y / B (load-schedule ways are renumbered, lighting and power kept on separate ELCBs)">Balance phases</button>
        <MenuButton label={busy ? 'Exporting…' : 'Export sheets'} title="Board sheets: A3, black and white, one per board, with title block" align="right">
          {(close) => (
            <>
              <button onClick={() => { close(); void exportSheets('pdf', false); }}>PDF — {board.id}</button>
              <button onClick={() => { close(); void exportSheets('pdf', true); }}>PDF — every board ({order.length} sheets)</button>
              <button onClick={() => { close(); void exportSheets('dxf', false); }}>DXF — {board.id}</button>
              <button onClick={() => { close(); void exportSheets('dxf', true); }}>DXF — every board (ZIP)</button>
            </>
          )}
        </MenuButton>
      </div>

      <div className="bs-phases" role="group" aria-label="Phase loading">
        {PH.map((p) => (
          <div key={p} className="bs-ph">
            <b className={`ph-${p.toLowerCase()}`}>{p}</b>
            <span className="bs-track"><span className={`bs-fill ph-${p.toLowerCase()}`} style={{ width: `${(pb.currentA[p] / maxA) * 100}%` }} /></span>
            <span>{pb.kw[p].toFixed(2)} kW · {pb.currentA[p].toFixed(1)} A</span>
          </div>
        ))}
        <div className="bs-ph-sum">
          <span>N {pb.neutralA.toFixed(1)} A</span>
          <span>Unbalance <b className={over ? 'warn' : 'ok'}>{pb.unbalancePct.toFixed(1)} %</b> <span className="m">(check ≤ {PHASE_UNBALANCE_CHECK_PCT} %)</span></span>
          {pb.unassigned.length > 0 && <span className="warn" title={pb.unassigned.map((f) => f.id).join(', ')}>{pb.unassigned.length} single-phase circuit{pb.unassigned.length === 1 ? '' : 's'} with no phase</span>}
        </div>
      </div>

      <div className="bs-earth">
        <span className="m">Earth</span>
        <span className={earth.status === 'fail' ? 'bad' : earth.status === 'pass' ? 'ok' : earth.status === 'none' ? 'warn' : ''}>{earth.text.split(' · sheet ')[0]}</span>
        {earth.conductor && <span className={earth.conductor.status}>{earth.conductor.text}</span>}
        {onOpenEarthing && <button className="linkish" onClick={onOpenEarthing}>Earthing schematic ›</button>}
      </div>

      <SingleLineDiagram board={board} voltageV={project.voltageV} project={project} results={own} selected={selected} onSelect={onSelect} onPhase={cyclePhase} {...diagram} />

      <div className="bs-table">
        <table className="compact">
          <thead><tr><th>Ref</th><th>Description</th><th>Breaker</th><th>Cable</th><th className="num">m</th><th className="num ph-r">R kW</th><th className="num ph-y">Y kW</th><th className="num ph-b">B kW</th><th className="num">Ib A</th><th className="num">Vd %</th><th /></tr></thead>
          <tbody>
            {own.map((r) => {
              const f = r.feeder, k = feederPhaseKw(project, f), tag = phaseTag(f);
              return (
                <tr key={f.id} className={selected === f.id ? 'sel' : ''} onClick={() => onSelect(f.id)}>
                  <td><b className={tag ? `ph-${tag.toLowerCase()}` : 'warn'}>{circuitRef(f) ?? f.id}</b></td>
                  <td>{f.feedsBoardId ? <button className="linkish" onClick={(e) => { e.stopPropagation(); onBoard(f.feedsBoardId!); }}>{f.room || f.name || ''} → {f.feedsBoardId}</button> : f.room || f.name || '—'}</td>
                  <td>{f.breakerRatingA} A {devicePoles(f)} {deviceKind(f)}</td>
                  <td>{f.cores}C × {f.cableCsaMm2} mm²</td>
                  <td className="num">{f.lengthM}</td>
                  {PH.map((p) => <td key={p} className="num">{k[p] > 0.005 ? k[p].toFixed(2) : '—'}</td>)}
                  <td className="num">{r.ib.toFixed(1)}</td>
                  <td className="num">{r.vdTotalPct.toFixed(2)}</td>
                  <td className={r.status}>{r.status === 'bad' ? 'fail' : r.status === 'warn' ? 'check' : 'ok'}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td /><td><b>Total</b></td><td /><td /><td />{PH.map((p) => <td key={p} className="num"><b>{own.reduce((s, r) => s + feederPhaseKw(project, r.feeder)[p], 0).toFixed(2)}</b></td>)}<td /><td /><td /></tr></tfoot>
        </table>
      </div>
    </div>
  );
}
