import { useCallback, useRef, useState } from 'react';
import type { CadView } from '../../engines/cad/cadEngine';
import type { CadToggles } from './CadCanvas';

/** The tool working on the drawing: none (a click inspects the object under it), a measuring tool, placing a device
 * (`dev`), modifying the selected object (`move`, `copy`, `rotate`), drawing (`line`, `pline`, `rect`, `circle`, `arc`)
 * or annotating (`text`, `dim`). */
export type CadTool = 'none' | 'dist' | 'area' | 'room' | 'dev' | 'move' | 'copy' | 'rotate' | 'line' | 'pline' | 'rect' | 'circle' | 'arc' | 'text' | 'dim';

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
  /** The Layer roles table in the side panel (File → Layer roles). */
  const [showRoles, setShowRoles] = useState(false);
  /** Save DXF and Delete (ribbon), set by the page while it shows a drawing. */
  const actions = useRef<{ save: () => void; remove: () => void }>({ save: () => {}, remove: () => {} });
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

  return { view, open, layersOn, setLayer, allLayers, toggles, toggle, fitKey, fit: () => setFitKey((k) => k + 1), showLayers, setShowLayers, history, say, tool, setTool, device, setDevice, feederId, setFeederId, boardId, setBoardId, selected, setSelected, showDevices, setShowDevices, showRoles, setShowRoles, actions, textAt, setTextAt };
}

export type CadState = ReturnType<typeof useCad>;
