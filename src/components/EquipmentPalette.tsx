import { ask } from './ConfirmDialog';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity, CircleDot, Link2, ShieldAlert, ToggleLeft, ZapOff, BatteryCharging, BatteryFull, Star, Cable, Car, Cog, Cpu, Database, Fan, Flame, Gauge, Lightbulb, PanelLeftClose, PanelLeftOpen, Power, ShieldCheck, Snowflake, Sun, Waves, Zap,
  Bookmark, Box, Layers, Pencil, Copy, Download, Upload, Plus, Plug, Heater, PanelTop, Info, X, type LucideIcon
} from 'lucide-react';
import { dropHint, dropsOn, itemKey, PALETTE, type DropTarget, type PaletteEntry, type PaletteItem } from '../model/sldEdit';
import { BUILT_IN_PRESETS, presetCard, presetParts, type FeederPreset } from '../model/presets';
import { getArmedItem, getDragItem, setArmedItem, setDragItem, subscribeArmedItem } from '../diagram/dragItem';
import { hasSymbol, PaletteSymbol } from './paletteSymbols';

const ICON: Record<string, LucideIcon> = {
  'starter:DOL': Zap, 'starter:SD': Star, 'starter:SS': Gauge, 'starter:VFD': Activity,
  tie: Link2, transformer: Waves, 'board:MC': Gauge, cable: Cable, generator: Power, 'generator:ACB': Power, capacitor: BatteryCharging, 'board:UPS': BatteryFull,
  'load:motor': Cog, 'load:ahu': Fan, 'load:chiller': Snowflake, 'load:fire-pump': Flame, 'load:ev': Car,
  'load:pv': Sun, 'load:lighting': Lightbulb, 'load:it': Cpu, 'load:general': Zap,
  'acc:meter': Gauge, 'acc:ct-meter': CircleDot, 'acc:rcd': ShieldAlert, 'acc:isolator': ToggleLeft, 'acc:spd': ZapOff, 'acc:pmu': Activity, 'acc:cable-fr': Flame, 'acc:cable-lszh': Cable
};
/** A preset's icon from what it feeds: plug for sockets, heater, snowflake for AC / chillers, fan for AHU / FCU, panel for boards. */
function presetIcon(p: FeederPreset): LucideIcon {
  if (p.kind === 'board') return PanelTop;
  const name = (p.loadName ?? p.name).toLowerCase();
  if (p.loadType === 'sockets') return Plug;
  if (/heater/.test(name)) return Heater;
  if (p.loadType === 'hvac') return /split|chiller|\bac\b|a\/c/.test(name) ? Snowflake : Fan;
  return ICON[`load:${p.loadType}`] ?? Zap;
}
const iconOf = (i: PaletteItem): LucideIcon => (i.kind === 'preset' ? presetIcon(i.preset) : undefined) ?? ICON[itemKey(i)] ?? (i.kind === 'board' ? PanelTop : i.kind === 'device' ? ShieldCheck : i.kind === 'library' ? Database : Zap);

const presetEntry = (p: FeederPreset): PaletteEntry => ({ item: { kind: 'preset', preset: p }, label: p.name, title: `${presetParts(p)} — drop on a busbar; breaker and cable are sized` });

/** This viewer's palette preferences (open category, favourites, recent). */
function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
  });
  return [v, (next: T) => { setV(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* preference only */ } }];
}

/** Palette categories: one open at a time, each one or more PALETTE groups. */
const CATS: { id: string; label: string; groups: string[]; sym?: string; icon?: LucideIcon }[] = [
  { id: 'supply', label: 'Supply', groups: ['Supply'], sym: 'transformer' },
  { id: 'boards', label: 'Boards', groups: ['Distribution boards', 'Package panels'], sym: 'board:MDB' },
  { id: 'protection', label: 'Protection', groups: ['Protection'], sym: 'device:MCCB' },
  { id: 'metering', label: 'Metering', groups: ['Metering & accessories'], sym: 'acc:meter' },
  { id: 'cable', label: 'Cable', groups: ['Cable', 'Cable types'], sym: 'cable' },
  { id: 'starters', label: 'Starters', groups: ['Motor starters'], sym: 'load:motor' },
  { id: 'loads', label: 'Loads', groups: ['Loads'], sym: 'load:general' },
  { id: 'presets', label: 'Presets', groups: ['Feeder presets'], icon: Layers },
  { id: 'mine', label: 'My presets', groups: ['My presets'], icon: Bookmark },
  { id: 'components', label: 'Components', groups: ['My components'], icon: Box },
  { id: 'equipment', label: 'My equipment', groups: ['My equipment'], icon: Database }
];
const WHERE: Record<DropTarget['type'], string> = { bus: 'Busbar', feeder: 'Feeder', canvas: 'Canvas' };
const STRIP = 8;

/** Equipment library for building the SLD, laid out like a CAD ribbon:
 * category tiles, then the open category's items as icon tiles. Drag an
 * item onto a busbar, a feeder or the empty canvas, or click it and then
 * click the drawing. Where it goes decides how it connects, and along a
 * busbar, where the new way goes. Search, favourites ★ and recently used
 * (pinned strip), × qty on the armed item; the user's own presets can be
 * edited, duplicated, exported and imported. */
export default function EquipmentPalette({ docked, onHint, library = [], presets = [], components = [], onEditComponent, onDeleteComponent, qty = 1, onQty, onDeletePreset, onEditPreset, onExportPresets, onImportPresets }: {
  /** Inside the side panel's Equipment tab: no own frame, hide button or resize handle. */
  docked?: boolean;
  /** Your own components (as presets with id cmp-<id>). */
  components?: FeederPreset[];
  onEditComponent?: (id: string | null) => void;
  onDeleteComponent?: (id: string) => void;
  onHint: (m: string) => void;
  /** The user's own equipment (Loads.xlsx). */
  library?: PaletteEntry[];
  /** The user's saved feeder presets. */
  presets?: FeederPreset[];
  qty?: number;
  onQty?: (n: number) => void;
  onDeletePreset?: (id: string) => void;
  /** Open the preset editor: an existing preset, a copy, or a new one. */
  onEditPreset?: (p: FeederPreset | null, mode: 'edit' | 'copy') => void;
  onExportPresets?: () => void;
  onImportPresets?: (text: string) => void;
}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('palette') !== 'closed'; } catch { return true; }
  });
  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem('palette', open ? 'closed' : 'open'); } catch { /* preference only */ }
  };
  const [query, setQuery] = useState('');
  const [cat, setCat] = useStored('palette.cat', 'loads');
  const [favs, setFavs] = useStored<string[]>('palette.favs', []);
  const [recent, setRecent] = useStored<string[]>('palette.recent', []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [tip, setTip] = useState<{ entry: PaletteEntry; x: number; y: number } | null>(null);
  const [width, setWidth] = useStored('palette.width', 210);
  const startResize = (e: React.PointerEvent) => {
    const x0 = e.clientX, w0 = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(156, Math.min(320, w0 + ev.clientX - x0)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Armed item: the next click on the drawing places it. Esc, a second
  // click on the tile, or placing it disarms; the quantity goes back to 1.
  const armed = useSyncExternalStore(subscribeArmedItem, getArmedItem, getArmedItem);
  const armedKey = armed ? itemKey(armed) : null;
  const qtyRef = useRef(onQty);
  qtyRef.current = onQty;
  useEffect(() => () => setArmedItem(null), []);
  useEffect(() => subscribeArmedItem(() => { if (!getArmedItem()) qtyRef.current?.(1); }), []);
  useEffect(() => {
    if (!armed) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setArmedItem(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [armed]);

  const groups = useMemo(() => [
    { group: 'Feeder presets', entries: BUILT_IN_PRESETS.map(presetEntry) },
    { group: 'My presets', entries: presets.map(presetEntry) },
    { group: 'My components', entries: components.map((p) => ({ item: { kind: 'preset' as const, preset: p }, label: p.name, title: `${p.name} — your component: drop on a busbar; breaker and cable are sized` })) },
    ...PALETTE,
    ...(library.length ? [{ group: 'My equipment', entries: library }] : [])
  ], [presets, library, components]);
  const cats = CATS.filter((c) => c.groups.some((g) => groups.some((x) => x.group === g)));
  const openCat = cats.find((c) => c.id === cat) ?? cats[0];
  const entriesOf = (c: (typeof CATS)[number]) => groups.filter((g) => c.groups.includes(g.group)).flatMap((g) => g.entries);
  const byKey = useMemo(() => new Map(groups.flatMap((g) => g.entries.map((e) => [itemKey(e.item), e] as const))), [groups]);
  const pick = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((e): e is PaletteEntry => !!e);
  const strip = pick([...favs, ...recent.filter((k) => !favs.includes(k))]).slice(0, STRIP);
  const q = query.trim().toLowerCase();
  const results = q
    ? groups.flatMap((g) => g.entries).filter((e) => `${e.label} ${e.title}${e.item.kind === 'preset' ? ` ${(c => `${c.title} ${c.value ?? ''} ${c.parts.join(' ')}`)(presetCard(e.item.preset))}` : ''}`.replace(/\u00a0/g, ' ').toLowerCase().includes(q)).filter((e, i, a) => a.findIndex((x) => itemKey(x.item) === itemKey(e.item)) === i)
    : null;
  const shown = results ?? entriesOf(openCat);
  const isMine = !q && openCat.id === 'mine';
  const isComp = !q && openCat.id === 'components';

  const where = (item: PaletteItem) => dropsOn(item).map((t) => WHERE[t].toLowerCase()).join(' or ');
  const arm = (e: React.MouseEvent | React.KeyboardEvent, { item, label }: PaletteEntry) => {
    const key = itemKey(item);
    if (armedKey === key) { setArmedItem(null); onHint(''); return; }
    setArmedItem(item);
    onQty?.(e.shiftKey ? 3 : 1);
    setRecent([key, ...recent.filter((k) => k !== key)].slice(0, 6));
    onHint(`${label}: click a ${where(item)} on the drawing to place it — Esc cancels`);
  };
  const showTip = (entry: PaletteEntry) => (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const right = r.right + 236 < window.innerWidth;
    setTip({ entry, x: right ? r.right + 6 : r.left - 236, y: r.top });
  };
  /** Drag, click-to-arm, keyboard and hover behaviour shared by tiles and cards. */
  const handlers = (entry: PaletteEntry) => {
    const { item } = entry;
    const key = itemKey(item);
    return {
      draggable: true,
      role: 'button',
      tabIndex: 0,
      'aria-pressed': armedKey === key,
      'aria-label': `${entry.label} — ${entry.title}`,
      onDragStart: (e: React.DragEvent) => {
        setTip(null);
        if (armedKey && armedKey !== key) setArmedItem(null);
        setDragItem(item);
        e.dataTransfer.setData('text/plain', key);
        e.dataTransfer.effectAllowed = 'copy';
        setRecent([key, ...recent.filter((k) => k !== key)].slice(0, 6));
      },
      onDragEnd: () => {
        // The diagram clears the item when it takes the drop; still
        // set means it was dropped somewhere it can't go.
        const missed = getDragItem() !== null;
        setDragItem(null);
        if (armedKey === key) setArmedItem(null);
        if (missed) onHint(dropHint(item));
      },
      onClick: (e: React.MouseEvent) => arm(e, entry),
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); arm(e, entry); } },
      onMouseEnter: showTip(entry),
      onMouseLeave: () => setTip(null)
    };
  };
  const favBtn = (key: string) => {
    const fav = favs.includes(key);
    return (
      <button className={`icon-btn fav${fav ? ' on' : ''}`} title={fav ? 'Remove from favourites' : 'Add to favourites'} onClick={(e) => { e.stopPropagation(); setFavs(fav ? favs.filter((k) => k !== key) : [...favs, key]); }}>
        <Star size={12} fill={fav ? 'currentColor' : 'none'} />
      </button>
    );
  };
  const qtyStep = onQty && (
    <span className="palette-q" onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn" aria-label="One fewer" disabled={qty <= 1} onClick={() => onQty(Math.max(1, qty - 1))}>−</button>
      × {qty}
      <button className="icon-btn" aria-label="One more" disabled={qty >= 50} onClick={() => onQty(Math.min(50, qty + 1))}>+</button>
    </span>
  );
  const dots = (item: PaletteItem) => (
    <span className="palette-dots" aria-hidden>{dropsOn(item).map((t) => <i key={t} className={t} />)}</span>
  );
  const symbol = (item: PaletteItem, size?: number) => {
    const key = itemKey(item);
    if (hasSymbol(key)) return <PaletteSymbol k={key} size={size} />;
    const Icon = iconOf(item);
    return <Icon size={size ?? 20} strokeWidth={1.6} className="palette-ic" aria-hidden />;
  };

  const tile = (entry: PaletteEntry) => {
    const { item, label } = entry;
    const key = itemKey(item);
    const on = armedKey === key;
    return (
      <div key={key} className={`palette-tile${on ? ' armed' : ''}${favs.includes(key) ? ' is-fav' : ''}`} {...handlers(entry)}>
        {dots(item)}
        {favBtn(key)}
        {symbol(item)}
        <span className="palette-tname">{label}</span>
        {on && qtyStep}
      </div>
    );
  };
  const card = (entry: PaletteEntry) => {
    const { item, label } = entry;
    if (item.kind !== 'preset') return tile(entry);
    const key = itemKey(item);
    const on = armedKey === key;
    const fav = favs.includes(key);
    const mine = presets.some((p) => p.id === item.preset.id);
    const c = presetCard(item.preset);
    return (
      <div key={key} className={`palette-item has-card${fav ? ' is-fav' : ''}${on ? ' armed' : ''}`} {...handlers(entry)}>
        {symbol(item, 18)}
        <span className="palette-card">
          <span className="palette-l1"><span className="palette-name">{c.title}</span>{c.value && <span className="palette-val">{c.value}</span>}</span>
          {c.parts.length > 0 && <span className="palette-l2">{c.parts.join(' · ')}</span>}
          {on && qtyStep}
          {details === key && (
            <span className="palette-details" onClick={(e) => e.stopPropagation()}>
              {c.details.map(([k, v]) => <span key={k}><span className="m">{k}</span> {v}</span>)}
            </span>
          )}
        </span>
        <span className="palette-acts">
          <button className={`icon-btn${details === key ? ' on' : ''}`} title="Details: PF, phase, cable length and other defaults" aria-expanded={details === key} onClick={(e) => { e.stopPropagation(); setDetails(details === key ? null : key); }}><Info size={12} /></button>
          {item.preset.id.startsWith('cmp-') && onEditComponent && (
            <>
              <button className="icon-btn" title="Edit this component (updates every copy)" onClick={(e) => { e.stopPropagation(); onEditComponent(item.preset.id.slice(4)); }}><Pencil size={12} /></button>
              {onDeleteComponent && <button className="icon-btn" title="Delete the component" onClick={async (e) => { e.stopPropagation(); if (await ask(`Delete the component “${label}”? Copies on the SLD stay as ordinary loads.`)) onDeleteComponent(item.preset.id.slice(4)); }} aria-label={`Delete the component ${label}`}><X size={12} aria-hidden /></button>}
            </>
          )}
          {!item.preset.id.startsWith('cmp-') && onEditPreset && (
            mine
              ? <button className="icon-btn" title="Edit this preset" onClick={(e) => { e.stopPropagation(); onEditPreset(item.preset, 'edit'); }}><Pencil size={12} /></button>
              : <button className="icon-btn" title="Copy to My presets and edit" onClick={(e) => { e.stopPropagation(); onEditPreset(item.preset, 'copy'); }}><Copy size={12} /></button>
          )}
          {mine && onEditPreset && <button className="icon-btn" title="Duplicate" onClick={(e) => { e.stopPropagation(); onEditPreset(item.preset, 'copy'); }}><Copy size={12} /></button>}
          {mine && onDeletePreset && (
            <button className="icon-btn" title={`Delete the preset “${label}”`} onClick={async (e) => { e.stopPropagation(); if (await ask(`Delete the preset “${label}”?`)) onDeletePreset(item.preset.id); }} aria-label={`Delete the preset ${label}`}><X size={12} aria-hidden /></button>
          )}
          {favBtn(key)}
        </span>
      </div>
    );
  };

  if (!open && !docked) {
    return (
      <aside className="palette closed">
        <button className="chip" onClick={toggle} title="Show the equipment library"><PanelLeftOpen size={16} /></button>
      </aside>
    );
  }
  return (
    <aside className={`palette${docked ? ' docked' : ''}`} aria-label="Equipment library" style={docked ? undefined : { width }}>
      {!docked && <>
        <div className="palette-resize" onPointerDown={startResize} onDoubleClick={() => setWidth(210)} title="Drag to resize (double-click: default width)" />
        <div className="palette-head">
          <b>Equipment</b>
          <button className="icon-btn" onClick={toggle} title="Hide the library"><PanelLeftClose size={15} /></button>
        </div>
      </>}
      <input className="palette-search" type="search" aria-label="Search the equipment library" placeholder="Search… (AHU, RCD, SMDB)" value={query} onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery(''); } }} />
      {strip.length > 0 && (
        <div className="palette-strip" aria-label="Favourites and recently used">
          {strip.map((entry) => {
            const key = itemKey(entry.item);
            return (
              <div key={key} className={`palette-mini${armedKey === key ? ' armed' : ''}`} {...handlers(entry)}>
                {favs.includes(key) && <span className="palette-mini-fav" aria-hidden>★</span>}
                {symbol(entry.item, 18)}
              </div>
            );
          })}
        </div>
      )}
      {!q && (
        <div className="palette-cats" role="tablist" aria-label="Equipment categories">
          {cats.map((c) => {
            const Icon = c.icon;
            return (
              <button key={c.id} type="button" role="tab" aria-selected={c.id === openCat.id} className={`palette-cat${c.id === openCat.id ? ' on' : ''}`} title={`${c.label} (${entriesOf(c).length})`} onClick={() => setCat(c.id)}>
                {c.sym ? <PaletteSymbol k={c.sym} size={18} /> : Icon && <Icon size={18} strokeWidth={1.6} className="palette-ic" aria-hidden />}
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="palette-ghead">
        <span>{q ? `Results for “${query.trim()}”` : openCat.label}</span>
        <span className="m palette-count">{shown.length}</span>
        {isComp && onEditComponent && <button className="icon-btn" title="New component" onClick={() => onEditComponent(null)}><Plus size={13} /></button>}
        {isMine && <>
          {onEditPreset && <button className="icon-btn" title="New preset" onClick={() => onEditPreset(null, 'edit')}><Plus size={13} /></button>}
          {onExportPresets && presets.length > 0 && <button className="icon-btn" title="Export my presets to a file (share with the team)" onClick={onExportPresets}><Download size={13} /></button>}
          {onImportPresets && <button className="icon-btn" title="Import presets from a file" onClick={() => fileRef.current?.click()}><Upload size={13} /></button>}
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f && onImportPresets) onImportPresets(await f.text());
            e.target.value = '';
          }} />
        </>}
      </div>
      {isComp && !shown.length && <p className="m palette-tip">Click + to make your own equipment with inputs, formulas and an SLD label.</p>}
      {isMine && !shown.length && <p className="m palette-tip">Select a feeder and “Save as preset”, click + or import a file.</p>}
      {q && !shown.length && <p className="m palette-tip">Nothing matches.</p>}
      <div className="palette-tiles">
        {shown.map((e) => (e.item.kind === 'preset' ? card(e) : tile(e)))}
      </div>
      <p className="m palette-legend"><span><i className="bus" />busbar</span><span><i className="feeder" />feeder</span><span><i className="canvas" />canvas</span><span className="sp">drag, or click then click</span></p>
      {tip && (
        <div className="palette-tipcard" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.entry.label}</b>
          <span>{tip.entry.title}</span>
          <span className="palette-where">{(['bus', 'feeder', 'canvas'] as const).map((t) => <span key={t} className={dropsOn(tip.entry.item).includes(t) ? 'yes' : ''}>{WHERE[t]}</span>)}</span>
          <span className="m">Drag it there, or click it then click the drawing. Shift-click: × 3.</span>
        </div>
      )}
    </aside>
  );
}
