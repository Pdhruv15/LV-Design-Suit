import { useMemo } from 'react';
import type { Project } from '../types';
import { boardSummary, boardsInSupplyOrder, systemSummary } from '../calc/summary';

const fmt = (n: number, d = 0) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/** System summary (totals + transformer loading gauge) and a bus voltage
 * table with one row per board, in supply order. */
export default function SystemSummaryCards({
  project,
  selectedBoardId,
  onSelectBoard
}: {
  project: Project;
  selectedBoardId: string | null;
  onSelectBoard: (id: string) => void;
}) {
  const sys = useMemo(() => systemSummary(project), [project]);
  const boards = useMemo(() => boardsInSupplyOrder(project).map((b) => boardSummary(project, b)), [project]);

  const pct = sys.transformerLoadingPct ?? 0;
  const R = 44;
  const C = 2 * Math.PI * R;
  const arc = 0.75; // gauge covers 270°
  const fill = Math.min(pct / 100, 1) * C * arc;
  const status = sys.transformerLoadingStatus ?? 'ok';

  return (
    <div className="cards">
      <section className="card">
        <h4>System summary</h4>
        <div className="summary">
          <svg width="124" height="112" viewBox="0 0 124 112" aria-label={`Transformer loading ${pct.toFixed(0)} percent`}>
            <g transform="rotate(135 62 58)" fill="none" strokeWidth="9" strokeLinecap="round">
              <circle cx="62" cy="58" r={R} stroke="var(--line)" strokeDasharray={`${C * arc} ${C}`} />
              <circle cx="62" cy="58" r={R} stroke={`var(--${status})`} strokeDasharray={`${fill} ${C}`} />
            </g>
            <text x="62" y="56" textAnchor="middle" style={{ fontSize: 20, fontWeight: 600 }}>
              {sys.transformerLoadingPct === undefined ? '—' : `${pct.toFixed(0)}%`}
            </text>
            <text x="62" y="72" textAnchor="middle" className="m">transformer</text>
            <text x="62" y="106" textAnchor="middle" className="m">
              {fmt(sys.demandKva)} of {fmt(sys.transformerKva)} kVA
            </text>
          </svg>
          <dl className="kv">
            <dt>Connected load</dt>
            <dd>{fmt(sys.connectedKw)} kW</dd>
            <dt>Maximum demand</dt>
            <dd>{fmt(sys.demandKw)} kW</dd>
            <dt>Demand kVA</dt>
            <dd>{fmt(sys.demandKva)} kVA</dd>
            <dt>Power factor</dt>
            <dd>{sys.powerFactor.toFixed(2)}</dd>
            <dt>Demand current</dt>
            <dd>{fmt(sys.currentA)} A</dd>
            {sys.generationKw > 0 && (
              <>
                <dt>Generation (PV)</dt>
                <dd>{fmt(sys.generationKw)} kW</dd>
              </>
            )}
          </dl>
        </div>
      </section>

      <section className="card">
        <h4>Bus voltages and board loading</h4>
        <table className="compact">
          <thead>
            <tr>
              <th>Board</th>
              <th>Voltage (V)</th>
              <th>% nominal</th>
              <th>Ik″ (kA)</th>
              <th>Demand (A)</th>
              <th>Loading</th>
            </tr>
          </thead>
          <tbody>
            {boards.map((s) => (
              <tr key={s.board.id} className={selectedBoardId === s.board.id ? 'sel' : ''} onClick={() => onSelectBoard(s.board.id)}>
                <td style={{ paddingLeft: 10 + s.depth * 14 }}>{s.board.id}</td>
                <td>{s.voltageV.toFixed(0)}</td>
                <td>{s.voltagePct.toFixed(1)}%</td>
                <td>{s.faultKA.toFixed(1)}</td>
                <td>{s.currentA.toFixed(0)}</td>
                <td className={s.loadingStatus ?? ''}>
                  {s.loadingPct === undefined ? 'no rating' : `${s.loadingPct.toFixed(0)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m note">
          Built-in estimate: voltage measured from the main busbar (transformer regulation not included). Use Engine
          comparison for a full load flow.
        </p>
      </section>
    </div>
  );
}
