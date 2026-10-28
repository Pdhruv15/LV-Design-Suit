import { useMemo, useState } from 'react';
import { buildingInfoOf, roomTypesOf } from '../../calc/building';
import { DEFAULT_RULES, ELV_SYSTEMS, type Density, type ElvSystem, type RoomRule } from '../../elv/defaults';
import { estimateElv, type ElvSettings } from '../../elv/estimate';
import { elvLoadsPackage } from '../../elv/package';
import { acceptedElvLoads } from '../../exchange/inbox';
import type { ExchangePackage } from '../../exchange/contracts';
import type { Project } from '../../types';
import { safeFileName, saveText } from '../../util/files';
import { sha256Hex } from '../../util/sha256';
import { Page } from '../ui';

export const SYSTEM_LABEL: Record<ElvSystem, string> = { 'fire-alarm': 'Fire alarm', cctv: 'CCTV', 'access-control': 'Access control', ict: 'ICT', 'public-address': 'Public address' };

/** Assumption columns: which rule and which part of it (devices per m², or a minimum per room). */
const RULE_COLUMNS: { key: keyof RoomRule; part: keyof Density; label: string; title: string }[] = [
  { key: 'detectorM2', part: 'm2', label: 'Detector per m²', title: 'One detector per this floor area (BS 5839-1 coverage)' },
  { key: 'camera', part: 'm2', label: 'Camera per m²', title: 'One camera per this floor area; 0 = none by area' },
  { key: 'door', part: 'min', label: 'Doors', title: 'Access-controlled doors per room' },
  { key: 'dataPort', part: 'm2', label: 'Data per m²', title: 'One data outlet per this floor area' },
  { key: 'speaker', part: 'm2', label: 'Speaker per m²', title: 'One PA speaker per this floor area' }
];

const kw = (n: number) => n.toFixed(2);
const DEVICE_COLUMNS: { label: string; of: (d: Record<string, number | undefined>) => number }[] = [
  { label: 'Det.', of: (d) => (d.smokeDetector ?? 0) + (d.heatDetector ?? 0) + (d.multiDetector ?? 0) },
  { label: 'Cam.', of: (d) => d.camera ?? 0 },
  { label: 'Doors', of: (d) => (d.door ?? 0) + Math.max(d.cardReader ?? 0, d.maglock ?? 0) },
  { label: 'Data', of: (d) => d.dataPort ?? 0 },
  { label: 'APs', of: (d) => d.accessPoint ?? 0 },
  { label: 'Spk.', of: (d) => (d.ceilingSpeaker ?? 0) + (d.hornSpeaker ?? 0) }
];

/** ELV estimate from the rooms of Building: the systems on and off, upstream kW per system and supply, devices per
 * room, and the assumptions per room type (typical values to verify; a changed value is kept in project.elv).
 * "Send to LV" puts the loads package in the inbox; nothing changes the boards until it is accepted and placed. */
export default function ElvView({ project, onChange, onSend, onPlace, onStatus }: {
  project: Project;
  onChange: (p: Project) => void;
  onSend: (pkg: ExchangePackage, hash: string) => void;
  onPlace: () => void;
  onStatus: (m: string) => void;
}) {
  const settings: ElvSettings = project.elv ?? {};
  const estimate = useMemo(() => estimateElv(project), [project]);
  const info = buildingInfoOf(project);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [system, setSystem] = useState<ElvSystem | ''>('');
  const levels = [...new Set(estimate.rooms.map((r) => `${r.building} · ${r.level}`))];
  const [level, setLevel] = useState('');
  const shownLevel = levels.includes(level) ? level : levels[0] ?? '';
  const on = new Set(settings.systems ?? ELV_SYSTEMS);
  const total = estimate.supplies.reduce((t, s) => t + s.kW, 0);
  const essential = estimate.supplies.filter((s) => s.supply === 'essential').reduce((t, s) => t + s.kW, 0);
  const placed = acceptedElvLoads(project).length > 0;

  const setSettings = (next: ElvSettings) => onChange({ ...project, elv: Object.keys(next).length ? next : undefined });
  const toggle = (s: ElvSystem, v: boolean) => {
    const list = ELV_SYSTEMS.filter((x) => (x === s ? v : on.has(x)));
    if (!list.length) { onStatus('At least one ELV system must stay on.'); return; }
    const { systems: _old, ...rest } = settings;
    setSettings(list.length === ELV_SYSTEMS.length ? rest : { ...rest, systems: list });
  };
  const ruleOf = (type: string): RoomRule => ({ ...(DEFAULT_RULES[type] ?? DEFAULT_RULES.default), ...(settings.rules?.[type] ?? {}) });
  const changed = (type: string, key: keyof RoomRule) => settings.rules?.[type]?.[key] !== undefined;
  const setRule = (type: string, key: keyof RoomRule, part: keyof Density, text: string) => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) return;
    const base = DEFAULT_RULES[type] ?? DEFAULT_RULES.default;
    const value = { ...(ruleOf(type)[key] as Density), [part]: part === 'min' ? Math.round(n) : n };
    const same = JSON.stringify(value) === JSON.stringify(base[key]);
    const { [key]: _drop, ...others } = settings.rules?.[type] ?? {};
    const forType = same ? others : { ...others, [key]: value };
    const { [type]: _t, ...rules } = settings.rules ?? {};
    const nextRules = Object.keys(forType).length ? { ...rules, [type]: forType } : rules;
    const { rules: _r, ...rest } = settings;
    setSettings(Object.keys(nextRules).length ? { ...rest, rules: nextRules } : rest);
  };

  const pkg = () => elvLoadsPackage(project, estimate, new Date().toISOString(), sha256Hex);
  const send = () => {
    try { const p = pkg(); onSend(p, p.sha256); } catch (e) { onStatus(e instanceof Error ? e.message : String(e)); }
  };
  const exportPkg = async () => {
    try { const m = await saveText(`${safeFileName(project.name)} - ELV loads.json`, `${JSON.stringify(pkg(), null, 2)}\n`, 'ELV loads package', 'json'); if (m) onStatus(m); } catch (e) { onStatus(e instanceof Error ? e.message : String(e)); }
  };

  const types = [...new Set(info.rooms.map((r) => r.type))];
  const typeLabel = (id: string) => roomTypesOf(info).find((t) => t.id === id)?.label ?? id;
  const levelName = (s: { buildingId: string; levelId?: string; floor?: number }) => {
    if (!s.levelId) return 'Building';
    const b = info.buildings.find((x) => x.id === s.buildingId);
    const l = b?.levels.find((x) => x.id === s.levelId);
    return `${l?.name ?? s.levelId}${s.floor ? ` · floor ${s.floor}` : ''}`;
  };
  const supplies = estimate.supplies.filter((s) => !system || s.system === system);
  const roomRows = estimate.rooms.filter((r) => `${r.building} · ${r.level}` === shownLevel);

  return (
    <Page title="ELV systems" intro={`Estimate from ${info.rooms.length} room${info.rooms.length === 1 ? '' : 's'} in Building · typical values, verify. An estimate for the LV loads, not a device layout.`}
      actions={<>
        <button className="chip" onClick={() => setShowAssumptions((v) => !v)} aria-expanded={showAssumptions}>Assumptions…</button>
        <button className="chip" onClick={exportPkg} disabled={!estimate.supplies.length}>Export package…</button>
        {placed && <button className="chip" onClick={onPlace}>Place on boards…</button>}
        <button className="chip primary" onClick={send} disabled={!estimate.supplies.length} title="Put the ELV loads in the inbox to review and accept">Send to LV</button>
      </>}>
      <div className="tool-panel">
        <div className="la-kpis">
          {ELV_SYSTEMS.map((s) => {
            const t = estimate.totals[s];
            const units = estimate.supplies.filter((x) => x.system === s).reduce((n, x) => n + x.units, 0);
            const ess = estimate.supplies.some((x) => x.system === s && x.supply === 'essential');
            return (
              <div key={s}>
                <span>{SYSTEM_LABEL[s]} · <label><input type="checkbox" checked={on.has(s)} onChange={(e) => toggle(s, e.target.checked)} /> on</label></span>
                <b>{on.has(s) ? `${kw(t?.kW ?? 0)} kW` : 'Off'}</b>
                <span>{on.has(s) ? `${t?.supplies ?? 0} suppl${t?.supplies === 1 ? 'y' : 'ies'} · ${units} unit${units === 1 ? '' : 's'}${ess ? ' · essential' : ''}` : 'Not estimated'}</span>
              </div>
            );
          })}
          <div><span>Total upstream</span><b>{kw(total)} kW</b><span>{estimate.supplies.length} supplies · {kw(essential)} kW essential</span></div>
        </div>

        {estimate.warnings.map((w, i) => <p key={i} className="warn">⚠ {w}</p>)}

        {showAssumptions && (
          <div className="card">
            <h4>Assumptions <span className="m">per room type · a changed value is kept with the project and shown in bold</span></h4>
            {!types.length ? <p className="m">No rooms in Building yet.</p> : (
              <table className="tbl"><thead><tr><th>Room type</th>{RULE_COLUMNS.map((c) => <th key={c.key} className="num" title={c.title}>{c.label}</th>)}<th>Basis</th></tr></thead><tbody>
                {types.map((t) => {
                  const r = ruleOf(t);
                  const any = RULE_COLUMNS.some((c) => changed(t, c.key));
                  return (
                    <tr key={t}>
                      <td>{typeLabel(t)}</td>
                      {RULE_COLUMNS.map((c) => (
                        <td key={c.key} className="num">
                          <input type="number" min={0} step={c.part === 'min' ? 1 : 'any'} aria-label={`${typeLabel(t)}: ${c.label}`} style={{ width: 70, fontWeight: changed(t, c.key) ? 700 : undefined }}
                            defaultValue={(r[c.key] as Density)[c.part]} key={`${t}-${c.key}-${(r[c.key] as Density)[c.part]}`}
                            onBlur={(e) => setRule(t, c.key, c.part, e.target.value)} />
                        </td>
                      ))}
                      <td className={any ? '' : 'warn'}>{any ? 'Changed for this project' : 'Typical — verify'}</td>
                    </tr>
                  );
                })}
              </tbody></table>
            )}
            <ul className="m">{estimate.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
          </div>
        )}

        <div className="card">
          <h4>Supplies to LV <span className="m">one LV circuit each after placing</span>{' '}
            <select value={system} onChange={(e) => setSystem(e.target.value as ElvSystem | '')} aria-label="System">
              <option value="">All systems</option>
              {ELV_SYSTEMS.filter((s) => on.has(s)).map((s) => <option key={s} value={s}>{SYSTEM_LABEL[s]}</option>)}
            </select>
          </h4>
          {!supplies.length ? <p className="m">No supplies: add rooms with room types in Building.</p> : (
            <table className="tbl"><thead><tr><th>ID</th><th>Equipment</th><th>Serves</th><th className="num">kW</th><th className="num">pf</th><th>Supply</th><th>Basis</th></tr></thead><tbody>
              {supplies.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td><td>{s.equipment}</td><td>{levelName(s)}</td><td className="num">{kw(s.kW)}</td><td className="num">{s.pf.toFixed(2)}</td>
                  <td>{s.supply === 'essential' ? <b>Essential</b> : 'Normal'}</td><td className="m">{s.demandBasis}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>

        <div className="card">
          <h4>Devices per room{' '}
            {levels.length > 1 && <select value={shownLevel} onChange={(e) => setLevel(e.target.value)} aria-label="Level">{levels.map((l) => <option key={l} value={l}>{l}</option>)}</select>}
            {levels.length === 1 && <span className="m">{shownLevel}</span>}
          </h4>
          {!roomRows.length ? <p className="m">No rooms.</p> : (
            <table className="tbl"><thead><tr><th>Room</th><th>Type</th><th className="num">m²</th>{DEVICE_COLUMNS.map((c) => <th key={c.label} className="num">{c.label}</th>)}</tr></thead><tbody>
              {roomRows.map((r) => (
                <tr key={r.roomId}>
                  <td>{r.roomId} {r.name}{r.count > 1 ? <span className="m"> × {r.count}</span> : ''}</td><td>{typeLabel(r.type)}</td><td className="num">{Math.round(r.areaM2)}</td>
                  {DEVICE_COLUMNS.map((c) => <td key={c.label} className="num">{c.of(r.devices)}</td>)}
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </div>
    </Page>
  );
}
