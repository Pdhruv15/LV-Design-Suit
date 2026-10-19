import { useMemo, useState } from 'react';
import type { Project } from '../types';
import RiserDiagram, { RiserLegendSvg } from '../diagram/RiserDiagram';
import FeederRiserDiagram, { FeederRiserLegendSvg } from '../diagram/FeederRiserDiagram';
import { riserLayout } from '../diagram/riserLayout';
import { feederRiserLayout } from '../diagram/feederRiserLayout';
import { addRiserSheet, setOf } from '../model/drawingSet';

type Style = 'feeders' | 'bus';
const stored = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(`lvds.${k}`); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(`lvds.${k}`, JSON.stringify(v)); } catch { /* ignore */ } };

/** Design ▸ SLD ▸ Riser tab: a building's riser — individual feeders from each
 * panel's busbar (riser schematic) or busbar trunking / cable chain — with
 * its legend, and a button to put it in the drawing set. */
export default function RiserView({ project, onChange, onStatus }: { project: Project; onChange: (p: Project) => void; onStatus: (m: string) => void }) {
  const buildings = project.building?.buildings ?? [];
  const [pick, setPick] = useState<string>(() => stored('riser.building', ''));
  const b = buildings.find((x) => x.id === pick) ?? buildings[0];
  const [style, setStyleState] = useState<Style>(() => stored('riser.style', 'feeders'));
  const setStyle = (s: Style) => { setStyleState(s); store('riser.style', s); };
  const [zoom, setZoom] = useState(1);
  const fl = useMemo(() => (b && style === 'feeders' ? feederRiserLayout(project, b.id) : undefined), [project, b, style]);
  const bl = useMemo(() => (b && style === 'bus' ? riserLayout(project, b.id) : undefined), [project, b, style]);

  if (!b) return <p className="m">No buildings yet — add one in Building information, then set each panel's Level.</p>;
  const sheetStyle = style === 'feeders' ? 'feeders' : undefined;
  const existing = setOf(project).sheets.find((s) => s.kind === 'riser' && s.buildingId === b.id && s.riserStyle === sheetStyle);
  const addSheet = () => {
    const set = setOf(project);
    const r = addRiserSheet(set, b.id, b.name, sheetStyle);
    onChange({ ...project, drawingSet: r.set });
    onStatus(`Added ${r.set.sheets.find((s) => s.id === r.id)?.number ?? 'a riser sheet'} to the drawing set`);
  };
  const used = fl?.used ?? bl?.used ?? new Set<string>();
  const empty = fl?.empty ?? bl?.empty ?? true;
  return (
    <div className="earth-ws">
      <div className="earth-main">
        <div className="earth-bar">
          <div className="seg" role="tablist" aria-label="Riser">
            <button role="tab" aria-selected={style === 'feeders'} className={style === 'feeders' ? 'on' : ''} onClick={() => setStyle('feeders')} title="Each board on its own breaker and cable from its panel's busbar">Individual feeders</button>
            <button role="tab" aria-selected={style === 'bus'} className={style === 'bus' ? 'on' : ''} onClick={() => setStyle('bus')} title="Busbar trunking tap-offs and cable chain">Busbar riser</button>
          </div>
          {buildings.length > 1 && (
            <select className="chip" value={b.id} onChange={(e) => { setPick(e.target.value); store('riser.building', e.target.value); }} aria-label="Building">
              {buildings.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <span className="sp" />
          <button className="chip" disabled={empty || !!existing} onClick={addSheet} title="Add this riser to Drawings as a titled sheet (PDF, DXF)">{existing ? `In drawings — ${existing.number}` : 'Add to drawings'}</button>
          <button className="chip" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z / 1.25).toFixed(2)))}>−</button>
          <button className="chip" onClick={() => setZoom(1)}>Fit</button>
          <button className="chip" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, +(z * 1.25).toFixed(2)))}>+</button>
        </div>
        <div className="earth-canvas"><div style={{ zoom }}>
          {style === 'feeders' ? <FeederRiserDiagram project={project} buildingId={b.id} layout={fl} /> : <RiserDiagram project={project} buildingId={b.id} layout={bl} />}
          {!empty && (style === 'feeders' ? <FeederRiserLegendSvg used={used} /> : <RiserLegendSvg used={used} />)}
        </div></div>
      </div>
    </div>
  );
}
