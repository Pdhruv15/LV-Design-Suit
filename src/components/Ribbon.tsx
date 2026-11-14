import { AddBoardIcon, BoardPropsIcon, EllipseIcon, TransformerIcon, TxGenSizingIcon } from './icons/elecIcons';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as KeyEvent } from 'react';
import {
  BatteryCharging, Building2, Cable, ClipboardCheck, MessageSquareWarning, Inbox, CircuitBoard, Ellipsis, FileDown, FileSignature, FileSpreadsheet, FileText, GitPullRequestArrow, Send, Stamp,
  Gauge, Hand, LayoutGrid, ListTree, MousePointer2, Pencil, Receipt, Scale, Settings2, ShieldCheck, Sun,
  ChevronDown, ChevronUp, Waypoints, Lock, CircleArrowRight, MessageCircleQuestion, Route, Database, BookOpen, GitCompare, History, Percent, BadgePercent, Play, AlignVerticalSpaceAround, LayoutDashboard, LifeBuoy, Braces, PanelBottom, Files, FilePlus2, FolderOpen, Save, SaveAll, UserRound, FolderCog, Clock, Network, House, Redo2, Rows3, Table2, Trash2, TrendingDown, Undo2, Zap, type LucideIcon, BatteryFull, Box, ChartColumnBig, Cctv } from 'lucide-react';
import { BringToFront, Frame, LayoutTemplate, Printer, Crop, Plus, ChevronRight, LightbulbOff, Snowflake, LockOpen, Focus, CircleCheck, Layers3, ArrowDownRight, Cloud, FileSearch, ListOrdered } from 'lucide-react';
import { ListFilter, PenTool, FileCog, PaintBucket, MessageSquareText, Tag, Navigation, Layers2, PaintRoller, BoxSelect, Paintbrush, Scissors, FlipHorizontal2, Scaling, StretchHorizontal, CornerUpRight, Unlink2, Link2, Paperclip, Ungroup, Grid2x2, Rows2, CirclePlus, Move, Slash, Spline, RectangleHorizontal, Circle, Rainbow, RotateCw, Eraser, MoveHorizontal, Layers, MousePointerClick, PenLine, Type, Ruler, Maximize, Grid3x3, Copy, CircleDashed, ListChecks, Palette, ZoomIn, ZoomOut, Columns2, FileCode, BookImage, ALargeSmall, Plug, Tags, Workflow, Lightbulb, DoorOpen , SquareScissors } from 'lucide-react';
import { ClipboardList, Package, Dot, Divide, Target, Pentagon, ArrowRightToLine, TriangleRight, Hexagon, CaseSensitive, LandPlot, ScanSearch, Expand, SlidersHorizontal, DraftingCompass } from 'lucide-react';
import { VP_ARRANGEMENTS, VP_SCALES } from '../model/planViewports';
import { LayoutPanelLeft, Maximize2, Square } from 'lucide-react';
import { ArrowDownToLine, ArrowLeftRight, Check, ChevronLeft, ClipboardPaste, CopyPlus, ListPlus, LocateFixed, Scan, SquareDashed } from 'lucide-react';
import type { CadExport, CadRibbonInfo, CadTool } from './cad/cadState';
import { ColourPicker } from './cad/ColourPicker';
import { LINETYPE_IDS, LINETYPES, LINEWEIGHTS, type LinetypeId, type ObjectProps } from '../model/cadLayerStyle';
import { toolAlias } from './cad/cadCommands';
import type { BoardKind, Feeder } from '../types';
import type { MainView } from '../views';
import type { DrawingsTab } from './docs/DrawingsView';
import type { DrawingSheet } from '../model/drawingSet';
import { markupSize, type MarkupColor, type SheetMarkup } from '../model/sheetMarkup';
import { ALL_TOOLS, MARKUP_SIZES } from './sld/markupTools';
import type { SheetUi } from './sld/sheetUi';
import { STAGE_INFO, type DesignStage, type TenderRoute } from '../model/designStage';
import { PALETTE, type PaletteEntry, type PaletteItem } from '../model/sldEdit';
import { LAYER_LABELS, type ResultLayers } from '../diagram/annotations';
import { COLOR_BY, type ColorBy } from '../diagram/heatmap';
import type { SupplyMode } from '../calc/scenario';

export type BomCommand = 'boq' | 'scope' | 'changes' | 'variations' | 'circuits' | 'excel' | 'pdf' | 'summary-pdf' | 'rates-sheet' | 'import' | 'save-list' | 'add-item' | 'add-section' | 'extras' | 'wastage' | 'markup' | 'document' | 'issue-rev';
export type RibbonTab = 'schedule' | 'sld' | 'home' | 'concept' | 'schematic' | 'detailed' | 'cad' | 'sheets' | 'spec' | 'reports' | 'issue' | 'cost' | 'standards';

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
  /** Split button: the arrow part offers these; `sep` draws a line above an item. `checked`: the item shows a tick
   * while it is on (one of a list of choices); with `keep` it is a switch of its own and the list stays open. */
  menu?: { label: string; title: string; onClick: () => void; sep?: boolean; disabled?: boolean; checked?: boolean; keep?: boolean }[];
  /** A small button: icon and label on one line, three to a column (the CAD-standard panels). */
  small?: boolean;
  /** A small button that starts a new column. */
  col?: boolean;
  /** In the panel's ▾ under its caption instead of on the row (the less used tools of a panel). */
  more?: boolean;
  /** Its typed command, shown in bold with the name in an icon-only tool's tooltip (e.g. O for Offset). */
  cmd?: string;
  /** The whole button opens its `menu` (it has no action of its own). */
  menuOnly?: boolean;
}

export interface RibbonActions {
  view: MainView;
  onView: (v: MainView) => void;
  /** The sheets pages of Design CAD: the register tab shown when no sheet is open, and choosing one; with a sheet open, its tools
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
  /** The SLD tab's own tools: the checks beside Run, the equipment library's supply and device items, what the system
   * diagram shows, copy and paste of a board, fit and export. Without it they are greyed. */
  sld?: {
    /** Circuits failing and to check; `onCheck` shows the next one on the drawing. */
    fails: number; warns: number; onCheck: () => void;
    /** An equipment-library item chosen: the next click on the drawing places it. */
    onArm: (item: PaletteItem, label: string) => void;
    onHvSupply: () => void;
    /** The system diagram is on screen: the result lists and Fit act on it. */
    system: boolean;
    layers: ResultLayers; onLayers: (l: ResultLayers) => void;
    colorBy: ColorBy; onColorBy: (c: ColorBy) => void;
    supply: SupplyMode; onSupply: (m: SupplyMode) => void; hasGenerator: boolean;
    /** Main boards whose transformer can fail with a tie to another. */
    outages: string[];
    canCopy: boolean; onCopy: () => void;
    /** The board copied, while it can be pasted on the selected one. */
    canPaste: boolean; copied?: string; onPaste: () => void;
    /** Show the selected board or circuit on its floor plan in Design CAD. */
    onShowOnPlan: () => void;
    onFit: () => void;
    onExport: () => void;
  };
  /** The Load schedule tab's own tools: add circuits and spare ways, the row tools, balance, copy and paste on the grid,
   * export. Published by the Load schedule page while it is on screen; without it they are greyed. */
  schedule?: {
    /** The form on screen: a DB's load schedule, a panel's connected load & MD form, the TCL summary or the busbar riser. */
    form: 'db' | 'md' | 'tx' | 'riser';
    /** The DB load schedule form's grid is on screen (Check, Balance phases and the CSV / template exports are DB-only). */
    grid: boolean;
    /** A panel's own form (the DB schedule or the connected load & MD form) is on screen: the board steps work there. */
    board: boolean;
    /** The panels either side of this one in the schedule's order; undefined at the ends. */
    prevBoard?: string; nextBoard?: string;
    onBoardStep: (d: -1 | 1) => void;
    /** Circuits of this schedule that fail and to check; `onCheck` shows the next one, or the next board with one. */
    fails: number; warns: number; onCheck: () => void;
    onAddCircuit: (threePhase?: boolean) => void;
    /** A spare or a space; `phase` is only given by the 1-phase / 3-phase items (the MD form's own default is 3-phase). */
    onAddSpare: (kind: 'spare' | 'space', phase?: 'one' | 'three') => void;
    /** A transformer in the substation on screen, or in a new substation (TCL summary). */
    onAddTransformer: (newSubstation: boolean) => void;
    /** Label of the active row of the form on screen (a DB circuit, an MD outgoing feeder or spare way, a transformer): what Edit and Delete act on. */
    row?: string;
    /** Why Delete / Duplicate can't act on the MD form's active row. */
    rowBlock?: string; dupBlock?: string;
    /** The substation a transformer is added to (TCL summary). */
    substation?: string;
    /** Project, area, owner, plot, consultant and contractor of the authority forms. */
    onFormDetails: () => void;
    onFillDown: () => void; onDuplicate: () => void; onEditRow: () => void; onDeleteRow: () => void;
    canBalance: boolean; imbalancePct?: number; onBalance: () => void;
    onCopy: () => void; onPaste: () => void;
    exporting: boolean;
    onExport: (kind: 'excel' | 'pdf' | 'csv' | 'pack' | 'template') => void;
    /** The board on screen has a sheet linked to it, or the project has a DB format: Export → Open in my format works. */
    sheetFormat: boolean; onOpenSheet: () => void;
  };
  // Home: projects
  onNew: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** Export anonymized sample (a copy without client, site or people, for sharing an issue). */
  onAnonymizedSample: () => void;
  /** Design CAD's tools (src/components/cad); `file`: the File menu's Plans, Level and Units (cadFileMenu.ts). */
  cad?: {
    tool: CadTool; onTool: (t: CadTool) => void; onOpen: () => void;
    /** File → New: a blank drawing (NEW). */
    onNew?: () => void; onSave: () => void; onSaveDwg: () => void; onClose: () => void;
    /** File: Save As, Close all but this one, Export, Publish; and the Drafting settings (DS). */
    onSaveAs?: () => void; onCloseOthers?: () => void; onExport?: (kind: CadExport) => void; onPublish?: () => void; onSettings?: () => void; onDelete: () => void; hasSelection: boolean; onLayers: () => void; onLayerManager?: () => void; onRefs?: () => void; layersOn: boolean; hasDrawing: boolean;
    /** A layout tab showing (paper space): Page setup has its viewports; its tools run these commands (LAYOUT, MV, VPSCALE n, VPLOCK, PAGESETUP, PLOT). */
    inLayout?: boolean; vpLocked?: boolean; onLayoutCmd?: (cmd: string) => void;
    /** On a layout's paper (not working in the model through a viewport): Annotate's markup tools draw on it. */
    onPaper?: boolean;
    /** A command as if typed on the command line (STYLE, LAYISO, XATTACH, CLOSEALL…). */
    onCommand?: (text: string) => void;
    /** The drawing open last on this computer, while it is not open: File → Reopen. */
    reopen?: { label: string; title: string; onClick: () => void };
    /** The properties palette shown (↘ beside the Properties caption). */
    propsOn?: boolean; onProps?: () => void;
    /** The Blocks palette shown (Insert on the Blocks panel). */
    blocksOn?: boolean;
    /** The drawing's layers and the current one, and the colour, linetype and lineweight of the objects picked or of new
     * objects (the page sets them, CadPage); `onSetProps` changes one of the three. */
    info?: CadRibbonInfo | null; onSetProps?: (patch: ObjectProps) => void;
    /** Every tool named, the small ones too (Show labels, also in Preferences → App); off: the main tools named, the
     * small ones on hover. */
    labels?: boolean; onLabels?: (on: boolean) => void;
    file: { plans: Tool['menu']; plansSub?: string; level: string; levelTitle: string; levels: Tool['menu']; unit: string; unitTitle: string; units: Tool['menu'] };
    onRoles: () => void; rolesOn: boolean; onAddFound: () => void; onSchedules: () => void; onPlaceBoard: () => void; placingBoard: boolean;
    onCoverage: () => void; coverageOn: boolean; copyLevels: Tool['menu'];
    onWireAll: () => void; onTags: () => void; tagsOn: boolean;
  };
  /** Design CAD → Output: the dialogs that work without an open sheet (Plot needs one). */
  output?: { onPlot: () => void; onSetups: () => void; onPrinters: () => void; onPens: () => void; onBatch: () => void; onRegister: () => void };
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

/** Design CAD's panels, in the order of CAPTIONS.cad and the cad tab's groups: the drafting panels (Draw, Modify,
 * Annotate, Layers, Properties, Measure, in the order of the layout the user chose), the sheet's (Markup, On panels,
 * Sheet) and the engineering and sheet-set panels. */
const G = {
  draw: 0, modify: 1, annotate: 2, blocks: 3, layers: 4, props: 5, measure: 6, markup: 7, onPanels: 8, sheet: 9,
  rooms: 10, cables: 11, devices: 12, editDevices: 13, wiring: 14, reference: 15, sheetSet: 16, layouts: 17, viewports: 18, plot: 19, publish: 20, export: 21
} as const;
/** A Design CAD sub-tab: its panels on the drawing; on the sheets pages `sheet` instead (none: the sub-tab with the
 * sheet set shows), on a layout's paper `paper` instead, and on a layout `layout` after its Layout panel. */
export interface CadTab { id: string; label: string; groups: number[]; sheet?: number[]; paper?: number[]; layout?: number[];
  /** The small tools named as well, without Show labels (LVCAD, Annotate and Output: their panels fill the row with their names). */
  smallNamed?: boolean }
/** Design CAD's sub-tabs. As shown (the main tools named under their icons, the small ones on hover): LVCAD, the
 * drafting panels in the order of the layout the user chose; Annotate beside it (its own sub-tab since v2.128: on LVCAD
 * the row had grown wider than the window); and Electrical, ELV & sheets, which on the sheets pages has every sheet
 * tool. With Show labels every tool is named and needs about twice the room, so the panels take more sub-tabs. On a
 * layout's paper, Annotate shows the markup instead. File (open, save, close) is a menu beside them. The layout tools
 * (Layout, and on a layout Layout viewports) are the first panels of Output, which reads Layout · Layout viewports ·
 * Plot · Publish · Export with its small tools named too (1,281 px on a layout, inside a 1,366 px window); with Show
 * labels they would make it wider than the window, so there they have a sub-tab of their own between Sheets and Output. */
export const CAD_TABS: Record<'named' | 'labels', CadTab[]> = {
  named: [
    { id: 'drafting', label: 'LVCAD', groups: [G.draw, G.modify, G.blocks, G.layers, G.props, G.measure], paper: [G.draw, G.modify, G.layers, G.props, G.measure], sheet: [], smallNamed: true },
    { id: 'annotate', label: 'Annotate', groups: [G.annotate], paper: [G.markup], sheet: [], smallNamed: true },
    { id: 'elec', label: 'Electrical, ELV & sheets', groups: [G.rooms, G.cables, G.devices, G.editDevices, G.wiring, G.reference, G.sheetSet],
      sheet: [G.markup, G.onPanels, G.sheet, G.sheetSet] },
    { id: 'output', label: 'Output', groups: [G.layouts, G.plot, G.publish, G.export], layout: [G.viewports], sheet: [G.plot, G.publish, G.export], smallNamed: true }
  ],
  labels: [
    { id: 'drafting', label: 'LVCAD', groups: [G.draw, G.modify, G.blocks], paper: [G.draw, G.modify], sheet: [] },
    { id: 'annotate', label: 'Annotate', groups: [G.annotate], paper: [G.markup], sheet: [G.markup, G.onPanels] },
    { id: 'layers', label: 'Layers & properties', groups: [G.layers, G.props, G.measure], sheet: [] },
    { id: 'elec', label: 'Electrical & ELV', groups: [G.rooms, G.cables, G.devices, G.editDevices, G.wiring], sheet: [] },
    { id: 'sheets', label: 'Sheets', groups: [G.reference, G.sheetSet], sheet: [G.sheet, G.sheetSet] },
    { id: 'layout', label: 'Layout', groups: [G.layouts], layout: [G.viewports], sheet: [] },
    { id: 'output', label: 'Output', groups: [G.plot, G.publish, G.export], sheet: [G.plot, G.publish, G.export] }
  ]
};
const SHEET_VIEWS: MainView[] = ['drawings', 'drawing-register'];
/** The panel a tool is on, so the ribbon shows the tool in use (a typed command moves it there). */
const GROUP_OF: Partial<Record<CadTool, number>> = {
  point: G.draw, divide: G.draw, measure: G.draw, line: G.draw, pline: G.draw, rect: G.draw, circle: G.draw, arc: G.draw, hatch: G.draw, hatchedit: G.draw, boundary: G.draw, polygon: G.draw, ellipse: G.draw, circle2p: G.draw, circle3p: G.draw, circled: G.draw, arcsce: G.draw, revcloud: G.annotate,
  move: G.modify, copy: G.modify, rotate: G.modify, mirror: G.modify, scale: G.modify, stretch: G.modify, trim: G.modify, extend: G.modify, offset: G.modify, fillet: G.modify, chamfer: G.modify, break: G.modify, join: G.modify, explode: G.modify, array: G.modify,
  text: G.annotate, mtext: G.annotate, draworder: G.modify, texttofront: G.modify, block: G.blocks, blockpick: G.blocks, insert: G.blocks, attedit: G.blocks, attpick: G.blocks, dim: G.annotate, dimlin: G.annotate, dimcont: G.annotate, dimbase: G.annotate, leader: G.annotate, rtag: G.annotate, north: G.annotate, keynote: G.annotate,
  tcount: G.annotate, tjust: G.annotate, th: G.annotate, talign: G.annotate, tcase: G.annotate, tframe: G.annotate, tmask: G.annotate, tcopy: G.annotate, matchprop: G.props, dist: G.measure, area: G.measure,
  xattach: G.reference, xclip: G.reference, crop: G.reference, room: G.rooms, trace: G.rooms, name: G.rooms, tray: G.cables, cable: G.cables, link: G.cables,
  dev: G.devices, fill: G.devices, lux: G.devices, em: G.devices, arl: G.editDevices, match: G.editDevices, wire: G.wiring
};
/** Under Text's arrow: Text and Numbered text, then the tools that change the texts picked (typed-only before v2.072). */
const TEXT_TOOLS: [CadTool, string, string][] = [
  ['text', 'Text (T)', 'Click where it goes, type it, Enter'],
  ['mtext', 'Notes (MT)', 'Two corners for the box, then type; lines wrap to its width'],
  ['tcount', 'Numbered text (TCOUNT)', 'Prefix, start, step, suffix, then click to place each, or renumber the texts picked'],
  ['tjust', 'Justify (TJ)', 'Justify the texts picked without moving them'],
  ['th', 'Height (TH)', 'Text height on paper (mm) of the texts picked, or for new text'],
  ['talign', 'Align or space (TA)', 'Line up the texts picked on a text or point, or space them evenly'],
  ['tcase', 'Case (TC)', 'Upper, lower, title or sentence case of the texts picked'],
  ['tframe', 'Frame (TFRAME)', 'A circle, box or hexagon round the texts picked'],
  ['tmask', 'Mask (TMASK)', 'A paper-colour mask under the texts picked'],
  ['tcopy', 'Copy words (TCOPY)', 'Give the texts picked the words of another text']
];
/** The sub-tabs of v2.053 and v2.054, kept on this computer: the panel each stands for now. */
const OLD_SUB: Record<string, number> = { draw: G.draw, modify: G.modify, annotate: G.annotate, insert: G.reference, layers: G.layers, view: G.draw, page: G.sheetSet, tools: G.measure };
const SUB_KEY = 'lvds.cadSub';
/** The sub-tab Design CAD opens on: the one used last on this computer, Drafting the first time. */
const firstSub = (): string => { try { return localStorage.getItem(SUB_KEY) ?? 'drafting'; } catch { return 'drafting'; } };
/** The sub-tab of `tabs` an id stands for: its own, the one holding the first panel of the other mode's sub-tab of that
 * id (or of a sub-tab of v2.053), else the first. */
function cadTabOf(tabs: CadTab[], id: string): CadTab {
  const own = tabs.find((t) => t.id === id);
  if (own) return own;
  const g = [...CAD_TABS.named, ...CAD_TABS.labels].find((t) => t.id === id)?.groups[0] ?? OLD_SUB[id];
  return (g !== undefined && tabs.find((t) => [...t.groups, ...(t.layout ?? [])].includes(g))) || tabs[0];
}

/** The tooltip of an icon-only tool: its name and typed command (and its state, such as a colour) in bold, then what
 * it does: its title, less a leading "Name (CMD): " that the bold line already says. */
export function tipOf(t: Pick<Tool, 'label' | 'title' | 'cmd' | 'sub'>): { head: string; text: string } {
  const lead = t.cmd ? `${t.label} (${t.cmd})` : undefined;
  const rest = lead && t.title.startsWith(lead) ? t.title.slice(lead.length).replace(/^[:,]?\s*/, '') : t.title;
  return { head: `${lead ?? t.label}${t.sub ? ` · ${t.sub}` : ''}`, text: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/** Group captions under the ribbon groups (same order as the groups). */
export const CAPTIONS: Record<RibbonTab, string[]> = {
  schedule: ['Run and check', 'Schedule', 'Circuits and loads', 'Rows', 'Balance', 'Copy and undo', 'Output'],
  sld: ['Run and check', 'Canvas', 'Boards', 'Equipment', 'Selection', 'Results', 'Copy and undo', 'View', 'Output'],
  home: ['Project', 'Diagram & history', 'Setup'],
  concept: ['Load', 'Supply', 'Stage'],
  schematic: ['History', 'Distribution', 'Main systems', 'ELV', 'Stage'],
  detailed: ['Run', 'Calculate', 'Stage'],
  cad: ['Draw', 'Modify', 'Annotate', 'Blocks', 'Layers', 'Properties', 'Measure and view', 'Markup', 'On panels', 'Sheet',
    'Rooms', 'Cables and boards', 'Devices', 'Edit devices', 'Wiring', 'Reference', 'Sheet set', 'Layout', 'Layout viewports', 'Plot', 'Publish', 'Export'],
  sheets: [],
  spec: [],
  reports: ['Schedules', 'Drawings and reports'],
  issue: ['Tender', 'Track', 'Send', 'IFC'],
  cost: ['Bill', 'Add to the bill', 'Rates', 'Issue and export'],
  standards: ['Project data']
};

/** SLD tab: the groups after Selection (Results, Copy and undo, View, Output) wait under More while the window is too
 * narrow for the row; the five before them always stay on it. */
const SLD_MOVES = CAPTIONS.sld.length - 5;
/** Load schedule tab: the same, for the groups after Circuits and loads. */
const SCHEDULE_MOVES = CAPTIONS.schedule.length - 3;

const ADD_BOARD: { kind: BoardKind; ratingA: number }[] = [
  { kind: 'DB', ratingA: 63 }, { kind: 'EDB', ratingA: 63 }, { kind: 'SMDB', ratingA: 250 },
  { kind: 'MCC', ratingA: 400 }, { kind: 'EMCC', ratingA: 400 }, { kind: 'EMDB', ratingA: 400 }
];

/** The design stages in the order the design is done: sub-tabs of the Stages tab, as Plan, Draw and Sheets are of Design CAD. */
type StageTab = 'concept' | 'schematic' | 'detailed' | 'issue';
const STAGE_TABS: { id: StageTab; label: string; stages: DesignStage[] }[] = [
  { id: 'concept', label: '1 Concept', stages: ['concept'] },
  { id: 'schematic', label: '2 Schematic', stages: ['schematic'] },
  { id: 'detailed', label: '3 Detailed design', stages: ['detailed'] },
  { id: 'issue', label: '4 Tender and IFC', stages: ['tender', 'ifc'] }
];
const isStageTab = (t: RibbonTab) => STAGE_TABS.some((s) => s.id === t);

/** The tab row: Project, the everyday work, the Stages tab, what comes out of the design, then Standards at the far end.
 * `sep`: a divider before the tab. */
const TABS: { id: Exclude<RibbonTab, StageTab> | 'stages'; label: string; icon: Icon; sep?: boolean }[] = [
  { id: 'home', label: 'Project', icon: House },
  { id: 'schedule', label: 'Load schedule', icon: Table2, sep: true },
  { id: 'sld', label: 'SLD', icon: Network },
  { id: 'cad', label: 'Design CAD', icon: PenTool },
  { id: 'sheets', label: 'Sheets', icon: Grid3x3 },
  { id: 'spec', label: 'Specification', icon: PenLine },
  { id: 'stages', label: 'Stages', icon: Waypoints, sep: true },
  { id: 'reports', label: 'Documents', icon: FileText, sep: true },
  { id: 'cost', label: 'BOM / Cost', icon: Receipt },
  { id: 'standards', label: 'Standards', icon: Settings2 }
];

/** The ribbon tab a project in this stage opens on. */
export const tabForStage = (s: DesignStage): RibbonTab => STAGE_TABS.find((t) => t.stages.includes(s))!.id;

/** Screens on each tab, so the ribbon stays where the tools that open them are. A screen on several tabs (the SLD on
 * Project and Schematic) keeps the tab you are on. */
const TAB_VIEWS: Record<RibbonTab, MainView[]> = {
  schedule: ['load-schedule', 'enclosure'],
  sld: ['design', 'panels', 'enclosure', 'engines', 'calculators'],
  home: ['projects', 'dashboard', 'help', 'parameters', 'titleblock', 'building', 'design'],
  concept: ['building', 'load-assessment', 'sizing', 'substation-area', 'space-planning', 'dashboard'],
  schematic: ['panels', 'design', 'busbar', 'pfc', 'ups', 'solar', 'lightning', 'earth-schematic', 'elv', 'inbox'],
  detailed: ['selection', 'voltage-drop', 'earthing', 'coordination'],
  cad: ['cad', 'drawings', 'drawing-register'],
  // Sheets has its own Excel-style ribbon on the page, so this tab has no tools of its own.
  sheets: ['sheets'],
  spec: ['specification'],
  reports: ['cable-schedule', 'cable-tray', 'equipment', 'study-reports', 'report', 'export-centre'],
  issue: ['revisions', 'modifications', 'review', 'received-docs', 'submissions'],
  cost: ['boq'],
  standards: ['database', 'design-references']
};
const HOME_TAB: Partial<Record<MainView, RibbonTab>> = { building: 'concept', dashboard: 'home', design: 'sld', panels: 'sld', 'load-schedule': 'schedule' };

/** The page a tab shows when it is chosen and the page on screen is not one of its own. */
const TAB_PAGE: Record<RibbonTab, MainView> = {
  schedule: 'load-schedule', sld: 'design', home: 'dashboard', concept: 'building', schematic: 'design', detailed: 'design', cad: 'cad',
  sheets: 'sheets', spec: 'specification', reports: 'cable-schedule', issue: 'revisions', cost: 'boq', standards: 'database'
};
/** The page to show when a tab is chosen: the page on screen when it is on that tab (the SLD stays on Schematic), else
 * the tab's own page, which for Detailed design is the SLD too; Design CAD shows the drawing. */
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
  // A window too narrow for the row: this many of the sub-tab's panels collapse to one button each, from the right.
  const [shut, setShut] = useState(0);
  // SLD and Load schedule tabs, a window too narrow for the row: this many of the last groups wait under More, from the right.
  const [over, setOver] = useState(0);
  const [resized, setResized] = useState(0);
  const toolsRef = useRef<HTMLDivElement>(null);
  // Design CAD's sub-tab, kept for next time (the sub-tab of the same id, or holding the same panel, with or without
  // labels). A sheets page (opened from Documents, the SLD, Sheet set) on a sub-tab with no sheet tools shows the one
  // with the sheet set, and stays there.
  const onSheets = SHEET_VIEWS.includes(a.view);
  const labels = !!a.cad?.labels;
  const cadTabs = CAD_TABS[labels ? 'labels' : 'named'];
  const sheetsTab = cadTabs.find((t) => t.sheet?.includes(G.sheetSet)) ?? cadTabs[0];
  const [cadSub, setCadSub] = useState<string>(firstSub);
  const chosen = cadTabOf(cadTabs, cadSub);
  const forced = onSheets && !chosen.sheet?.length;
  const sub = forced ? sheetsTab : chosen;
  useEffect(() => { if (forced) setCadSub(sheetsTab.id); }, [forced, sheetsTab.id]);
  useEffect(() => { try { localStorage.setItem(SUB_KEY, cadSub); } catch { /* not kept */ } }, [cadSub]);
  // The panels a sub-tab shows: on the sheets pages the open sheet's, on a layout's paper the markup in place of
  // Annotate, on a layout its viewports as well.
  const cadGroups = (t: CadTab) => {
    if (onSheets) return t.sheet ?? [];
    if (a.view === 'cad' && a.cad?.onPaper && t.paper) return t.paper;
    const g = [...t.groups];
    if (a.cad?.inLayout && t.layout) g.splice(g.indexOf(G.layouts) + 1 || g.length, 0, ...t.layout);
    return g;
  };
  const shown = tab === 'cad' ? cadGroups(sub) : [];
  const folded = [...shown].reverse().slice(0, shut);
  // While the row is wider than the window, one more panel collapses; a resized window, or another sub-tab, opens them
  // all again and measures the row anew (a window made narrower with none folded too).
  useLayoutEffect(() => {
    const el = toolsRef.current;
    if (el && tab === 'cad' && el.scrollWidth > el.clientWidth + 1 && shut < shown.length) setShut(shut + 1);
  }, [tab, sub.id, shut, shown.length, resized]);
  useEffect(() => { const open = () => { setShut(0); setOver(0); setResized((n) => n + 1); }; window.addEventListener('resize', open); return () => window.removeEventListener('resize', open); }, []);
  useEffect(() => setShut(0), [tab, sub.id, onSheets, labels]);
  const cadToolNow = a.cad?.tool;
  useEffect(() => {
    const g = cadToolNow ? GROUP_OF[cadToolNow] : undefined;
    const t = g === undefined ? undefined : cadTabs.find((x) => [...x.groups, ...(x.paper ?? []), ...(x.layout ?? [])].includes(g));
    if (t) setCadSub(t.id);
  }, [cadToolNow]); // eslint-disable-line react-hooks/exhaustive-deps -- a tool started moves the ribbon; the mode alone does not
  // File: open, save and close drawings, the level and units of this one (a menu, with lists beside it).
  const [fileOpen, setFileOpen] = useState(false);
  const [fileList, setFileList] = useState<'open' | 'close' | 'export' | null>(null);
  const fileRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fileOpen) return;
    const away = (e: MouseEvent) => !fileRef.current?.contains(e.target as Node) && setFileOpen(false);
    // Esc closes the menu only, not the command running on the drawing.
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setFileOpen(false); } };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [fileOpen]);
  // Icon-only tools: the name, typed command and what it does, under the tool after a short rest (at once on focus
  // from the keyboard).
  const [tip, setTip] = useState<{ x: number; y: number; head: string; text: string; of: string } | null>(null);
  const tipTimer = useRef<number | undefined>(undefined);
  const tipEl = useRef<HTMLElement | null>(null);
  // A tooltip shown a moment ago: the next tool's shows at once (the cursor running along the icons).
  const tipOn = useRef(false), tipGone = useRef(0);
  const hideTip = () => { window.clearTimeout(tipTimer.current); tipEl.current = null; if (tipOn.current) tipGone.current = Date.now(); tipOn.current = false; setTip(null); };
  useEffect(() => () => window.clearTimeout(tipTimer.current), []);
  useEffect(() => { window.clearTimeout(tipTimer.current); setTip(null); }, [tab, sub, labels]);
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
  // SLD and Load schedule tabs: while the row is wider than the window, one more of its last groups moves under More.
  // Measured again when the window is resized, the tools drop down from a collapsed ribbon, or what is written on the
  // row changes: the board and selection named on it, the settings beside the result lists, the imbalance, an export.
  const sldWide = `${a.boardId} ${a.selection?.id ?? ''} ${a.staleCount} ${a.sld?.fails ?? 0} ${a.sld?.warns ?? 0} ${a.sld?.colorBy ?? ''} ${a.sld?.supply ?? ''} ${a.schedule?.imbalancePct ?? ''} ${a.schedule?.exporting ?? ''} ${a.schedule?.fails ?? 0} ${a.schedule?.warns ?? 0}`;
  const moves = tab === 'sld' ? SLD_MOVES : tab === 'schedule' ? SCHEDULE_MOVES : 0;
  useLayoutEffect(() => {
    const el = toolsRef.current;
    if (el && moves && el.scrollWidth > el.clientWidth + 1 && over < moves) setOver(over + 1);
  }, [tab, over, moves, sldWide, resized, collapsed, peek]);
  useEffect(() => setOver(0), [tab]);
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
  const sm = (t: Tool): Tool => ({ ...t, small: true });
  const cadTool = (t: CadTool, label: string, icon: Icon, title: string, cmd = toolAlias(t)): Tool => ({ label, icon, title, cmd, onClick: () => a.cad?.onTool(t), active: a.cad?.tool === t, disabled: !a.cad?.hasDrawing });
  /** A tool that runs a command as if typed on the command line. */
  const cadCmd = (label: string, icon: Icon, cmd: string, title: string, text = cmd): Tool => ({ label, icon, cmd, title, onClick: () => a.cad?.onCommand?.(text), disabled: !a.cad?.hasDrawing || !a.cad.onCommand });
  /** A tool with its other forms under its arrow (Trim: Extend; Fillet: Chamfer), shown in use while any of them runs. */
  const withList = (t: Tool, forms: [CadTool, string, string][]): Tool => ({
    ...t, active: forms.some(([k]) => a.cad?.tool === k), menu: forms.map(([k, label, title]) => ({ label, title, onClick: () => a.cad?.onTool(k) }))
  });
  // The sheet tools (the sheets pages of Design CAD); greyed while no sheet is open. The markup tools also draw on a
  // layout's paper.
  const sh = a.sheets, ui = sh?.ui, act = () => ui!.actions.current;
  const onSheet = !!ui && (SHEET_VIEWS.includes(a.view) ? !!sh?.open : a.view === 'cad' && !!a.cad?.onPaper);
  const noSheet = SHEET_VIEWS.includes(a.view) || !a.cad?.inLayout ? 'Open a sheet first' : 'On the paper: PS returns to it from the model';
  // Output in Design CAD: a layout tab plots with its page setup; model space with a drawing open has its own forms.
  const onLayout = onSheet || (a.view === 'cad' && !!a.cad?.inLayout), inModel = a.view === 'cad' && !a.cad?.inLayout && !!a.cad?.hasDrawing;
  const noDrawing = SHEET_VIEWS.includes(a.view) ? 'Open a sheet first' : 'Open a drawing, a layout or a sheet first';
  const markTool = (id: string): Tool => {
    const t = ALL_TOOLS.find((x) => x.tool === id)!, panelOnly = t.tool === 'pcloud' || t.tool === 'parrow';
    return { label: t.label, icon: t.icon, cmd: t.key, title: !onSheet ? noSheet : panelOnly && sh?.kind !== 'system' ? 'On system SLD sheets' : `${t.label} (${t.key}): ${t.hint}`,
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

  // The SLD tab's tools; the Load schedule tab shares some of them.
  const [run, canvas, boards, equipment, selection]: Tool[][] = [
    [{ label: 'Run', icon: Play, title: a.staleCount ? `Run calculations (F5) — ${a.staleCount} out of date` : 'Run calculations (F5) — up to date', onClick: a.onRun, stale: a.staleCount > 0 }],
    [
      { label: 'SLD', icon: Network, title: 'Single line diagram', onClick: go('design'), active: a.view === 'design', page: true },
      view('drawings', 'Sheets', Files, 'The submission sheets of this design (Design CAD → Sheet set): SLDs, risers and earthing, with title blocks, clouds and notes'),
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
      { label: 'Delete', icon: Trash2, title: sel ? `Delete ${selName}${sel.kind === 'board' ? ' and everything fed from it' : ''} (Delete key)` : 'Select a board or feeder first', onClick: a.onDeleteSelected, disabled: !sel },
      { label: 'Show on plan', icon: LocateFixed, title: 'Show the selected board or circuit on its floor plan in Design CAD', onClick: () => a.sld?.onShowOnPlan(), disabled: !sel || !a.sld }
    ]
  ];
  // The SLD tab's own tools beside those: the checks, the equipment library's supply and device items, what the system
  // diagram shows, copy and undo, fit and export. The Load schedule tab keeps the plain Run and Add load.
  const s = a.sld, offSystem = !s?.system, onSystemOnly = 'On the system diagram';
  const lib = (g: string) => PALETTE.find((x) => x.group === g)?.entries ?? [];
  const armItem = (e: PaletteEntry, sep?: boolean) => ({ label: e.label, title: e.title, onClick: () => s?.onArm(e.item, e.label), sep });
  const supplyItems = lib('Supply');
  const supplyNow = !s || s.supply === 'normal' ? 'Normal' : s.supply === 'generator' ? 'On generator' : `${s.supply.slice(7)} transformer out`;
  const [sldRun, sldEquipment, results, copyUndo, sldView, output]: Tool[][] = [
    [
      { ...run[0], sub: a.staleCount ? `${a.staleCount} out of date` : undefined },
      { label: 'Check', icon: ListChecks, sub: s?.fails ? `${s.fails} fail` : s?.warns ? `${s.warns} to check` : undefined,
        title: s?.fails || s?.warns ? `Show the next ${s.fails ? 'failing circuit' : 'circuit to check'} on the drawing — ${s.fails} failing, ${s.warns} to check` : 'Every circuit is within limits',
        onClick: () => s?.onCheck(), disabled: !s?.fails && !s?.warns }
    ],
    [
      { label: 'Supply', icon: TransformerIcon, title: 'Add a transformer: then click the empty canvas, or a main board to give it one — the arrow beside it for a meter cabinet, a generator, a bus coupler or the HV supply',
        onClick: () => supplyItems[0] && s?.onArm(supplyItems[0].item, supplyItems[0].label), disabled: !s,
        menu: [...supplyItems.map((e) => armItem(e)), { label: 'HV supply and RMUs…', title: 'Panels → Transformers: the authority HV supply and each RMU', onClick: () => s?.onHvSupply(), sep: true }] },
      ...equipment,
      { label: 'Devices', icon: ShieldCheck, title: 'Protection, metering and a capacitor bank from the equipment library: choose one, then click the feeder or busbar it goes on', onClick: () => {}, menuOnly: true, disabled: !s,
        menu: [...lib('Protection').map((e) => armItem(e)), ...lib('Metering & accessories').map((e, i) => armItem(e, i === 0)), ...lib('Loads').filter((e) => e.item.kind === 'capacitor').map((e) => armItem(e, true))] }
    ],
    [
      sm({ label: 'Values', icon: Tags, sub: s ? `${LAYER_LABELS.filter(([k]) => s.layers[k]).length} shown` : undefined, title: offSystem ? onSystemOnly : 'The result values shown on the drawing', onClick: () => {}, menuOnly: true, disabled: offSystem,
        menu: LAYER_LABELS.map(([k, label]) => ({ label, title: `${label} on the drawing`, checked: !!s?.layers[k], keep: true, onClick: () => s?.onLayers({ ...s.layers, [k]: !s.layers[k] }) })) }),
      sm({ label: 'Colour by', icon: Palette, sub: COLOR_BY.find((c) => c.value === s?.colorBy)?.label, title: offSystem ? onSystemOnly : 'Colour the drawing by how close each circuit is to a limit', onClick: () => {}, menuOnly: true, disabled: offSystem,
        menu: COLOR_BY.map((c) => ({ label: c.label, title: c.legend || 'No colouring', checked: s?.colorBy === c.value, onClick: () => s?.onColorBy(c.value) })) }),
      sm({ label: 'Scenario', icon: ArrowLeftRight, sub: s ? supplyNow : undefined, title: offSystem ? onSystemOnly : 'Operating scenario: normal, mains lost (standby generators), or one transformer out with the bus tie closed', onClick: () => {}, menuOnly: true, disabled: offSystem,
        menu: [
          { label: 'Normal supply', title: 'Every transformer in service', checked: s?.supply === 'normal', onClick: () => s?.onSupply('normal') },
          { label: 'On generator (mains lost)', title: s?.hasGenerator ? 'The network as it runs on the standby generators' : 'Add a generator first', checked: s?.supply === 'generator', disabled: !s?.hasGenerator, onClick: () => s?.onSupply('generator') },
          ...(s?.outages ?? []).map((id) => ({ label: `Transformer of ${id} failed`, title: `The transformer of ${id} out, the bus tie closed`, checked: s?.supply === `outage:${id}`, onClick: () => s?.onSupply(`outage:${id}`) }))
        ] })
    ],
    [
      sm({ label: 'Copy', icon: Copy, title: s?.canCopy ? `Copy ${a.boardId} with everything below it (⌘C / Ctrl+C)` : 'Select a board on the SLD first', onClick: () => s?.onCopy(), disabled: !s?.canCopy }),
      sm({ label: 'Paste', icon: ClipboardPaste, title: s?.canPaste ? `Paste ${s.copied} on ${a.boardId} (⌘V / Ctrl+V)` : s?.copied ? 'Select the board to paste it on' : 'Copy a board first', onClick: () => s?.onPaste(), disabled: !s?.canPaste }),
      sm({ label: 'Undo', icon: Undo2, title: 'Undo (⌘Z / Ctrl+Z)', onClick: a.onUndo, disabled: !a.canUndo, col: true }),
      sm({ label: 'Redo', icon: Redo2, title: 'Redo (⇧⌘Z / Ctrl+Y)', onClick: a.onRedo, disabled: !a.canRedo })
    ],
    [sm({ label: 'Fit', icon: Scan, title: offSystem ? onSystemOnly : 'Fit the whole drawing (F or 0, or double-click the wheel)', onClick: () => s?.onFit(), disabled: offSystem })],
    [
      { label: 'Export', icon: FileDown, title: 'Export the SLD: a PDF sheet with title block, DXF or DWG for CAD, or SVG — the arrow beside it for OpenDSS', onClick: () => s?.onExport(), disabled: !s,
        menu: [
          { label: 'Drawing: SVG, DXF, DWG or PDF…', title: 'A PDF sheet with title block, DXF or DWG for CAD, or SVG', onClick: () => s?.onExport() },
          { label: 'OpenDSS (.dss)', title: 'The network as an OpenDSS script', onClick: a.onExportDss }
        ] }
    ]
  ];

  // The Load schedule tab's own tools. The page publishes them; the grid ones act on its selection and active row.
  // Under Balance phases: how far apart the phases are, (max − min) ÷ average; "imbalance n %" is too wide for the line.
  const ls = a.schedule;
  const lsOff = !ls ? 'On the Load schedule page' : undefined, gridOff = lsOff ?? (ls?.grid ? undefined : 'On the DB load schedule form');
  const lsForm = ls?.form ?? 'db', lsMd = lsForm === 'md', lsTx = lsForm === 'tx', lsRiser = lsForm === 'riser';
  const rowsOff = lsOff ?? (lsForm === 'db' || lsMd ? undefined : 'On a DB load schedule or a panel\'s form');
  const waysOff = lsOff ?? (lsForm === 'db' || lsMd ? undefined : 'On a DB or a panel\'s form');
  const rowOff = lsOff ?? (lsRiser ? undefined : ls?.row ? undefined : lsForm === 'db' ? 'Click a circuit row on the schedule first' : 'Click a row on the form first');
  const rowKind = lsForm === 'db' ? 'circuit' : lsTx ? 'transformer' : 'row';
  const stepOff = (end: string | undefined, name: string) => lsOff ?? (!ls?.board ? 'On a board\'s schedule' : end ? undefined : `${name} board of the schedule`);
  const lsRun: Tool[] = [
    { ...run[0], sub: a.staleCount ? `${a.staleCount} out of date` : undefined },
    { label: 'Check', icon: ListChecks, sub: ls?.fails ? `${ls.fails} fail` : ls?.warns ? `${ls.warns} to check` : undefined,
      title: gridOff ?? (ls?.fails || ls?.warns ? `Show the next ${ls.fails ? 'failing circuit' : 'circuit to check'} in this schedule — ${ls.fails} failing, ${ls.warns} to check` : 'No problem in this schedule — press to look in the other boards'),
      onClick: () => ls?.onCheck(), disabled: !!gridOff }
  ];
  const lsSchedule: Tool[] = [
    view('load-schedule', 'Load schedule', Table2, 'DEWA load distribution schedule per DB'), boards[0], boards[1], boards[3],
    sm({ label: 'Previous board', icon: ChevronLeft, title: stepOff(ls?.prevBoard, 'First') ?? `Previous board: ${ls?.prevBoard}`, onClick: () => ls?.onBoardStep(-1), disabled: !!stepOff(ls?.prevBoard, 'First') }),
    sm({ label: 'Next board', icon: ChevronRight, title: stepOff(ls?.nextBoard, 'Last') ?? `Next board: ${ls?.nextBoard}`, onClick: () => ls?.onBoardStep(1), disabled: !!stepOff(ls?.nextBoard, 'Last') })
  ];
  const [lsCircuits, lsRows, lsBalance, lsCopyUndo, lsOutput]: Tool[][] = [
    [
      lsMd ? { label: 'Add feeder', icon: ListPlus, title: `Add an outgoing feeder (an equipment load, sized by the app) to ${a.boardId} — the arrow beside it for a board fed from ${a.boardId}`, onClick: () => ls?.onAddCircuit(),
        menu: [{ label: 'Feeder (equipment load)', title: `Add an outgoing feeder (an equipment load, sized by the app) to ${a.boardId}`, onClick: () => ls?.onAddCircuit() }, ...boardMenu.map((m, i) => (i === 0 ? { ...m, sep: true } : m))] }
      : lsTx ? { label: 'Add transformer', icon: ListPlus, title: `Add a transformer to ${ls?.substation} — the arrow beside it for a new substation`, onClick: () => ls?.onAddTransformer(false),
        menu: [{ label: `Transformer in ${ls?.substation}`, title: `Add a transformer to ${ls?.substation}`, onClick: () => ls?.onAddTransformer(false) }, { label: 'New substation', title: 'Add a transformer in a new substation', onClick: () => ls?.onAddTransformer(true) }] }
      : { label: 'Add circuit', icon: ListPlus, title: lsOff ?? (lsRiser ? 'On a DB, a panel\'s form or the TCL summary' : `Add a circuit in the next free way of ${a.boardId} — the arrow beside it for a 3-phase circuit`), onClick: () => ls?.onAddCircuit(), disabled: !!lsOff || lsRiser,
        menu: [
          { label: 'Circuit', title: `Add a circuit in the next free way of ${a.boardId}`, onClick: () => ls?.onAddCircuit() },
          { label: '3-phase circuit', title: `Add a 3-phase circuit (RYB) to ${a.boardId}`, onClick: () => ls?.onAddCircuit(true) }
        ] },
      { label: 'Spare', icon: SquareDashed, title: waysOff ?? 'A spare is a way with a breaker fitted and nothing connected; a space is an empty way kept for a future breaker. Neither carries load.', onClick: () => (lsMd ? ls?.onAddSpare('spare', 'three') : ls?.onAddSpare('spare')), disabled: !!waysOff,
        menu: lsMd ? [
          { label: 'Spare', title: 'A 3-phase way with a breaker fitted and nothing connected', onClick: () => ls?.onAddSpare('spare', 'three') },
          { label: 'Space', title: 'A 3-phase empty way kept for a future breaker', onClick: () => ls?.onAddSpare('space', 'three') },
          { label: '1-phase spare', title: 'A 1-phase way with a breaker fitted and nothing connected', onClick: () => ls?.onAddSpare('spare', 'one'), sep: true },
          { label: '1-phase space', title: 'A 1-phase empty way kept for a future breaker', onClick: () => ls?.onAddSpare('space', 'one') }
        ] : [
          { label: 'Spare', title: 'A way with a breaker fitted and nothing connected', onClick: () => ls?.onAddSpare('spare') },
          { label: 'Space', title: 'An empty way kept for a future breaker', onClick: () => ls?.onAddSpare('space') },
          { label: '3-phase spare', title: 'A 3-phase way with a breaker fitted and nothing connected', onClick: () => ls?.onAddSpare('spare', 'three'), sep: true },
          { label: '3-phase space', title: 'A 3-phase empty way kept for a future breaker', onClick: () => ls?.onAddSpare('space', 'three') }
        ] },
      equipment[0]
    ],
    [
      sm({ label: 'Fill down', icon: ArrowDownToLine, title: rowsOff ?? 'Fill down (Ctrl/⌘ D): the top cell of the selected cells copied down them', onClick: () => ls?.onFillDown(), disabled: !!rowsOff }),
      sm({ label: 'Duplicate', icon: CopyPlus, title: rowsOff ?? (lsMd ? rowOff ?? ls?.dupBlock ?? `Duplicate feeder ${ls?.row} in ${a.boardId}` : rowOff ?? `Duplicate circuit ${ls?.row} in the next free way`), onClick: () => ls?.onDuplicate(), disabled: !!rowsOff || !!rowOff || (lsMd && !!ls?.dupBlock) }),
      sm({ label: 'Edit', icon: Pencil, title: lsRiser ? 'Edit the busbar riser (Calculate → Busbar riser)' : rowOff ?? `Edit ${rowKind === 'row' ? '' : `${rowKind} `}${ls?.row} (or double-click the row)`, onClick: () => ls?.onEditRow(), disabled: !!rowOff, col: true }),
      sm({ label: 'Delete', icon: Trash2, title: lsRiser ? 'On a DB, a panel\'s form or the TCL summary' : rowOff ?? (lsMd ? ls?.rowBlock : undefined) ?? `Delete ${rowKind === 'row' ? '' : `${rowKind} `}${ls?.row}`, onClick: () => ls?.onDeleteRow(), disabled: lsRiser || !!rowOff || (lsMd && !!ls?.rowBlock) })
    ],
    [
      { label: 'Balance phases', icon: Scale, sub: ls?.grid && ls.imbalancePct !== undefined ? `${ls.imbalancePct} % apart` : undefined,
        title: gridOff ?? 'Lighting circuits first, then power, each starting on an ELCB section; spread over R/Y/B and renumber', onClick: () => ls?.onBalance(), disabled: !!gridOff || !ls?.canBalance }
    ],
    [
      sm({ label: 'Copy', icon: Copy, title: rowsOff ?? 'Copy the selected cells (Ctrl/⌘ C)', onClick: () => ls?.onCopy(), disabled: !!rowsOff }),
      sm({ label: 'Paste', icon: ClipboardPaste, title: rowsOff ?? 'Paste from the clipboard at the selected cell (Ctrl/⌘ V)', onClick: () => ls?.onPaste(), disabled: !!rowsOff }),
      sm({ label: 'Undo', icon: Undo2, title: 'Undo (⌘Z / Ctrl+Z)', onClick: a.onUndo, disabled: !a.canUndo, col: true }),
      sm({ label: 'Redo', icon: Redo2, title: 'Redo (⇧⌘Z / Ctrl+Y)', onClick: a.onRedo, disabled: !a.canRedo })
    ],
    [
      { label: 'Export', icon: FileDown, sub: ls?.exporting ? 'Exporting…' : undefined, title: lsOff ?? 'This form as an Excel workbook, laid out like the authority form — the arrow beside it for PDF, CSV, the submission pack or your own template',
        onClick: () => ls?.onExport('excel'), disabled: !ls || ls.exporting,
        menu: [
          { label: 'Excel: this form', title: 'This form as an Excel workbook, laid out like the authority form', onClick: () => ls?.onExport('excel') },
          { label: 'PDF: this form', title: 'This form as PDF', onClick: () => ls?.onExport('pdf') },
          { label: 'CSV', title: ls?.grid ? 'The circuits of this DB as a CSV file' : 'On the DB load schedule form', onClick: () => ls?.onExport('csv'), disabled: !ls?.grid },
          { label: 'Submission pack (Excel)', title: 'Every form of the project in one workbook: load summary, MDB / SMDB / MCC forms, then every DB schedule', onClick: () => ls?.onExport('pack'), sep: true },
          { label: 'My Excel template…', title: ls?.grid ? 'Fill your own Excel load schedule format: placeholders such as {{board.id}} and a row of {{row.…}} repeated for every circuit' : 'On the DB load schedule form', onClick: () => ls?.onExport('template'), disabled: !ls?.grid },
          { label: 'Open in my format', title: !ls?.grid ? 'On the DB load schedule form' : ls.sheetFormat ? 'This DB as a sheet in your own format, in Sheets' : 'Choose a DB format in Sheets → My formats first', onClick: () => ls?.onOpenSheet(), disabled: !ls?.grid || !ls.sheetFormat },
          { label: 'Form details…', title: lsMd || lsTx ? 'Project, area, owner, plot, consultant and contractor on the authority forms' : 'On a panel\'s form or the TCL summary', onClick: () => ls?.onFormDetails(), disabled: !lsMd && !lsTx, sep: true }
        ] }
    ]
  ];

  const stageGroups: Record<Exclude<RibbonTab, 'schedule' | 'sld'>, Tool[][]> = {
    sheets: [],
    spec: [],
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
        view('drawings', 'Sheets', Files, 'The submission sheets of this design (Design CAD → Sheet set): SLDs, risers and earthing, with title blocks, clouds and notes'),
        view('busbar', 'Busbar riser', AlignVerticalSpaceAround, 'Busbar trunking risers for high-rise buildings: rating (Cu / Al), area, voltage drop per floor, size and weight')
      ],
      [
        view('pfc', 'Power factor', BatteryCharging, 'Power factor correction: capacitor banks from the maximum demand'),
        view('ups', 'UPS & battery', BatteryFull, 'UPS rating and battery sizing for the backup time'),
        view('solar', 'Solar PV', Sun, 'Solar PV array, string design, inverters and yield'),
        view('lightning', 'Lightning', Zap, 'Lightning protection at concept stage: roof mesh, rods or ESE terminal, down conductors and earth pits'),
        view('earth-schematic', 'Earth pits', Network, 'Earthing schematic: earth pits of the RMUs, transformers and main boards, and how they are linked')
      ],
      [
        view('elv', 'ELV systems', Cctv, 'ELV estimate from the rooms of Building: fire alarm, CCTV, access control, ICT and public address — devices, supplies and the kW each LV circuit feeds'),
        { ...view('inbox', 'Inbox', Inbox, a.inboxCount ? `Packages from other programs to review — ${a.inboxCount} waiting` : 'Packages from other programs (CAD, IFC, ELV): review and accept before they change the project'), sub: a.inboxCount ? `${a.inboxCount} to review` : undefined, stale: a.inboxCount > 0 }
      ],
      [gate('schematic')]
    ],
    detailed: [
      run,
      [
        view('selection', 'Selection', ListTree, 'Breaker and cable selection'),
        view('voltage-drop', 'Voltage drop', TrendingDown, 'Voltage drop calculation: panels and equipment cables, with report'),
        view('earthing', 'Earthing', Gauge, 'Fault loop impedance and disconnection time'),
        view('coordination', 'Protection', ShieldCheck, 'Protection coordination and selectivity')
      ],
      [gate('detailed')]
    ],
    cad: [
      // Draw: the four main drawing tools and Hatch, then Rectangle, Polygon and Ellipse.
      [
        cadTool('line', 'Line', Slash, 'Line (L): click points; type a length, x,y or @dx,dy; Enter stops'),
        cadTool('pline', 'Polyline', Spline, 'Polyline (PL): click points; C or the first point closes it; Enter finishes'),
        withList(cadTool('circle', 'Circle', Circle, 'Circle (C): centre, then radius (a point or typed; D for the diameter). The arrow: by its diameter, two or three points'), [
          ['circle', 'Centre, radius (C)', 'Centre, then radius'], ['circled', 'Centre, diameter', 'Centre, then the diameter'],
          ['circle2p', '2 points', 'The two ends of a diameter'], ['circle3p', '3 points', 'Three points on the circle']]),
        withList(cadTool('arc', 'Arc', Rainbow, 'Arc (A): start, a point on it, end. The arrow: start, centre, end'), [
          ['arc', '3 points (A)', 'Start, a point on it, end'], ['arcsce', 'Start, centre, end', 'Start, the centre, then the end (anticlockwise)']]),
        withList(cadTool('hatch', 'Hatch', PaintBucket, 'Hatch (H): the pattern on the right, then click inside a closed drawn object or a room. The arrow: edit a hatch, or a boundary polyline'), [
          ['hatch', 'Hatch (H)', 'Click inside a closed object or a room'], ['hatchedit', 'Edit hatch (HE)', 'Pattern, spacing, angle, origin and islands of a hatch'],
          ['boundary', 'Boundary (BO)', 'A closed polyline round an area']]),
        sm(cadTool('rect', 'Rectangle', RectangleHorizontal, 'Rectangle (REC): two opposite corners')),
        sm(cadTool('polygon', 'Polygon', Pentagon, 'Polygon (POL): the number of sides, the centre, then the radius (I: corners on it, C: sides touching it)')),
        sm(cadTool('ellipse', 'Ellipse', EllipseIcon, 'Ellipse (EL): centre, the end of one axis, then the other axis; A for the two ends of an axis')),
        // Under Draw's ▾ (S8 of the 2D gap plan): points, and points set out along an object.
        { ...cadTool('point', 'Point', Dot, 'Point (PO): click each point; Enter stops'), more: true },
        { ...cadTool('divide', 'Divide', Divide, 'Divide (DIV): pick an object, then the number of parts: points (or a block) at the divisions'), more: true },
        { ...cadTool('measure', 'Measure out', Ruler, 'Measure out (ME): pick an object, then the length: points (or a block) every length along it'), more: true },
        { ...cadCmd('Point style…', Target, 'PTYPE', 'Point style (PTYPE): the shape and size of drawn points'), more: true }
      ],
      // Modify: three rows, column by column (Move, Copy, Stretch · Rotate, Mirror, Scale · Trim, Extend, Break · Fillet,
      // Chamfer, Join · Offset, Array, Explode · Erase); Quick select under Modify ▾.
      [
        sm(cadTool('move', 'Move', Move, 'Move (M): select an object (drawn or a device), base point, second point')),
        sm(cadTool('copy', 'Copy', Copy, 'Copy (CO): select, base point, then as many copies as you click; Enter stops. A copied light or socket is counted on its circuit')),
        sm(cadTool('stretch', 'Stretch', StretchHorizontal, 'Stretch (S): a window round the points to move, then base point and second point — a tray end moves, its far end stays')),
        sm(cadTool('rotate', 'Rotate', RotateCw, 'Rotate (RO): select a drawn object, base point, then an angle (typed degrees or a point)')),
        sm(cadTool('mirror', 'Mirror', FlipHorizontal2, 'Mirror (MI): pick drawn objects, Enter, then two points of the mirror line; keep the originals or not')),
        sm(cadTool('scale', 'Scale', Scaling, 'Scale (SC): pick drawn objects, Enter, then the base point; the factor is on the right')),
        sm(cadTool('trim', 'Trim', Scissors, 'Trim (TRIM): click the part to cut away — cut at the nearest lines crossing it, drawn or the architect\'s (never changed); Shift-click extends')),
        sm(cadTool('extend', 'Extend', ArrowRightToLine, 'Extend (EX): click near an end: it runs on to the next line or wall ahead')),
        sm(cadTool('break', 'Break', Unlink2, 'Break (BR): click the object where it breaks, then a second point (the part between goes), or Enter to split it there')),
        sm(cadTool('fillet', 'Fillet', CornerUpRight, 'Fillet (F): click two lines near the corner; joined with the radius on the right (0 = sharp corner; trays meet in a bend)')),
        sm(cadTool('chamfer', 'Chamfer', TriangleRight, 'Chamfer (CHA): click two lines; the corner cut at the two distances on the right')),
        sm(cadTool('join', 'Join', Link2, 'Join (J): pick lines and polylines that meet end to end, then Enter: one polyline')),
        sm(cadTool('offset', 'Offset', Rows2, 'Offset (O): the distance on the right, click the object, then the side; a tray is copied as a tray of the same width and route')),
        sm(cadTool('array', 'Array', Grid2x2, 'Array (AR): pick drawn objects, Enter; rectangular copies (Apply) or polar round a centre clicked')),
        sm(cadTool('explode', 'Explode', Ungroup, 'Explode (X): click a polyline or rectangle: separate lines')),
        sm({ label: 'Erase', icon: Eraser, cmd: 'E', title: 'Erase the selected object (E or Delete); a light or socket is taken off its circuit. The architect\'s drawing is not changed', onClick: () => a.cad?.onDelete(), disabled: !a.cad?.hasSelection }),
        { ...cadCmd('Quick select…', ListFilter, 'QSELECT', 'Quick select (QS): pick objects by type, layer and property'), more: true },
        // Draw order (S7 of the 2D gap plan): its entries listed under the panel's ▾, after a separator.
        { label: 'Draw order', icon: BringToFront, cmd: 'DR', title: 'Draw order (DR): the objects picked to the front, the back, above or under another object; later in the order is on top', onClick: () => a.cad?.onCommand?.('DRAWORDER'), menuOnly: true, more: true, disabled: !a.cad?.hasDrawing, menu: [
          { label: 'Bring to front', title: 'The objects picked over everything else (DR F)', onClick: () => a.cad?.onCommand?.('DRAWORDER F') },
          { label: 'Send to back', title: 'The objects picked under everything else (DR B)', onClick: () => a.cad?.onCommand?.('DRAWORDER B') },
          { label: 'Above object', title: 'The objects picked just over the object clicked next (DR A)', onClick: () => a.cad?.onCommand?.('DRAWORDER A') },
          { label: 'Under object', title: 'The objects picked just under the object clicked next (DR U)', onClick: () => a.cad?.onCommand?.('DRAWORDER U') },
          { label: 'Text to front (TEXTTOFRONT)', title: 'Texts, dimensions or leaders over everything else', onClick: () => a.cad?.onCommand?.('TEXTTOFRONT') }] }
      ],
      // Annotate: Text (numbered text and the text tools under the arrow), Dimension (its forms under the arrow) and
      // Leader, then Room tag, Keynote, North arrow, Revision cloud, Text style and Dimension style. On a layout's paper the
      // markup takes its place.
      [
        { ...cadTool('text', 'Text', Type, 'Text (T): click where it goes, type it on the command line, Enter. The arrow: numbered text and the text tools'),
          active: TEXT_TOOLS.some(([k]) => a.cad?.tool === k), menu: TEXT_TOOLS.map(([k, label, title], i) => ({ label, title, onClick: () => a.cad?.onTool(k), sep: i === 3 })) },
        { ...cadTool('dim', 'Dimension', MoveHorizontal, 'Dimension (DIM): two points, then where the dimension line goes; it shows the length in the unit of its dimension style'), menu: [
          { label: 'Aligned (DIM)', title: 'Two points, then where the dimension line goes', onClick: () => a.cad?.onTool('dim') },
          { label: 'Linear (DLI)', title: 'Two points, then where the dimension line goes: horizontal above or below them, vertical beside them', onClick: () => a.cad?.onTool('dimlin') },
          { label: 'Continue (DCO)', title: 'From the last dimension\'s second point: click each next point; the dimensions run in one line', onClick: () => a.cad?.onTool('dimcont') },
          { label: 'Baseline (DBA)', title: 'From the last dimension\'s first point: click each next point; each dimension one step further out', onClick: () => a.cad?.onTool('dimbase') },
          { label: 'Radius (DRA)', title: 'Click an arc or circle, then where the text goes', onClick: () => a.cad?.onTool('dimrad') },
          { label: 'Diameter (DDI)', title: 'Click an arc or circle, then where the text goes', onClick: () => a.cad?.onTool('dimdia') },
          { label: 'Angular (DAN)', title: 'Two lines (or an arc, or a vertex and two points), then where the arc goes', onClick: () => a.cad?.onTool('dimang') }] },
        cadTool('leader', 'Leader', MessageSquareText, 'Leader (LE): click the arrow point, then the text point (more points bend it), type the text, Enter'),
        sm(cadTool('rtag', 'Room tag', Tag, 'Room tag (RT): click inside a room: its name and area')),
        sm(cadTool('keynote', 'Keynote', Hexagon, 'Keynote (KN): a numbered hexagon keynote with a line in the legend')),
        sm(cadTool('north', 'North arrow', Navigation, 'North arrow (NORTH): click where it goes')),
        sm(cadTool('revcloud', 'Revision cloud', Cloud, 'Revision cloud (REVCLOUD): two corners, or P and the points round the change; arcs 15 mm long on paper, or type a length')),
        sm(cadCmd('Text style', CaseSensitive, 'ST', 'Text style (ST): named text styles with their height on paper; new text takes the current one', 'STYLE')),
        sm(cadCmd('Dim style', SlidersHorizontal, 'D', 'Dimension style (D): the arrows, sizes, unit and decimals of new dimensions', 'DIMSTYLE'))
      ],
      // Blocks (S9 of the 2D gap plan): the drawing's own blocks. Create first; Insert and the palette come with S10.
      [
        { label: 'Insert', icon: Package, cmd: 'I', title: 'Insert (I): the Blocks palette — blocks of this drawing, recent ones and the library folder', onClick: () => a.cad?.onCommand?.('INSERT'), active: !!a.cad?.blocksOn, disabled: !a.cad?.hasDrawing, menu: [
          ...(a.cad?.info?.blocks ?? []).slice(0, 12).map((n) => ({ label: n, title: `Insert "${n}": click where it goes`, onClick: () => a.cad?.onCommand?.(`-INSERT ${n}`) })),
          { label: 'More blocks…', title: 'The Blocks palette: this drawing\'s blocks, recent ones and the library folder', onClick: () => a.cad?.onCommand?.('INSERT'), sep: (a.cad?.info?.blocks?.length ?? 0) > 0 }] },
        sm({ label: 'Create', icon: Box, cmd: 'B', title: 'Create block (B): name it, pick its base point and objects', onClick: () => a.cad?.onCommand?.('BLOCK'), disabled: !a.cad?.hasDrawing }),
        // Attributes (S11): a definition drawn for a block; Edit attributes under the panel's ▾.
        sm({ label: 'Attribute', icon: Tags, cmd: 'ATT', title: 'Attribute definition (ATT): a tag, prompt and default value, drawn as text for a block', onClick: () => a.cad?.onCommand?.('ATTDEF'), disabled: !a.cad?.hasDrawing }),
        { ...cadCmd('Edit attributes', ClipboardList, 'EATTEDIT', 'Edit attributes (EATTEDIT): pick a block, then type its values; a double-click on the block opens it too'), more: true }
      ],
      // Layers: the layer palette; the current layer list (PANEL) over two rows of three, column by column (Off, All on ·
      // Freeze, Thaw all · Lock, Unlock), then Isolate, Unisolate and Make current beside them; Layer roles, New layer and
      // the layers panel under Layers ▾.
      [
        { label: 'Layers', icon: Layers, cmd: 'LM', title: 'Layers (LM): the layer palette, docked beside the drawing — each layer on, frozen, locked, its colour, linetype and lineweight; the app\'s drawn layers, the architect\'s and the references\'; new layers, isolate and layer states', onClick: () => a.cad?.onLayerManager?.(), disabled: !a.cad?.hasDrawing },
        sm(cadCmd('Off', LightbulbOff, 'LAYOFF', 'Layer off (LAYOFF): pick objects first; their layers go off')),
        sm(cadCmd('All on', Lightbulb, 'LAYON', 'All on (LAYON): every layer on again')),
        sm(cadCmd('Freeze', Snowflake, 'LAYFRZ', 'Freeze (LAYFRZ): pick objects first; their layers are frozen: hidden, not picked, left out of zoom and the sheets')),
        sm(cadCmd('Thaw all', Sun, 'LAYTHW', 'Thaw all (LAYTHW): every layer thawed')),
        sm(cadCmd('Lock', Lock, 'LAYLCK', 'Lock (LAYLCK): pick objects first; their layers are locked: shown, not changed')),
        sm(cadCmd('Unlock', LockOpen, 'LAYULK', 'Unlock (LAYULK): pick objects first; their layers are unlocked')),
        sm(cadCmd('Isolate', Focus, 'LAYISO', 'Isolate (LAYISO): only the layers of the objects picked stay on')),
        sm(cadCmd('Unisolate', Layers2, 'LAYUNISO', 'Unisolate (LAYUNISO): the layers Isolate turned off come back on')),
        sm(cadCmd('Make current', CircleCheck, 'LAYMCUR', 'Make current (LAYMCUR): pick an object first; its layer becomes the current one')),
        { label: 'Layer roles', icon: Layers3, title: 'Layer roles: what each layer is — wall, room outline, room name, tray, route… (used to find rooms and walls)', onClick: () => a.cad?.onRoles(), active: a.cad?.rolesOn, disabled: !a.cad?.hasDrawing, more: true },
        { ...cadCmd('New layer', Plus, 'LAYER N', 'New layer (LAYER N): a new drawn layer in the layer palette, to rename'), more: true },
        { label: 'Layers panel', icon: Layers, cmd: 'LA', title: 'Layers panel (LA): show or hide the list of the architect\'s layers', onClick: () => a.cad?.onLayers(), active: a.cad?.layersOn, more: true }
      ],
      // Properties: Match, with the colour, linetype and lineweight lists beside it (PANEL); ↘ shows the palette.
      [cadTool('matchprop', 'Match properties', PaintRoller, 'Match properties (MP): click the drawn object to copy from, then each to change: layer, colour, linetype, lineweight')],
      // Measure and view: Distance, Area, Room area · Inspect, Zoom extents, Drafting settings.
      [
        sm(cadTool('dist', 'Distance', Ruler, 'Distance (DI): between two snapped points; ORTHO keeps it straight')),
        sm(cadTool('area', 'Area', LandPlot, 'Area (AREA): area and perimeter from snapped corners, or a closed object (AREA, then O)')),
        sm(cadTool('room', 'Room area', DoorOpen, 'Room area (RA): click inside a room: its area')),
        sm(cadCmd('Inspect', ScanSearch, 'LIST', 'Inspect (LIST): click an object: what it is')),
        sm({ label: 'Zoom extents', icon: Expand, cmd: 'FIT', title: 'Zoom extents (FIT): the whole drawing in the window', onClick: () => a.cad?.onCommand?.('FIT'), disabled: !a.cad?.hasDrawing || !a.cad.onCommand }),
        sm(cadCmd('Drafting settings', DraftingCompass, 'DS', 'Drafting settings (DS): snaps, grid, ORTHO and polar tracking', 'DSETTINGS'))
      ],
      // Markup: on the open sheet, or a layout's paper.
      [
        ...['select', 'cloud', 'text', 'callout'].map(markTool),
        ...['arrow', 'rect', 'line'].map((id) => sm(markTool(id))),
        sm({ label: 'Colour', icon: Palette, sub: named(colour), title: onSheet ? 'Colour of new markups and of the one selected: click for the next, the arrow to choose' : noSheet,
          onClick: () => setColour(COLOURS[(COLOURS.indexOf(colour) + 1) % COLOURS.length]), disabled: !onSheet,
          menu: COLOURS.map((c) => ({ label: named(c), title: `${named(c)} markups`, onClick: () => setColour(c) })) }),
        sm({ label: 'Text height', icon: ALargeSmall, sub: `${height} mm`, title: onSheet ? 'Letter height of notes and callouts on the paper' : noSheet, onClick: () => act().restyle({ size: MARKUP_SIZES[(MARKUP_SIZES.indexOf(height) + 1) % MARKUP_SIZES.length] }),
          disabled: !onSheet || !textual, menu: MARKUP_SIZES.map((z) => ({ label: `${z} mm`, title: `Letters ${z} mm high`, onClick: () => act().restyle({ size: z }) })) }),
        sm({ label: 'Delete', icon: Trash2, title: onSheet ? 'Delete the selected markup (Delete key)' : noSheet, onClick: () => act().removeSelected(), disabled: !onSheet || !sh?.selected })
      ],
      ['pcloud', 'parrow'].map(markTool),
      // Sheet: the open sheet's view.
      [
        { label: 'Fit', icon: Maximize, sub: onSheet ? ui?.pct : undefined, title: onSheet ? 'Fit the sheet to the window (F) · Ctrl/⌘ + scroll to zoom' : noSheet, onClick: () => ui?.setZoom('fit'), active: onSheet && ui?.zoom === 'fit', disabled: !onSheet },
        sm({ label: 'Zoom in', icon: ZoomIn, title: onSheet ? 'Zoom in' : noSheet, onClick: () => act().zoomIn(), disabled: !onSheet }),
        sm({ label: 'Zoom out', icon: ZoomOut, title: onSheet ? 'Zoom out' : noSheet, onClick: () => act().zoomOut(), disabled: !onSheet }),
        sm({ label: 'Legend', icon: BookImage, title: onSheet ? 'Symbol legend in the sheets\' legend column (and on SLD exports)' : noSheet, onClick: () => sh?.onLegend?.(), active: onSheet && !!sh?.legend?.on, disabled: !onSheet || !sh?.legend?.shown }),
        sm({ label: 'Side by side', icon: Columns2, title: onSheet ? 'The design on the left with each sheet\'s panels outlined, this sheet on the right' : noSheet, onClick: () => ui?.setSide(!ui.side), active: onSheet && !!ui?.side, disabled: !onSheet })
      ],
      // Electrical & ELV: how the plan feeds the design (rooms, cables and trays, devices, wiring).
      [
        { label: 'Add found', icon: LayoutGrid, cmd: 'ROOMS', title: 'Add every room the plan outlines (closed outlines on the Room outline layers, named by the text inside) to Building information on this level — one undo step (ROOMS)', onClick: () => a.cad?.onAddFound(), disabled: !a.cad?.hasDrawing },
        cadTool('room', 'Click inside', MousePointerClick, 'Click inside a room: its outline from the walls (doors closed), its area — then Add (RA)'),
        sm(cadTool('trace', 'Trace', PenLine, 'Click the corners of a room, Enter to close — then Add (TR)')),
        sm(cadTool('name', 'Pick name', Type, 'Click the room name on the drawing: it names the room found, or renames the room it is in (PN)'))
      ],
      [
        cadTool('tray', 'Cable tray', Rows3, 'Draw a cable tray run (CT): its points, Enter to finish, at the width chosen; the tray route can be assigned later'),
        cadTool('cable', 'Cable route', Cable, 'Draw the route of a cable (CR): choose the cable, click its points, Enter to finish'),
        sm(cadTool('link', 'Link route', Route, 'Click a line or polyline of the drawing: it becomes the chosen cable\'s route (LR)')),
        sm({ label: 'Place board', icon: CircuitBoard, title: 'Place a board on the plan: its room, level and position (Add device → DB)', onClick: () => a.cad?.onPlaceBoard(), active: a.cad?.placingBoard, disabled: !a.cad?.hasDrawing }),
        { label: 'Update schedules', icon: ListChecks, cmd: 'SCHED', title: 'From the trays and cable routes on every level\'s plan: tray route lengths and fittings (tray schedule and BOQ), cable lengths, and the tray routes each cable runs along — one undo step (SCHED)', onClick: () => a.cad?.onSchedules(), disabled: !a.cad?.hasDrawing }
      ],
      [
        { label: 'Add device', icon: CirclePlus, cmd: 'DEV', title: 'Place lights, sockets, a DB or ELV devices on the plan (DEV): choose it and its circuit, then click', onClick: () => a.cad?.onTool('dev'), active: a.cad?.tool === 'dev', disabled: !a.cad?.hasDrawing },
        cadTool('fill', 'Fill room', Grid3x3, 'Choose an ELV device, point at a room to see it at its coverage spacing, click to place them all (FILL)'),
        cadTool('lux', 'Light room', Lightbulb, 'Point at a room: its luminaires by the lumen method for its outline, then placed as lights on a circuit (LUX)'),
        sm(cadTool('em', 'Emergency', DoorOpen, 'Emergency lighting (BS 5266-1 / EN 1838): draw the escape routes, mark the points of emphasis and open areas; fittings and exit signs are placed at their spacing (EM)')),
        sm({ label: 'Coverage', icon: CircleDashed, cmd: 'COV', title: 'Show what the devices of the chosen ELV device\'s system cover, and what is not covered (COV)', onClick: () => a.cad?.onCoverage(), active: a.cad?.coverageOn, disabled: !a.cad?.hasDrawing }),
        sm({ label: 'Copy to level', icon: Copy, title: "Copy this level's devices of the chosen ELV device's system to another level, at the same plan positions", onClick: () => {}, menuOnly: true, disabled: !a.cad?.hasDrawing || !a.cad.copyLevels?.length, menu: a.cad?.copyLevels })
      ],
      [
        sm(cadTool('none', 'Select', BoxSelect, 'Select devices (SEL): click one, Shift-click to add or remove, or drag a window — left to right picks what is inside, right to left also what it crosses; a toolbar beside them has the edits that suit them', 'SEL')),
        sm(cadTool('arl', 'Array on line', Ellipsis, 'Array on line (ARL): click the start and the end of a line; N devices evenly along it, by number or spacing, on a circuit')),
        sm(cadTool('match', 'Match', Paintbrush, 'Match (MA): click the device to copy from, then each device to change: its circuit, and its type if chosen'))
      ],
      [
        { label: 'Wire circuits', icon: Workflow, cmd: 'WC', sub: 'all on this level', title: 'Wire every circuit with devices on this level: arcs between its devices in circuit order and a home run to its DB, tagged with the circuit, cable and length; Update schedules gives the cable schedule the lengths (WC)', onClick: () => a.cad?.onWireAll(), disabled: !a.cad?.hasDrawing },
        sm({ ...cadTool('wire', 'Wire one', Plug, 'Click a device: its circuit is wired, or its wiring is taken off when it is wired (W1)'), sub: 'pick a device' }),
        sm({ label: 'Tags', icon: Tags, cmd: 'TAGS', sub: a.cad?.tagsOn ? 'on' : 'off', title: 'Show or hide the wiring tags (DB-GF1/L3 · 2C × 1.5 mm² · 23 m) on the plan', onClick: () => a.cad?.onTags(), active: a.cad?.tagsOn, disabled: !a.cad?.hasDrawing })
      ],
      // Reference: other drawings shown under the plan.
      [
        { ...cadCmd('Attach', FilePlus2, 'XA', 'Attach a reference (XA): another drawing shown under this plan — the structure, other services, a site plan; its file is never changed', 'XATTACH') },
        sm(cadCmd('Clip', Crop, 'XCLIP', 'Clip a reference (XCLIP): show part of it only, inside a window or a closed outline')),
        sm({ ...cadCmd('Crop', SquareScissors, 'CROP', 'Crop a block (CROP): cut it along a window, circle or closed outline — what is inside stays as drawn lines, the rest is deleted, not hidden'), active: a.cad?.tool === 'crop' }),
        sm({ label: 'References', icon: Paperclip, cmd: 'XR', title: 'References (XR): other drawings shown under this plan — the structure, other services, a site plan. Attach (XA), reload, unload, detach, repath, clip, bind; the files are never changed', onClick: () => a.cad?.onRefs?.(), disabled: !a.cad?.hasDrawing })
      ],
      // The sheet set, layouts and viewports; the open sheet's page setup and export.
      [
        { label: 'All sheets', icon: Files, title: 'Every submission sheet: the register with filters, bulk changes, thumbnails and export (PDF, DXF, Excel)', onClick: () => a.sheets?.onTab('sheets'), active: SHEET_VIEWS.includes(a.view) && !a.sheets?.open && a.sheets?.tab === 'sheets', page: true },
        sm({ label: 'Layout', icon: LayoutGrid, title: 'How sheets are made and what they show: panels per sheet, values printed, legend', onClick: () => a.sheets?.onTab('layout'), active: SHEET_VIEWS.includes(a.view) && !a.sheets?.open && a.sheets?.tab === 'layout', page: true }),
        sm({ label: 'Title block', icon: PanelBottom, title: 'Title block and drawing numbering of the set', onClick: () => a.sheets?.onTab('titleblock'), active: SHEET_VIEWS.includes(a.view) && !a.sheets?.open && a.sheets?.tab === 'titleblock', page: true }),
        sm({ label: 'Issues', icon: Stamp, title: 'Issue sheets: revisions and transmittals', onClick: () => a.sheets?.onTab('issues'), active: SHEET_VIEWS.includes(a.view) && !a.sheets?.open && a.sheets?.tab === 'issues', page: true })
      ],
      [
        { label: 'New layout', icon: LayoutTemplate, cmd: 'LAYOUT', title: 'A new layout (paper) of this drawing, one from a template, or a plan sheet of this level (LAYOUT)', onClick: () => {}, menuOnly: true, disabled: !a.cad?.hasDrawing,
          menu: [
            { label: 'New layout', title: 'A new layout of this drawing: A3, the whole drawing in one viewport; Page setup changes its paper', onClick: () => a.cad?.onLayoutCmd?.('LAYOUT') },
            { label: 'From template…', title: 'A new layout from one of your layout templates: its paper, viewports and tables', onClick: () => a.cad?.onLayoutCmd?.('LAYOUT T') },
            ...(['Lighting', 'Power', 'ELV', 'Containment'] as const).map((t, i) => ({ label: `${t} layout`, title: `A new ${t.toLowerCase()} plan sheet of this level`, sep: i === 0, onClick: () => a.cad?.onLayoutCmd?.(`LAYOUT ${t.toUpperCase()}`) }))
          ] },
        sm({ label: 'Page setup', icon: FileCog, cmd: 'PAGESETUP', title: 'This layout\'s paper and page setup (PAGESETUP)', onClick: () => a.cad?.onLayoutCmd?.('PAGESETUP'), disabled: !a.cad?.inLayout }),
        sm({ label: 'Save as template', icon: Save, cmd: 'LAYOUT S', title: 'Save this layout as a template for new layouts: its paper, viewports and tables (LAYOUT S)', onClick: () => a.cad?.onLayoutCmd?.('LAYOUT S'), disabled: !a.cad?.inLayout })
      ],
      [
        { label: 'Viewport', icon: Frame, cmd: 'MV', title: 'A new viewport: click two corners on the paper (MV)', onClick: () => a.cad?.onLayoutCmd?.('MV') },
        { label: 'Arrange', icon: LayoutPanelLeft, cmd: 'VPORTS', title: 'Arrange the layout\'s viewports: one, two, three or four, or a plan with a key plan (VPORTS)', onClick: () => {}, menuOnly: true,
          menu: VP_ARRANGEMENTS.map((x) => ({ label: x.label, title: x.title, onClick: () => a.cad?.onLayoutCmd?.(`VPORTS ${x.id}`) })) },
        { label: 'Legend', icon: Table2, cmd: 'LEGEND', title: 'A legend table on the paper: click where its corner goes; its rows follow the plan, its frame picked sets the width, rows and columns (LEGEND)', onClick: () => a.cad?.onLayoutCmd?.('LEGEND') },
        { label: 'Notes', icon: ListOrdered, cmd: 'NOTES', title: 'A notes table on the paper: the sheet\'s notes where you put them (NOTES)', onClick: () => a.cad?.onLayoutCmd?.('NOTES') },
        sm({ label: 'Scale', icon: Scaling, cmd: 'VPSCALE', title: 'The scale of the viewport picked (VPSCALE)', onClick: () => {}, menuOnly: true,
          menu: [...(a.cad?.info?.scales ?? VP_SCALES).map((k) => ({ label: `1:${k}`, title: `Viewport at 1:${k}`, onClick: () => a.cad?.onLayoutCmd?.(`VPSCALE ${k}`) })),
            { label: 'Scale list…', title: 'The scales offered: tick more standard ones or add your own (SCALELISTEDIT)', sep: true, onClick: () => a.cad?.onLayoutCmd?.('SCALELISTEDIT') }] }),
        sm({ label: 'Lock', icon: Lock, cmd: 'VPLOCK', title: 'Lock or unlock the viewport picked: locked, pan and zoom inside it leave its view alone (VPLOCK)', onClick: () => a.cad?.onLayoutCmd?.('VPLOCK'), active: a.cad?.info?.vp?.locked ?? a.cad?.vpLocked }),
        sm({ label: 'Fit', icon: Expand, cmd: 'VPFIT', title: 'The whole level in the viewport picked, at the nearest scale of the list (VPFIT)', onClick: () => a.cad?.onLayoutCmd?.('VPFIT') }),
        sm({ label: 'Copy', icon: Copy, cmd: 'VPCOPY', title: 'A copy of the viewport picked, beside it (VPCOPY)', onClick: () => a.cad?.onLayoutCmd?.('VPCOPY') }),
        sm({ label: 'Align', icon: AlignVerticalSpaceAround, cmd: 'VPALIGN', title: 'Line up the view of the viewport picked with Viewport 1 (VPALIGN)', onClick: () => {}, menuOnly: true,
          menu: [{ label: 'Side by side', title: 'The same height of the plan on one line across both viewports', onClick: () => a.cad?.onLayoutCmd?.('VPALIGN H') },
            { label: 'Stacked', title: 'The same part of the plan one above the other', onClick: () => a.cad?.onLayoutCmd?.('VPALIGN V') }] }),
        sm({ label: 'Maximise', icon: Maximize2, cmd: 'VPMAX', title: 'The viewport\'s area on the Model tab, to work at full size; VPMIN or the layout\'s tab comes back (VPMAX)', onClick: () => a.cad?.onLayoutCmd?.('VPMAX') }),
        sm({ label: 'Frame prints', icon: Square, cmd: 'VPFRAME', title: 'The frame of the viewport picked prints, or shows on screen only (VPFRAME)', onClick: () => a.cad?.onLayoutCmd?.('VPFRAME'), active: a.cad?.info?.vp?.frame })
      ],
      // Output: plot one layout or sheet and its setup; publish many; export files for others. In model space the
      // drawing's own view, Publish and Save As stand in for the sheet's.
      [
        { label: 'Plot', icon: Printer, cmd: 'PLOT', title: onLayout ? 'Plot this layout or sheet to PDF or a printer, with a named page setup or its own, copies and pens (PLOT)' : inModel ? 'Plot the drawing\'s view to PDF, black on white; on a layout tab or sheet, with its page setup and to a printer too (PLOT)' : noDrawing, onClick: () => onLayout ? a.output?.onPlot() : a.cad?.onExport?.('pdfView'), disabled: onLayout ? !a.output : !inModel || !a.cad?.onExport },
        { label: 'Preview', icon: FileSearch, title: onSheet ? 'How it will print: the plotted PDF at the pen widths and greys' : onLayout ? 'On the paper: PS returns to it from the model' : 'How a layout or sheet will print: open one (the drawing\'s view has no page setup)', onClick: () => act().previewPdf(), disabled: !onSheet || !window.lvds?.files?.pdfBytes },
        sm({ label: 'Page setups', icon: FileCog, cmd: 'PAGESETUP', title: 'Named page setups of the project (paper, scale, pens, printer): make them and apply one to many layouts and sheets (PAGESETUP)', onClick: () => a.output?.onSetups(), disabled: !a.output,
          menu: [{ label: 'Named page setups…', title: 'Make named page setups and apply one to many layouts and sheets', onClick: () => a.output?.onSetups(), disabled: !a.output },
            { label: 'This sheet\'s page setup…', title: onSheet ? 'This sheet\'s own paper, scale (plans), pens, lineweights and plot stamp, or save them as the set\'s default' : noSheet, onClick: () => act().pageSetup(), disabled: !onSheet }] }),
        sm({ label: 'Pen tables', icon: PenLine, title: 'Pen tables: the width and ink each kind of line prints with; import a CTB plot style table', onClick: () => onSheet ? act().pens() : a.output?.onPens(), disabled: !onSheet && !a.output }),
        sm({ label: 'Printers', icon: Settings2, title: 'The printers on this computer and the built-in PDF: where plots go', onClick: () => a.output?.onPrinters(), disabled: !a.output })
      ],
      [
        { label: 'Publish', icon: Send, sub: onSheet ? sh?.publish?.label || undefined : undefined, title: onSheet ? sh?.publish?.title ?? 'Issue this sheet' : inModel || onLayout ? 'Publish this drawing\'s layouts: the ones ticked, as PDF, DXF or DWG (PUBLISH)' : noDrawing, onClick: () => onSheet ? act().publish() : a.cad?.onPublish?.(), stale: onSheet && !!sh?.publish?.changed, disabled: onSheet ? false : !(inModel || onLayout) || !a.cad?.onPublish },
        { label: 'Batch plot', icon: ListOrdered, cmd: 'BATCHPLOT', title: 'Many layouts and sheets in one run, each with its page setup, to one PDF, a PDF each or a printer; save the list and run it again (BATCHPLOT)', onClick: () => a.output?.onBatch(), disabled: !a.output }
      ],
      [
        { label: 'PDF', icon: FileText, title: onSheet ? 'This sheet as PDF' : inModel ? 'The drawing\'s view as PDF, black on white' : noDrawing, onClick: () => onSheet ? act().exportAs('pdf') : a.cad?.onExport?.('pdfView'), disabled: onSheet ? false : !inModel || !a.cad?.onExport },
        { label: 'DXF', icon: FileCode, title: onSheet ? 'This sheet as DXF (R12, editable layers)' : inModel ? 'Save the drawing as DXF: the version and what goes in (SAVEAS)' : noDrawing, onClick: () => onSheet ? act().exportAs('dxf') : a.cad?.onSaveAs?.(), disabled: onSheet ? false : !inModel || !a.cad?.onSaveAs },
        { label: 'DWG', icon: FileDown, title: onSheet ? 'This sheet as DWG (2018 format)' : inModel ? 'Save the drawing as DWG: the version and what goes in (SAVEAS)' : noDrawing, onClick: () => onSheet ? act().exportAs('dwg') : a.cad?.onSaveDwg?.(), disabled: onSheet ? false : !inModel || !a.cad?.onSaveDwg },
        { label: 'Register', icon: FileSpreadsheet, title: 'The sheet register as an Excel workbook', onClick: () => a.output?.onRegister(), disabled: !a.output }
      ]
    ],
    reports: [
      [
        view('load-schedule', 'Load schedule', Table2, 'DEWA load distribution schedule per DB'),
        view('cable-schedule', 'Cable schedule', Cable, 'Every cable in the installation'),
        view('cable-tray', 'Cable trays', Rows3, 'Cable tray schedule: routes A, B, C… with the cables on each and the tray size'),
        view('equipment', 'Equipment', FileSpreadsheet, 'Transformers and boards')
      ],
      [view('drawings', 'Drawings', Files, 'Opens the drawing set in Design CAD (Sheet set): every submission sheet and the register — panels per sheet, status, revisions, title block, issues and transmittals, PDF / DXF / Excel exports'), view('study-reports', 'Study reports', ClipboardCheck, 'Submission reports: chosen studies (short circuit, load flow…) for chosen boards, with their SLD'), view('report', 'Calc report', FileText, 'Calculation report (PDF)'), view('export-centre', 'Export centre', FileDown, 'Every PDF document in one list: tick what you need and export a zip or one bookmarked PDF')]
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
  const groups: Record<RibbonTab, Tool[][]> = {
    ...stageGroups,
    schedule: [lsRun, lsSchedule, lsCircuits, lsRows, lsBalance, lsCopyUndo, lsOutput],
    sld: [sldRun, canvas, boards, sldEquipment, selection, results, copyUndo, sldView, output]
  };
  const onStage = isStageTab(tab);
  const now = <span className="stage-now" title={`The project is at ${STAGE_INFO[a.stage].label}`}>Now</span>;
  /** Arrow keys move between the tabs of a row; Home / End to the first / last. */
  const tabKeys = (e: KeyEvent<HTMLButtonElement>, i: number, count: number, pick: (k: number) => void) => {
    const k = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : null;
    if (k === null) return;
    e.preventDefault();
    const to = (k + count) % count;
    pick(to);
    (e.currentTarget.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]')[to] as HTMLElement | undefined)?.focus();
  };
  /** Stages shows the stage the project is at, or stays on the stage already showing. */
  const tabOf = (id: typeof TABS[number]['id']): RibbonTab => (id !== 'stages' ? id : onStage ? tab : tabForStage(a.stage));
  /** A Design CAD sub-tab chosen: on the sheets pages one with sheet tools stays there; the others show the drawing. */
  const pickSub = (t: CadTab) => { setCadSub(t.id); if (!(onSheets && t.sheet?.length) && a.view !== 'cad') a.onView('cad'); };
  /** The tooltip of the tool `el` (its name and command in data-tip-head, what it does in data-tip-text). */
  const showTip = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    tipOn.current = true;
    setTip({ x: Math.max(4, Math.min(r.left, window.innerWidth - 264)), y: r.bottom + 6, of: el.getAttribute('aria-label') ?? '', head: el.dataset.tipHead ?? '', text: el.dataset.tipText ?? '' });
  };
  // The cursor rests on a tool, greyed ones too (a disabled button gets no mouse events of its own, so the toolbar
  // watches for them).
  const cadNamed = tab === 'cad' && !labels;
  const smallNamed = cadNamed && !!sub.smallNamed;
  const overTool = (e: React.MouseEvent<HTMLElement>) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-tip-head]');
    if (!b || b === tipEl.current) return;
    window.clearTimeout(tipTimer.current);
    tipEl.current = b;
    if (Date.now() - tipGone.current < 500) showTip(b);
    else tipTimer.current = window.setTimeout(() => showTip(b), 400);
  };
  const offTool = (e: React.MouseEvent<HTMLElement>) => {
    const b = (e.target as Element).closest('[data-tip-head]');
    if (b && !(e.relatedTarget instanceof Node && b.contains(e.relatedTarget))) hideTip();
  };
  const fromKeyboard = (el: HTMLElement) => { try { return el.matches(':focus-visible'); } catch { return false; } };
  /** An icon-only button: its name for screen readers, and the app's tooltip (`head` in bold, then `text`) on a rest of
   * the mouse or on keyboard focus. */
  const tipAttrs = (name: string, head: string, text: string) => ({
    'aria-label': name, 'aria-describedby': tip?.of === name ? 'ribbon-tip' : undefined, 'data-tip-head': head, 'data-tip-text': text, onBlur: hideTip,
    onFocus: (e: React.FocusEvent<HTMLButtonElement>) => { if (fromKeyboard(e.currentTarget)) showTip(e.currentTarget); }
  });
  /** File: Open ▸ (a drawing file, the plan of a level, the drawing open last), Close ▸, Save, Save As…, Export ▸ and
   * Publish…. The level and units of the drawing are in the Drafting settings (DS). */
  const fileMenu = () => {
    const c = a.cad, has = !!c?.hasDrawing;
    const run = (fn?: () => void) => () => { setFileOpen(false); fn?.(); };
    const item = (label: string, cmd: string, title: string, fn: (() => void) | undefined, off = false) => (
      <button key={label} role="menuitem" title={title} disabled={off || !fn} onClick={run(fn)} onMouseEnter={() => setFileList(null)}><span>{label}</span><span className="k">{cmd}</span></button>
    );
    const list = (key: 'open' | 'close' | 'export', label: string, cmd: string, title: string, items: Tool['menu'], off = false) => (
      <div key={key} className="ribbon-file-sub">
        <button role="menuitem" title={title} aria-haspopup="menu" aria-expanded={fileList === key} disabled={off || !items?.length}
          onClick={() => setFileList(fileList === key ? null : key)} onMouseEnter={() => setFileList(key)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); setFileList(key); } }}><span>{label}</span><span className="k">{cmd}</span><ChevronRight size={12} strokeWidth={1.8} aria-hidden /></button>
        {fileList === key && items && (
          <div className="ribbon-file-menu side" role="menu" aria-label={label}>
            {items.map((m) => <Fragment key={m.label}>{m.sep && <hr />}<button role="menuitem" title={m.title} disabled={m.disabled} onClick={run(m.onClick)}>{m.label}</button></Fragment>)}
          </div>
        )}
      </div>
    );
    const ex = (kind: CadExport) => (c?.onExport ? () => c.onExport!(kind) : undefined);
    const openItems: Tool['menu'] = [
      ...(c?.onOpen ? [{ label: 'Drawing file… (DWG / DXF)', title: 'Open a DWG / DXF drawing (OPEN)', onClick: c.onOpen }] : []),
      ...(c?.reopen ? [{ label: c.reopen.label, title: c.reopen.title, onClick: c.reopen.onClick }] : []),
      ...(c?.file.plans ?? []).map((m, i) => ({ ...m, sep: i === 0 || m.sep }))
    ];
    const closeItems: Tool['menu'] = c ? [
      { label: 'This drawing', title: 'Close this drawing (CLOSE). What you drew stays in the project', onClick: c.onClose },
      { label: 'All drawings', title: 'Close every drawing open (CLOSEALL). What you drew stays in the project', onClick: () => c.onCommand?.('CLOSEALL') },
      { label: 'All but this one', title: 'Close the other drawings (CLOSEOTHERS)', onClick: () => c.onCloseOthers?.() }
    ] : [];
    const exportItems: Tool['menu'] = c?.onExport ? [
      { label: 'PDF of this view…', title: 'What is on screen, black on white, A3 (EXPORTPDF)', onClick: ex('pdfView')! },
      { label: 'PDF of this layout…', title: 'The layout tab showing, with its page setup', onClick: ex('pdfLayout')!, disabled: !c.inLayout },
      { label: 'Image (PNG)…', title: 'What is on screen, as on screen (PNGOUT)', onClick: ex('png')! },
      { label: 'Selected objects as DXF…', title: 'The drawn objects and devices picked, as a new DXF (WBLOCK)', onClick: ex('wblock')!, sep: true },
      { label: 'Device list (Excel)…', title: 'The devices placed on this plan: kind, circuit or board, room, position', onClick: ex('devices')! },
      { label: 'Cable route lengths (Excel)…', title: 'Each cable\'s routes drawn on this plan and their length', onClick: ex('cables')! },
      { label: 'Block attributes (Excel)…', title: 'Every attribute of every block on this plan: block, tag, value, layer, position (ATTEXT; Csv on the command line)', onClick: ex('attributes')! }
    ] : [];
    return (
      <div className="ribbon-file-menu" role="menu" aria-label="File">
        {item('New', 'NEW', 'A blank drawing in millimetres to draw from scratch (Drawing1.dxf…); Save As names it the first time', c?.onNew)}
        {list('open', 'Open', 'OPEN', 'Open a drawing file, the plan of a level, or the drawing open last', openItems)}
        {list('close', 'Close', 'CLOSE', 'Close this drawing, all of them, or all but this one. What you drew stays in the project', closeItems, !has)}
        <hr />
        {item('Save', 'SAVE', 'Save to the copy saved last; the first time, Save As. The architect\'s drawing is not changed', c?.onSave, !has)}
        {item('Save As…', 'SAVEAS', 'The file name, DWG or DXF and its version, and what goes in: what you drew, the devices placed, the wiring, references bound', c?.onSaveAs, !has)}
        <hr />
        {list('export', 'Export', 'EXPORT', 'A PDF of the view or the layout, an image, the objects picked as DXF, or the device and cable lists', exportItems, !has)}
        {item('Publish…', 'PUBLISH', 'Publish the sheets: this drawing\'s layouts ticked, as PDF, DXF or DWG', c?.onPublish)}
      </div>
    );
  };
  // Layers: the current layer (its colour, On and Lock) and the list of the drawn layers to make another current.
  const info = a.cad?.info ?? null;
  const isCur = (n: string) => !!info && n.toLowerCase() === info.current.toLowerCase();
  const cur = info?.layers.find((l) => isCur(l.name));
  const listAt = (key: string) => (e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); hideTip(); const r = e.currentTarget.getBoundingClientRect(); setSplitAt({ x: r.left, y: r.bottom + 2 }); setSplitOpen(splitOpen === key ? null : key); };
  const layerList = (
    <>
      <button type="button" className="ribbon-layer" aria-haspopup="menu" aria-expanded={splitOpen === 'layer:list'} disabled={!info} onClick={listAt('layer:list')}
        {...(cadNamed ? tipAttrs('Current layer', `Current layer (CLAYER) · ${info?.current ?? 'no drawing'}`, 'New lines, polylines, rectangles, circles and arcs go on it; the list makes another current')
          : { title: 'The current layer (CLAYER): new lines, polylines, rectangles, circles and arcs go on it', 'aria-label': 'Current layer' })}>
        <i className="sw" style={{ background: cur?.color ?? 'transparent' }} />
        <span className="nm">{info?.current ?? 'No drawing'}</span>
        {cur && <span className="st" aria-hidden>{cur.on ? <Lightbulb size={11} /> : <LightbulbOff size={11} />}{cur.lock ? <Lock size={11} /> : <LockOpen size={11} />}</span>}
        <ChevronDown size={10} strokeWidth={1.8} aria-hidden />
      </button>
      {splitOpen === 'layer:list' && info && (
        <div className="ribbon-split-menu ribbon-layer-menu" role="menu" aria-label="Layers" style={{ left: splitAt.x, top: splitAt.y }} onMouseDown={(e) => e.stopPropagation()}>
          {info.layers.map((l) => (
            <button key={l.name} role="menuitemradio" aria-checked={isCur(l.name)} disabled={l.freeze} title={l.freeze ? `${l.name} is frozen: thaw it to make it current` : `Make ${l.name} the current layer`}
              onClick={() => { setSplitOpen(null); a.cad?.onCommand?.(`CLAYER ${l.name}`); }}>
              <i className="sw" style={{ background: l.color ?? 'transparent' }} /><span>{l.name}</span>{!l.on && <LightbulbOff size={11} aria-label="off" />}{l.lock && <Lock size={11} aria-label="locked" />}
            </button>
          ))}
          <hr />
          <button role="menuitem" onClick={() => { setSplitOpen(null); a.cad?.onLayerManager?.(); }}>Layer palette… (LM)</button>
        </div>
      )}
    </>
  );
  // Properties: the colour, linetype and lineweight of the drawn objects picked, or of new objects while none is.
  const pv = info?.props;
  const target = info?.picked ? `the ${info.picked} object${info.picked === 1 ? '' : 's'} picked` : 'new objects';
  const VARIES = '__varies';
  const propLists = (
    <>
      <span className="ribbon-prop" title={`Colour of ${target}`}>
        <ColourPicker label={`Colour of ${target}`} value={pv?.color === 'varies' ? undefined : pv?.color} varies={pv?.color === 'varies'} onChange={(c) => a.cad?.onSetProps?.({ color: c })} />
      </span>
      <label className="ribbon-prop" title={`Linetype of ${target}`}>
        <span className="pv" aria-hidden />
        <select aria-label={`Linetype of ${target}`} disabled={!info} value={pv?.lt === 'varies' ? VARIES : pv?.lt ?? ''} onChange={(e) => { if (e.target.value !== VARIES) a.cad?.onSetProps?.({ lt: (e.target.value || undefined) as LinetypeId | undefined }); }}>
          {pv?.lt === 'varies' && <option value={VARIES} disabled>varies</option>}
          <option value="">ByLayer</option>{LINETYPE_IDS.map((l) => <option key={l} value={l}>{LINETYPES[l].label}</option>)}
        </select>
      </label>
      <label className="ribbon-prop" title={`Lineweight of ${target}`}>
        <span className="pv lw" aria-hidden />
        <select aria-label={`Lineweight of ${target}`} disabled={!info} value={pv?.lw === 'varies' ? VARIES : pv?.lw ?? ''} onChange={(e) => { if (e.target.value !== VARIES) a.cad?.onSetProps?.({ lw: e.target.value === '' ? undefined : Number(e.target.value) }); }}>
          {pv?.lw === 'varies' && <option value={VARIES} disabled>varies</option>}
          <option value="">ByLayer</option>{LINEWEIGHTS.filter(Boolean).map((w) => <option key={w} value={w}>{w.toFixed(2)} mm</option>)}
        </select>
      </label>
    </>
  );
  /** What a Design CAD panel has besides its tools: a list at its head (two rows of tools under it), lists beside them,
   * and a button beside its caption that shows its palette. */
  const PANEL: Partial<Record<number, { head?: React.ReactNode; under?: number; side?: React.ReactNode; launch?: { name: string; head: string; text: string; on?: boolean; onClick: () => void } }>> = {
    [G.layers]: { head: layerList, under: 6 },
    [G.props]: { side: propLists, launch: { name: 'Properties palette', head: 'Properties palette (Ctrl+1)', text: 'The layer, colour, linetype and shape of the objects picked, docked on the right', on: a.cad?.propsOn, onClick: () => a.cad?.onProps?.() } }
  };

  // The SLD groups moved under More, filled as the row is drawn.
  const moved: React.ReactNode[] = [];
  const otherTools = (
    <>
      <button role="menuitem" onClick={() => { setMoreOpen(false); a.onView('engines'); }}>Load flow (OpenDSS / pandapower)</button>
      <button role="menuitem" onClick={() => { setMoreOpen(false); a.onView('calculators'); }}>Quick calcs</button>
      <button role="menuitem" onClick={() => { setMoreOpen(false); a.onView('report'); }}>Calculation report</button>
      <button role="menuitem" onClick={() => { setMoreOpen(false); a.onSettings(); }}>Project settings</button>
    </>
  );

  return (
    <div className={`ribbon${collapsed ? ' collapsed' : ''}${cadNamed ? ' cad-named' : ''}${smallNamed ? ' small-named' : ''}`} ref={rootRef} data-doc-id="main-ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
        {TABS.map(({ id, label, icon: I, sep }, ti) => {
          const on = id === 'stages' ? onStage : tab === id;
          return (
            <Fragment key={id}>
              {sep && <span className="tab-sep" aria-hidden="true" />}
              {id === 'standards' && <span className="sp" />}
              <button id={`ribbon-tab-${id}`} role="tab" aria-selected={on} aria-controls="ribbon-tools" tabIndex={on ? 0 : -1} className={on ? 'on' : ''}
                onClick={() => { if (collapsed) setPeek(on ? !peek : true); onTab(tabOf(id)); }}
                onDoubleClick={toggleCollapsed} title={collapsed ? 'Click to show its tools · double-click to keep the ribbon open' : 'Double-click to collapse the ribbon (Ctrl+F1)'}
                onKeyDown={(e) => tabKeys(e, ti, TABS.length, (k) => onTab(tabOf(TABS[k].id)))}>
                <I size={16} strokeWidth={1.8} />
                {label}
                {id === 'stages' && now}
              </button>
            </Fragment>
          );
        })}
        <button className="ribbon-pin" onClick={toggleCollapsed} aria-pressed={!collapsed} aria-label={collapsed ? 'Expand the ribbon' : 'Collapse the ribbon'}
          title={collapsed ? 'Keep the ribbon open (Ctrl+F1)' : 'Collapse the ribbon to its tabs (Ctrl+F1)'}>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {tab === 'cad' && (!collapsed || peek) && (
        <div className="ribbon-subtabs">
          <div className="ribbon-file" ref={fileRef}>
            <button type="button" className={fileOpen ? 'on' : ''} aria-haspopup="menu" aria-expanded={fileOpen} title="Open, save and close drawings; the level and units of the drawing"
              onClick={() => { setFileOpen(!fileOpen); setFileList(null); }}><FolderOpen size={14} strokeWidth={1.8} aria-hidden />File<ChevronDown size={12} strokeWidth={1.8} aria-hidden /></button>
            {fileOpen && fileMenu()}
          </div>
          <div className="ribbon-subtabs-list" role="tablist" aria-label="Design CAD">
            {cadTabs.map((t, i) => (
              <button key={t.id} id={`ribbon-cad-${t.id}`} role="tab" aria-selected={sub.id === t.id} tabIndex={sub.id === t.id ? 0 : -1} className={sub.id === t.id ? 'on' : ''}
                onClick={() => pickSub(t)} onKeyDown={(e) => tabKeys(e, i, cadTabs.length, (j) => pickSub(cadTabs[j]))}>{t.label}</button>
            ))}
          </div>
          <span className="sp" />
          <label className="ribbon-labels" title="The name of every tool, the small ones too; the names need more room, so the tools take more sub-tabs (also in Preferences → App)">
            <input type="checkbox" checked={labels} disabled={!a.cad?.onLabels} onChange={(e) => a.cad?.onLabels?.(e.target.checked)} />Show labels
          </label>
        </div>
      )}
      {onStage && (!collapsed || peek) && (
        <div className="ribbon-subtabs" role="tablist" aria-label="Stages">
          {STAGE_TABS.map(({ id, label, stages }, si) => (
            <button key={id} id={`ribbon-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls="ribbon-tools" tabIndex={tab === id ? 0 : -1} className={tab === id ? 'on' : ''}
              onClick={() => onTab(id)} onKeyDown={(e) => tabKeys(e, si, STAGE_TABS.length, (k) => onTab(STAGE_TABS[k].id))}>
              {label}
              {stages.includes(a.stage) && now}
            </button>
          ))}
        </div>
      )}
      {(!collapsed || peek) && tab !== 'sheets' && tab !== 'spec' && <div id="ribbon-tools" ref={toolsRef} className={`ribbon-tools${collapsed ? ' peek' : ''}`} onMouseOver={cadNamed ? overTool : undefined} onMouseOut={cadNamed ? offTool : undefined} onClick={(e) => {
        // A tool was used: put the dropped-down tools away (not for buttons that open a menu of their own).
        const b = (e.target as HTMLElement).closest('button');
        if (collapsed && b && !b.hasAttribute('aria-haspopup') && !b.hasAttribute('aria-expanded')) setPeek(false);
      }} role="toolbar" aria-label={`${[...TABS, ...STAGE_TABS].find((t) => t.id === tab)?.label} tools`}>
        {groups[tab].map((group, gi) => {
          if (tab === 'cad' && !shown.includes(gi)) return null;
          const caption = CAPTIONS[tab]?.[gi];
          const order = tab === 'cad' ? { order: shown.indexOf(gi) + 1 } : undefined;
          // A tool that only opens a list (New layout, viewport Scale, Copy to level) is in the menu as that list.
          const menuOf = (tools: Tool[]) => tools.flatMap((t, k) => (t.menuOnly && t.menu
            ? t.menu.map((m, i) => ({ ...m, label: `${t.label}: ${m.label}`, sep: k > 0 && i === 0 }))
            : [{ label: t.label, title: t.title, onClick: t.onClick }]));
          const popup = (key: string, items: NonNullable<Tool['menu']>) => splitOpen === key && (
            <div className="ribbon-split-menu" role="menu" style={{ left: splitAt.x, top: splitAt.y }} onMouseDown={(e) => e.stopPropagation()}>
              {items.map((m) => <span key={m.label} style={{ display: 'contents' }}>{m.sep && <hr />}<button role={m.checked === undefined ? 'menuitem' : m.keep ? 'menuitemcheckbox' : 'menuitemradio'} aria-checked={m.checked} title={m.title} disabled={m.disabled}
                onClick={() => { if (!m.keep) setSplitOpen(null); m.onClick(); }}>{m.checked !== undefined && <span className="ck" aria-hidden>{m.checked && <Check size={12} strokeWidth={2.2} />}</span>}{m.label}</button></span>)}
            </div>
          );
          const opener = (key: string) => (e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setSplitAt({ x: r.left, y: r.bottom + 2 }); setSplitOpen(splitOpen === key ? null : key); };
          // Collapsed for a narrow window: one button with the panel's name; its tools in a menu. As shown it is one main
          // tool with the name under its icon and no caption, its tools on hover, so the fold makes room.
          if (tab === 'cad' && folded.includes(gi)) {
            const Gi = group[0]?.icon ?? ChevronDown;
            const live = group.filter((t) => !t.disabled);
            const face = cadNamed ? tipAttrs(`${caption}: its tools`, caption ?? '', live.length ? `Its tools: ${live.map((t) => t.label).join(', ')}` : 'Its tools are greyed for now') : { title: `${caption}: its tools` };
            return (
              <div key={gi} className="ribbon-group" role="group" aria-label={caption} style={order}>
                <div className="ribbon-group-btns">
                  <button {...face} aria-haspopup="menu" aria-expanded={splitOpen === `shut:${gi}`} onClick={(e) => { hideTip(); opener(`shut:${gi}`)(e); }}>
                    <Gi size={cadNamed ? 22 : 20} strokeWidth={1.6} /><span>{caption}<ChevronDown size={10} strokeWidth={1.8} aria-hidden /></span>
                  </button>
                  {popup(`shut:${gi}`, menuOf(live))}
                </div>
                {caption && !cadNamed && <div className="ribbon-caption">{caption}</div>}
              </div>
            );
          }
          // Design CAD as shown: the main tools named under their icons, the small ones icon only; each with its name,
          // command and what it does on hover. With Show labels every tool is named.
          const button = (t: Tool) => {
            const { label, icon: I, title, onClick, active, disabled, stale, page, menu, sub, small, menuOnly } = t;
            const openList = (e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); const r = (e.currentTarget.closest('.ribbon-split') ?? e.currentTarget).getBoundingClientRect(); setSplitAt({ x: r.left, y: r.bottom + 2 }); setSplitOpen(splitOpen === label ? null : label); };
            const said = cadNamed ? tipOf(t) : undefined;
            const hint = said ? tipAttrs(label, said.head, said.text) : { title };
            // SLD → Results: a small tool with its setting beside its name.
            const shows = !!sub && !!small && tab === 'sld';
            const btn = (
              <button key={label} className={`${active ? (page ? 'page-on' : 'on') : ''}${stale ? ' stale' : ''}${shows ? ' has-val' : ''}`} {...hint} aria-pressed={page || menuOnly ? undefined : active} aria-current={page && active ? 'page' : undefined}
                aria-haspopup={menuOnly ? 'menu' : undefined} aria-expanded={menuOnly ? splitOpen === label : undefined} disabled={disabled} onClick={(e) => { hideTip(); if (menuOnly && menu) openList(e); else onClick(); }}>
                <I size={cadNamed ? (small ? 16 : 22) : small ? 15 : 20} strokeWidth={1.6} />
                {(!cadNamed || !small || smallNamed) && <span>{label}</span>}
                {sub && !small && !cadNamed && <span className="ribbon-sub">{sub}</span>}
                {shows && <span className="ribbon-val">{sub}</span>}
              </button>
            );
            if (!menu) return btn;
            return (
              <span key={label} className="ribbon-split">
                {btn}
                <button className="ribbon-split-arrow" title={`${label}: more options`} aria-haspopup="menu" aria-expanded={splitOpen === label} disabled={disabled}
                  onClick={openList}><ChevronDown size={small ? 12 : 14} strokeWidth={1.8} aria-hidden /></button>
                {popup(label, menu)}
              </span>
            );
          };
          // Small buttons go three to a column, in order (two under a list at the head of the panel, as in Layers, the
          // first `under` of them; the rest three to a column beside it); the panel's less used tools wait in its caption's ▾.
          const pnl = tab === 'cad' ? PANEL[gi] : undefined;
          const row: React.ReactNode[] = [], under: React.ReactNode[] = [], after: React.ReactNode[] = [];
          let stack: Tool[] = [], smalls = 0;
          const below = () => !!pnl?.head && (pnl.under === undefined || smalls <= pnl.under);
          const flush = () => { if (stack.length) (below() ? under : pnl?.head ? after : row).push(<div key={`s${row.length}.${under.length}.${after.length}`} className="ribbon-stack">{stack.map(button)}</div>); stack = []; };
          for (const t of group.filter((x) => !x.more)) {
            if (!t.small) { flush(); row.push(button(t)); continue; }
            if (t.col || (pnl?.under !== undefined && smalls === pnl.under)) flush();
            stack.push(t); smalls++;
            if (stack.length === (below() ? 2 : 3)) flush();
          }
          flush();
          if (pnl?.head) row.push(<div key="block" className="ribbon-block">{pnl.head}<div className="ribbon-rows">{under}</div></div>, ...after);
          if (pnl?.side) row.push(<div key="side" className="ribbon-side">{pnl.side}</div>);
          const extra = group.filter((x) => x.more);
          const launch = pnl?.launch && (
            <button type="button" className={`ribbon-launch${pnl.launch.on ? ' on' : ''}`} aria-pressed={!!pnl.launch.on} {...(cadNamed ? tipAttrs(pnl.launch.name, pnl.launch.head, pnl.launch.text) : { title: `${pnl.launch.head}: ${pnl.launch.text}`, 'aria-label': pnl.launch.name })}
              onClick={() => { hideTip(); pnl.launch!.onClick(); }}><ArrowDownRight size={10} strokeWidth={2} aria-hidden /></button>
          );
          const panel = (
            <div key={gi} className="ribbon-group" role="group" aria-label={caption} style={order}>
              <div className="ribbon-group-btns">{row}</div>
              {caption && (extra.length
                ? <><button className="ribbon-caption ribbon-caption-more" title={`More ${caption.toLowerCase()} tools: ${extra.map((t) => t.label).join(', ')}`} aria-haspopup="menu" aria-expanded={splitOpen === `more:${gi}`} onClick={opener(`more:${gi}`)}>{caption}<ChevronDown size={10} strokeWidth={1.8} aria-hidden /></button>{popup(`more:${gi}`, menuOf(extra))}</>
                : <div className="ribbon-caption">{caption}{launch}</div>)}
            </div>
          );
          // SLD and Load schedule tabs, a narrow window: the group waits under More.
          if (moves && gi >= groups[tab].length - over) { moved.push(panel); return null; }
          return panel;
        })}
        {tab === 'sld' && (
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
        {(tab === 'sld' || (tab === 'schedule' && over > 0)) && (
          <div className="ribbon-group more" ref={moreRef}>
            <button
              title={over ? `More tools: ${CAPTIONS[tab].slice(-over).join(', ')}${tab === 'sld' ? ' and the other tools' : ''}` : 'More tools'}
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
            <div className="ribbon-caption">{tab === 'sld' ? 'Other tools' : 'More tools'}</div>
            {moreOpen && (moved.length ? (
              // A tool used puts the panel away; a list opened, or a value ticked in one, keeps it.
              <div className="ribbon-over" role="group" aria-label="More tools" onClick={(e) => {
                const b = (e.target as HTMLElement).closest('button');
                if (b && !b.hasAttribute('aria-haspopup') && !b.hasAttribute('aria-expanded') && b.getAttribute('role') !== 'menuitemcheckbox') setMoreOpen(false);
              }}>
                {moved}
                {tab === 'sld' && <div className="ribbon-over-list" role="menu" aria-label="Other tools">{otherTools}</div>}
              </div>
            ) : (
              <div className="ribbon-menu" role="menu" style={{ left: menuLeft }}>{otherTools}</div>
            ))}
          </div>
        )}
      </div>}
      {tip && <div className="ribbon-tip" role="tooltip" id="ribbon-tip" style={{ left: tip.x, top: tip.y }}><b>{tip.head}</b>{tip.text}</div>}
    </div>
  );
}
