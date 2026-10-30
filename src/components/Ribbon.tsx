import { AddBoardIcon, BoardPropsIcon, TxGenSizingIcon } from './icons/elecIcons';
import { useEffect, useRef, useState } from 'react';
import {
  BatteryCharging, Building2, Cable, ClipboardCheck, MessageSquareWarning, Inbox, CircuitBoard, Ellipsis, FileDown, FileSignature, FileSpreadsheet, FileText, GitPullRequestArrow, Send, Stamp,
  Gauge, Hand, LayoutGrid, ListTree, MousePointer2, Pencil, Receipt, Scale, Settings2, ShieldCheck, Sun,
  ChevronDown, ChevronUp, Waypoints, Lock, CircleArrowRight, MessageCircleQuestion, Route, Database, BookOpen, GitCompare, History, Percent, BadgePercent, Play, AlignVerticalSpaceAround, LayoutDashboard, LifeBuoy, Braces, PanelBottom, Files, FilePlus2, FolderOpen, Save, SaveAll, UserRound, FolderCog, Clock, Network, House, Redo2, Rows3, Table2, Trash2, TrendingDown, Undo2, Zap, type LucideIcon, BatteryFull, Box, ChartColumnBig, Cctv } from 'lucide-react';
import { PenTool, CirclePlus, Move, Slash, Spline, RectangleHorizontal, Circle, Rainbow, RotateCw, Eraser, MoveHorizontal, Layers, MousePointerClick, PenLine, Type, Ruler, Square, Maximize, Grid3x3, Copy, CircleDashed, ListChecks, Palette, ZoomIn, ZoomOut, Columns2, FileCode, BookImage, ALargeSmall, Plug, Tags, Workflow } from 'lucide-react';
import type { CadTool } from './cad/cadState';
import type { BoardKind, Feeder } from '../types';
import type { MainView } from '../views';
import type { DrawingsTab } from './docs/DrawingsView';
import type { DrawingSheet } from '../model/drawingSet';
import { markupSize, type MarkupColor, type SheetMarkup } from '../model/sheetMarkup';
import { ALL_TOOLS, MARKUP_SIZES } from './sld/markupTools';
import type { SheetUi } from './sld/sheetUi';
import { STAGE_INFO, type DesignStage, type TenderRoute } from '../model/designStage';

export type BomCommand = 'boq' | 'scope' | 'changes' | 'variations' | 'circuits' | 'excel' | 'pdf' | 'summary-pdf' | 'rates-sheet' | 'import' | 'save-list' | 'add-item' | 'add-section' | 'extras' | 'wastage' | 'markup' | 'document' | 'issue-rev';
export type RibbonTab = 'home' | 'concept' | 'schematic' | 'detailed' | 'cad' | 'reports' | 'issue' | 'cost' | 'standards';

export type DiagramTool = 'select' | 'pan';

type Icon = LucideIcon | ((p: { size?: number; strokeWidth?: number }) => JSX.Element);

interface Tool {
  label: string;
  icon: Icon;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Highlight: something needs this (e.g. Run with out-of-date results). */
  stale?: boolean;
  /** Opens a page (lighter highlight when it's the page shown); tools such
   * as Select / Pan get the solid highlight. */
  page?: boolean;
  /** Small second line under the label (e.g. the board it acts on). */
  sub?: string;
  /** Split button: the arrow part offers these; `sep` draws a line above an item. */
  menu?: { label: string; title: string; onClick: () => void; sep?: boolean }[];
}

export interface RibbonActions {
  view: MainView;
  onView: (v: MainView) => void;
  /** Design CAD → Sheets: the register tab shown when no sheet is open, and choosing one; with a sheet open, its tools
   * (shared with the sheet), its kind, the markup selected, what Publish would issue, and the symbol legend. */
  sheets?: {
    tab: DrawingsTab; open: boolean; onTab: (t: DrawingsTab) => void;
    ui?: SheetUi; kind?: DrawingSheet['kind']; selected?: SheetMarkup;
    publish?: { label: string; title: string; changed: boolean };
    legend?: { on: boolean; shown: boolean }; onLegend?: () => void;
  };
  tool: DiagramTool;
  onTool: (t: DiagramTool) => void;
  boardId: string;
  selectedFeederId: string | null;
  /** What Edit / Delete / Properties act on. */
  selection: { kind: 'board' | 'feeder'; id: string } | null;
  onAddFeeder: (preset: Partial<Feeder>) => void;
  /** Add a board; with a kind and rating, the form starts with them. */
  onAddBoard: (preset?: { kind: BoardKind; ratingA: number }) => void;
  onBoardProperties: () => void;
  onEditSelected: () => void;
  onDeleteSelected: () => void;
  onExportDss: () => void;
  onSettings: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onRun: () => void;
  staleCount: number;
  // Home: projects
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** Export anonymized sample (a copy without client, site or people, for sharing an issue). */
  onAnonymizedSample: () => void;
  /** Design CAD's tools (src/components/cad); `file`: the File group's Plans, Level and Units (cadFileMenu.ts). */
  cad?: {
    tool: CadTool; onTool: (t: CadTool) => void; onOpen: () => void; onSave: () => void; onSaveDwg: () => void; onDelete: () => void; hasSelection: boolean; onFit: () => void; onLayers: () => void; layersOn: boolean; hasDrawing: boolean;
    file: { plans: Tool['menu']; plansSub?: string; level: string; levelTitle: string; levels: Tool['menu']; unit: string; unitTitle: string; units: Tool['menu'] };
    onRoles: () => void; rolesOn: boolean; onAddFound: () => void; onSchedules: () => void; onPlaceBoard: () => void; placingBoard: boolean;
    onCoverage: () => void; coverageOn: boolean; copyLevels: Tool['menu'];
    onWireAll: () => void; onTags: () => void; tagsOn: boolean;
  };
  onProfile: () => void;
  onChooseFolder: () => void;
  folderLabel: string;
  dirty: boolean;
  recent: { file: string; name: string; when: string }[];
  currentFile?: string;
  onOpenRecent: (file: string) => void;
  dbIssues: number;
  /** Packages from other programs waiting in the inbox. */
  inboxCount: number;
  /** BOM / Cost tab: a command for the bill of quantities page. */
  onBom: (cmd: BomCommand) => void;
  hasPriceList: boolean;
  /** Design stage the project is in, and the stage gate (issue this stage's package, move to the next). */
  stage: DesignStage;
  nextStage?: DesignStage;
  ifcIssued: boolean;
  onAdvanceStage: () => void;
  route: TenderRoute;
  onRoute: (r: TenderRoute) => void;
  /** Concept design report (one A4 page, PDF). */
  onConceptReport: () => void;
}

/** Design CAD's sub-tabs: Plan (engineering) and Draw (drafting) over the same floor plan, and Sheets (every
 * submission sheet), as groups of the cad tab (File · Rooms · Cables and boards · Draw · Modify · Annotate · Measure ·
 * Devices · View · Sheets … · Wiring). Sheets is its own page (the drawings view). */
export type CadSub = 'plan' | 'draw' | 'sheets';
export const CAD_SUB: Record<CadSub, { label: string; groups: number[] }> = {
  plan: { label: 'Plan', groups: [0, 1, 2, 7, 15, 6, 8] },
  draw: { label: 'Draw', groups: [0, 3, 4, 5, 8] },
  sheets: { label: 'Sheets', groups: [9, 10, 11, 12, 13, 14] }
};
const SHEET_VIEWS: MainView[] = ['drawings', 'drawing-register'];
/** The sub-tab a tool is on, so the ribbon shows the tool in use. */
const SUB_OF: Partial<Record<CadTool, CadSub>> = {
  line: 'draw', pline: 'draw', rect: 'draw', circle: 'draw', arc: 'draw', text: 'draw', dim: 'draw', rotate: 'draw',
  room: 'plan', trace: 'plan', name: 'plan', tray: 'plan', cable: 'plan', link: 'plan', dev: 'plan', fill: 'plan', wire: 'plan', dist: 'plan', area: 'plan'
};

/** Group captions under the ribbon groups (same order as the groups). */
export const CAPTIONS: Record<RibbonTab, string[]> = {
  home: ['Project', 'Diagram & history', 'Setup'],
  concept: ['Load', 'Supply', 'Stage'],
  schematic: ['History', 'Distribution', 'Main systems', 'ELV', 'Stage'],
  detailed: ['Run', 'Canvas', 'Boards', 'Equipment', 'Selection', 'Calculate', 'Stage'],
  cad: ['File', 'Rooms', 'Cables and boards', 'Draw', 'Modify', 'Annotate', 'Measure', 'Devices', 'View', 'Sheets', 'Markup', 'On panels', 'Style', 'View', 'Issue and export', 'Wiring'],
  reports: ['Schedules', 'Drawings and reports'],
  issue: ['Tender', 'Track', 'Send', 'IFC'],
  cost: ['Bill', 'Add to the bill', 'Rates', 'Issue and export'],
  standards: ['Project data']
};

const ADD_BOARD: { kind: BoardKind; ratingA: number }[] = [
  { kind: 'DB', ratingA: 63 }, { kind: 'EDB', ratingA: 63 }, { kind: 'SMDB', ratingA: 250 },
  { kind: 'MCC', ratingA: 400 }, { kind: 'EMCC', ratingA: 400 }, { kind: 'EMDB', ratingA: 400 }
];

/** Tabs in the order the design is done: concept → schematic → detailed design → documents → tender and IFC. */
const TABS: { id: RibbonTab; label: string; icon: Icon; step?: string; stages?: DesignStage[] }[] = [
  { id: 'home', label: 'Project', icon: House },
  { id: 'cad', label: 'Design CAD', icon: PenTool },
  { id: 'concept', label: 'Concept', icon: ChartColumnBig, step: '1', stages: ['concept'] },
  { id: 'schematic', label: 'Schematic', icon: Waypoints, step: '2', stages: ['schematic'] },
  { id: 'detailed', label: 'Detailed design', icon: CircuitBoard, step: '3', stages: ['detailed'] },
  { id: 'reports', label: 'Documents', icon: FileText },
  { id: 'issue', label: 'Tender and IFC', icon: Stamp, step: '4', stages: ['tender', 'ifc'] },
  { id: 'cost', label: 'BOM / Cost', icon: Receipt },
  { id: 'standards', label: 'Standards', icon: Settings2 }
];

/** The ribbon tab a project in this stage opens on. */
export const tabForStage = (s: DesignStage): RibbonTab => TABS.find((t) => t.stages?.includes(s))!.id;

/** Screens on each tab. A screen on several tabs (the SLD on Schematic and Detailed design) keeps the tab you are on. */
const TAB_VIEWS: Record<RibbonTab, MainView[]> = {
  home: ['projects', 'dashboard', 'help', 'parameters', 'titleblock', 'building', 'design'],
  concept: ['building', 'load-assessment', 'sizing', 'substation-area', 'space-planning', 'dashboard'],
  schematic: ['panels', 'design', 'busbar', 'pfc', 'ups', 'solar', 'earth-schematic', 'elv', 'inbox'],
  detailed: ['design', 'panels', 'load-schedule', 'enclosure', 'selection', 'voltage-drop', 'earthing', 'coordination', 'engines', 'calculators'],
  cad: ['cad', 'drawings', 'drawing-register'],
  reports: ['load-schedule', 'cable-schedule', 'cable-tray', 'equipment', 'study-reports', 'report', 'export-centre'],
  issue: ['revisions', 'modifications', 'review', 'received-docs', 'submissions'],
  cost: ['boq'],
  standards: ['database', 'design-references']
};
const HOME_TAB: Partial<Record<MainView, RibbonTab>> = { building: 'concept', dashboard: 'home', design: 'detailed', panels: 'detailed', 'load-schedule': 'detailed' };

/** The page a tab shows when it is chosen and the page on screen is not one of its own. */
const TAB_PAGE: Record<RibbonTab, MainView> = {
  home: 'dashboard', concept: 'building', schematic: 'design', detailed: 'design', cad: 'cad',
  reports: 'load-schedule', issue: 'revisions', cost: 'boq', standards: 'database'
};
/** The page to show when a tab is chosen: the page on screen when it is on that tab (the SLD stays on Schematic and
 * Detailed design), else the tab's own page — Design CAD shows the drawing, Floor plan the plan. */
export const viewForTab = (t: RibbonTab, current: MainView): MainView => (TAB_VIEWS[t].includes(current) ? current : TAB_PAGE[t]);

/** The ribbon tab that owns a screen, so the ribbon follows navigation
 * (the current tab is kept when the screen is on it too). */
export function tabForView(v: MainView, current?: RibbonTab): RibbonTab {
  if (current && TAB_VIEWS[current].includes(v)) return current;
  return HOME_TAB[v] ?? (Object.keys(TAB_VIEWS) as RibbonTab[]).find((t) => TAB_VIEWS[t].includes(v)) ?? 'reports';
}

export default function Ribbon({ tab, onTab, a }: { tab: RibbonTab; onTab: (t: RibbonTab) => void; a: RibbonActions }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState(0);
  const [splitOpen, setSplitOpen] = useState<string | null>(null);
  const [cadSub, setCadSub] = useState<CadSub>('plan');
  // Sheets is a page of its own: shown whenever a sheets page is on screen, else Plan or Draw as last chosen.
  const sub: CadSub = SHEET_VIEWS.includes(a.view) ? 'sheets' : cadSub === 'sheets' ? 'plan' : cadSub;
  const cadToolNow = a.cad?.tool;
  useEffect(() => { const s = cadToolNow && SUB_OF[cadToolNow]; if (s) setCadSub(s); }, [cadToolNow]);
  const [splitAt, setSplitAt] = useState({ x: 0, y: 0 });
  // Collapsed: only the tabs show; a tab click drops its tools over the page until a tool is used or you click elsewhere.
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('lvds.ribbonCollapsed') === '1'; } catch { return false; } });
  const [peek, setPeek] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleCollapsed = () => setCollapsed((c) => { try { localStorage.setItem('lvds.ribbonCollapsed', c ? '0' : '1'); } catch { /* ignore */ } setPeek(false); return !c; });
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'F1' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); toggleCollapsed(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!peek) return;
    const away = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setPeek(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPeek(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [peek]);
  useEffect(() => {
    if (!splitOpen) return;
    const close = () => setSplitOpen(null);
    window.addEventListener('mousedown', close);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [splitOpen]);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => !moreRef.current?.contains(e.target as Node) && setMoreOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [moreOpen]);

  const go = (v: MainView) => () => a.onView(v);
  const addTo = `to ${a.boardId}`;
  const view = (v: MainView, label: string, icon: Icon, title: string): Tool => ({ label, icon, title, onClick: go(v), active: a.view === v, page: true });
  const cadTool = (t: CadTool, label: string, icon: Icon, title: string): Tool => ({ label, icon, title, onClick: () => a.cad?.onTool(t), active: a.cad?.tool === t, disabled: !a.cad?.hasDrawing });
  // The open sheet's tools (Design CAD → Sheets); greyed while no sheet is open.
  const sh = a.sheets, ui = sh?.ui, onSheet = !!sh?.open && !!ui && SHEET_VIEWS.includes(a.view), act = () => ui!.actions.current;
  const noSheet = 'Open a sheet first';
  const markTool = (id: string): Tool => {
    const t = ALL_TOOLS.find((x) => x.tool === id)!, panelOnly = t.tool === 'pcloud' || t.tool === 'parrow';
    return { label: t.label, icon: t.icon, title: !onSheet ? noSheet : panelOnly && sh?.kind !== 'system' ? 'On system SLD sheets' : `${t.label} (${t.key}): ${t.hint}`,
      onClick: () => { ui?.setTool(t.tool); if (t.tool !== 'select') ui?.setSelId(null); }, active: onSheet && ui?.tool === t.tool, disabled: !onSheet || (panelOnly && sh?.kind !== 'system') };
  };
  const colour: MarkupColor = sh?.selected?.color ?? ui?.color ?? 'black';
  const setColour = (c: MarkupColor) => act().restyle({ color: c });
  const COLOURS: MarkupColor[] = ['black', 'red', 'blue'];
  const named = (c: string) => c[0].toUpperCase() + c.slice(1);
  const textual = ui?.tool === 'text' || ui?.tool === 'callout' || sh?.selected?.kind === 'text' || sh?.selected?.kind === 'callout';
  const height = sh?.selected && (sh.selected.kind === 'text' || sh.selected.kind === 'callout') ? markupSize(sh.selected) : ui?.size ?? 3.5;
  const sel = a.selection;
  const selName = sel ? `${sel.kind === 'board' ? 'board' : 'feeder'} ${sel.id}` : '';
  const boardMenu = [
    ...ADD_BOARD.map((x) => ({ label: `${x.kind} · ${x.ratingA} A`, title: `Add a ${x.kind} rated ${x.ratingA} A fed from ${a.boardId || 'the selected board'}`, onClick: () => a.onAddBoard(x) })),
    { label: 'Build hierarchy…', title: 'Panels: create by count (levels later), edit levels and connections in one list, rename by level; typical floors, repeat group, templates', onClick: go('panels'), sep: true }
  ];
  /** The stage gate of a stage: issues its package and moves on; only the stage the project is in can be issued. */
  const gate = (s: DesignStage): Tool => {
    const here = a.stage === s, done = s === 'ifc' ? a.ifcIssued : false;
    const info = STAGE_INFO[s], next = a.nextStage && STAGE_INFO[a.nextStage].label;
    return {
      label: s === 'ifc' ? 'Issue IFC' : s === 'tender' ? 'Issue for tender' : `Issue ${info.short.toLowerCase()}`,
      icon: s === 'ifc' ? Lock : CircleArrowRight,
      sub: here ? (s === 'ifc' ? (done ? 'issued' : 'final') : next ? `→ ${next}` : undefined) : undefined,
      title: !here ? `The project is at ${STAGE_INFO[a.stage].label}; this gate is for ${info.label}` : s === 'ifc'
        ? 'Issue the IFC package: records a revision, makes it the baseline and freezes it — later changes show as changes after IFC'
        : `Issue the ${info.label.toLowerCase()} package: records a revision (${info.sheetStatus}), makes it the baseline and moves to ${next}`,
      onClick: a.onAdvanceStage, disabled: !here, stale: here && !done
    };
  };

  const groups: Record<RibbonTab, Tool[][]> = {
    home: [
      [
        { label: 'New', icon: FilePlus2, title: 'New project', onClick: a.onNew },
        view('projects', 'Open', FolderOpen, 'All projects: open, duplicate, status'),
        { label: 'Save', icon: Save, sub: a.dirty ? 'unsaved' : undefined, title: a.dirty ? 'Save (Ctrl+S / ⌘S) — there are unsaved changes' : 'Save (Ctrl+S / ⌘S)', onClick: a.onSave, stale: a.dirty },
        { label: 'Save as', icon: SaveAll, title: 'Save as a new project (Ctrl+Shift+S / ⇧⌘S)', onClick: a.onSaveAs },
        { label: 'Share sample', icon: ShieldCheck, title: 'Export anonymized sample: a copy without the client, site or people, to share a technical issue', onClick: a.onAnonymizedSample }
      ],
      [
        { label: 'SLD', icon: Network, title: 'Single line diagram', onClick: go('design'), active: a.view === 'design' },
        { label: 'Run', icon: Play, title: a.staleCount ? `Run calculations (F5) — ${a.staleCount} out of date` : 'Run calculations (F5) — up to date', onClick: a.onRun, stale: a.staleCount > 0 },
        { label: 'Undo', icon: Undo2, title: 'Undo (⌘Z / Ctrl+Z)', onClick: a.onUndo, disabled: !a.canUndo },
        { label: 'Redo', icon: Redo2, title: 'Redo (⇧⌘Z / Ctrl+Y)', onClick: a.onRedo, disabled: !a.canRedo }
      ],
      [
        view('dashboard', 'Overview', LayoutDashboard, 'Overview of this project: next actions, key figures and what is outstanding — load, transformers, generators, panels, area, power density, checks'),
        view('building', 'Building', Building2, 'Building information: GFA, levels, typical floors, rooms and room types'),
        view('cad', 'Design CAD', PenTool, 'Design CAD: the architect\'s DWG / DXF of each level — rooms and areas, devices, cable trays and routes, lengths for the schedules'),
        { label: 'Project settings', icon: Scale, title: 'Voltage, ambient, voltage-drop limit, sizing targets, submission form details', onClick: a.onSettings },
        view('parameters', 'Parameters', Braces, '{Parameters}: designed / checked by, submission date, your own values — used in title blocks, notes and labels'),
        view('titleblock', 'Title block', PanelBottom, 'Design your own title blocks with logo, text and {Parameters}'),
        { label: 'Profile', icon: UserRound, title: 'Your name, designation, company, logo and new-project defaults', onClick: a.onProfile },
        view('help', 'Help', LifeBuoy, 'How to use the app: the workflow start to finish, quick paths for one job, and a start-here checklist'),
        { label: a.folderLabel, icon: FolderCog, title: 'Where projects are saved (e.g. a Google Drive folder)', onClick: a.onChooseFolder }
      ]
    ],
    concept: [
      [
        view('building', 'Building', Building2, 'Building information: GFA, levels, typical floors, rooms and room types'),
        view('cad', 'Design CAD', PenTool, 'Design CAD: the architect\'s DWG / DXF of each level — rooms and areas, devices, cable trays and routes, lengths for the schedules'),
        view('load-assessment', 'Load assessment', ChartColumnBig, 'Load assessment: maximum demand, transformers and generator from the building type, area schedule and services')
      ],
      [
        view('sizing', 'Tx & Gen sizing', TxGenSizingIcon, 'Transformer and generator sizing: size list, duty / standby, generator boards and motor start'),
        view('substation-area', 'Substation area', Building2, 'Minimum substation, RMU and LV room areas (Dubai Municipality DM-D-013)'),
        view('space-planning', 'Space plan', LayoutGrid, 'Space planning: areas → panels → transformers → RMUs')
      ],
      [view('dashboard', 'Overview', LayoutDashboard, 'Overview: the stage checklist, key figures and what is outstanding'), { label: 'Concept report', icon: FileText, title: 'Concept design report (PDF, one A4 page): building, area schedule, maximum demand, supply and room areas', onClick: a.onConceptReport }, gate('concept')]
    ],
    schematic: [
      [
        { label: 'Run', icon: Play, title: a.staleCount ? `Run calculations (F5) — ${a.staleCount} out of date` : 'Run calculations (F5) — up to date', onClick: a.onRun, stale: a.staleCount > 0 },
        { label: 'Undo', icon: Undo2, title: 'Undo (⌘Z / Ctrl+Z)', onClick: a.onUndo, disabled: !a.canUndo },
        { label: 'Redo', icon: Redo2, title: 'Redo (⇧⌘Z / Ctrl+Y)', onClick: a.onRedo, disabled: !a.canRedo }
      ],
      [
        { label: 'Boards', icon: AddBoardIcon, title: `Add a board fed from ${a.boardId || 'an existing board'} — the arrow beside it for an SMDB, MCC or EMDB with its usual rating, or Build hierarchy to create many at once`, onClick: () => a.onAddBoard(), page: true, menu: boardMenu },
        view('panels', 'Build hierarchy', ListTree, 'Panels: create by count, edit levels and connections in one list, rename by level; typical floors, repeat group, templates'),
        view('design', 'SLD', Network, 'Single line diagram — main boards and risers at this stage'),
        view('drawings', 'Sheets', Files, 'The submission sheets of this design in Design CAD → Sheets: SLDs, risers and earthing, with title blocks, clouds and notes'),
        view('busbar', 'Busbar riser', AlignVerticalSpaceAround, 'Busbar trunking risers for high-rise buildings: rating (Cu / Al), area, voltage drop per floor, size and weight')
      ],
      [
        view('pfc', 'Power factor', BatteryCharging, 'Power factor correction: capacitor banks from the maximum demand'),
        view('ups', 'UPS & battery', BatteryFull, 'UPS rating and battery sizing for the backup time'),
        view('solar', 'Solar PV', Sun, 'Solar PV array, string design, inverters and yield'),
        view('earth-schematic', 'Earth pits', Network, 'Earthing schematic: earth pits of the RMUs, transformers and main boards, and how they are linked')
      ],
      [
        view('elv', 'ELV systems', Cctv, 'ELV estimate from the rooms of Building: fire alarm, CCTV, access control, ICT and public address — devices, supplies and the kW each LV circuit feeds'),
        { ...view('inbox', 'Inbox', Inbox, a.inboxCount ? `Packages from other programs to review — ${a.inboxCount} waiting` : 'Packages from other programs (CAD, IFC, ELV): review and accept before they change the project'), sub: a.inboxCount ? `${a.inboxCount} to review` : undefined, stale: a.inboxCount > 0 }
      ],
      [gate('schematic')]
    ],
    detailed: [
      [{ label: 'Run', icon: Play, title: a.staleCount ? `Run calculations (F5) — ${a.staleCount} out of date` : 'Run calculations (F5) — up to date', onClick: a.onRun, stale: a.staleCount > 0 }],
      [
        { label: 'SLD', icon: Network, title: 'Single line diagram', onClick: go('design'), active: a.view === 'design', page: true },
        view('drawings', 'Sheets', Files, 'The submission sheets of this design in Design CAD → Sheets: SLDs, risers and earthing, with title blocks, clouds and notes'),
        { label: 'Select', icon: MousePointer2, title: 'Select tool — click boards and loads to select them (V)', onClick: () => { a.onView('design'); a.onTool('select'); }, active: a.view === 'design' && a.tool === 'select' },
        { label: 'Pan', icon: Hand, title: 'Pan tool — drag to move around the diagram without selecting (H)', onClick: () => { a.onView('design'); a.onTool('pan'); }, active: a.view === 'design' && a.tool === 'pan' }
      ],
      [
        { label: 'Boards', icon: AddBoardIcon, title: `Add a board fed from ${a.boardId || 'an existing board'} — the arrow beside it for a DB, SMDB, MCC or EMDB with its usual rating, or Build hierarchy to create many at once`, onClick: () => a.onAddBoard(), active: a.view === 'panels', page: true, menu: boardMenu },
        { label: 'Board', icon: BoardPropsIcon, sub: a.boardId || undefined, title: a.boardId ? `Properties of ${a.boardId}: general, supply (its transformer and feed chain), electrical, protection, location` : 'Board properties — select a board first', onClick: a.onBoardProperties, disabled: !a.boardId },
        { label: 'Schedule', icon: Table2, title: `Load distribution schedule of ${a.boardId}: circuits, spare ways, R / Y / B balance`, onClick: go('load-schedule'), active: a.view === 'load-schedule', page: true },
        { label: 'Enclosure', icon: Box, title: 'Enclosure sizing: the board\'s physical space (modules) from a supplier catalogue — candidates, dimensioned preview', onClick: go('enclosure'), active: a.view === 'enclosure', page: true }
      ],
      [
        { label: 'Add load', icon: Zap, title: `Add a load ${addTo} — the arrow beside it for a motor, solar PV, EV charger or a feeder cable`, onClick: () => a.onAddFeeder({ loadType: 'general' }),
          menu: [
            { label: 'Load', title: `Add a load ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'general' }) },
            { label: 'Motor', title: `Add a motor ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'motor', powerFactor: 0.86, demandFactor: 1 }) },
            { label: 'Solar PV', title: `Add solar PV / generation ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'pv', generation: true, powerFactor: 1, demandFactor: 1 }) },
            { label: 'EV charger', title: `Add EV charging ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'ev', powerFactor: 0.98 }) },
            { label: 'Feeder cable', title: `Add a feeder cable ${addTo}`, onClick: () => a.onAddFeeder({}), sep: true }
          ] }
      ],
      [
        { label: 'Edit', icon: Pencil, title: sel ? `Edit ${selName}` : 'Select a board or feeder first', onClick: a.onEditSelected, disabled: !sel },
        { label: 'Delete', icon: Trash2, title: sel ? `Delete ${selName}${sel.kind === 'board' ? ' and everything fed from it' : ''} (Delete key)` : 'Select a board or feeder first', onClick: a.onDeleteSelected, disabled: !sel }
      ],
      [
        view('selection', 'Selection', ListTree, 'Breaker and cable selection'),
        view('voltage-drop', 'Voltage drop', TrendingDown, 'Voltage drop calculation: panels and equipment cables, with report'),
        view('earthing', 'Earthing', Gauge, 'Fault loop impedance and disconnection time'),
        view('coordination', 'Protection', ShieldCheck, 'Protection coordination and selectivity')
      ],
      [gate('detailed')]
    ],
    cad: [
      [
        view('cad', 'Design CAD', PenTool, 'Design CAD: the plan of each level opened natively — model space, snaps, layers, command line'),
        { label: 'Plans', icon: FolderOpen, sub: a.cad?.file.plansSub, title: 'Open a DWG / DXF drawing; the arrow: the plan of each level of the project (open it, or open one for a level without)', onClick: () => a.cad?.onOpen(), menu: a.cad?.file.plans?.length ? a.cad.file.plans : undefined },
        { label: a.cad?.file.level ?? 'Level', icon: Building2, sub: 'level', title: a.cad?.file.levelTitle ?? 'The level the drawing is the plan of', onClick: () => {}, disabled: !a.cad?.hasDrawing || !a.cad.file.levels?.length, menu: a.cad?.file.levels },
        { label: a.cad?.file.unit ?? 'Units', icon: Scale, sub: 'units', title: a.cad?.file.unitTitle ?? 'The units the drawing is in', onClick: () => {}, disabled: !a.cad?.hasDrawing, menu: a.cad?.file.units },
        { label: 'Layer roles', icon: Layers, title: 'What each layer is: wall, room outline, room name, tray, route… (used to find rooms and walls)', onClick: () => a.cad?.onRoles(), active: a.cad?.rolesOn, disabled: !a.cad?.hasDrawing },
        { label: 'Save DXF', icon: Save, title: 'Save the drawing as DXF with what you drew (LV-SKETCH, LV-ANNO) and the devices placed (E-LV-POINTS, E-ELV-DEVICES, E-BOARDS)', onClick: () => a.cad?.onSave(), disabled: !a.cad?.hasDrawing },
        { label: 'Save DWG', icon: SaveAll, title: 'Save the drawing as DWG (its own version, else AutoCAD 2018) with what you drew and the devices placed, as a new file — the architect\'s drawing is not changed (SAVEDWG)', onClick: () => a.cad?.onSaveDwg(), disabled: !a.cad?.hasDrawing }
      ],
      [
        { label: 'Add found', icon: LayoutGrid, title: 'Add every room the plan outlines (closed outlines on the Room outline layers, named by the text inside) to Building information on this level — one undo step (ROOMS)', onClick: () => a.cad?.onAddFound(), disabled: !a.cad?.hasDrawing },
        cadTool('room', 'Click inside', MousePointerClick, 'Click inside a room: its outline from the walls (doors closed), its area — then Add (RA)'),
        cadTool('trace', 'Trace', PenLine, 'Click the corners of a room, Enter to close — then Add (TR)'),
        cadTool('name', 'Pick name', Type, 'Click the room name on the drawing: it names the room found, or renames the room it is in (PN)')
      ],
      [
        cadTool('tray', 'Cable tray', Rows3, 'Draw a cable tray run (CT): its points, Enter to finish, at the width chosen; the tray route can be assigned later'),
        cadTool('cable', 'Cable route', Cable, 'Draw the route of a cable (CR): choose the cable, click its points, Enter to finish'),
        cadTool('link', 'Link route', Route, 'Click a line or polyline of the drawing: it becomes the chosen cable\'s route (LR)'),
        { label: 'Place board', icon: CircuitBoard, title: 'Place a board on the plan: its room, level and position (Add device → DB)', onClick: () => a.cad?.onPlaceBoard(), active: a.cad?.placingBoard, disabled: !a.cad?.hasDrawing },
        { label: 'Update schedules', icon: ListChecks, title: 'From the trays and cable routes on every level\'s plan: tray route lengths and fittings (tray schedule and BOQ), cable lengths, and the tray routes each cable runs along — one undo step (SCHED)', onClick: () => a.cad?.onSchedules(), disabled: !a.cad?.hasDrawing }
      ],
      [
        cadTool('line', 'Line', Slash, 'Line (L): click points; type a length, x,y or @dx,dy; Enter stops'),
        cadTool('pline', 'Polyline', Spline, 'Polyline (PL): click points; C or the first point closes it; Enter finishes'),
        cadTool('rect', 'Rectangle', RectangleHorizontal, 'Rectangle (REC): two opposite corners'),
        cadTool('circle', 'Circle', Circle, 'Circle (C): centre, then radius (a point or typed)'),
        cadTool('arc', 'Arc', Rainbow, 'Arc (A): start, a point on it, end')
      ],
      [
        cadTool('move', 'Move', Move, 'Move (M): select an object (drawn or a device), base point, second point'),
        cadTool('copy', 'Copy', Copy, 'Copy (CO): select, base point, then as many copies as you click; Enter stops. A copied light or socket is counted on its circuit'),
        cadTool('rotate', 'Rotate', RotateCw, 'Rotate (RO): select a drawn object, base point, then an angle (typed degrees or a point)'),
        { label: 'Erase', icon: Eraser, title: 'Erase the selected object (E or Delete); a light or socket is taken off its circuit. The architect\'s drawing is not changed', onClick: () => a.cad?.onDelete(), disabled: !a.cad?.hasSelection }
      ],
      [
        cadTool('text', 'Text', Type, 'Text (T): click where it goes, type it on the command line, Enter'),
        cadTool('dim', 'Dimension', MoveHorizontal, 'Dimension (DIM): two points, then where the dimension line goes; it shows the length in metres')
      ],
      [
        { label: 'Distance', icon: Ruler, title: 'Measure the distance between two snapped points (DI); ORTHO keeps it straight', onClick: () => a.cad?.onTool('dist'), active: a.cad?.tool === 'dist', disabled: !a.cad?.hasDrawing },
        { label: 'Area', icon: Square, title: 'Area and perimeter from snapped corners, or a closed object (AREA, then O)', onClick: () => a.cad?.onTool('area'), active: a.cad?.tool === 'area', disabled: !a.cad?.hasDrawing }
      ],
      [
        { label: 'Add device', icon: CirclePlus, title: 'Place lights, sockets, a DB or ELV devices on the plan (DEV): choose it and its circuit, then click', onClick: () => a.cad?.onTool('dev'), active: a.cad?.tool === 'dev', disabled: !a.cad?.hasDrawing },
        cadTool('fill', 'Fill room', Grid3x3, 'Choose an ELV device, point at a room to see it at its coverage spacing, click to place them all (FILL)'),
        { label: 'Coverage', icon: CircleDashed, title: 'Show what the devices of the chosen ELV device\'s system cover, and what is not covered (COV)', onClick: () => a.cad?.onCoverage(), active: a.cad?.coverageOn, disabled: !a.cad?.hasDrawing },
        { label: 'Copy to level', icon: Copy, title: "Copy this level's devices of the chosen ELV device's system to another level, at the same plan positions", onClick: () => {}, disabled: !a.cad?.hasDrawing || !a.cad.copyLevels?.length, menu: a.cad?.copyLevels }
      ],
      [
        { label: 'Layers', icon: Layers, title: 'Show or hide the layers panel (LAYER)', onClick: () => a.cad?.onLayers(), active: a.cad?.layersOn },
        { label: 'Fit', icon: Maximize, title: 'Fit the drawing to the window (FIT / ZE, or double-click the middle button)', onClick: () => a.cad?.onFit(), disabled: !a.cad?.hasDrawing }
      ],
      [
        { label: 'All sheets', icon: Files, title: 'Every submission sheet: the register with filters, bulk changes, thumbnails and export (PDF, DXF, Excel)', onClick: () => a.sheets?.onTab('sheets'), active: SHEET_VIEWS.includes(a.view) && !a.sheets?.open && a.sheets?.tab === 'sheets', page: true },
        { label: 'Layout', icon: LayoutGrid, title: 'How sheets are made and what they show: panels per sheet, values printed, legend', onClick: () => a.sheets?.onTab('layout'), active: SHEET_VIEWS.includes(a.view) && !a.sheets?.open && a.sheets?.tab === 'layout', page: true },
        { label: 'Title block', icon: PanelBottom, title: 'Title block and drawing numbering of the set', onClick: () => a.sheets?.onTab('titleblock'), active: SHEET_VIEWS.includes(a.view) && !a.sheets?.open && a.sheets?.tab === 'titleblock', page: true },
        { label: 'Issues', icon: Stamp, title: 'Issue sheets: revisions and transmittals', onClick: () => a.sheets?.onTab('issues'), active: SHEET_VIEWS.includes(a.view) && !a.sheets?.open && a.sheets?.tab === 'issues', page: true }
      ],
      ['select', 'cloud', 'text', 'callout', 'arrow', 'rect', 'line'].map(markTool),
      ['pcloud', 'parrow'].map(markTool),
      [
        { label: 'Colour', icon: Palette, sub: named(colour), title: onSheet ? 'Colour of new markups and of the one selected: click for the next, the arrow to choose' : noSheet,
          onClick: () => setColour(COLOURS[(COLOURS.indexOf(colour) + 1) % COLOURS.length]), disabled: !onSheet,
          menu: COLOURS.map((c) => ({ label: named(c), title: `${named(c)} markups`, onClick: () => setColour(c) })) },
        { label: 'Text height', icon: ALargeSmall, sub: `${height} mm`, title: onSheet ? 'Letter height of notes and callouts on the paper' : noSheet, onClick: () => act().restyle({ size: MARKUP_SIZES[(MARKUP_SIZES.indexOf(height) + 1) % MARKUP_SIZES.length] }),
          disabled: !onSheet || !textual, menu: MARKUP_SIZES.map((z) => ({ label: `${z} mm`, title: `Letters ${z} mm high`, onClick: () => act().restyle({ size: z }) })) },
        { label: 'Delete', icon: Trash2, title: onSheet ? 'Delete the selected markup (Delete key)' : noSheet, onClick: () => act().removeSelected(), disabled: !onSheet || !sh?.selected }
      ],
      [
        { label: 'Fit', icon: Maximize, sub: onSheet ? ui?.pct : undefined, title: onSheet ? 'Fit the sheet to the window (F) · Ctrl/⌘ + scroll to zoom' : noSheet, onClick: () => ui?.setZoom('fit'), active: onSheet && ui?.zoom === 'fit', disabled: !onSheet },
        { label: 'Zoom in', icon: ZoomIn, title: onSheet ? 'Zoom in' : noSheet, onClick: () => act().zoomIn(), disabled: !onSheet },
        { label: 'Zoom out', icon: ZoomOut, title: onSheet ? 'Zoom out' : noSheet, onClick: () => act().zoomOut(), disabled: !onSheet },
        { label: 'Legend', icon: BookImage, title: onSheet ? 'Symbol legend in the sheets\' legend column (and on SLD exports)' : noSheet, onClick: () => sh?.onLegend?.(), active: onSheet && !!sh?.legend?.on, disabled: !onSheet || !sh?.legend?.shown },
        { label: 'Side by side', icon: Columns2, title: onSheet ? 'The design on the left with each sheet\'s panels outlined, this sheet on the right' : noSheet, onClick: () => ui?.setSide(!ui.side), active: onSheet && !!ui?.side, disabled: !onSheet }
      ],
      [
        { label: 'Publish', icon: Send, sub: onSheet ? sh?.publish?.label || undefined : undefined, title: onSheet ? sh?.publish?.title ?? 'Issue this sheet' : noSheet, onClick: () => act().publish(), stale: onSheet && !!sh?.publish?.changed, disabled: !onSheet },
        { label: 'PDF', icon: FileText, title: onSheet ? 'This sheet as PDF' : noSheet, onClick: () => act().exportAs('pdf'), disabled: !onSheet },
        { label: 'DXF', icon: FileCode, title: onSheet ? 'This sheet as DXF (AutoCAD R12, editable layers)' : noSheet, onClick: () => act().exportAs('dxf'), disabled: !onSheet },
        { label: 'DWG', icon: FileDown, title: onSheet ? 'This sheet as DWG (AutoCAD 2018)' : noSheet, onClick: () => act().exportAs('dwg'), disabled: !onSheet }
      ],
      [
        { label: 'Wire circuits', icon: Workflow, sub: 'all on this level', title: 'Wire every circuit with devices on this level: arcs between its devices in circuit order and a home run to its DB, tagged with the circuit, cable and length; Update schedules gives the cable schedule the lengths (WC)', onClick: () => a.cad?.onWireAll(), disabled: !a.cad?.hasDrawing },
        { ...cadTool('wire', 'Wire one', Plug, 'Click a device: its circuit is wired, or its wiring is taken off when it is wired (W1)'), sub: 'pick a device' },
        { label: 'Tags', icon: Tags, sub: a.cad?.tagsOn ? 'on' : 'off', title: 'Show or hide the wiring tags (DB-GF1/L3 · 2C × 1.5 mm² · 23 m) on the plan', onClick: () => a.cad?.onTags(), active: a.cad?.tagsOn, disabled: !a.cad?.hasDrawing }
      ]
    ],
    reports: [
      [
        view('load-schedule', 'Load schedule', Table2, 'DEWA load distribution schedule per DB'),
        view('cable-schedule', 'Cable schedule', Cable, 'Every cable in the installation'),
        view('cable-tray', 'Cable trays', Rows3, 'Cable tray schedule: routes A, B, C… with the cables on each and the tray size'),
        view('equipment', 'Equipment', FileSpreadsheet, 'Transformers and boards')
      ],
      [view('drawings', 'Drawings', Files, 'Opens Design CAD → Sheets: every submission sheet and the register — panels per sheet, status, revisions, title block, issues and transmittals, PDF / DXF / Excel exports'), view('study-reports', 'Study reports', ClipboardCheck, 'Submission reports: chosen studies (short circuit, load flow…) for chosen boards, with their SLD'), view('report', 'Calc report', FileText, 'Calculation report (PDF)'), view('export-centre', 'Export centre', FileDown, 'Every PDF document in one list: tick what you need and export a zip or one bookmarked PDF')]
    ],
    issue: [
      [
        ...(a.route === 'before-ifc' ? [gate('tender')] : []),
        { label: 'Tender queries', icon: MessageCircleQuestion, title: 'Tenderers\' queries and the answers (Review list, type Tender query); open ones keep the tender stage open', onClick: go('review') },
        { label: 'BOQ', icon: Receipt, title: 'Bill of quantities for the tender', onClick: () => a.onBom('boq') },
        { label: 'Route', icon: Route, sub: a.route === 'before-ifc' ? 'Tender first' : 'IFC for tender', title: a.route === 'before-ifc' ? 'Tender before IFC: a tender stage between detailed design and IFC — the arrow beside it changes this' : 'The IFC package is used for tender (no separate tender stage) — the arrow beside it changes this', onClick: () => a.onRoute(a.route === 'before-ifc' ? 'from-ifc' : 'before-ifc'),
          menu: [
            { label: 'Tender before IFC', title: 'Detailed design → Tender → IFC (design-bid-build)', onClick: () => a.onRoute('before-ifc') },
            { label: 'IFC used for tender', title: 'Detailed design → IFC; the IFC package goes to tender', onClick: () => a.onRoute('from-ifc') }
          ] }
      ],
      [view('revisions', 'Revisions', History, 'Issue Rev A, B, C… and see what changed'), view('modifications', 'Changes', GitCompare, 'What the working draft changes against its baseline (the last stage issue): panels, studies to run again, drawings, schedules and BOQ quantities'), view('review', 'Review', MessageSquareWarning, 'Design review comments: raise, answer and close them; closed ones are flagged when the design changes'), view('received-docs', 'Received docs', Inbox, 'Register of documents received from others, with revisions and the baseline the work started from')],
      [view('submissions', 'Submissions', Send, 'Documents sent out — BOQ, drawings, reports, variations — with due dates, responses, comments and transmittals')],
      [gate('ifc')]
    ],
    cost: [
      [
        { label: 'BOQ', icon: Receipt, title: 'Bill of quantities: full BOQ by tender section, priced from your price list', onClick: () => a.onBom('boq'), active: a.view === 'boq' },
        { label: 'Scope', icon: ClipboardCheck, title: 'Fit-out / new installation, schedule point quantities, responsibility and tender checks', onClick: () => a.onBom('scope') },
        { label: 'Revisions', icon: History, title: 'BOQ revisions (Rev 0, 1, 2…) and every line changed between them', onClick: () => a.onBom('changes') },
        { label: 'Variations', icon: GitPullRequestArrow, title: 'Variations to the contract (VO-001…): additions and omissions, status, contract sum', onClick: () => a.onBom('variations') },
        { label: 'Per circuit', icon: Table2, title: 'Cable and breaker cost of every circuit', onClick: () => a.onBom('circuits') }
      ],
      [
        { label: '+ Item', icon: FilePlus2, title: 'Add your own line: manual work, extra scope, anything not in the design', onClick: () => a.onBom('add-item') },
        { label: '+ Section', icon: Rows3, title: 'Add your own tender section', onClick: () => a.onBom('add-section') },
        { label: 'Extras', icon: ClipboardCheck, title: 'Lighting, wiring devices, existing work, mechanical interfaces, ELV, testing and civil scope', onClick: () => a.onBom('extras') },
        { label: 'Wastage', icon: Percent, title: 'Wastage % per section on the design quantities (e.g. cables 5 %)', onClick: () => a.onBom('wastage') }
      ],
      [
        { label: 'Rates sheet', icon: FileSpreadsheet, title: 'Every item of this project in Excel — fill in your supplier rates', onClick: () => a.onBom('rates-sheet') },
        { label: 'Import rates', icon: FolderOpen, title: 'Read supply / install rates from an Excel sheet', onClick: () => a.onBom('import') },
        { label: 'Save price list', icon: Save, title: a.hasPriceList ? 'Keep this price list for your other projects' : 'Enter or import some rates first', onClick: () => a.onBom('save-list'), disabled: !a.hasPriceList },
        { label: 'Markup / VAT', icon: BadgePercent, title: 'Overheads and profit %, discount %, VAT %', onClick: () => a.onBom('markup') }
      ],
      [
        { label: 'Excel BOQ', icon: FileDown, title: 'Tender BOQ in Excel: summary, bill with section totals, changes since the revision', onClick: () => a.onBom('excel') },
        { label: 'Issue revision', icon: Stamp, title: 'Record the bill as issued: BOQ Rev 0, 1, 2… — later changes are marked △ in the next revision', onClick: () => a.onBom('issue-rev') },
        { label: 'BOQ document', icon: FileSignature, title: 'Document no., status and prepared / checked / approved names for the PDF cover', onClick: () => a.onBom('document') },
        { label: 'PDF BOQ', icon: FileText, title: 'Tender-format PDF: cover, notes, grand summary with page numbers, bills — your logo on every page', onClick: () => a.onBom('pdf') },
        { label: 'Summary only', icon: Scale, title: 'One-page PDF: bill totals, markup, discount, VAT and grand total', onClick: () => a.onBom('summary-pdf') }
      ]
    ],
    standards: [
      [
        { label: 'Project settings', icon: Scale, title: 'Voltage, ambient, voltage-drop limit and sizing targets', onClick: a.onSettings },
        view('design-references', 'Design references', BookOpen, 'DEWA, IEC, BS 7671, ADDC, EtihadWE and your own design values — apply one to this project'),
        { ...view('database', 'Database', Database, a.dbIssues ? `Your equipment, cable, breaker and parameter data (Excel, synced by Drive) — ${a.dbIssues} to check` : 'Your equipment, cable, breaker and parameter data (Excel, synced by Drive)'), sub: a.dbIssues ? `${a.dbIssues} to check` : undefined, stale: a.dbIssues > 0 }
      ]
    ]
  };

  return (
    <div className={`ribbon${collapsed ? ' collapsed' : ''}`} ref={rootRef} data-doc-id="main-ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
        {TABS.map(({ id, label, icon: I }, ti) => (
          <button key={id} id={`ribbon-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls="ribbon-tools" tabIndex={tab === id ? 0 : -1} className={tab === id ? 'on' : ''}
            onClick={() => { if (collapsed) setPeek(tab === id ? !peek : true); onTab(id); }}
            onDoubleClick={toggleCollapsed} title={collapsed ? 'Click to show its tools · double-click to keep the ribbon open' : 'Double-click to collapse the ribbon (Ctrl+F1)'}
            onKeyDown={(e) => {
              // Arrow keys move between tabs; Home / End to the first / last.
              const k = e.key === 'ArrowRight' ? ti + 1 : e.key === 'ArrowLeft' ? ti - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
              if (k === null) return;
              e.preventDefault();
              const next = TABS[(k + TABS.length) % TABS.length];
              onTab(next.id);
              (e.currentTarget.parentElement?.children[(k + TABS.length) % TABS.length] as HTMLElement | undefined)?.focus();
            }}>
            <I size={16} strokeWidth={1.8} />
            {TABS[ti].step ? `${TABS[ti].step} ${label}` : label}
            {TABS[ti].stages?.includes(a.stage) && <span className="stage-now" title={`The project is at ${STAGE_INFO[a.stage].label}`}>Now</span>}
          </button>
        ))}
        <span className="sp" />
        <button className="ribbon-pin" onClick={toggleCollapsed} aria-pressed={!collapsed} aria-label={collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}
          title={collapsed ? 'Keep the ribbon open (Ctrl+F1)' : 'Collapse the ribbon to its tabs (Ctrl+F1)'}>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {tab === 'cad' && (!collapsed || peek) && (
        <div className="ribbon-subtabs" role="tablist" aria-label="Design CAD">
          {(Object.keys(CAD_SUB) as CadSub[]).map((k) => (
            <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => { setCadSub(k); if (k === 'sheets') a.onView('drawings'); else if (a.view !== 'cad') a.onView('cad'); }}>{CAD_SUB[k].label}</button>
          ))}
        </div>
      )}
      {(!collapsed || peek) && <div id="ribbon-tools" className={`ribbon-tools${collapsed ? ' peek' : ''}`} onClick={(e) => {
        // A tool was used: put the dropped-down tools away (not for buttons that open a menu of their own).
        const b = (e.target as HTMLElement).closest('button');
        if (collapsed && b && !b.hasAttribute('aria-haspopup') && !b.hasAttribute('aria-expanded')) setPeek(false);
      }} role="toolbar" aria-label={`${TABS.find((t) => t.id === tab)?.label} tools`}>
        {groups[tab].map((group, gi) => (tab === 'cad' && !CAD_SUB[sub].groups.includes(gi) ? null :
          <div key={gi} className="ribbon-group" role="group" aria-label={CAPTIONS[tab]?.[gi]} style={tab === 'cad' ? { order: CAD_SUB[sub].groups.indexOf(gi) + 1 } : undefined}>
            <div className="ribbon-group-btns">
              {group.map(({ label, icon: I, title, onClick, active, disabled, stale, page, menu, sub }) => {
                const btn = (
                  <button key={label} className={`${active ? (page ? 'page-on' : 'on') : ''}${stale ? ' stale' : ''}`} title={title} aria-pressed={page ? undefined : active} aria-current={page && active ? 'page' : undefined} disabled={disabled} onClick={onClick}>
                    <I size={20} strokeWidth={1.6} />
                    <span>{label}</span>
                    {sub && <span className="ribbon-sub">{sub}</span>}
                  </button>
                );
                if (!menu) return btn;
                return (
                  <span key={label} className="ribbon-split">
                    {btn}
                    <button className="ribbon-split-arrow" title={`${label}: more options`} aria-haspopup="menu" aria-expanded={splitOpen === label} disabled={disabled}
                      onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect(); setSplitAt({ x: r.left, y: r.bottom + 2 }); setSplitOpen(splitOpen === label ? null : label); }}><ChevronDown size={14} strokeWidth={1.8} aria-hidden /></button>
                    {splitOpen === label && (
                      <div className="ribbon-split-menu" role="menu" style={{ left: splitAt.x, top: splitAt.y }} onMouseDown={(e) => e.stopPropagation()}>
                        {menu.map((m) => <span key={m.label} style={{ display: 'contents' }}>{m.sep && <hr />}<button role="menuitem" title={m.title} onClick={() => { setSplitOpen(null); m.onClick(); }}>{m.label}</button></span>)}
                      </div>
                    )}
                  </span>
                );
              })}
            </div>
            {CAPTIONS[tab]?.[gi] && <div className="ribbon-caption">{CAPTIONS[tab]![gi]}</div>}
          </div>
        ))}
        {tab === 'detailed' && (
          <div className="ribbon-selected" title="Edit, Delete and Properties act on this">
            <span className="m">Selected</span>
            <b>{sel ? sel.id : '—'}</b>
            {sel && <span className="m">{sel.kind === 'board' ? 'board' : 'feeder'}</span>}
          </div>
        )}
        {tab === 'home' && a.recent.length > 0 && (
          <div className="ribbon-group more" ref={moreRef}>
            <button
              title="Recently opened projects"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={(e) => {
                const ribbon = e.currentTarget.closest('.ribbon')!.getBoundingClientRect();
                setMenuLeft(e.currentTarget.getBoundingClientRect().left - ribbon.left);
                setMoreOpen((o) => !o);
              }}
            >
              <Clock size={20} strokeWidth={1.6} />
              <span className="ribbon-menu-label">Recent <ChevronDown size={12} strokeWidth={1.8} aria-hidden /></span>
            </button>
            <div className="ribbon-caption">Open</div>
            {moreOpen && (
              <div className="ribbon-menu" role="menu" style={{ left: menuLeft }}>
                {a.recent.map((r) => (
                  <button key={r.file} role="menuitem" className={r.file === a.currentFile ? 'on' : ''} onClick={() => { setMoreOpen(false); a.onOpenRecent(r.file); }}>
                    {r.name} <span className="m">· {r.when}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'detailed' && (
          <div className="ribbon-group more" ref={moreRef}>
            <button
              title="More tools"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={(e) => {
                // The menu is anchored to the ribbon (so the scrolling toolbar can't clip it); line it up under this button.
                const ribbon = e.currentTarget.closest('.ribbon')!.getBoundingClientRect();
                setMenuLeft(e.currentTarget.getBoundingClientRect().left - ribbon.left);
                setMoreOpen((o) => !o);
              }}
            >
              <Ellipsis size={20} strokeWidth={1.6} />
              <span>More</span>
            </button>
            <div className="ribbon-caption">Other tools</div>
            {moreOpen && (
              <div className="ribbon-menu" role="menu" style={{ left: menuLeft }}>
                <button role="menuitem" onClick={() => { setMoreOpen(false); a.onView('engines'); }}>Load flow (OpenDSS / pandapower)</button>
                <button role="menuitem" onClick={() => { setMoreOpen(false); a.onView('calculators'); }}>Quick calcs</button>
                <button role="menuitem" onClick={() => { setMoreOpen(false); a.onExportDss(); }}>Export OpenDSS (.dss)</button>
                <button role="menuitem" onClick={() => { setMoreOpen(false); a.onView('report'); }}>Calculation report</button>
                <button role="menuitem" onClick={() => { setMoreOpen(false); a.onSettings(); }}>Project settings</button>
              </div>
            )}
          </div>
        )}
      </div>}
    </div>
  );
}
