import { useCallback, useRef, useState } from 'react';
import type { CadDrawing } from '../model/cadDrawing';
import type { ElvSystem } from '../elv/defaults';
import type { ElvDeviceType } from '../elv/devices';

type Pt = [number, number];
export type FloorPlanTool = 'auto' | 'room' | 'trace' | 'name' | 'link' | 'tray' | 'place' | 'dist' | 'area' | 'elv-place' | 'elv-fill' | 'elv-select';
export type FloorPlanPanel = 'rooms' | 'cables' | 'trays' | 'boards' | 'elv';

/** ELV design on the plan: the system and device being placed, coverage shown, the selected device. */
export interface ElvChoice { system: ElvSystem; device: ElvDeviceType; coverage: boolean; selected: string | null }

/** The panel each tool works with. */
export const PANEL_OF: Record<FloorPlanTool, FloorPlanPanel | undefined> = {
  auto: 'rooms', room: 'rooms', trace: 'rooms', name: 'rooms', link: 'cables', tray: 'trays', place: 'boards', dist: undefined, area: undefined,
  'elv-place': 'elv', 'elv-fill': 'elv', 'elv-select': 'elv'
};

export interface OpenPlan { file: string; path?: string; drawing: CadDrawing }

const RECENT = (projectId: string | undefined) => `lvds.floorPlan.${projectId ?? 'new'}`;
/** The plan a project had open last time on this computer (its full path stays out of the project file). */
export const rememberedPlan = (projectId: string | undefined): string | undefined => { try { return localStorage.getItem(RECENT(projectId)) ?? undefined; } catch { return undefined; } };
const remember = (projectId: string | undefined, path?: string) => { try { if (path) localStorage.setItem(RECENT(projectId), path); } catch { /* not remembered */ } };

/** State of the Floor plan page, kept by the app so the plan stays open while other pages are shown. */
export function useFloorPlan(projectId: string | undefined) {
  const [plan, setPlanState] = useState<OpenPlan | null>(null);
  const [tool, setToolState] = useState<FloorPlanTool>('auto');
  const [panel, setPanel] = useState<FloorPlanPanel>('rooms');
  const [targets, setTargets] = useState<{ feeder: string; tray: string; board: string }>({ feeder: '', tray: '', board: '' });
  const [levelKey, setLevelKey] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [outlines, setOutlines] = useState<Record<string, Pt[]>>({}); // rooms picked on the plan this session → outline
  const [showLayers, setShowLayers] = useState(false);
  const [elv, setElv] = useState<ElvChoice>({ system: 'fire-alarm', device: 'smoke-detector', coverage: true, selected: null });
  const [fitKey, setFitKey] = useState(0);
  const [zoomKey, setZoomKey] = useState(0);
  /** Add found rooms (ribbon button), set by the page while it shows a plan. */
  const addFoundRef = useRef<(() => void) | null>(null);

  const setPlan = useCallback((p: OpenPlan | null) => {
    setPlanState(p);
    setOutlines({}); setSelectedRoom(null); setFitKey((k) => k + 1);
    if (p) remember(projectId, p.path);
  }, [projectId]);
  const setTool = useCallback((t: FloorPlanTool) => { setToolState(t); const p = PANEL_OF[t]; if (p) setPanel(p); setShowLayers(false); }, []);

  return {
    plan, setPlan, tool, setTool, panel, setPanel, targets, setTargets, levelKey, setLevelKey, selectedRoom, setSelectedRoom,
    outlines, setOutlines, addFoundRef, showLayers, setShowLayers, elv, setElv, fitKey, fit: () => setFitKey((k) => k + 1), zoomKey, zoom: () => setZoomKey((k) => k + 1)
  };
}

export type FloorPlanState = ReturnType<typeof useFloorPlan>;
