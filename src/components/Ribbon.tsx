import { AddBoardIcon, BoardPropsIcon, TransformerIcon, TxGenSizingIcon } from './icons/elecIcons';
import { useEffect, useRef, useState } from 'react';
import {
  Activity, BatteryCharging, Building2, Cable, Calculator, ClipboardCheck, Car, CircuitBoard, Cog, Ellipsis, FileDown, FileSpreadsheet, FileText,
  Gauge, Hand, LayoutGrid, ListTree, Minus, MousePointer2, Pencil, Receipt, Scale, Server, Settings2, ShieldCheck, Sun,
  Database, History, Percent, BadgePercent, Play, AlignVerticalSpaceAround, LayoutDashboard, LifeBuoy, Braces, PanelBottom, Files, FilePlus2, FolderOpen, Save, SaveAll, UserRound, FolderCog, Clock, Network, House, Redo2, Rows3, Table2, Trash2, TrendingDown, Undo2, Waves, Zap, type LucideIcon, BatteryFull, Box } from 'lucide-react';
import type { BoardKind, Feeder } from '../types';
import type { MainView } from '../views';

export type BomCommand = 'boq' | 'changes' | 'circuits' | 'excel' | 'pdf' | 'summary-pdf' | 'rates-sheet' | 'import' | 'save-list' | 'add-item' | 'add-section' | 'extras' | 'wastage' | 'markup';
export type RibbonTab = 'home' | 'design' | 'calculate' | 'simulate' | 'reports' | 'cost' | 'standards';
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
  /** Split button: the ▾ part offers these. */
  menu?: { label: string; title: string; onClick: () => void }[];
}

export interface RibbonActions {
  view: MainView;
  onView: (v: MainView) => void;
  tool: DiagramTool;
  onTool: (t: DiagramTool) => void;
  boardId: string;
  selectedFeederId: string | null;
  /** What Edit / Delete / Properties act on. */
  selection: { kind: 'board' | 'feeder'; id: string } | null;
  /** The main board whose transformer the Transformer button opens. */
  transformerBoardId?: string;
  onAddFeeder: (preset: Partial<Feeder>) => void;
  /** Add a board; with a kind and rating, the form starts with them. */
  onAddBoard: (preset?: { kind: BoardKind; ratingA: number }) => void;
  onBuildHierarchy: () => void;
  onTransformer: () => void;
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
  onProfile: () => void;
  onChooseFolder: () => void;
  folderLabel: string;
  dirty: boolean;
  recent: { file: string; name: string; when: string }[];
  currentFile?: string;
  onOpenRecent: (file: string) => void;
  dbIssues: number;
  /** BOM / Cost tab: a command for the bill of quantities page. */
  onBom: (cmd: BomCommand) => void;
  hasPriceList: boolean;
  hasRevisions: boolean;
}

/** Group captions under the ribbon groups (same order as the groups). */
const CAPTIONS: Partial<Record<RibbonTab, string[]>> = {
  home: ['Project', 'Diagram & history', 'Setup'],
  design: ['History', 'Canvas', 'Boards & planning', 'Equipment', 'Selection']
};

const ADD_BOARD: { kind: BoardKind; ratingA: number }[] = [{ kind: 'DB', ratingA: 63 }, { kind: 'SMDB', ratingA: 250 }, { kind: 'MCC', ratingA: 400 }, { kind: 'EMDB', ratingA: 400 }];

const TABS: { id: RibbonTab; label: string; icon: Icon }[] = [
  { id: 'home', label: 'Project', icon: House },
  { id: 'design', label: 'Design', icon: CircuitBoard },
  { id: 'calculate', label: 'Calculate', icon: Calculator },
  { id: 'simulate', label: 'Simulate', icon: Activity },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'cost', label: 'BOM / Cost', icon: Receipt },
  { id: 'standards', label: 'Standards', icon: Settings2 }
];

/** The ribbon tab that owns a screen, so the ribbon follows navigation
 * done from the left menu. */
export function tabForView(v: MainView): RibbonTab {
  if (v === 'projects' || v === 'dashboard' || v === 'help' || v === 'parameters' || v === 'titleblock') return 'home';
  if (v === 'building' || v === 'design' || v === 'load-schedule' || v === 'space-planning' || v === 'substation-area' || v === 'enclosure') return 'design';
  if (v === 'engines') return 'simulate';
  if (['calculators', 'voltage-drop', 'earthing', 'coordination', 'selection', 'sizing', 'pfc', 'busbar', 'ups', 'solar'].includes(v)) return 'calculate';
  if (v === 'boq') return 'cost';
  if (v === 'database') return 'standards';
  return 'reports';
}

export default function Ribbon({ tab, onTab, a }: { tab: RibbonTab; onTab: (t: RibbonTab) => void; a: RibbonActions }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState(0);
  const [splitOpen, setSplitOpen] = useState<string | null>(null);
  const [splitAt, setSplitAt] = useState({ x: 0, y: 0 });
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
  const sel = a.selection;
  const selName = sel ? `${sel.kind === 'board' ? 'board' : 'feeder'} ${sel.id}` : '';

  const groups: Record<RibbonTab, Tool[][]> = {
    home: [
      [
        { label: 'New', icon: FilePlus2, title: 'New project', onClick: a.onNew },
        view('projects', 'Open', FolderOpen, 'All projects: open, duplicate, status'),
        { label: a.dirty ? 'Save ●' : 'Save', icon: Save, title: 'Save (Ctrl+S / ⌘S)', onClick: a.onSave, stale: a.dirty },
        { label: 'Save as', icon: SaveAll, title: 'Save as a new project (Ctrl+Shift+S / ⇧⌘S)', onClick: a.onSaveAs }
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
        { label: 'Project settings', icon: Scale, title: 'Voltage, ambient, voltage-drop limit, sizing targets, submission form details', onClick: a.onSettings },
        view('parameters', 'Parameters', Braces, '{Parameters}: designed / checked by, submission date, your own values — used in title blocks, notes and labels'),
        view('titleblock', 'Title block', PanelBottom, 'Design your own title blocks with logo, text and {Parameters}'),
        { label: 'Profile', icon: UserRound, title: 'Your name, designation, company, logo and new-project defaults', onClick: a.onProfile },
        view('help', 'Help', LifeBuoy, 'How to use the app: the workflow start to finish, quick paths for one job, and a start-here checklist'),
        { label: a.folderLabel, icon: FolderCog, title: 'Where projects are saved (e.g. a Google Drive folder)', onClick: a.onChooseFolder }
      ]
    ],
    design: [
      [
        { label: 'Run', icon: Play, title: a.staleCount ? `Run calculations (F5) — ${a.staleCount} out of date` : 'Run calculations (F5) — up to date', onClick: a.onRun, stale: a.staleCount > 0 },
        { label: 'Undo', icon: Undo2, title: 'Undo (⌘Z / Ctrl+Z)', onClick: a.onUndo, disabled: !a.canUndo },
        { label: 'Redo', icon: Redo2, title: 'Redo (⇧⌘Z / Ctrl+Y)', onClick: a.onRedo, disabled: !a.canRedo }
      ],
      [
        { label: 'SLD', icon: Network, title: 'Single line diagram', onClick: go('design'), active: a.view === 'design', page: true },
        { label: 'Select', icon: MousePointer2, title: 'Select tool — click boards and loads to select them (V)', onClick: () => { a.onView('design'); a.onTool('select'); }, active: a.view === 'design' && a.tool === 'select' },
        { label: 'Pan', icon: Hand, title: 'Pan tool — drag to move around the diagram without selecting (H)', onClick: () => { a.onView('design'); a.onTool('pan'); }, active: a.view === 'design' && a.tool === 'pan' }
      ],
      [
        { label: 'Add board', icon: AddBoardIcon, title: `Add a board fed from ${a.boardId || 'an existing board'} — ▾ for a DB, SMDB, MCC or EMDB with its usual rating`, onClick: () => a.onAddBoard(),
          menu: ADD_BOARD.map((x) => ({ label: `${x.kind} · ${x.ratingA} A`, title: `Add a ${x.kind} rated ${x.ratingA} A fed from ${a.boardId || 'the selected board'}`, onClick: () => a.onAddBoard(x) })) },
        { label: 'Build hierarchy', icon: Network, title: 'Build panel hierarchy: MDBs, SMDBs per floor and DBs under each from the building levels — previewed, checked, one undo', onClick: a.onBuildHierarchy },
        { label: 'Board properties', icon: BoardPropsIcon, title: a.boardId ? `Board properties — ${a.boardId}` : 'Board properties — select a board first', onClick: a.onBoardProperties, disabled: !a.boardId },
        { label: 'Transformer data', icon: TransformerIcon, title: a.transformerBoardId ? `Transformer data of ${a.transformerBoardId} (the main board supplying ${a.boardId})` : 'No main board', onClick: a.onTransformer, disabled: !a.transformerBoardId },
        { label: 'Schedule', icon: Table2, title: `Load distribution schedule of ${a.boardId}`, onClick: go('load-schedule'), active: a.view === 'load-schedule', page: true },
        view('building', 'Building', Building2, 'Building information: GFA, levels, typical floors, rooms and room types'),
        { label: 'Space plan', icon: LayoutGrid, title: 'Space planning: areas → panels → transformers → RMUs', onClick: go('space-planning'), active: a.view === 'space-planning', page: true },
        { label: 'Enclosure sizing', icon: Box, title: 'Enclosure sizing: the board\'s physical space (modules) from a supplier catalogue — candidates, dimensioned preview', onClick: go('enclosure'), active: a.view === 'enclosure', page: true },
        { label: 'Substation area', icon: Building2, title: 'Minimum substation, RMU and LV room areas (Dubai Municipality DM-D-013)', onClick: go('substation-area'), active: a.view === 'substation-area', page: true }
      ],
      [
        { label: 'Cable', icon: Cable, title: `Add a feeder cable ${addTo}`, onClick: () => a.onAddFeeder({}) },
        { label: 'Load', icon: Zap, title: `Add a load ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'general' }) },
        { label: 'Motor', icon: Cog, title: `Add a motor ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'motor', powerFactor: 0.86, demandFactor: 1 }) },
        { label: 'Solar PV', icon: Sun, title: `Add solar PV / generation ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'pv', generation: true, powerFactor: 1, demandFactor: 1 }) },
        { label: 'EV', icon: Car, title: `Add EV charging ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'ev', powerFactor: 0.98 }) },
        { label: 'Capacitor', icon: BatteryCharging, title: 'Size capacitor banks (power factor correction)', onClick: go('pfc'), page: true }
      ],
      [
        { label: 'Edit', icon: Pencil, title: sel ? `Edit ${selName}` : 'Select a board or feeder first', onClick: a.onEditSelected, disabled: !sel },
        { label: 'Delete', icon: Trash2, title: sel ? `Delete ${selName}${sel.kind === 'board' ? ' and everything fed from it' : ''} (Delete key)` : 'Select a board or feeder first', onClick: a.onDeleteSelected, disabled: !sel },
        { label: 'Protection', icon: ShieldCheck, title: 'Protection coordination study', onClick: go('coordination'), page: true }
      ]
    ],
    calculate: [
      [{ label: 'Run', icon: Play, title: a.staleCount ? `Run calculations (F5) — ${a.staleCount} out of date` : 'Run calculations (F5) — up to date', onClick: a.onRun, stale: a.staleCount > 0 }],
      [
        view('voltage-drop', 'Voltage drop', TrendingDown, 'Voltage drop calculation: panels and equipment cables, with report'),
        view('earthing', 'Earthing', Gauge, 'Fault loop impedance and disconnection time'),
        view('coordination', 'Protection', ShieldCheck, 'Protection coordination and selectivity'),
        view('selection', 'Selection', ListTree, 'Breaker and cable selection')
      ],
      [
        view('sizing', 'Tx & Gen sizing', TxGenSizingIcon, 'Transformer and generator sizing: size list, duty / standby, generator boards and motor start'),
        view('pfc', 'Power factor', BatteryCharging, 'Power factor correction'),
        view('busbar', 'Busbar riser', AlignVerticalSpaceAround, 'Busbar trunking risers for high-rise buildings: rating (Cu / Al), area, voltage drop per floor, size and weight')
      ],
      [
        view('ups', 'UPS & battery', BatteryFull, 'UPS rating and battery sizing for the backup time'),
        view('solar', 'Solar PV', Sun, 'Solar PV array, string design, inverters and yield')
      ],
      [view('calculators', 'Quick calcs', Calculator, 'Quick calculators: amps, kW/kVA, voltage drop, cable & breaker, transformer, motor, PF, fault level, Ohm\'s law, energy, units')]
    ],
    simulate: [
      [view('engines', 'Load flow', Activity, 'Run OpenDSS or pandapower and compare with the built-in engine')],
      [{ label: 'Export .dss', icon: FileDown, title: 'Export the network as an OpenDSS script', onClick: a.onExportDss }]
    ],
    reports: [
      [
        view('load-schedule', 'Load schedule', Table2, 'DEWA load distribution schedule per DB'),
        view('db-schedule', 'DB schedule', LayoutGrid, 'Panel schedule per board'),
        view('cable-schedule', 'Cable schedule', Cable, 'Every cable in the installation'),
        view('cable-tray', 'Cable trays', Rows3, 'Cable tray schedule: routes A, B, C… with the cables on each and the tray size'),
        view('equipment', 'Equipment', FileSpreadsheet, 'Transformers and boards')
      ],
      [view('drawings', 'Drawings', Files, 'SLD sheets and register in one place: panels per sheet, status, revisions, title block, issues and transmittals, PDF / Excel exports'), view('study-reports', 'Study reports', ClipboardCheck, 'Submission reports: chosen studies (short circuit, load flow…) for chosen boards, with their SLD'), view('report', 'Calc report', FileText, 'Calculation report (PDF)'), view('revisions', 'Revisions', History, 'Issue Rev A, B, C… and see what changed')]
    ],
    cost: [
      [
        { label: 'Bill of quantities', icon: Receipt, title: 'Full BOQ by tender section, priced from your price list', onClick: () => a.onBom('boq'), active: a.view === 'boq' },
        { label: 'Changes', icon: History, title: a.hasRevisions ? 'Quantity and cost change since an issued revision' : 'Issue a revision first (Reports → Revisions)', onClick: () => a.onBom('changes') },
        { label: 'Per circuit', icon: Table2, title: 'Cable and breaker cost of every circuit', onClick: () => a.onBom('circuits') }
      ],
      [
        { label: '+ Item', icon: FilePlus2, title: 'Add your own line: manual work, extra scope, anything not in the design', onClick: () => a.onBom('add-item') },
        { label: '+ Section', icon: Rows3, title: 'Add your own section, e.g. J Lighting fixtures, L Civil works', onClick: () => a.onBom('add-section') },
        { label: 'Extras', icon: ClipboardCheck, title: 'Ready-made extras: testing and commissioning, DEWA fees, as-built drawings, scaffolding, core drilling…', onClick: () => a.onBom('extras') },
        { label: 'Wastage', icon: Percent, title: 'Wastage % per section on the design quantities (e.g. cables 5 %)', onClick: () => a.onBom('wastage') }
      ],
      [
        { label: 'Rates sheet', icon: FileSpreadsheet, title: 'Every item of this project in Excel — fill in your supplier rates', onClick: () => a.onBom('rates-sheet') },
        { label: 'Import rates', icon: FolderOpen, title: 'Read supply / install rates from an Excel sheet', onClick: () => a.onBom('import') },
        { label: 'Save price list', icon: Save, title: a.hasPriceList ? 'Keep this price list for your other projects' : 'Enter or import some rates first', onClick: () => a.onBom('save-list'), disabled: !a.hasPriceList },
        { label: 'Markup / discount', icon: BadgePercent, title: 'Overheads and profit %, discount %', onClick: () => a.onBom('markup') }
      ],
      [
        { label: 'Excel BOQ', icon: FileDown, title: 'Tender BOQ in Excel: summary, bill with section totals, changes since the revision', onClick: () => a.onBom('excel') },
        { label: 'PDF BOQ', icon: FileText, title: 'The BOQ as a PDF with your logo: summary and full bill', onClick: () => a.onBom('pdf') },
        { label: 'Summary only', icon: Scale, title: 'One-page PDF: section totals, markup, discount and total', onClick: () => a.onBom('summary-pdf') }
      ]
    ],
    standards: [
      [
        { label: 'Project settings', icon: Scale, title: 'Voltage, ambient, voltage-drop limit and sizing targets', onClick: a.onSettings },
        view('database', a.dbIssues ? `Database (${a.dbIssues} ⚠)` : 'Database', Database, 'Your equipment, cable, breaker and parameter data (Excel, synced by Drive)')
      ]
    ]
  };

  return (
    <div className="ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
        {TABS.map(({ id, label, icon: I }, ti) => (
          <button key={id} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}
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
            {label}
          </button>
        ))}
      </div>
      <div className="ribbon-tools" role="toolbar" aria-label={`${TABS.find((t) => t.id === tab)?.label} tools`}>
        {groups[tab].map((group, gi) => (
          <div key={gi} className="ribbon-group" role="group" aria-label={CAPTIONS[tab]?.[gi]}>
            <div className="ribbon-group-btns">
              {group.map(({ label, icon: I, title, onClick, active, disabled, stale, page, menu }) => {
                const btn = (
                  <button key={label} className={`${active ? (page ? 'page-on' : 'on') : ''}${stale ? ' stale' : ''}`} title={title} aria-pressed={page ? undefined : active} aria-current={page && active ? 'page' : undefined} disabled={disabled} onClick={onClick}>
                    <I size={20} strokeWidth={1.6} />
                    <span>{label}</span>
                  </button>
                );
                if (!menu) return btn;
                return (
                  <span key={label} className="ribbon-split">
                    {btn}
                    <button className="ribbon-split-arrow" title={`${label}: choose a type`} aria-haspopup="menu" aria-expanded={splitOpen === label} disabled={disabled}
                      onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect(); setSplitAt({ x: r.left, y: r.bottom + 2 }); setSplitOpen(splitOpen === label ? null : label); }}>▾</button>
                    {splitOpen === label && (
                      <div className="ribbon-split-menu" role="menu" style={{ left: splitAt.x, top: splitAt.y }} onMouseDown={(e) => e.stopPropagation()}>
                        {menu.map((m) => <button key={m.label} role="menuitem" title={m.title} onClick={() => { setSplitOpen(null); m.onClick(); }}>{m.label}</button>)}
                      </div>
                    )}
                  </span>
                );
              })}
            </div>
            {CAPTIONS[tab]?.[gi] && <div className="ribbon-caption">{CAPTIONS[tab]![gi]}</div>}
          </div>
        ))}
        {tab === 'design' && (
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
              aria-expanded={moreOpen}
              onClick={(e) => {
                const ribbon = e.currentTarget.closest('.ribbon')!.getBoundingClientRect();
                setMenuLeft(e.currentTarget.getBoundingClientRect().left - ribbon.left);
                setMoreOpen((o) => !o);
              }}
            >
              <Clock size={20} strokeWidth={1.6} />
              <span>Recent ▾</span>
            </button>
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
        {tab === 'design' && (
          <div className="ribbon-group more" ref={moreRef}>
            <button
              title="More tools"
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
            {moreOpen && (
              <div className="ribbon-menu" role="menu" style={{ left: menuLeft }}>
                <button role="menuitem" onClick={() => { setMoreOpen(false); a.onExportDss(); }}>Export OpenDSS (.dss)</button>
                <button role="menuitem" onClick={() => { setMoreOpen(false); a.onView('report'); }}>Calculation report</button>
                <button role="menuitem" onClick={() => { setMoreOpen(false); a.onSettings(); }}>Project settings</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
