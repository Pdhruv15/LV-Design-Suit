import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, IndentDecrease, IndentIncrease, PanelLeftClose, PanelLeftOpen, Plus, Power, Waves } from 'lucide-react';
import type { Board, Project } from '../types';
import type { FeederResult, Status } from '../calc/electrical';
import { boardSummary } from '../calc/summary';
import { incomerOf, indentTarget, moveBlocked, outdentTarget, siblings } from '../model/moveBoard';

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
  /** Supply the board (and everything below it) from another board. */
  onMove?: (boardId: string, toId: string) => void;
  /** Move up / down among the boards on the same source. */
  onReorder?: (boardId: string, dir: -1 | 1) => void;
  /** The moved board's incomer length was checked. */
  onLengthChecked?: (boardId: string) => void;
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
export default function PanelTree({ project, results, activeId, focusId, view, onPick, onOpen, menu, copiedId, highlightedIds, onClearHighlights, equipment }: {
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
  highlightedIds?: string[];
  onClearHighlights?: () => void;
  /** The equipment library, shown as a second tab beside the panels (system SLD). */
  equipment?: ReactNode;
}) {
  const [hidden, setHidden] = useStored('tree.hidden', false);
  const [tab, setTab] = useStored<'panels' | 'equipment'>('tree.tab', 'panels');
  const [collapsed, setCollapsed] = useStored<string[]>('tree.collapsed', []);
  const [width, setWidth] = useStored('tree.width', 230);
  const [q, setQ] = useState('');
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null);
  const ref = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<{ id: string; over?: string; why?: string } | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [moveQ, setMoveQ] = useState('');

  // Reveal the newly created batch even if this tree was hidden, filtered
  // or collapsed. References in the draft have already been validated.
  // Only a new batch changes the user's tree preferences (not later edits to the boards or the tree).
  const lastBatch = useRef<typeof highlightedIds>(undefined);
  useEffect(() => {
    if (highlightedIds === lastBatch.current) return;
    lastBatch.current = highlightedIds;
    if (!highlightedIds?.length) return;
    const byId = new Map(project.boards.map((b) => [b.id, b]));
    const reveal = new Set<string>();
    for (const id of highlightedIds) {
      let current = byId.get(id);
      while (current && !reveal.has(current.id)) {
        reveal.add(current.id); current = current.upstreamId ? byId.get(current.upstreamId) : undefined;
      }
    }
    setHidden(false); setQ(''); setCollapsed(collapsed.filter((id) => !reveal.has(id)));
  }, [highlightedIds, project.boards, collapsed, setCollapsed, setHidden]);
  const presentIds = useMemo(() => new Set(project.boards.map((b) => b.id)), [project.boards]);
  const highlighted = new Set(highlightedIds?.filter((id) => presentIds.has(id)));
  useEffect(() => {
    if (highlightedIds?.length && !hidden) ref.current?.querySelector('.batch-new.on')?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIds, hidden]);

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

  const sel = activeId && project.boards.some((b) => b.id === activeId) ? activeId : undefined;
  const ind = sel ? indentTarget(project, sel) : undefined;
  const out = sel ? outdentTarget(project, sel) : undefined;
  const sib = sel ? siblings(project, sel) : [];
  const at = sib.findIndex((x) => x.id === sel);
  const onKey = (e: React.KeyboardEvent) => {
    if (!sel || !menu.onMove || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Tab') { e.preventDefault(); const t = e.shiftKey ? out : ind; if (t) menu.onMove(sel, t); }
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); menu.onReorder?.(sel, e.key === 'ArrowUp' ? -1 : 1); }
  };

  const node = (b: Board, depth: number): JSX.Element | null => {
    if (shown && !shown.has(b.id)) return null;
    const kids = children.get(b.id) ?? [];
    const open = !!shown || !collapsed.includes(b.id);
    const i = info.get(b.id);
    const over = drag?.over === b.id;
    const cls = ['tree-row', highlighted.has(b.id) ? 'batch-new' : '', b.id === activeId ? 'on' : '', b.id === focusId ? 'focus' : '', b.id === copiedId ? 'copied' : '', drag?.id === b.id ? 'dragging' : '', over ? (drag?.why ? 'drop-no' : 'drop-ok') : ''].join(' ');
    const check = incomerOf(project, b.id)?.lengthToCheck;
    return (
      <div key={b.id} role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={b.id === activeId}>
        <div
          className={cls}
          style={{ paddingLeft: 4 + depth * 14 }}
          draggable={!!menu.onMove && !!b.upstreamId}
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); onPick(b.id); setDrag({ id: b.id }); }}
          onDragOver={(e) => { if (!drag) return; const why = moveBlocked(project, drag.id, b.id); if (!why) e.preventDefault(); if (drag.over !== b.id) setDrag({ ...drag, over: b.id, why }); }}
          onDragLeave={() => drag?.over === b.id && setDrag({ ...drag, over: undefined, why: undefined })}
          onDrop={(e) => { e.preventDefault(); const d = drag; setDrag(null); if (d && !moveBlocked(project, d.id, b.id)) menu.onMove?.(d.id, b.id); }}
          onDragEnd={() => setDrag(null)}
          onClick={() => onPick(b.id)}
          onDoubleClick={() => onOpen(b.id)}
          onContextMenu={(e) => { e.preventDefault(); onPick(b.id); setCtx({ id: b.id, x: e.clientX, y: e.clientY }); }}
          title={over && drag?.why ? drag.why : `${b.id} — ${b.name}${check ? ' · moved: check the incomer cable length' : ''}${i?.loading !== undefined ? ` · ${i.loading.toFixed(0)} % loaded` : ''}${i?.fails ? ` · ${i.fails} failing` : ''}\nDouble-click: open on the SLD · right-click: more${b.upstreamId ? ' · drag onto another board to supply it from there' : ''}`}
        >
          <button className="tree-tw" onClick={(e) => { e.stopPropagation(); if (kids.length) toggle(b.id); }} tabIndex={-1} aria-hidden>
            {kids.length ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
          </button>
          <span className={`tree-dot ${i?.status ?? ''}`} />
          <span className="tree-id">{b.id}</span>
          {highlighted.has(b.id) && <span className="tree-new">New</span>}
          {!b.upstreamId && b.sourceKva ? <span className="tree-tx" title={`${b.sourceKva} kVA transformer`}><Waves size={11} />{b.sourceKva}</span> : null}
          {b.standby ? <span className="tree-tx" title={`${b.standby.kva} kVA standby generator (ATS)`}><Power size={11} /></span> : null}
          {check ? <span className="tree-check" title="Moved to another source — check the incomer cable length">len?</span> : null}
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

  const tabs = equipment && (
    <div className="tree-tabs" role="tablist" aria-label="Side panel">
      <button role="tab" aria-selected={tab === 'panels'} className={tab === 'panels' ? 'on' : ''} onClick={() => setTab('panels')}>Panels <span className="m">{project.boards.length}</span></button>
      <button role="tab" aria-selected={tab === 'equipment'} className={tab === 'equipment' ? 'on' : ''} onClick={() => setTab('equipment')}>Equipment</button>
      <span className="sp" />
      <button className="icon-btn" title="Hide the side panel" onClick={() => setHidden(true)}><PanelLeftClose size={14} /></button>
    </div>
  );
  if (equipment && tab === 'equipment') {
    return (
      <aside className="tree" ref={ref} style={{ width }} aria-label="Equipment library">
        {tabs}
        <div className="tree-equip">{equipment}</div>
        <div className="tree-resize" onPointerDown={startResize} onDoubleClick={() => setWidth(230)} title="Drag to resize" />
      </aside>
    );
  }

  return (
    <aside className="tree" ref={ref} style={{ width }} aria-label="Panel tree">
      {tabs}
      <div className="tree-head">
        {!tabs && <><b>Panels</b><span className="m">{project.boards.length}</span></>}
        <span className="sp" />
        <button className="icon-btn" title={activeId ? `Add a board fed from ${activeId}` : 'Add a board'} onClick={() => menu.onAddBoard(activeId ?? roots[0]?.id ?? '')}><Plus size={14} /></button>
        {menu.onMove && <>
          <button className="icon-btn" disabled={!ind} title={ind ? `Indent (Tab): supply ${sel} from ${ind}` : 'Indent (Tab): needs a board above at the same level'} onClick={() => sel && ind && menu.onMove!(sel, ind)}><IndentIncrease size={14} /></button>
          <button className="icon-btn" disabled={!out} title={out ? `Outdent (Shift+Tab): supply ${sel} from ${out}` : 'Outdent (Shift+Tab): already one level below the main board'} onClick={() => sel && out && menu.onMove!(sel, out)}><IndentDecrease size={14} /></button>
          <button className="icon-btn" disabled={at <= 0} title="Move up (Alt+↑)" onClick={() => sel && menu.onReorder?.(sel, -1)}><ArrowUp size={14} /></button>
          <button className="icon-btn" disabled={at < 0 || at >= sib.length - 1} title="Move down (Alt+↓)" onClick={() => sel && menu.onReorder?.(sel, 1)}><ArrowDown size={14} /></button>
        </>}
        <button className="icon-btn" title="Collapse all" onClick={() => setCollapsed(allIds.filter((id) => children.get(id)?.length))}><ChevronsDownUp size={14} /></button>
        <button className="icon-btn" title="Expand all" onClick={() => setCollapsed([])}><ChevronsUpDown size={14} /></button>
        {!tabs && <button className="icon-btn" title="Hide the panel tree" onClick={() => setHidden(true)}><PanelLeftClose size={14} /></button>}
      </div>
      <input className="tree-search" type="search" placeholder="Find a board…" value={q} onChange={(e) => setQ(e.target.value)} />
      {highlighted.size > 0 && <div className="tree-batch">{highlighted.size} new panels<span className="sp" />{onClearHighlights && <button className="chip" onClick={onClearHighlights}>Clear</button>}</div>}
      <div className="tree-body" role="tree" tabIndex={0} onKeyDown={onKey} aria-label="Panels — Tab / Shift+Tab to indent or outdent, Alt+↑↓ to reorder">
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
          {menu.onMove && ctxBoard.upstreamId && <button role="menuitem" onClick={act((id) => { setMoveFor(id); setMoveQ(''); })}>Move under…</button>}
          {menu.onLengthChecked && incomerOf(project, ctxBoard.id)?.lengthToCheck && <button role="menuitem" onClick={act(menu.onLengthChecked)}>Incomer length checked</button>}
          <button role="menuitem" onClick={act(menu.onCopy)}>Copy with everything below</button>
          {menu.onPaste && copiedId && copiedId !== ctxBoard.id && <button role="menuitem" onClick={act(menu.onPaste)}>Paste {copiedId} here</button>}
          <button role="menuitem" className="bad" onClick={act(menu.onDelete)}>Delete…</button>
        </div>
      )}
      {moveFor && (
        <div className="tree-move" role="dialog" aria-label={`Move ${moveFor} under`} onMouseDown={(e) => e.stopPropagation()}>
          <div className="tree-menu-h">Supply {moveFor} from… <span className="sp" /><button className="icon-btn" onClick={() => setMoveFor(null)}>✕</button></div>
          <input autoFocus type="search" placeholder="Find a board…" value={moveQ} onChange={(e) => setMoveQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setMoveFor(null)} />
          <div className="tree-move-list">
            {project.boards.filter((t) => `${t.id} ${t.name}`.toLowerCase().includes(moveQ.trim().toLowerCase())).map((t) => {
              const why = moveBlocked(project, moveFor, t.id);
              return <button key={t.id} disabled={!!why} title={why ?? `Supply ${moveFor} from ${t.id}`} onClick={() => { const id = moveFor; setMoveFor(null); menu.onMove!(id, t.id); }}><b>{t.id}</b> <span className="m">{why ? (why.includes('already') ? 'current source' : why.includes('loop') ? 'below it' : '') : t.name !== t.id ? t.name : ''}</span></button>;
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
