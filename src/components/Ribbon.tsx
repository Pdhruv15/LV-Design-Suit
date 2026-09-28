import { useEffect, useRef, useState } from 'react';
import {
  Activity, BatteryCharging, Building2, Cable, Calculator, ClipboardCheck, Car, CircuitBoard, Cog, Ellipsis, FileDown, FileSpreadsheet, FileText,
  Gauge, Hand, LayoutGrid, ListTree, Minus, MousePointer2, Pencil, Receipt, Scale, Server, Settings2, ShieldCheck, Sun,
  Database, History, Play, Redo2, Rows3, Table2, Trash2, TrendingDown, Undo2, Waves, Zap, type LucideIcon, BatteryFull
} from 'lucide-react';
import type { Feeder } from '../types';
import type { MainView } from '../views';

export type RibbonTab = 'design' | 'calculate' | 'simulate' | 'reports' | 'cost' | 'standards';
export type DiagramTool = 'select' | 'pan';

type Icon = LucideIcon;

interface Tool {
  label: string;
  icon: Icon;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Highlight: something needs this (e.g. Run with out-of-date results). */
  stale?: boolean;
}

export interface RibbonActions {
  view: MainView;
  onView: (v: MainView) => void;
  tool: DiagramTool;
  onTool: (t: DiagramTool) => void;
  boardId: string;
  selectedFeederId: string | null;
  onAddFeeder: (preset: Partial<Feeder>) => void;
  onAddBoard: () => void;
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
}

const TABS: { id: RibbonTab; label: string; icon: Icon }[] = [
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
  if (v === 'design' || v === 'load-schedule' || v === 'space-planning' || v === 'substation-area') return 'design';
  if (v === 'engines') return 'simulate';
  if (['calculators', 'voltage-drop', 'earthing', 'coordination', 'selection', 'sizing', 'pfc', 'ups', 'solar'].includes(v)) return 'calculate';
  if (v === 'boq') return 'cost';
  if (v === 'database') return 'standards';
  return 'reports';
}

export default function Ribbon({ tab, onTab, a }: { tab: RibbonTab; onTab: (t: RibbonTab) => void; a: RibbonActions }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState(0);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => !moreRef.current?.contains(e.target as Node) && setMoreOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  const go = (v: MainView) => () => a.onView(v);
  const addTo = `to ${a.boardId}`;
  const view = (v: MainView, label: string, icon: Icon, title: string): Tool => ({ label, icon, title, onClick: go(v), active: a.view === v });

  const groups: Record<RibbonTab, Tool[][]> = {
    design: [
      [
        { label: 'Run', icon: Play, title: a.staleCount ? `Run calculations (F5) — ${a.staleCount} out of date` : 'Run calculations (F5) — up to date', onClick: a.onRun, stale: a.staleCount > 0 },
        { label: 'Undo', icon: Undo2, title: 'Undo (⌘Z / Ctrl+Z)', onClick: a.onUndo, disabled: !a.canUndo },
        { label: 'Redo', icon: Redo2, title: 'Redo (⇧⌘Z / Ctrl+Y)', onClick: a.onRedo, disabled: !a.canRedo }
      ],
      [
        { label: 'Select', icon: MousePointer2, title: 'Click boards and loads to select them', onClick: () => { a.onView('design'); a.onTool('select'); }, active: a.view === 'design' && a.tool === 'select' },
        { label: 'Pan', icon: Hand, title: 'Drag to move around the diagram without selecting', onClick: () => { a.onView('design'); a.onTool('pan'); }, active: a.view === 'design' && a.tool === 'pan' }
      ],
      [
        { label: 'Transformer', icon: Waves, title: 'Transformer data (main board → Electrical)', onClick: a.onTransformer },
        { label: 'Bus', icon: Minus, title: 'Add a board (busbar) fed from an existing board', onClick: a.onAddBoard },
        { label: 'Switchgear', icon: Server, title: `Board properties of ${a.boardId}`, onClick: a.onBoardProperties },
        { label: 'Schedule', icon: Table2, title: `Load distribution schedule of ${a.boardId}`, onClick: go('load-schedule'), active: a.view === 'load-schedule' },
        { label: 'Space plan', icon: LayoutGrid, title: 'Space planning: areas → panels → transformers → RMUs', onClick: go('space-planning'), active: a.view === 'space-planning' },
        { label: 'Substation area', icon: Building2, title: 'Minimum substation, RMU and LV room areas (Dubai Municipality DM-D-013)', onClick: go('substation-area'), active: a.view === 'substation-area' }
      ],
      [
        { label: 'Cable', icon: Cable, title: `Add a feeder cable ${addTo}`, onClick: () => a.onAddFeeder({}) },
        { label: 'Load', icon: Zap, title: `Add a load ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'general' }) },
        { label: 'Motor', icon: Cog, title: `Add a motor ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'motor', powerFactor: 0.86, demandFactor: 1 }) },
        { label: 'Generator', icon: Sun, title: `Add PV / generation ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'pv', generation: true, powerFactor: 1, demandFactor: 1 }) },
        { label: 'EV', icon: Car, title: `Add EV charging ${addTo}`, onClick: () => a.onAddFeeder({ loadType: 'ev', powerFactor: 0.98 }) },
        { label: 'Capacitor', icon: BatteryCharging, title: 'Size capacitor banks (power factor correction)', onClick: go('pfc') }
      ],
      [
        { label: 'Protection', icon: ShieldCheck, title: 'Protection coordination study', onClick: go('coordination') },
        { label: 'Edit', icon: Pencil, title: a.selectedFeederId ? `Edit ${a.selectedFeederId}` : 'Select a load or feeder first', onClick: a.onEditSelected, disabled: !a.selectedFeederId },
        { label: 'Delete', icon: Trash2, title: a.selectedFeederId ? `Delete ${a.selectedFeederId}` : 'Select a load or feeder first', onClick: a.onDeleteSelected, disabled: !a.selectedFeederId }
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
        view('sizing', 'Transformer / Gen', Waves, 'Transformer and generator sizing'),
        view('pfc', 'Power factor', BatteryCharging, 'Power factor correction')
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
      [view('study-reports', 'Study reports', ClipboardCheck, 'Submission reports: chosen studies (short circuit, load flow…) for chosen boards, with their SLD'), view('report', 'Calc report', FileText, 'Calculation report (PDF)'), view('revisions', 'Revisions', History, 'Issue Rev A, B, C… and see what changed')]
    ],
    cost: [[view('boq', 'Cost estimate', Receipt, 'Bill of quantities with cost')]],
    standards: [
      [
        { label: 'Project settings', icon: Scale, title: 'Voltage, ambient, voltage-drop limit and sizing targets', onClick: a.onSettings },
        view('database', 'Database', Database, 'Your equipment, cable, breaker and parameter data (Excel, synced by Drive)')
      ]
    ]
  };

  return (
    <div className="ribbon">
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
        {TABS.map(({ id, label, icon: I }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => onTab(id)}>
            <I size={16} strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </div>
      <div className="ribbon-tools" role="toolbar" aria-label={`${TABS.find((t) => t.id === tab)?.label} tools`}>
        {groups[tab].map((group, gi) => (
          <div key={gi} className="ribbon-group">
            {group.map(({ label, icon: I, title, onClick, active, disabled, stale }) => (
              <button key={label} className={`${active ? 'on' : ''}${stale ? ' stale' : ''}`} title={title} aria-pressed={active} disabled={disabled} onClick={onClick}>
                <I size={20} strokeWidth={1.6} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        ))}
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
