import { useState } from 'react';
import { autoRoutes, autoTrays } from '../model/cadAutoLink';
import { traysFromDrawing, type CadDrawing } from '../model/cadDrawing';
import { applyCadLengths, CAD_LENGTH_DEFAULTS, lengthBreakdown, pullCadLengths, type CadRoute } from '../model/cadLengths';
import { applyBoardPlaces, pullBoardPlaces, type CadPlan } from '../model/cadPlaces';
import { linkedRoutes, withLinks } from '../model/cadPlanLinks';
import { withLayerMap } from '../model/cadRooms';
import { applyCadTrays, pullCadTrays, TRAY_MIN_RUN_M, TRAY_TOLERANCE_M, type CadTrayPlan } from '../model/cadTrays';
import { trayPlanOf } from '../calc/cableTray';
import type { LevelRef } from '../model/levels';
import type { CadLayerMap, CadLengthSettings, CadPlanLinks, Feeder, Project } from '../types';

/** The side panels of the Floor plan window for cable lengths, tray routes and board locations: what the plan gives
 * beside the design, ticked rows applied on accept — the same reading as the CAD dialogs had with OpenCADStudio, with
 * the links made by clicking on the plan in this window. */

export interface TaskProps {
  project: Project;
  /** The plan read with this window's links, and the curves of the route and tray layers. */
  plan: CadPlan;
  /** The drawing with this window's links as tags. */
  linked: CadDrawing;
  roles: CadLayerMap[];
  links: CadPlanLinks;
  level?: LevelRef;
  levelName?: string;
  /** What clicks on the plan link to: a feeder id, a tray route name or a board id. */
  target: string;
  onTarget: (v: string) => void;
  onApply: (next: Project, message: string) => void;
}

export const feederLabel = (f: Feeder) => (f.feedsBoardId ? `${f.boardId} → ${f.feedsBoardId}` : `${f.boardId} ${f.phase && f.way ? `${f.phase}${f.way}` : ''} ${f.name}`.replace(/\s+/g, ' ').trim());
const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : undefined; };
const toggle = (set: (f: (s: Set<string>) => Set<string>) => void, key: string, on: boolean) => set((s) => { const n = new Set(s); if (on) n.delete(key); else n.add(key); return n; });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** The project with this window's layer roles and links saved. */
const saved = (project: Project, roles: CadLayerMap[], links: CadPlanLinks) => withLinks(roles.length ? withLayerMap(project, roles) : project, links);

export function LengthsPanel({ project, plan, roles, links, target, onTarget, onApply }: TaskProps) {
  const [settings, setSettings] = useState<CadLengthSettings>(project.cadLength ?? {});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const s = { ...CAD_LENGTH_DEFAULTS, ...settings };
  const working: Project = { ...project, cadLength: settings };
  const hand = linkedRoutes(plan);
  const handIds = new Set(hand.map((r) => r.feederId));
  const auto = autoRoutes(project, plan, roles);
  const routes: CadRoute[] = [...hand, ...auto.routes.filter((r) => !handIds.has(r.feederId)).map((r) => ({ feederId: r.feederId, length: r.length, pieces: r.pieces.length }))];
  const pull = pullCadLengths(working, routes, plan.units);
  const accepted = pull.proposals.filter((x) => !skip.has(x.feederId));
  const feeders = [...project.feeders].filter((f) => !f.generation).sort((a, b) => feederLabel(a).localeCompare(feederLabel(b)));
  const setting = (k: 'verticalM' | 'terminationM' | 'wastePct', v: string) => setSettings((x) => ({ ...x, [k]: num(v) }));

  function apply() {
    const changed = JSON.stringify(settings) !== JSON.stringify(project.cadLength ?? {});
    const base = saved({ ...project, cadLength: changed ? (Object.keys(settings).length ? settings : undefined) : project.cadLength }, roles, links);
    onApply(applyCadLengths(base, accepted), accepted.length
      ? `Cable lengths from the floor plan: ${plural(accepted.length, 'feeder')} updated — run the calculations to check voltage drop`
      : 'Cable lengths from the floor plan: links and allowances saved, no lengths changed');
  }

  return (
    <>
      <div className="fp-form">
        <label>Link clicks to feeder
          <select value={target} onChange={(e) => onTarget(e.target.value)}>
            <option value="">Choose a feeder…</option>
            {feeders.map((f) => <option key={f.id} value={f.id}>{feederLabel(f)}</option>)}
          </select>
        </label>
        <label>Vertical (m)<input inputMode="decimal" value={settings.verticalM ?? ''} placeholder={String(s.verticalM)} onChange={(e) => setting('verticalM', e.target.value)} /></label>
        <label>Terminations (m)<input inputMode="decimal" value={settings.terminationM ?? ''} placeholder={String(s.terminationM)} onChange={(e) => setting('terminationM', e.target.value)} /></label>
        <label>Waste (%)<input inputMode="decimal" value={settings.wastePct ?? ''} placeholder={String(s.wastePct)} onChange={(e) => setting('wastePct', e.target.value)} /></label>
      </div>
      <div className="fp-list">
        <p className="m fp-pad">{plural(hand.length, 'route')} linked here · {auto.routes.filter((r) => !handIds.has(r.feederId)).length} from the cable route layers · {pull.units}</p>
        {pull.proposals.length > 0 && (
          <table className="bi-table compact">
            <thead><tr><th /><th>Feeder</th><th>Now (m)</th><th>From plan (m)</th></tr></thead>
            <tbody>
              {pull.proposals.map((x) => (
                <tr key={x.feederId} className={x.feederId === target ? 'sel' : undefined} onClick={() => onTarget(x.feederId)}>
                  <td><input type="checkbox" aria-label={`Accept ${x.label}`} checked={!skip.has(x.feederId)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(setSkip, x.feederId, e.target.checked)} /></td>
                  <td>{x.label}</td>
                  <td className="num">{x.currentM ?? '—'}</td>
                  <td className="num" title={lengthBreakdown(x)}>{x.proposedM}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pull.unknownFeeders.length > 0 && <p className="m fp-pad">Routes linked to feeders no longer in the design (ignored): {pull.unknownFeeders.join(', ')}</p>}
        {auto.unmatched.length > 0 && <p className="m fp-pad">Routes on the cable route layers not linked (click them with a feeder chosen): {auto.unmatched.map((u) => `${u.lengthM} m on ${u.layer} (${u.reason})`).join('; ')}</p>}
      </div>
      <Foot note={`${plural(accepted.length, 'length')} to apply · then run the calculations`} label={`Apply ${plural(accepted.length, 'length')}`} onApply={apply} />
    </>
  );
}

export function TraysPanel({ project, plan, linked, roles, links, target, onTarget, onApply }: TaskProps) {
  const [skipF, setSkipF] = useState<Set<string>>(new Set());
  const [skipL, setSkipL] = useState<Set<string>>(new Set());
  const hand = traysFromDrawing(linked);
  const handRoutes = new Set(hand.routes.map((r) => r.feederId));
  const autoT = autoTrays(project, plan, roles);
  const autoR = autoRoutes(project, plan, roles);
  const trayPlan: CadTrayPlan = {
    units: plan.units,
    trays: [...hand.trays, ...autoT],
    routes: [...hand.routes, ...autoR.routes.filter((r) => !handRoutes.has(r.feederId)).flatMap((r) => r.pieces.map((points) => ({ feederId: r.feederId, points })))]
  };
  const pull = pullCadTrays(project, trayPlan);
  const feeders = pull.feeders.filter((x) => !skipF.has(x.feederId));
  const lengths = pull.lengths.filter((x) => !skipL.has(x.name));
  const known = trayPlanOf(project).routes.map((r) => r.name);

  function apply() {
    const parts = [feeders.length ? plural(feeders.length, 'feeder tray route') : '', lengths.length ? plural(lengths.length, 'tray length') : ''].filter(Boolean);
    onApply(applyCadTrays(saved(project, roles, links), feeders, lengths), parts.length ? `Tray routes from the floor plan: updated ${parts.join(' and ')}` : 'Tray routes from the floor plan: links saved, nothing changed');
  }

  return (
    <>
      <div className="fp-form">
        <label>Link clicks to tray route
          <input list="fp-tray-names" placeholder="e.g. A" value={target} onChange={(e) => onTarget(e.target.value.toUpperCase().replace(/\s+/g, ''))} />
          <datalist id="fp-tray-names">{known.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
      </div>
      <div className="fp-list">
        <p className="m fp-pad">{plural(trayPlan.trays.length, 'tray run')} ({autoT.length} from the tray layers) · a feeder is on a tray where its route runs within {TRAY_TOLERANCE_M} m of it for more than {TRAY_MIN_RUN_M} m · {pull.units}</p>
        {pull.feeders.length > 0 && (
          <table className="bi-table compact">
            <thead><tr><th /><th>Feeder</th><th>Now</th><th>From plan</th></tr></thead>
            <tbody>
              {pull.feeders.map((x) => (
                <tr key={x.feederId}>
                  <td><input type="checkbox" aria-label={`Accept ${x.label}`} checked={!skipF.has(x.feederId)} onChange={(e) => toggle(setSkipF, x.feederId, e.target.checked)} /></td>
                  <td>{x.label}</td>
                  <td>{x.current || '—'}</td>
                  <td title={x.runs.map((r) => `${r.name}: ${r.m} m`).join(', ')}>{x.proposed || <i>on no tray</i>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pull.lengths.length > 0 && (
          <table className="bi-table compact">
            <thead><tr><th /><th>Tray route</th><th>Now (m)</th><th>From plan (m)</th></tr></thead>
            <tbody>
              {pull.lengths.map((x) => (
                <tr key={x.name} className={x.name === target ? 'sel' : undefined} onClick={() => onTarget(x.name)}>
                  <td><input type="checkbox" aria-label={`Accept tray ${x.name}`} checked={!skipL.has(x.name)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(setSkipL, x.name, e.target.checked)} /></td>
                  <td>{x.name}{x.isNew && <span className="m"> (new)</span>}</td>
                  <td className="num">{x.currentM ?? '—'}</td>
                  <td className="num">{x.proposedM}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pull.unknownFeeders.length > 0 && <p className="m fp-pad">Routes linked to feeders no longer in the design (ignored): {pull.unknownFeeders.join(', ')}</p>}
      </div>
      <Foot note={`${plural(feeders.length + lengths.length, 'change')} to apply`} label={`Apply ${plural(feeders.length + lengths.length, 'change')}`} onApply={apply} />
    </>
  );
}

export function BoardsPanel({ project, plan, roles, links, level, levelName, target, onTarget, onApply }: TaskProps) {
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const working = roles.length ? withLayerMap(project, roles) : project;
  const pull = pullBoardPlaces(working, plan, level);
  const accepted = pull.proposals.filter((x) => !skip.has(x.boardId));

  function apply() {
    onApply(applyBoardPlaces(saved(project, roles, links), accepted, level), accepted.length ? `Board locations from the floor plan: ${plural(accepted.length, 'board')} updated` : 'Board locations from the floor plan: places saved, nothing changed');
  }

  return (
    <>
      <div className="fp-form">
        <label>Place clicks as board
          <select value={target} onChange={(e) => onTarget(e.target.value)}>
            <option value="">Choose a board…</option>
            {project.boards.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}{links.places?.[b.id] ? ' (placed)' : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="fp-list">
        <p className="m fp-pad">Boards found by a TAG / BOARD / PANEL attribute or placed here · {plural(pull.rooms, 'room outline')} · {pull.units}{levelName ? ` · level ${levelName}` : ''}</p>
        {pull.proposals.length > 0 && (
          <table className="bi-table compact">
            <thead><tr><th /><th>Board</th><th>Now</th><th>From plan</th><th>Level</th></tr></thead>
            <tbody>
              {pull.proposals.map((x) => (
                <tr key={x.boardId} className={x.boardId === target ? 'sel' : undefined} onClick={() => onTarget(x.boardId)}>
                  <td><input type="checkbox" aria-label={`Accept ${x.boardId}`} checked={!skip.has(x.boardId)} onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(setSkip, x.boardId, e.target.checked)} /></td>
                  <td title={x.how === 'linked' ? 'Placed by hand' : 'Found by its TAG attribute'}>{x.boardId}</td>
                  <td>{x.currentLocation || '—'}</td>
                  <td>{x.room ?? <i>not in a room</i>}</td>
                  <td>{x.currentLevel === x.newLevel ? x.currentLevel : `${x.currentLevel} → ${x.newLevel}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pull.unknown.length > 0 && <p className="m fp-pad">Symbols naming boards not in the design (ignored): {pull.unknown.join(', ')}</p>}
        {pull.noRoom.length > 0 && <p className="m fp-pad">Outside every room outline (location kept): {pull.noRoom.join(', ')}</p>}
      </div>
      <Foot note={`${plural(accepted.length, 'board')} to update · ${pull.matching} already match`} label={`Apply ${plural(accepted.length, 'board')}`} onApply={apply} />
    </>
  );
}

function Foot({ note, label, onApply }: { note: string; label: string; onApply: () => void }) {
  return (
    <div className="modal-actions fp-foot">
      <span className="m">{note}</span>
      <span className="sp" />
      <button className="chip primary" onClick={onApply}>{label}</button>
    </div>
  );
}
