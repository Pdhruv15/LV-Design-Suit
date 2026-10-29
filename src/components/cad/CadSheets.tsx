import { useState } from 'react';
import type { Project } from '../../types';
import type { CalcRun } from '../../calc/runs';
import type { FeederResult } from '../../calc/electrical';
import type { Annotations } from '../../diagram/annotations';
import type { MainView } from '../../views';
import { boardsInSupplyOrder } from '../../calc/summary';
import { movePanelToSheet, setOf } from '../../model/drawingSet';
import SystemDiagram from '../SystemDiagram';
import DrawingsView, { type DrawingsTab } from '../docs/DrawingsView';
import { SheetList, SheetWorkspace, sheetOutlines } from '../sld/SheetWorkspace';
import type { SheetUi } from '../sld/sheetUi';

/** Design CAD → Sheets: every submission sheet in one place — SLDs, risers and earthing. The sheet list on the left;
 * the open sheet (page, markup, publish) with its settings on the right, or with none open the drawing register
 * (layout, title block and numbering, issues, export). Sheets are made from the design, so a design change shows on
 * them; nothing here changes the design except which panels go on which sheet. */
export default function CadSheets({ project, calcProject, results, annotations, run, sheetId, tab, ui, onActive, onChange, onStatus, onOpen }: {
  project: Project;
  calcProject: Project;
  results: FeederResult[];
  annotations?: Annotations;
  run?: CalcRun;
  /** The open sheet; null for the register. */
  sheetId: string | null;
  /** The register's tab when no sheet is open. */
  tab: DrawingsTab;
  /** The open sheet's tools, shared with the ribbon. */
  ui: SheetUi;
  onActive: (id: string | null) => void;
  onChange: (p: Project) => void;
  onStatus: (m: string) => void;
  onOpen: (v: MainView) => void;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  // A panel picked on the design beside the sheet: "Panel and its branch" starts from it.
  const [panel, setPanel] = useState<string | null>(null);
  const set = setOf(project);
  const open = !!sheetId && set.sheets.some((x) => x.id === sheetId);
  // Side by side: the design with each sheet's panels outlined; drag a panel onto another outline to move it there.
  const design = (
    <SystemDiagram project={project} calcProject={calcProject} results={results} annotations={annotations}
      selectedFeederId={null} selectedBoardId={panel} onSelectFeeder={() => {}} onSelectBoard={setPanel}
      outlines={sheetOutlines(project)} onOutline={onActive}
      onMoveToSheet={(boardId, to) => {
        onChange({ ...project, drawingSet: movePanelToSheet(set, boardId, to, boardsInSupplyOrder(project).map((b) => b.id)) });
        onStatus(`${boardId} moved to ${set.sheets.find((x) => x.id === to)?.number}`);
      }} />
  );
  return (
    <div className="cad-sheets">
      <SheetList project={project} run={run} active={open ? sheetId : null} selectedBoardId={panel} onActive={onActive} onChange={onChange} onStatus={onStatus} />
      {open ? (
        <>
          <div className="cs-main">
            <SheetWorkspace project={project} run={run} sheetId={sheetId!} design={design} settingsHost={host} ui={ui} onChange={onChange} onStatus={onStatus} onActive={onActive} />
          </div>
          <aside ref={setHost} className="sheet-side" aria-label="Sheet" />
        </>
      ) : (
        <div className="cs-main cs-register">
          <DrawingsView key={tab} project={project} run={run} initialTab={tab} onChange={onChange} onStatus={onStatus} onOpen={onOpen} />
        </div>
      )}
    </div>
  );
}
