import { useMemo, useState } from 'react';
import { BOARD_KINDS, type Board, type Project } from '../types';
import type { FeederResult } from '../calc/electrical';
import { DEFAULT_TRANSFORMER_XR } from '../calc/electrical';
import { boardSummary } from '../calc/summary';

type Tab = 'general' | 'electrical' | 'protection';

const statusLabel = { ok: 'Within limits', warn: 'Near rating (> 80 %)', bad: 'Overloaded' } as const;

/** Properties of a board: editable equipment data (General), supply and
 * computed electrical values (Electrical), and the incoming protective
 * device's checks (Protection), plus a loading summary. */
export default function BoardPanel({
  project,
  board,
  results,
  onChange,
  onSelectFeeder
}: {
  project: Project;
  board: Board;
  results: FeederResult[];
  onChange: (b: Board) => void;
  onSelectFeeder: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('general');
  const s = useMemo(() => boardSummary(project, board), [project, board]);
  const incomerResult = s.incomer ? results.find((r) => r.feeder.id === s.incomer!.id) : undefined;
  const isMain = !board.upstreamId;

  function set<K extends keyof Board>(key: K, value: Board[K]) {
    onChange({ ...board, [key]: value });
  }
  const text = (key: 'name' | 'ipRating' | 'location' | 'manufacturer' | 'model', placeholder = '') => (
    <input value={board[key] ?? ''} placeholder={placeholder} onChange={(e) => set(key, e.target.value || (key === 'name' ? '' : undefined))} />
  );
  const num = (key: 'ratedCurrentA' | 'sourceKva' | 'sourceImpedancePct' | 'sourceXr', step = 1, placeholder = '') => (
    <input
      type="number"
      step={step}
      min="0"
      placeholder={placeholder}
      value={board[key] ?? ''}
      onChange={(e) => set(key, e.target.value === '' ? undefined : +e.target.value)}
    />
  );

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

        {tab === 'general' && (
          <div className="form-kv">
            <label>Name{text('name')}</label>
            <label>
              Type
              <select value={board.kind ?? (isMain ? 'MDB' : 'DB')} onChange={(e) => set('kind', e.target.value as Board['kind'])}>
                {BOARD_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </label>
            <label>Rated current (A){num('ratedCurrentA', 1, 'e.g. 400')}</label>
            <label>
              Busbar material
              <select value={board.busbarMaterial ?? ''} onChange={(e) => set('busbarMaterial', (e.target.value || undefined) as Board['busbarMaterial'])}>
                <option value="">—</option>
                <option value="copper">Copper</option>
                <option value="aluminium">Aluminium</option>
              </select>
            </label>
            <label>IP rating{text('ipRating', 'e.g. IP42')}</label>
            <label>Location{text('location')}</label>
            <label>Manufacturer{text('manufacturer')}</label>
            <label>Model{text('model')}</label>
          </div>
        )}

        {tab === 'electrical' && (
          <>
            {isMain && (
              <div className="form-kv">
                <label>Transformer (kVA){num('sourceKva', 50)}</label>
                <label>Impedance Z (%){num('sourceImpedancePct', 0.1)}</label>
                <label>X/R ratio{num('sourceXr', 0.5, String(DEFAULT_TRANSFORMER_XR))}</label>
              </div>
            )}
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
