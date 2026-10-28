import { useMemo } from 'react';
import { buildingInfoOf } from '../../calc/building';
import type { RoomCoverage } from '../../elv/coverage';
import { COVERED_SYSTEMS } from '../../elv/coverage';
import type { ElvSystem } from '../../elv/defaults';
import { ELV_DEVICES, type DeviceSymbol, type ElvDeviceType } from '../../elv/devices';
import { devicesOn } from '../../elv/placed';
import { elvSchedules } from '../../elv/schedules';
import type { Project } from '../../types';
import { devicesFor, remove, rotate, SYSTEM_LABEL, type PlanLevel } from './elvPlan';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A device's plan symbol as a small icon (the canvas draws the same shapes). */
export function SymbolIcon({ symbol }: { symbol: DeviceSymbol }) {
  const fill = symbol.filled ? 'currentColor' : 'none';
  const shape = symbol.shape === 'circle' ? <circle cx="12" cy="12" r="8" />
    : symbol.shape === 'square' ? <rect x="4" y="4" width="16" height="16" />
      : symbol.shape === 'triangle' ? <path d="M12 3 21 20H3z" />
        : symbol.shape === 'diamond' ? <path d="M12 3 21 12 12 21 3 12z" />
          : symbol.shape === 'hexagon' ? <path d="M3 12 7.5 4h9L21 12l-4.5 8h-9z" />
            : symbol.shape === 'camera' ? <path d="M3 7h11v10H3zM14 10l7-3v10l-7-3z" />
              : <path d="M3 9h4v6H3zM7 9l8-5v16l-8-5z" />;
  const text = symbol.shape === 'camera' || symbol.shape === 'speaker' ? null
    : <text x="12" y={symbol.shape === 'triangle' ? 16 : 13} textAnchor="middle" dominantBaseline="middle" fontSize={symbol.text.length > 1 ? 6.5 : 8} fontWeight={600} fill={symbol.filled ? 'var(--panel)' : 'currentColor'} stroke="none">{symbol.text}</text>;
  return <svg className="elv-sym" viewBox="0 0 24 24" aria-hidden="true"><g fill={fill} stroke="currentColor" strokeWidth={1.6}>{shape}</g>{text}</svg>;
}

/** The ELV tab of the Floor plan page: the devices of the chosen system to place, the selected device, devices and
 * coverage per room on this level, and how the building's devices are wired (loops, ports, controllers, PA zones). */
export default function ElvPlanPanel({ project, level, levelName, system, device, selected, coverage, onDevice, onSelect, onChange }: {
  project: Project;
  level?: PlanLevel;
  levelName?: string;
  system: ElvSystem;
  device: ElvDeviceType;
  selected: string | null;
  coverage: RoomCoverage[];
  onDevice: (t: ElvDeviceType) => void;
  onSelect: (id: string | null) => void;
  onChange: (next: Project, message: string) => void;
}) {
  const schedules = useMemo(() => elvSchedules(project), [project]);
  if (!level || !levelName) return <p className="m fp-pad">Add the building and its levels in Building information first; ELV devices are placed per level.</p>;
  const info = buildingInfoOf(project);
  const onLevel = devicesOn(project, level.building, level.level);
  const ofSystem = onLevel.filter((d) => ELV_DEVICES[d.type].system === system);
  const rooms = info.rooms.filter((r) => r.buildingId === level.building && r.levelId === level.level);
  const sel = selected ? onLevel.find((d) => d.id === selected) : undefined;
  const turns = sel && (ELV_DEVICES[sel.type].symbol.shape === 'camera' || ELV_DEVICES[sel.type].symbol.shape === 'speaker');
  const covered = COVERED_SYSTEMS.includes(system);
  const short = coverage.filter((c) => c.pct !== undefined && c.pct < 0.999);
  const noOutline = coverage.filter((c) => c.needed && c.pct === undefined).length;
  const b = schedules.buildings.find((x) => x.buildingId === level.building);
  const floorOf = (levelId: string) => b?.switches.filter((s) => s.levelId === levelId) ?? [];
  const groups: string[] = !b ? [] : system === 'fire-alarm'
    ? [`${plural(b.zones.length, 'detection zone')} (one floor, ≤ 2,000 m² each)`, ...b.loops.map((l) => `Loop ${l.id}: ${plural(l.devices.length, 'device')} · ${l.alarmMa.toFixed(1)} mA in alarm · ${plural(l.isolators, 'isolator')}`)]
    : system === 'cctv' || system === 'ict'
      ? floorOf(level.level).filter((s) => s.system === system).map((s) => `${s.id}: ${plural(s.ports, 'port')} · ${s.poeW.toFixed(1)} W PoE`)
      : system === 'access-control'
        ? b.controllers.filter((c) => c.levelId === level.level).map((c) => `${c.id}: ${plural(c.doors, 'door')}`)
        : [...b.paZones.filter((z) => z.levelId === level.level).map((z) => `${z.id}: ${plural(z.speakers, 'speaker')} · ${z.watts.toFixed(0)} W → ${z.amplifier}`),
          ...b.amplifiers.map((a) => `${a.id}: ${a.loadW.toFixed(0)} of ${a.ratedW} W (${a.zones.join(', ')})`)];
  const roomName = (id?: string) => rooms.find((r) => r.id === id)?.name;

  return (
    <>
      <h4>{SYSTEM_LABEL[system]} devices <small className="m">· pick one, then Place or Fill room</small></h4>
      <div className="elv-pal" role="group" aria-label={`${SYSTEM_LABEL[system]} devices`}>
        {devicesFor(system).map((d) => (
          <button key={d.type} aria-pressed={d.type === device} onClick={() => onDevice(d.type)} title={d.coverage?.basis ?? d.label}>
            <SymbolIcon symbol={d.symbol} />{d.label}<b>{onLevel.filter((x) => x.type === d.type).length}</b>
          </button>
        ))}
      </div>
      {sel && (
        <div className="fp-form elv-sel">
          <span><b>{ELV_DEVICES[sel.type].label} {sel.id}</b> <span className="m">· {roomName(sel.roomId) ?? 'outside every room outline'}</span></span>
          {turns && <label>Faces (°)<input key={sel.id} inputMode="numeric" defaultValue={sel.rotationDeg ?? 0} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== (sel.rotationDeg ?? 0)) { const r = rotate(project, sel.id, n); onChange(r.next, r.message); } }} /></label>}
          <button className="chip" onClick={() => { const r = remove(project, sel.id); onSelect(null); onChange(r.next, r.message); }}>Delete</button>
        </div>
      )}
      <div className="fp-list">
        <table className="bi-table compact">
          <thead><tr><th>Room</th><th className="num">Devices</th>{covered && <th className="num">Covered</th>}</tr></thead>
          <tbody>
            {rooms.map((r) => {
              const c = coverage.find((x) => x.roomId === r.id);
              const n = ofSystem.filter((d) => d.roomId === r.id).length;
              return (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="num">{n}</td>
                  {covered && <td className="num">{!c?.needed ? <span className="m">not needed</span> : c.pct === undefined ? <span className="m" title="Typed in, not taken from the plan: no outline to check">no outline</span>
                    : <span className={c.pct > 0.999 ? 'elv-ok' : c.pct > 0.95 ? 'elv-warn' : 'elv-bad'}>{(c.pct * 100).toFixed(c.pct > 0.999 ? 0 : 1)} %</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {groups.length > 0 && (
          <>
            <h4>{system === 'fire-alarm' ? 'Zones and loops' : system === 'public-address' ? 'PA zones and amplifiers' : system === 'access-control' ? 'Door controllers' : 'Switch ports'} <small className="m">· {system === 'fire-alarm' ? 'whole building' : levelName}</small></h4>
            <ul className="elv-groups">{groups.map((g) => <li key={g}>{g}</li>)}</ul>
          </>
        )}
        {(short.length > 0 || noOutline > 0 || schedules.warnings.length > 0) && (
          <ul className="elv-warns">
            {short.map((c) => <li key={c.roomId}>{roomName(c.roomId)}: {((1 - c.pct!) * 100).toFixed(1)} % not covered — move a device or add one.</li>)}
            {noOutline > 0 && <li>{plural(noOutline, 'room')} typed in without an outline: coverage is not checked there.</li>}
            {schedules.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
      </div>
      <div className="modal-actions fp-foot"><span className="m">{plural(ofSystem.length, `${SYSTEM_LABEL[system].toLowerCase()} device`)} on {levelName} · the ELV estimate and LV loads follow</span></div>
    </>
  );
}
