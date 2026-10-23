import { ask, tell } from '../ConfirmDialog';
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Project } from '../../types';
import { applyMdEdits, buildMdSheet } from '../../docs/mdSheet';
import { addOutgoingFeeder, deleteOutgoingFeeder, feederDeleteBlock } from '../../model/mdFeeders';
import { addSpareWay, deleteSpareWay, spareLabel } from '../../model/spareWays';
import { revisionStamp } from '../../model/revisions';
import ClassicGrid from '../grid/ClassicGrid';

/** "Details of connected load, maximum demand & kWh metering" for one
 * board, drawn like the authority form: header, the sheet, then the demand
 * factor / maximum demand line and the meter legend. */
export default function MdSheetView({ project, boardId, onChange, onStatus, onSettings }: {
  project: Project;
  boardId: string;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
  onSettings: () => void;
}) {
  const sheet = useMemo(() => buildMdSheet(project, boardId), [project, boardId]);
  const f = sheet.form;
  const blank = (v: string) => v || <span className="md-blank" title="Set in Project settings">—</span>;
  const add = () => {
    const r = addOutgoingFeeder(project, boardId);
    if (r.project !== project) onChange(r.project);
    onStatus(r.message);
  };
  /** Delete control on each outgoing feeder row (not the incomer). A feeder
   * that supplies a panel can't be deleted here: it would leave that panel unfed. */
  const [singlePhase, setSinglePhase] = useState(false);
  const addWay = (kind: 'spare' | 'space') => {
    const r = addSpareWay(project, boardId, kind, singlePhase ? 'R' : 'RYB');
    if (r.project !== project) onChange(r.project);
    onStatus(r.message);
  };
  const rowAction = (y: number) => {
    const row = sheet.rows[y];
    if (row.type === 'way') {
      const w = row.way;
      const what = spareLabel(w).toLowerCase();
      return (
        <button className="icon-btn" aria-label={`Delete ${what}`} title={`Delete this ${what}`}
          onClick={async () => {
            if (!(await ask(`Delete this ${what} from ${boardId}?`))) return;
            const r = deleteSpareWay(project, boardId, w.id);
            onChange(r.project);
            onStatus(r.message);
          }}>
          <Trash2 size={14} />
        </button>
      );
    }
    if (row.type !== 'feeder') return null;
    const f = row.feeder;
    const block = feederDeleteBlock(project, f.id);
    const label = row.toBoard ? row.toBoard.id : f.name || f.id;
    return (
      <button className={`icon-btn${block ? ' md-del-blocked' : ''}`} aria-label={`Delete feeder ${f.id}`}
        title={block ?? `Delete feeder ${f.id} (${label})`}
        onClick={async () => {
          if (block) { onStatus(block); void tell(block); return; }
          if (!(await ask(`Delete outgoing feeder ${f.id} (${label}) from ${boardId}?`))) return;
          const r = deleteOutgoingFeeder(project, f.id);
          if (r.project !== project) onChange(r.project);
          onStatus(r.message);
        }}>
        <Trash2 size={14} />
      </button>
    );
  };
  return (
    <div className="md-form">
      <div className="md-head">
        <div><span>PROJECT:</span> <b>{f.project}</b></div>
        <div className="md-title">{f.title}</div>
        <div><span>AREA:</span> {blank(f.area)} <span className="md-rev">{revisionStamp(project)}</span></div>
        <div><span>PLANNED COMPLETION DATE:</span> {blank(f.completion)}</div>
        <div><span>OWNER:</span> {blank(f.owner)}</div>
        <div><span>PLOT NO:</span> {blank(f.plotNo)}</div>
        <div><b>{f.boardLine}</b></div>
        <div><span>CONSULTANT:</span> {blank(f.consultant)}</div>
        <div><span>LOCATION:</span> {blank(f.location)}</div>
      </div>
      <div className="ls-actions">
        <button className="chip" onClick={add} title="Adds an outgoing feeder (general load, sized by the app) to this panel — type its kW in the TCL column; feeders to panels are added by dropping a board on the SLD"><Plus size={14} /> Add feeder</button>
        <span className="seg ls-spare-add" title="A spare is a way with a breaker fitted and nothing connected; a space is an empty way kept for a future breaker. Neither carries load.">
          <button onClick={() => addWay('spare')}><Plus size={14} /> Spare</button>
          <button onClick={() => addWay('space')}><Plus size={14} /> Space</button>
          <label className="m"><input type="checkbox" checked={singlePhase} onChange={(e) => setSinglePhase(e.target.checked)} /> 1-phase (SP)</label>
        </span>
      </div>
      <ClassicGrid
        model={sheet}
        rowAction={rowAction}
        onStatus={onStatus}
        onEdits={(edits) => {
          const { project: next, rejected } = applyMdEdits(project, sheet, edits);
          if (next !== project) onChange(next);
          return { changed: next !== project, rejected };
        }}
      />
      <div className="md-foot">
        <div className="md-connected">{f.connectedTo.map((l) => <div key={l}>{l}</div>)}</div>
        <div className="md-demand">
          <span>DEMAND FACTOR: <b>{f.demandFactor.toFixed(2)}</b></span>
          <span>MAX. DEMAND: <b>{f.maxDemandKw.toFixed(2)} kW</b></span>
          <span>TOTAL CONNECTED LOAD: <b>{f.totalConnectedKw.toFixed(2)} kW</b></span>
          <span>TOTAL BUILD UP AREA (Sq. mtr): {blank(f.builtUpArea)}</span>
        </div>
        <div className="md-demand">
          <span>CONSULTANT/ CONTRACTOR: {blank(f.contractor)}</span>
          <span>TEL: {blank(f.tel)}</span>
          <span>FAX: {blank(f.fax)}</span>
          <button className="chip" onClick={onSettings}>Edit form details…</button>
        </div>
        <p className="m">
          {f.metering && <>Type of meter (rating of incomer): (1) up to 60 A, 1-phase · (2) up to 125 A, 3-phase · (3) LV CT / HV CT.
          Type 1 in a meter column to propose that meter. </>}An equipment feeder's load is typed in its TCL column (its breaker and cable are re-sized); a panel's load comes from the boards and load schedules below — edit them there.
        </p>
      </div>
    </div>
  );
}
