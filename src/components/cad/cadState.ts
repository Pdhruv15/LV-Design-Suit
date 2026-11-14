import { useCallback, useEffect, useRef, useState } from 'react';
import type { CadView } from '../../engines/cad/cadEngine';
import type { CadToggles } from './CadCanvas';
import type { ObjectProps } from '../../model/cadLayerStyle';
import type { PlanTarget } from '../../model/planTarget';

/** The tool working on the drawing: none (Select: a click inspects the object under it, Shift-click or a window picks
 * several devices or drawn objects), a measuring tool, a room tool (`room`
 * click inside, `trace` its corners, `name` pick its name), drawing a cable tray run (`tray`) or a feeder's cable route
 * (`cable`, or `link` a line of the drawing as it), placing a device (or `fill` a room with an ELV device)
 * (`dev`), wiring a circuit (`wire`, Wire one), devices along a line (`arl`) or
 * matching another (`match`), modifying the selected object (`move`, `copy`, `rotate`, `mirror`, `scale`, `stretch`), editing what was drawn (`trim`,
 * `extend`, `offset`, `fillet`, `chamfer`, `break`, `join`, `explode`, `array`), drawing (`line`, `pline`, `rect`, `circle`, `arc`)
 * or annotating (`text`, `dim`; linear `dimlin`, continued `dimcont`, baseline `dimbase`), or placing (`xattach`) or clipping (`xclip`) a reference, or cropping a block (`crop`). More drawing tools: `polygon`,
 * `ellipse`, the circle by two or three points (`circle2p`, `circle3p`) or by its diameter (`circled`), the arc by start,
 * centre and end (`arcsce`), and the revision cloud (`revcloud`). Text tools on the texts picked: `tjust` (justify
 * without moving), `th` (height on paper), `talign` (line up or space), `tcase`, `tprefix` / `tsuffix`, `torient` (readable),
 * `tcen` (centre between two points), `tcopy` (the words of another text), `tframe` (a circle, box or hexagon round them),
 * `tmask` (a paper-colour fill under them); `tcount` places or renumbers texts in sequence; `keynote` a numbered hexagon
 * with a legend line; `rtall` tags every room of the level. */
export type CadTool = 'none' | 'dist' | 'area' | 'room' | 'trace' | 'name' | 'tray' | 'cable' | 'link' | 'dev' | 'fill' | 'lux' | 'em' | 'arl' | 'match' | 'wire' | 'move' | 'copy' | 'rotate' | 'mirror' | 'scale' | 'stretch' | 'trim' | 'extend' | 'offset' | 'fillet' | 'chamfer' | 'break' | 'join' | 'explode' | 'array' | 'matchprop' | 'hatch' | 'leader' | 'rtag' | 'north' | 'line' | 'pline' | 'rect' | 'circle' | 'arc' | 'text' | 'dim' | 'xattach' | 'xclip'
  | 'polygon' | 'ellipse' | 'circle2p' | 'circle3p' | 'circled' | 'arcsce' | 'revcloud' | 'crop'
  | 'dimlin' | 'dimcont' | 'dimbase' | 'tjust' | 'th' | 'talign' | 'tcase' | 'tprefix' | 'tsuffix' | 'torient' | 'tcen' | 'tcopy' | 'rtall' | 'tframe' | 'tmask' | 'tcount' | 'keynote' | 'mtext' | 'draworder' | 'texttofront' | 'point' | 'divide' | 'measure' | 'block' | 'blockpick' | 'insert' | 'attedit' | 'attpick' | 'copybase' | 'paste'
  | 'zoom' | 'zoomwin' | 'zoomscale' | 'pan' | 'selsim' | 'dimrad' | 'dimdia' | 'dimang' | 'textedit' | 'hatchedit' | 'boundary';

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
export const rememberPath = (projectId: string | undefined, file: string, path?: string) => {
  try { if (path) localStorage.setItem(PATHS(projectId), JSON.stringify({ ...paths(projectId), [file.toLowerCase()]: path })); } catch { /* not remembered */ }
};

const SKIPPED = (projectId: string | undefined, host: string) => `lvds.cad.refsOff.${projectId ?? 'new'}.${host.toLowerCase()}`;
/** References inside a plan's drawing that were detached on this computer: not looked for again when the plan opens. */
export const skippedRefs = (projectId: string | undefined, host: string): string[] => { try { return JSON.parse(localStorage.getItem(SKIPPED(projectId, host)) ?? '[]') as string[]; } catch { return []; } };
export const skipRef = (projectId: string | undefined, host: string, name: string, off: boolean) => {
  const rest = skippedRefs(projectId, host).filter((n) => n.toLowerCase() !== name.toLowerCase());
  try { localStorage.setItem(SKIPPED(projectId, host), JSON.stringify(off ? [...rest, name] : rest)); } catch { /* not remembered */ }
};

/** What the ribbon asks of the page showing the drawing; nothing while the page is not shown. */
/** What the ribbon runs on the page; `newDrawing` opens a blank drawing (NEW); `command` runs a command as if typed on the command line (TEXTSTYLE, LAYISO…);
 * `setProps` sets the colour, linetype or lineweight of the drawn objects picked, or of new objects when none is. */
export interface CadActions { newDrawing: () => void; save: () => void; saveDwg: () => void; saveAs: () => void; exportAs: (kind: CadExport) => void; publish: () => void; settings: (tab?: DraftTab) => void; close: () => void; closeOthers: () => void; remove: () => void; addFound: () => void; schedules: () => void; copyTo: (levelKey: string) => void; wireAll: () => void; layerManager: () => void; refs: () => void; layoutCmd: (cmd: string) => void; command: (text: string) => void; reopen: () => void; setProps: (patch: ObjectProps) => void; showOnPlan: (t: PlanTarget) => void }
export const NO_ACTIONS: CadActions = { newDrawing: () => {}, save: () => {}, saveDwg: () => {}, saveAs: () => {}, exportAs: () => {}, publish: () => {}, settings: () => {}, close: () => {}, closeOthers: () => {}, remove: () => {}, addFound: () => {}, schedules: () => {}, copyTo: () => {}, wireAll: () => {}, layerManager: () => {}, refs: () => {}, layoutCmd: () => {}, command: () => {}, reopen: () => {}, setProps: () => {}, showOnPlan: () => {} };

/** File → Export: a PDF of the view or of the layout, a PNG image, the objects picked as DXF, the devices placed or the
 * cable routes' lengths as Excel. */
export type CadExport = 'pdfView' | 'pdfLayout' | 'png' | 'wblock' | 'devices' | 'cables' | 'attributes' | 'attributesCsv';
/** The tabs of the Drafting settings dialog (DS). */
export type DraftTab = 'snap' | 'polar' | 'osnap' | 'dyn' | 'select' | 'cursor' | 'units';
/** Where a drawing was last saved this session (Save writes there again): the file name and path (none for a browser
 * download), as what and in which version, and what went in. */
export interface SavedCopy { name: string; path?: string; as: 'dwg' | 'dxf'; version: string; drawn: boolean; devices: boolean; wiring: boolean; bind: boolean }

/** What the ribbon shows of the drawing on the page: its layers (colour as CSS) and the current one, and the colour,
 * linetype and lineweight of the drawn objects picked (`picked` of them; 'varies' when they differ) or of new objects. */
export interface CadRibbonInfo {
  /** The drawn layers (those new objects can go on). */
  layers: { name: string; color?: string; on: boolean; freeze: boolean; lock: boolean }[];
  current: string;
  picked: number;
  props: { [K in keyof ObjectProps]: ObjectProps[K] | 'varies' };
  /** The drawing's own blocks, for Insert's arrow (S10 of the 2D gap plan). */
  blocks: string[];
  /** The scales offered for viewports (1:n). */
  scales?: number[];
  /** The viewport the layout tools act on: locked, and whether its frame prints. */
  vp?: { locked: boolean; frame: boolean };
}

/** A drawing open in a tab (its zoom and pan stay with CadCanvas; its layers' On is kept in the project, cadLayerState). */
interface OpenDrawing { view: CadView }
/** The drawings open, a tab each, and the one showing. */
interface Tabs { open: OpenDrawing[]; shown: CadView | null }
const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
/** Above this many lines open at once (about 1 GB of engine memory) the command line suggests closing some. */
const MANY_LINES = 1_000_000;

/** State of the CAD view, kept by the app so the drawings stay open while other pages are shown. */
export function useCad(projectId: string | undefined) {
  const [tabs, setTabsState] = useState<Tabs>({ open: [], shown: null });
  // The same, as of now: what opens and closes drawings may run between renders.
  const now = useRef(tabs);
  const setTabs = useCallback((next: Tabs) => { now.current = next; setTabsState(next); }, []);
  const view = tabs.shown;
  const [toggles, setToggles] = useState<CadToggles>({ snap: false, osnap: true, ortho: false, grid: true, dyn: true, polar: false, otrack: false, lwt: true });
  // Drawings changed since they were last saved (by file name, lower case), and where each was saved this session.
  const [dirty, setDirty] = useState<ReadonlySet<string>>(() => new Set());
  const markDirty = useCallback((file: string, on = true) => setDirty((d) => {
    const k = file.toLowerCase();
    if (d.has(k) === on) return d;
    const n = new Set(d); if (on) n.add(k); else n.delete(k); return n;
  }), []);
  const isDirty = useCallback((file: string) => dirty.has(file.toLowerCase()), [dirty]);
  const saved = useRef(new Map<string, SavedCopy>());
  const [fitKey, setFitKey] = useState(0);
  const [showLayers, setShowLayers] = useState(true);
  /** The Blocks palette (INSERT), docked beside the drawing like the layer palette. */
  const [showBlocks, setShowBlocks] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [tool, setTool] = useState<CadTool>('none');
  // Devices: what Add device places, on which circuit / board, the device selected (the level is the plan's: cadPlans).
  const [device, setDevice] = useState('ltg');
  const [feederId, setFeederId] = useState('');
  const [boardId, setBoardId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [showDevices, setShowDevices] = useState(true);
  // Model or a layout (paper space): the layout's sheet id (null = Model), its viewport selected, and the viewport worked in (MS).
  const [layout, setLayoutState] = useState<string | null>(null);
  const [vpSel, setVpSel] = useState<string | null>(null);
  const [msVp, setMsVp] = useState<string | null>(null);
  const setLayout = useCallback((id: string | null) => { setLayoutState(id); setVpSel(null); setMsVp(null); }, []);
  /** Cable tray runs: the width drawn, and the tray route (none until the engineer assigns one). */
  const [tray, setTray] = useState<{ widthMm: number; service: string; route: string }>({ widthMm: 300, service: 'Power', route: '' });
  /** ELV coverage shown (Devices → Coverage) for the system of the ELV device chosen. */
  const [coverage, setCoverage] = useState(false);
  /** Circuit wiring tags shown on the plan (Wiring → Tags). */
  const [wireTags, setWireTags] = useState(true);
  /** The feeder whose cable route is drawn or linked. */
  const [cableFeeder, setCableFeeder] = useState('');
  /** The Layer roles table in the side panel (File → Layer roles). */
  const [showRoles, setShowRoles] = useState(false);
  /** Save DXF, Delete, Add found rooms, Update schedules and Copy to level (ribbon), set by the page while it is shown. */
  const actions = useRef<CadActions>(NO_ACTIONS);
  /** Text being typed for the TEXT tool: where it goes (drawing units). */
  const [textAt, setTextAt] = useState<[number, number] | null>(null);
  // A text placed at the next click as it is (a title block field from the Properties palette): its words, height and layer.
  const [textPreset, setTextPreset] = useState<{ text: string; h: number; layer: string } | null>(null);

  const say = useCallback((line: string) => setHistory((h) => [...h.slice(-49), line]), []);
  // Each open drawing keeps its own engine; closing it gives back that memory.
  useEffect(() => () => { for (const d of now.current.open) d.view.close(); now.current = { open: [], shown: null }; }, []);
  /** A drawing has been open, or the sample villa offered, since the app started: it does not come back by itself. */
  const sampleDone = useRef(false);
  const changeTabs = useCallback((next: Tabs) => {
    if (next.shown !== now.current.shown) { setSelected(null); setTextAt(null); setTextPreset(null); }
    setTabs(next);
    if (next.shown) remember(projectId, next.shown.path);
  }, [projectId, setTabs]);
  /** Shows the tab of an open drawing, as it was left. */
  const show = useCallback((v: CadView) => {
    if (now.current.open.some((d) => d.view === v)) changeTabs({ ...now.current, shown: v });
  }, [changeTabs]);
  /** The open drawing of a file, by name as the project keeps its plans. */
  const tabOf = useCallback((file: string) => now.current.open.find((d) => sameFile(d.view.file, file))?.view, []);
  /** Opens a drawing in a new tab; `replaces` (the plan it takes over from) gives up its tab. */
  const open = useCallback((v: CadView, replaces?: CadView) => {
    sampleDone.current = true;
    const list = now.current.open;
    if (list.some((d) => d.view === v)) { show(v); return; }
    const same = list.find((d) => sameFile(d.view.file, v.file));
    // Opened again and unchanged: its tab as it was left, and the copy just read gives back its memory.
    if (same && same.view.path === v.path && sameBytes(same.view.bytes, v.bytes)) {
      v.close();
      show(same.view);
      say(`${same.view.file} is already open`);
      return;
    }
    // A file of the same name (changed, or from another folder) takes over its tab.
    const gone = list.filter((d) => d === same || d.view === replaces);
    for (const d of gone) d.view.close();
    const next = list.filter((d) => !gone.includes(d));
    next.splice(gone.length ? list.indexOf(gone[0]) : next.length, 0, { view: v });
    changeTabs({ open: next, shown: v });
    setFitKey((k) => k + 1);
    rememberPath(projectId, v.file, v.path);
    say(`Command: OPEN  ${v.file} — ${v.info.format}, ${v.info.layers.length} layers${v.info.truncated ? ' (very large: part of it shown)' : ''}`);
    const lines = next.reduce((n, d) => n + d.view.info.segments, 0);
    if (next.length > 1 && lines > MANY_LINES) say(`${next.length} drawings open use about ${(lines / MANY_LINES).toFixed(1)} GB of memory. Close the ones you do not need (CLOSE).`);
  }, [projectId, say, show, changeTabs]);
  /** Closes drawings (all of them when none are named), giving back their memory: the tab to the right shows next, else
   * the last one. What was drawn stays in the project, by file name. Returns what was done, for the status line. */
  const close = useCallback((views?: CadView[]) => {
    const { open: list, shown } = now.current;
    const going = list.filter((d) => !views || views.includes(d.view));
    if (!going.length) return undefined;
    const left = list.filter((d) => !going.includes(d));
    const after = list.slice(list.findIndex((d) => d.view === shown) + 1).find((d) => left.includes(d));
    const nextShown = left.some((d) => d.view === shown) ? shown : (after ?? left[left.length - 1])?.view ?? null;
    for (const d of going) { d.view.close(); markDirty(d.view.file, false); }
    changeTabs({ open: left, shown: nextShown });
    const done = `${going.length === 1 ? going[0].view.file : `${going.length} drawings`} closed. What you drew stays in the project.`;
    say(done);
    return done;
  }, [say, changeTabs, markDirty]);
  /** Another project has been opened: the drawings open are the last one's plans, so none stays. The same project
   * opened again (its version on disk, recovered work) keeps them. */
  const projectOpened = useCallback((id: string | undefined) => { if (id !== projectId) close(); }, [projectId, close]);
  // ORTHO and POLAR turn each other off, as they ask for different directions.
  const toggle = useCallback((k: keyof CadToggles) => setToggles((t) => ({ ...t, [k]: !t[k], ...(k === 'ortho' && !t.ortho ? { polar: false } : k === 'polar' && !t.polar ? { ortho: false } : {}) })), []);
  // The properties palette shown (Ctrl+1), and the taller command history (F2) or the command list (F1).
  const [showProps, setShowProps] = useState(true);
  const [log, setLog] = useState<'history' | 'help' | null>(null);
  // What the ribbon asked of the page while another page was shown: it runs once the page is there (it loads lazily).
  const pending = useRef<((a: CadActions) => void) | null>(null);
  // The layers and properties the ribbon shows, as the page last had them (null with no drawing).
  const [ribbonInfo, setRibbonInfo] = useState<CadRibbonInfo | null>(null);
  // GRID (F7) steps lines → dots → off, like the SLD's grid.
  const [gridDots, setGridDots] = useState(false);
  const cycleGrid = () => {
    if (!toggles.grid) { setToggles((t) => ({ ...t, grid: true })); setGridDots(false); }
    else if (!gridDots) setGridDots(true);
    else { setToggles((t) => ({ ...t, grid: false })); setGridDots(false); }
  };

  return { view, drawings: tabs.open.map((d) => d.view), open, show, close, markDirty, isDirty, dirty, saved, setGridDots, setToggles, tabOf, projectOpened, sampleDone, toggles, toggle, gridDots, textPreset, setTextPreset, cycleGrid, fitKey, fit: () => setFitKey((k) => k + 1), showLayers, setShowLayers, showBlocks, setShowBlocks, history, say, tool, setTool, device, setDevice, feederId, setFeederId, boardId, setBoardId, selected, setSelected, showDevices, setShowDevices, tray, setTray, cableFeeder, setCableFeeder, wireTags, setWireTags, coverage, setCoverage, showRoles, setShowRoles, actions, pending, ribbonInfo, setRibbonInfo, showProps, setShowProps, log, setLog, textAt, setTextAt, layout, setLayout, vpSel, setVpSel, msVp, setMsVp };
}

export type CadState = ReturnType<typeof useCad>;
