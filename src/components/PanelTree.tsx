import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Plus, Power, Waves } from 'lucide-react';
import type { Board, Project } from '../types';
import type { FeederResult, Status } from '../calc/electrical';
import { boardSummary } from '../calc/summary';

/** What a click on a board does on the page you're on. */
export const TREE_HINT: Partial<Record<string, string>> = {
  design: 'Click a board to select it on the SLD',
  'load-schedule': 'Click a DB to open its load schedule',
  'db-schedule': 'Click a board for its panel schedule',
  coordination: 'Click a board for its breakers’ coordination',
  earthing: 'Click a board to show it and the boards below',
  selection: 'Click a board to show it and the boards below',
  'cable-schedule': 'Click a board to show its cables and those below'
};

export interface TreeMenuActions {
  onAddBoard: (parentId: string) => void;
  onAddFeeder: (boardId: string) => void;
  onProperties: (boardId: string) => void;
  onSchedule: (boardId: string) => void;
  onCopy: (boardId: string) => void;
  onPaste?: (boardId: string) => void;
  onDelete: (boardId: string) => void;
}

function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
  });
  return [v, (next: T) => { setV(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* preference only */ } }];
}

const worst = (xs: Status[]): Status | undefined => (xs.includes('bad') ? 'bad' : xs.includes('warn') ? 'warn' : xs.length ? 'ok' : undefined);

/** The installation as a tree: transformer → MDB → SMDB → DB, with each
 * board's status and loading. The page you're on decides what a click does
 * (select on the SLD, open its schedule, filter a study…); double-click
 * opens it on the SLD; right-click for the board menu. */
export default function PanelTree({ project, results, activeId, focusId, view, onPick, onOpen, menu, copiedId }: {
  project: Project;
  results: FeederResult[];
  /** The board the page is on (highlighted). */
  activeId?: string;
  /** A study page's board filter. */
  focusId?: string | null;
  view: string;
  onPick: (id: string) => void;
  onOpen: (id: string) => void;
  menu: TreeMenuActions;
  copiedId?: string | null;
}) {
  const [hidden, setHidden] = useStored('tree.hidden', false);
  const [collapsed, setCollapsed] = useStored<string[]>('tree.collapsed', []);
  const [width, setWidth] = useStored('tree.width', 230);
  const [q, setQ] = useState('');
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLElement>(null);

  // Children in the order their incomers sit on the parent's busbar.
  const children = useMemo(() => {
    const m = new Map<string, Board[]>();
    const byId = new Map(project.boards.map((b) => [b.id, b]));
    for (const f of project.feeders) {
      const child = f.feedsBoardId ? byId.get(f.feedsBoardId) : undefined;
      if (child && child.upstreamId === f.boardId) m.set(f.boardId, [...(m.get(f.boardId) ?? []), child]);
    }
    for (const b of project.boards) {
      if (b.upstreamId && !(m.get(b.upstreamId) ?? []).includes(b)) m.set(b.upstreamId, [...(m.get(b.upstreamId) ?? []), b]);
    }
    return m;
  }, [project]);
  const roots = project.boards.filter((b) => !b.upstreamId || !project.boards.some((x) => x.id === b.upstreamId));

  const info = useMemo(() => {
    const m = new Map<string, { status?: Status; loading?: number; loadingStatus?: Status; fails: number }>();
    for (const b of project.boards) {
      const rs = results.filter((r) => r.feeder.boardId === b.id);
      const s = boardSummary(project, b);
      m.set(b.id, { status: worst(rs.map((r) => r.status)), loading: s.loadingPct, loadingStatus: s.loadingStatus, fails: rs.filter((r) => r.status === 'bad').length });
    }
    return m;
  }, [project, results]);

  // Search: boards whose id / name / kind match, and the boards above them.
  const words = q.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!words) return null;
    const keep = new Set<string>();
    for (const b of project.boards) {
      if (`${b.id} ${b.name} ${b.kind ?? ''} ${b.location ?? ''}`.toLowerCase().includes(words)) {
        let cur: Board | undefined = b;
        for (let i = 0; cur && i < 30; i++) { keep.add(cur.id); cur = project.boards.find((x) => x.id === cur!.upstreamId); }
      }
    }
    return keep;
  }, [project, words]);

  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [ctx]);

  if (hidden) {
    return (
      <aside className="tree closed">
        <button className="icon-btn" onClick={() => setHidden(false)} title="Show the panel tree"><PanelLeftOpen size={16} /></button>
      </aside>
    );
  }

  const allIds = project.boards.map((b) => b.id);
  const toggle = (id: string) => setCollapsed(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);

  const node = (b: Board, depth: number): JSX.Element | null => {
    if (shown && !shown.has(b.id)) return null;
    const kids = children.get(b.id) ?? [];
    const open = !!shown || !collapsed.includes(b.id);
    const i = info.get(b.id);
    const cls = ['tree-row', b.id === activeId ? 'on' : '', b.id === focusId ? 'focus' : '', b.id === copiedId ? 'copied' : ''].join(' ');
    return (
      <div key={b.id} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={b.id === activeId}>
        <div
          className={cls}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => onPick(b.id)}
          onDoubleClick={() => onOpen(b.id)}
          onContextMenu={(e) => { e.preventDefault(); onPick(b.id); setCtx({ id: b.id, x: e.clientX, y: e.clientY }); }}
          title={`${b.id} — ${b.name}${i?.loading !== undefined ? ` · ${i.loading.toFixed(0)} % loaded` : ''}${i?.fails ? ` · ${i.fails} failing` : ''}\nDouble-click: open on the SLD · right-click: more`}
        >
          <button className="tree-tw" onClick={(e) => { e.stopPropagation(); if (kids.length) toggle(b.id); }} tabIndex={-1} aria-hidden>
            {kids.length ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
          </button>
          <span className={`tree-dot ${i?.status ?? ''}`} />
          <span className="tree-id">{b.id}</span>
          {!b.upstreamId && b.sourceKva ? <span className="tree-tx" title={`${b.sourceKva} kVA transformer`}><Waves size={11} />{b.sourceKva}</span> : null}
          {b.standby ? <span className="tree-tx" title={`${b.standby.kva} kVA standby generator (ATS)`}><Power size={11} /></span> : null}
          <span className="sp" />
          {i?.loading !== undefined && <span className={`tree-load ${i.loadingStatus ?? ''}`}>{i.loading.toFixed(0)}%</span>}
        </div>
        {open && kids.length > 0 && <div role="group">{kids.map((k) => node(k, depth + 1))}</div>}
      </div>
    );
  };

  const startResize = (e: React.PointerEvent) => {
    const x0 = e.clientX, w0 = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(170, Math.min(460, w0 + ev.clientX - x0)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const act = (fn: (id: string) => void) => () => { const id = ctx!.id; setCtx(null); fn(id); };
  const ctxBoard = ctx ? project.boards.find((b) => b.id === ctx.id) : undefined;

  return (
    <aside className="tree" ref={ref} style={{ width }} aria-label="Panel tree">
      <div className="tree-head">
        <b>Panels</b>
        <span className="m">{project.boards.length}</span>
        <span className="sp" />
        <button className="icon-btn" title={activeId ? `Add a board fed from ${activeId}` : 'Add a board'} onClick={() => menu.onAddBoard(activeId ?? roots[0]?.id ?? '')}><Plus size={14} /></button>
        <button className="icon-btn" title="Collapse all" onClick={() => setCollapsed(allIds.filter((id) => children.get(id)?.length))}><ChevronsDownUp size={14} /></button>
        <button className="icon-btn" title="Expand all" onClick={() => setCollapsed([])}><ChevronsUpDown size={14} /></button>
        <button className="icon-btn" title="Hide the panel tree" onClick={() => setHidden(true)}><PanelLeftClose size={14} /></button>
      </div>
      <input className="tree-search" type="search" placeholder="Find a board…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tree-body" role="tree">
        {roots.map((b) => node(b, 0))}
        {shown && shown.size === 0 && <p className="m tree-tip">No board matches.</p>}
      </div>
      <p className="m tree-tip">{TREE_HINT[view] ?? 'Double-click a board to open it on the SLD'}</p>
      <div className="tree-resize" onPointerDown={startResize} onDoubleClick={() => setWidth(230)} title="Drag to resize" />
      {ctx && ctxBoard && (
        <div className="tree-menu" role="menu" style={{ left: ctx.x, top: ctx.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="tree-menu-h">{ctxBoard.id} <span className="m">{ctxBoard.name}</span></div>
          <button role="menuitem" onClick={act(onOpen)}>Open on the SLD</button>
          <button role="menuitem" onClick={act(menu.onProperties)}>Properties…</button>
          <button role="menuitem" onClick={act(menu.onSchedule)}>Load schedule</button>
          <hr />
          <button role="menuitem" onClick={act(menu.onAddFeeder)}>Add feeder / load…</button>
          <button role="menuitem" onClick={act(menu.onAddBoard)}>Add sub-board…</button>
          <hr />
          <button role="menuitem" onClick={act(menu.onCopy)}>Copy with everything below</button>
          {menu.onPaste && copiedId && copiedId !== ctxBoard.id && <button role="menuitem" onClick={act(menu.onPaste)}>Paste {copiedId} here</button>}
          <button role="menuitem" className="bad" onClick={act(menu.onDelete)}>Delete…</button>
        </div>
      )}
    </aside>
  );
}
