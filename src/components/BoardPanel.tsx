import { useMemo, useState } from 'react';
import type { Board, Project } from '../types';
import type { FeederResult } from '../calc/electrical';
import { boardSummary } from '../calc/summary';
import BoardFields from './BoardFields';

export type BoardTab = 'general' | 'electrical' | 'protection';
type Tab = BoardTab;

const statusLabel = { ok: 'Within limits', warn: 'Near rating (> 80 %)', bad: 'Overloaded' } as const;

/** Properties of a board: editable equipment data (General), supply and
 * computed electrical values (Electrical), and the incoming protective
 * device's checks (Protection), plus a loading summary. */
export default function BoardPanel({
  project,
  board,
  results,
  onChange,
  onSelectFeeder,
  tab: tabProp,
  onTab,
  onEnclosure
}: {
  project: Project;
  board: Board;
  results: FeederResult[];
  onChange: (b: Board) => void;
  onSelectFeeder: (id: string) => void;
  /** Opens Design → Enclosure sizing for this board. */
  onEnclosure?: () => void;
  /** Optional controlled tab (the ribbon's Transformer button opens Electrical). */
  tab?: Tab;
  onTab?: (t: Tab) => void;
}) {
  const [localTab, setLocalTab] = useState<Tab>('general');
  const tab = tabProp ?? localTab;
  const setTab = onTab ?? setLocalTab;
  const s = useMemo(() => boardSummary(project, board), [project, board]);
  const incomerResult = s.incomer ? results.find((r) => r.feeder.id === s.incomer!.id) : undefined;
  const isMain = !board.upstreamId;

  return (
    <>
      <div className="pn">
        <h3>
          {board.id}
          {s.loadingStatus && <span className={`pill ${s.loadingStatus}`}>{s.loadingStatus === 'ok' ? 'In service' : statusLabel[s.loadingStatus]}</span>}
        </h3>
        <div className="tabs ptabs" role="tablist">
          {(['general', 'electrical', 'protection'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'general' && <BoardFields board={board} onChange={onChange} section="general" building={project.building} />}
        {tab === 'general' && (
          <p className="m enc-link">Enclosure: {board.enclosure ? <b>{board.enclosure.range} {board.enclosure.config.ref}{board.enclosure.dims ? ` · H${board.enclosure.dims.h} × W${board.enclosure.dims.w} × D${board.enclosure.dims.d} mm` : ''}</b> : 'not sized'}
            {board.enclosure && <span> ({board.enclosure.supplier} rev. {board.enclosure.revision}{board.enclosure.confirmNeeded ? ', supplier to confirm' : ''})</span>}
            {onEnclosure && <> <button className="chip" onClick={onEnclosure}>Enclosure sizing…</button></>}</p>
        )}

        {tab === 'electrical' && (
          <>
            {isMain && <BoardFields board={board} onChange={onChange} section="source" />}
            <dl className="kv">
              <dt>System voltage</dt>
              <dd>{project.voltageV} V, 3-phase</dd>
              <dt>Busbar voltage</dt>
              <dd>{s.voltageV.toFixed(0)} V ({s.voltagePct.toFixed(1)}%)</dd>
              <dt>Fault level Ik″</dt>
              <dd>{s.faultKA.toFixed(1)} kA</dd>
              <dt>Power factor</dt>
              <dd>{s.powerFactor.toFixed(2)}</dd>
              <dt>Supplied from</dt>
              <dd>{isMain ? 'Transformer' : board.upstreamId}</dd>
            </dl>
          </>
        )}

        {tab === 'protection' && (
          <dl className="kv">
            {s.incomer ? (
              <>
                <dt>Incoming device</dt>
                <dd>
                  <button className="linkish" onClick={() => onSelectFeeder(s.incomer!.id)}>{s.incomer.id}</button>
                </dd>
                <dt>Breaker</dt>
                <dd>{s.incomer.breakerRatingA} A, Icu {s.incomer.breakerIcuKa} kA</dd>
                <dt>Incoming cable</dt>
                <dd>{s.incomer.cableCsaMm2} mm² × {s.incomer.lengthM} m</dd>
                {incomerResult && (
                  <>
                    <dt>Ib ≤ In ≤ Iz</dt>
                    <dd className={incomerResult.protectionStatus}>
                      {incomerResult.ib.toFixed(0)} ≤ {s.incomer.breakerRatingA} ≤ {incomerResult.ampacity.toFixed(0)} A
                    </dd>
                    <dt>Icu vs fault</dt>
                    <dd className={incomerResult.icuStatus}>
                      {s.incomer.breakerIcuKa} kA vs {incomerResult.breakerFaultKA.toFixed(1)} kA
                    </dd>
                  </>
                )}
              </>
            ) : (
              <>
                <dt>Incoming supply</dt>
                <dd>{isMain ? 'Transformer secondary' : 'No incomer feeder found'}</dd>
                {board.ratedCurrentA && (
                  <>
                    <dt>Main device</dt>
                    <dd>{board.ratedCurrentA} A</dd>
                  </>
                )}
              </>
            )}
            <dt>Busbar fault level</dt>
            <dd>{s.faultKA.toFixed(1)} kA</dd>
          </dl>
        )}
      </div>

      <div className="pn">
        <h3>Loading</h3>
        <dl className="kv">
          <dt>Connected load</dt>
          <dd>{s.connectedKw.toFixed(0)} kW</dd>
          <dt>Demand load</dt>
          <dd>{s.demandKw.toFixed(0)} kW · {s.demandKva.toFixed(0)} kVA</dd>
          <dt>Demand current</dt>
          <dd>{s.currentA.toFixed(0)} A</dd>
          {s.generationKw > 0 && (
            <>
              <dt>Generation</dt>
              <dd>{s.generationKw.toFixed(0)} kW</dd>
            </>
          )}
        </dl>
        {s.loadingPct !== undefined ? (
          <>
            <div className="bar" aria-label={`Loading ${s.loadingPct.toFixed(0)} percent`}>
              <span className={s.loadingStatus} style={{ width: `${Math.min(s.loadingPct, 100)}%` }} />
              <b>{s.loadingPct.toFixed(0)}%</b>
            </div>
            <p className={`m ${s.loadingStatus}`}>{statusLabel[s.loadingStatus!]} of {board.ratedCurrentA} A rating</p>
          </>
        ) : (
          <p className="m">Set a rated current on the General tab to see board loading.</p>
        )}
      </div>

      <div className="pn">
        <h3>Related equipment</h3>
        <dl className="kv">
          <dt>Incoming feeder</dt>
          <dd>{s.incomer ? s.incomer.id : isMain && board.sourceKva ? `${board.sourceKva} kVA transformer` : '—'}</dd>
          <dt>Outgoing feeders</dt>
          <dd>{s.outgoing}</dd>
          <dt>Sub-boards</dt>
          <dd>{project.boards.filter((b) => b.upstreamId === board.id).map((b) => b.id).join(', ') || '—'}</dd>
        </dl>
      </div>
    </>
  );
}
