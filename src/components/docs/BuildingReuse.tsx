import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuildingInfo, Project, ProjectBuilding, UnitType } from '../../types';
import { buildingInfoOf } from '../../calc/building';
import { catalog } from '../../database/catalog';
import {
  bundleFrom, bundleLines, dbLinksOf, exportBuildingPresets, importBuildingPresets, libraryWith, loadBuildingPresets, mergeBundle, missingRoomTypes,
  presetFromBuilding, presetNameIssue, saveBuildingPresets, saveLocalUnitTypeLibrary, unitTypeLibrary, unitTypeRows, withLibraryUnits,
  type BuildingBundle, type BuildingPreset
} from '../../model/buildingPreset';
import { listProjects, loadProject, pickProject, whenText, type ProjectMeta } from '../../model/projectStore';
import { safeFileName, saveText } from '../../util/files';

const list = (xs: string[], max = 4) => `${xs.slice(0, max).join(', ')}${xs.length > max ? ` +${xs.length - max}` : ''}`;

/** Save the selected building as a preset: levels, flats, rooms and room types — no DB links, no riser board. */
export function SavePresetDialog({ info, b, onClose, onStatus }: { info: BuildingInfo; b: ProjectBuilding; onClose: () => void; onStatus: (m: string) => void }) {
  const presets = useMemo(loadBuildingPresets, []);
  const [name, setName] = useState(b.use ? `${b.use}` : b.name);
  const [note, setNote] = useState('');
  const [rooms, setRooms] = useState(true);
  const [areas, setAreas] = useState(false);
  const same = presets.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
  const issue = !name.trim() ? presetNameIssue(name, presets) : undefined;
  const preview = useMemo(() => bundleFrom(info, [b.id], { rooms, areas }), [info, b.id, rooms, areas]);
  const line = bundleLines(preview)[0];
  const links = dbLinksOf(info, [b.id]);
  const save = () => {
    const p = presetFromBuilding(info, b.id, name, { rooms, areas, note });
    const next = same ? presets.map((x) => (x.id === same.id ? { ...p, id: same.id } : x)) : [...presets, p];
    onStatus(saveBuildingPresets(next) ? `${same ? 'Updated' : 'Saved'} building preset "${p.name}" — use it from “From preset / past project…” in any project` : 'Could not store the preset');
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h3>Save {b.name} as a building preset</h3>
        <p className="m">For the next project of this kind: the levels and their heights, flats placed on them, {rooms ? 'the rooms, ' : ''}the flat layouts and the room types they use, the riser lengths. Not saved: the DBs serving the rooms{links ? ` (${links} links)` : ''} and the board the riser is fed from — they belong to this project’s single-line diagram.</p>
        <label>Preset name<input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Residential tower G+10+R" /></label>
        <label>Note <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional — e.g. DEWA, 2BR/3BR mix" /></label>
        <label className="row" style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" checked={rooms} onChange={(e) => setRooms(e.target.checked)} /> Rooms on the levels</label>
        <label className="row" style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" checked={areas} onChange={(e) => setAreas(e.target.checked)} /> Plot area, GFA and built-up area typed for this building</label>
        {line && <p className="m"><b>{line.description || 'No levels'}</b> · {preview.buildings[0].levels.length} levels · {line.rooms} rooms · {line.flats} flats · {preview.unitTypes.length} layouts · {preview.roomTypes.length} room types</p>}
        {same && <p className="warn">A preset is already called “{same.name}” — saving replaces it.</p>}
        {issue && <p className="bad">{issue}</p>}
        <div className="modal-actions">
          <span className="sp" />
          <button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!!issue} onClick={save}>{same ? 'Replace preset' : 'Save preset'}</button>
        </div>
      </div>
    </div>
  );
}

type Source = { kind: 'preset'; preset: BuildingPreset } | { kind: 'project'; name: string; info: BuildingInfo };

/** Add buildings from one of your presets or from a past project, with new ids, after a review of what comes in. */
export function ReuseDialog({ project, onAdd, onClose, onStatus }: {
  project: Project; onAdd: (info: BuildingInfo, buildingIds: string[], message: string) => void; onClose: () => void; onStatus: (m: string) => void;
}) {
  const info = buildingInfoOf(project);
  const [tab, setTab] = useState<'presets' | 'project'>('presets');
  const [presets, setPresets] = useState(loadBuildingPresets);
  const [source, setSource] = useState<Source | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [rooms, setRooms] = useState(true);
  const [areas, setAreas] = useState(false);
  const [roomTypes, setRoomTypes] = useState<'keep' | 'replace'>('keep');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tab !== 'project' || projects) return;
    listProjects().then((l) => setProjects(l.filter((m) => m.id !== project.id))).catch(() => setProjects([]));
  }, [tab, projects, project.id]);

  const storePresets = (next: BuildingPreset[]) => { setPresets(next); if (!saveBuildingPresets(next)) onStatus('Could not store the presets'); };

  const openProject = async (meta?: ProjectMeta) => {
    setBusy(true);
    try {
      let p: Project | undefined, name = meta?.name ?? '';
      if (meta) p = await loadProject(meta.file);
      else {
        const r = await pickProject();
        if (!r) return;
        p = r.data ?? (r.file ? await loadProject(r.file) : undefined);
        name = p?.name ?? r.from ?? r.file ?? 'Project';
      }
      const bi = p?.building;
      if (!bi?.buildings.length) { onStatus(`${name || 'That project'} has no building information`); return; }
      setSource({ kind: 'project', name, info: bi });
      setPicked(bi.buildings.map((x) => x.id));
    } catch (e) {
      onStatus(`Could not open the project: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  const bundle: BuildingBundle | null = useMemo(() => {
    if (!source) return null;
    if (source.kind === 'preset') return rooms ? source.preset.bundle : { ...source.preset.bundle, rooms: [] };
    return picked.length ? bundleFrom(source.info, picked, { rooms, areas }) : null;
  }, [source, picked, rooms, areas]);
  const result = useMemo(() => (bundle ? mergeBundle(info, bundle, { roomTypes }) : null), [info, bundle, roomTypes]);
  const links = source?.kind === 'project' && rooms ? dbLinksOf(source.info, picked) : 0;

  const add = () => {
    if (!result) return;
    const from = source?.kind === 'preset' ? `preset "${source.preset.name}"` : `“${source?.name}”`;
    const extra = [
      result.rooms ? `${result.rooms} rooms` : '',
      result.unitTypesAdded.length ? `${result.unitTypesAdded.length} flat layouts` : '',
      result.roomTypesAdded.length ? `${result.roomTypesAdded.length} room types` : '',
      roomTypes === 'replace' && result.roomTypesDiffer.length ? `${result.roomTypesDiffer.length} room types updated` : ''
    ].filter(Boolean).join(', ');
    onAdd(result.info, result.buildingIds, `Added ${list(result.buildingNames)} from ${from}${extra ? ` — ${extra}` : ''}. Set the riser board and the DBs serving the rooms, then Generate DBs.`);
  };

  async function importFile(file: File) {
    const { added, error } = importBuildingPresets(await file.text(), presets);
    if (error) { onStatus(error); return; }
    storePresets([...presets, ...added]);
    onStatus(`Imported ${added.length} building preset${added.length === 1 ? '' : 's'}`);
  }
  async function exportAll() {
    const m = await saveText(`${safeFileName('Building presets')}.json`, exportBuildingPresets(presets), 'Building presets', 'json');
    if (m) onStatus(m);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <h3>Add a building from a preset or a past project</h3>
        {!source ? (
          <>
            <div className="seg">
              <button className={tab === 'presets' ? 'on' : ''} onClick={() => setTab('presets')}>My presets ({presets.length})</button>
              <button className={tab === 'project' ? 'on' : ''} onClick={() => setTab('project')}>Past project</button>
            </div>
            {tab === 'presets' ? (
              <>
                {!presets.length && <p className="m">No building presets yet. Open a building and choose “Save as preset…”, or import a file a colleague exported.</p>}
                <table className="bi-table">
                  <tbody>
                    {presets.map((p) => {
                      const l = bundleLines(p.bundle)[0];
                      return (
                        <tr key={p.id}>
                          <td><b>{p.name}</b>{p.note ? <div className="m">{p.note}</div> : null}</td>
                          <td className="m">{l ? `${l.description || '—'} · ${l.rooms} rooms · ${l.flats} flats` : '—'}</td>
                          <td className="m">{whenText(Date.parse(p.savedAt))}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="chip primary" onClick={() => { setSource({ kind: 'preset', preset: p }); setRooms(true); }}>Use</button>
                            <button className="icon-btn" title="Export this preset" onClick={async () => { const m = await saveText(`${safeFileName(p.name)}.json`, exportBuildingPresets([p]), 'Building preset', 'json'); if (m) onStatus(m); }}>⤓</button>
                            <button className="icon-btn" title="Delete this preset" onClick={() => window.confirm(`Delete the building preset "${p.name}"? Projects made from it keep their buildings.`) && storePresets(presets.filter((x) => x.id !== p.id))}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="bi-actions">
                  <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
                  <button className="chip" onClick={() => fileRef.current?.click()}>Import…</button>
                  <button className="chip" disabled={!presets.length} onClick={exportAll}>Export all</button>
                  <span className="m">{window.lvds ? 'Presets are kept in Library.json with your other libraries.' : 'Presets are kept in this browser — export them to keep a copy.'}</span>
                </div>
              </>
            ) : (
              <>
                <p className="m">Copy buildings — levels, flats, rooms, layouts and room types — from another project. Its DBs and boards are not copied.</p>
                {!projects ? <p className="m">Reading your projects…</p> : !projects.length ? <p className="m">No other projects in your projects folder.</p> : (
                  <table className="bi-table">
                    <tbody>
                      {projects.slice(0, 30).map((m) => (
                        <tr key={m.file}>
                          <td><b>{m.name}</b>{m.plotNo || m.area ? <div className="m">{[m.plotNo, m.area].filter(Boolean).join(' · ')}</div> : null}</td>
                          <td className="m">{whenText(m.updatedAt)}</td>
                          <td><button className="chip" disabled={busy} onClick={() => void openProject(m)}>Choose</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {window.lvds && <div className="bi-actions"><button className="chip" disabled={busy} onClick={() => void openProject()}>Open another file…</button></div>}
              </>
            )}
            <div className="modal-actions"><span className="sp" /><button className="chip" onClick={onClose}>Close</button></div>
          </>
        ) : (
          <>
            <p className="m">From {source.kind === 'preset' ? <>preset <b>{source.preset.name}</b></> : <>project <b>{source.name}</b></>} · <button className="linkish" onClick={() => setSource(null)}>choose another</button></p>
            {source.kind === 'project' ? (
              <div className="bi-actions" style={{ marginTop: 0, flexWrap: 'wrap' }}>
                {bundleLines(bundleFrom(source.info, source.info.buildings.map((x) => x.id), { rooms: true, areas: true })).map((l) => (
                  <label key={l.id} className="row" style={{ flexDirection: 'row', gap: 6 }}>
                    <input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
                    <b>{l.name}</b> <span className="m">{l.description} · {l.rooms} rooms · {l.flats} flats</span>
                  </label>
                ))}
              </div>
            ) : null}
            <div className="bi-actions" style={{ marginTop: 0, flexWrap: 'wrap' }}>
              <label className="row" style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" checked={rooms} onChange={(e) => setRooms(e.target.checked)} /> Rooms</label>
              {source.kind === 'project' && <label className="row" style={{ flexDirection: 'row', gap: 6 }}><input type="checkbox" checked={areas} onChange={(e) => setAreas(e.target.checked)} /> Plot area, GFA, BUA</label>}
            </div>
            {result ? (
              <section className="card">
                <b>What will be added</b>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {bundleLines(bundle!).map((l, i) => <li key={l.id}><b>{result.buildingNames[i]}</b> <span className="m">{l.description} · {source.kind === 'preset' || rooms ? `${l.rooms} rooms · ` : ''}{l.flats} flats</span></li>)}
                  {result.unitTypesAdded.length > 0 && <li>Flat layouts added: {list(result.unitTypesAdded)}</li>}
                  {result.unitTypesReused.length > 0 && <li className="m">Flat layouts already here, reused: {list(result.unitTypesReused)}</li>}
                  {result.roomTypesAdded.length > 0 && <li>Room types added: {list(result.roomTypesAdded)}</li>}
                  {links > 0 && <li className="m">{links} rooms were served by DBs in that project — set their DBs here.</li>}
                  <li className="m">The riser board is left blank — choose it after adding.</li>
                </ul>
                {result.roomTypesDiffer.length > 0 && (
                  <>
                    <p className="warn" style={{ marginBottom: 4 }}>{result.roomTypesDiffer.length} room types have other figures here:</p>
                    <table className="bi-table compact"><tbody>{result.roomTypesDiffer.map((d) => <tr key={d.id}><td>{d.label}</td><td className="m">this project → {source.kind === 'preset' ? 'preset' : 'that project'}: {d.diff}</td></tr>)}</tbody></table>
                    <div className="seg" style={{ marginTop: 6 }}>
                      <button className={roomTypes === 'keep' ? 'on' : ''} onClick={() => setRoomTypes('keep')}>Keep this project’s</button>
                      <button className={roomTypes === 'replace' ? 'on' : ''} onClick={() => setRoomTypes('replace')}>Use the {source.kind === 'preset' ? 'preset’s' : 'copied'}</button>
                    </div>
                  </>
                )}
              </section>
            ) : <p className="m">Tick at least one building.</p>}
            <div className="modal-actions">
              <span className="sp" />
              <button className="chip" onClick={onClose}>Cancel</button>
              <button className="chip primary" disabled={!result} onClick={add}>Add {result && result.buildingIds.length > 1 ? `${result.buildingIds.length} buildings` : 'building'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Save this project's flat layouts to your library (UnitTypes.xlsx, or this computer in the browser). */
export async function saveUnitTypesToLibrary(units: UnitType[], onStatus: (m: string) => void): Promise<void> {
  if (!units.length) { onStatus('No flat layouts to save'); return; }
  const r = libraryWith(unitTypeLibrary(), units);
  if (!r.added.length && !r.updated.length) { onStatus('Your library already has these layouts'); return; }
  const what = [r.added.length ? `add ${list(r.added)}` : '', r.updated.length ? `update ${list(r.updated)}` : ''].filter(Boolean).join(' and ');
  if (!window.confirm(`Flat layout library: ${what}?${r.updated.length ? '\n\nUpdated layouts are replaced in the library by this project’s.' : ''}`)) return;
  const libTypes = new Set(catalog().roomTypes.map((t) => t.id));
  const unknown = libTypes.size ? [...new Set(units.flatMap((u) => u.rooms.map((x) => x.type)))].filter((t) => !libTypes.has(t)) : [];
  const tail = unknown.length ? ` — room types not in your room type library: ${list(unknown)} (save the room types too)` : '';
  if (window.lvds?.database.write) {
    try { await window.lvds.database.write('unitTypes', unitTypeRows(r.list)); onStatus(`Saved ${r.added.length + r.updated.length} layouts to UnitTypes.xlsx (database) — backup in Backups/${tail}`); }
    catch (e) { onStatus(`Could not write UnitTypes.xlsx: ${(e as Error).message}`); }
  } else onStatus(saveLocalUnitTypeLibrary(r.list) ? `Saved ${r.added.length + r.updated.length} layouts to your library on this computer${tail}` : 'Could not store the library');
}

/** Pick flat layouts from your library to add to the project. */
export function UnitLibraryDialog({ info, onAdd, onClose }: { info: BuildingInfo; onAdd: (units: UnitType[], message: string) => void; onClose: () => void }) {
  const lib = useMemo(unitTypeLibrary, []);
  const here = info.unitTypes ?? [];
  const [picked, setPicked] = useState<string[]>(() => lib.filter((u) => !here.some((x) => x.name.trim().toLowerCase() === u.name.trim().toLowerCase())).map((u) => u.id));
  const chosen = lib.filter((u) => picked.includes(u.id));
  const preview = withLibraryUnits(here, chosen);
  const missing = missingRoomTypes(info, chosen);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <h3>Flat layouts from your library</h3>
        {!lib.length ? <p className="m">Your library is empty — set up the layouts in a project and choose “Save to library”, or fill UnitTypes.xlsx.</p> : (
          <table className="bi-table">
            <tbody>
              {lib.map((u) => {
                const has = here.find((x) => x.name.trim().toLowerCase() === u.name.trim().toLowerCase());
                const area = u.rooms.reduce((s, r) => s + r.areaM2, 0);
                return (
                  <tr key={u.id}>
                    <td><input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((x) => x !== u.id))} /></td>
                    <td><b>{u.name}</b> <span className="m">{u.rooms.length} room{u.rooms.length === 1 ? '' : 's'} · {Math.round(area)} m²{u.meter ? ` · ${u.meter}` : ''}</span></td>
                    <td className="m">{has ? 'in this project — replaces its rooms' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {missing.length > 0 && <p className="warn">Room types not in this project: {list(missing)} — add them under Room types (or Use my library there).</p>}
        <div className="modal-actions">
          <span className="sp" />
          <button className="chip" onClick={onClose}>Cancel</button>
          <button className="chip primary" disabled={!chosen.length} onClick={() => onAdd(preview.list, [preview.added.length ? `Added ${list(preview.added)}` : '', preview.updated.length ? `updated ${list(preview.updated)}` : ''].filter(Boolean).join(', ') || 'Layouts already up to date')}>Add {chosen.length || ''}</button>
        </div>
      </div>
    </div>
  );
}
