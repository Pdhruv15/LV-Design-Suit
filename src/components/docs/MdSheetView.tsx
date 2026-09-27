import { useMemo } from 'react';
import type { Project } from '../../types';
import { applyMdEdits, buildMdSheet } from '../../docs/mdSheet';
import { revisionStamp } from '../../model/revisions';
import FormSheet from './FormSheet';

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
      <FormSheet
        model={sheet}
        height="48vh"
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
          Type of meter (rating of incomer): (1) up to 60 A, 1-phase · (2) up to 125 A, 3-phase · (3) LV CT / HV CT.
          Type 1 in a meter column to propose that meter. Loads come from the boards and load schedules below — edit them there.
        </p>
      </div>
    </div>
  );
}
