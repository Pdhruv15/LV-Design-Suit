import { useCallback, useRef, useState } from 'react';
import type { CadView } from '../../engines/cad/cadEngine';
import type { CadToggles } from './CadCanvas';

/** The tool working on the drawing: none (a click inspects the object under it), a measuring tool, a room tool (`room`
 * click inside, `trace` its corners, `name` pick its name), drawing a cable tray run (`tray`) or a feeder's cable route
 * (`cable`, or `link` a line of the drawing as it), placing a device (or `fill` a room with an ELV device)
 * (`dev`), modifying the selected object (`move`, `copy`, `rotate`), drawing (`line`, `pline`, `rect`, `circle`, `arc`)
 * or annotating (`text`, `dim`). */
export type CadTool = 'none' | 'dist' | 'area' | 'room' | 'trace' | 'name' | 'tray' | 'cable' | 'link' | 'dev' | 'fill' | 'move' | 'copy' | 'rotate' | 'line' | 'pline' | 'rect' | 'circle' | 'arc' | 'text' | 'dim';

/** Sample plans shipped with the app (electron/samples, made by scripts/make-sample-villa-plans.mjs), shown while no
 * drawing is open — a test aid. To remove: empty this list and delete the files and cad:sampleBytes. */
export const SAMPLE_PLANS: { file: string; label: string }[] = [
  { file: 'sample-villa-gf.dxf', label: 'Sample villa · Ground floor' },
  { file: 'sample-villa-ff.dxf', label: 'Sample villa · First floor' }
];
export const isSample = (file: string) => SAMPLE_PLANS.some((x) => x.file === file);

const RECENT = (projectId: string | undefined) => `lvds.cad.${projectId ?? 'new'}`;
/** The drawing a project had open in the CAD view last time on this computer (its path stays out of the project file). */
export const rememberedDrawing = (projectId: string | undefined): string | undefined => { try { return localStorage.getItem(RECENT(projectId)) ?? undefined; } catch { return undefined; } };
const remember = (projectId: string | undefined, path?: string) => { try { if (path) localStorage.setItem(RECENT(projectId), path); } catch { /* not remembered */ } };
const PATHS = (projectId: string | undefined) => `lvds.cad.paths.${projectId ?? 'new'}`;
const paths = (projectId: string | undefined): Record<string, string> => { try { return JSON.parse(localStorage.getItem(PATHS(projectId)) ?? '{}') as Record<string, string>; } catch { return {}; } };
/** Where a plan file of the project was opened from on this computer, to open it again from Plans. */
export const pathOfPlan = (projectId: string | undefined, file: string): string | undefined => paths(projectId)[file.toLowerCase()];
const rememberPath = (projectId: string | undefined, file: string, path?: string) => {
  try { if (path) localStorage.setItem(PATHS(projectId), JSON.stringify({ ...paths(projectId), [file.toLowerCase()]: path })); } catch { /* not remembered */ }
};

/** What the ribbon asks of the page showing the drawing; nothing while the page is not shown. */
export interface CadActions { save: () => void; saveDwg: () => void; remove: () => void; addFound: () => void; schedules: () => void; copyTo: (levelKey: string) => void }
export const NO_ACTIONS: CadActions = { save: () => {}, saveDwg: () => {}, remove: () => {}, addFound: () => {}, schedules: () => {}, copyTo: () => {} };

/** State of the CAD view, kept by the app so the drawing stays open while other pages are shown. */
export function useCad(projectId: string | undefined) {
  const [view, setViewState] = useState<CadView | null>(null);
  const [layersOn, setLayersOn] = useState<Uint8Array>(new Uint8Array());
  const [toggles, setToggles] = useState<CadToggles>({ snap: false, osnap: true, ortho: false, grid: false });
  const [fitKey, setFitKey] = useState(0);
  const [showLayers, setShowLayers] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [tool, setTool] = useState<CadTool>('none');
  // Devices: what Add device places, on which circuit / board, the device selected (the level is the plan's: cadPlans).
  const [device, setDevice] = useState('ltg');
  const [feederId, setFeederId] = useState('');
  const [boardId, setBoardId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [showDevices, setShowDevices] = useState(true);
  /** Cable tray runs: the width drawn, and the tray route (none until the engineer assigns one). */
  const [tray, setTray] = useState<{ widthMm: number; route: string }>({ widthMm: 300, route: '' });
  /** ELV coverage shown (Devices → Coverage) for the system of the ELV device chosen. */
  const [coverage, setCoverage] = useState(false);
  /** The feeder whose cable route is drawn or linked. */
  const [cableFeeder, setCableFeeder] = useState('');
  /** The Layer roles table in the side panel (File → Layer roles). */
  const [showRoles, setShowRoles] = useState(false);
  /** Save DXF, Delete, Add found rooms, Update schedules and Copy to level (ribbon), set by the page while it is shown. */
  const actions = useRef<CadActions>(NO_ACTIONS);
  /** Text being typed for the TEXT tool: where it goes (drawing units). */
  const [textAt, setTextAt] = useState<[number, number] | null>(null);

  const say = useCallback((line: string) => setHistory((h) => [...h.slice(-49), line]), []);
  const open = useCallback((v: CadView) => {
    setViewState(v);
    setLayersOn(Uint8Array.from(v.info.layers.map((l) => (l.on ? 1 : 0))));
    setFitKey((k) => k + 1);
    remember(projectId, v.path);
    rememberPath(projectId, v.file, v.path);
    say(`Command: OPEN  ${v.file} — ${v.info.format}, ${v.info.layers.length} layers${v.info.truncated ? ' (very large: part of it shown)' : ''}`);
  }, [projectId, say]);
  const setLayer = useCallback((i: number, on: boolean) => setLayersOn((l) => { const n = l.slice(); n[i] = on ? 1 : 0; return n; }), []);
  const allLayers = useCallback((on: boolean) => setLayersOn((l) => new Uint8Array(l.length).fill(on ? 1 : 0)), []);
  const toggle = useCallback((k: keyof CadToggles) => setToggles((t) => ({ ...t, [k]: !t[k] })), []);

  return { view, open, layersOn, setLayer, allLayers, toggles, toggle, fitKey, fit: () => setFitKey((k) => k + 1), showLayers, setShowLayers, history, say, tool, setTool, device, setDevice, feederId, setFeederId, boardId, setBoardId, selected, setSelected, showDevices, setShowDevices, tray, setTray, cableFeeder, setCableFeeder, coverage, setCoverage, showRoles, setShowRoles, actions, textAt, setTextAt };
}

export type CadState = ReturnType<typeof useCad>;
