import { useMemo, useRef, useState } from 'react';
import {
  Activity, CircleDot, Link2, ShieldAlert, ToggleLeft, ZapOff, BatteryCharging, BatteryFull, Star, Cable, Car, Cog, Cpu, Database, Fan, Flame, Gauge, Lightbulb, PanelLeftClose, PanelLeftOpen, Power, Server, ShieldCheck, Snowflake, Sun, Waves, Zap,
  ChevronDown, ChevronRight, Pencil, Copy, Download, Upload, Plus, Plug, Heater, PanelTop, Info, type LucideIcon
} from 'lucide-react';
import { dropHint, itemKey, PALETTE, type PaletteEntry, type PaletteItem } from '../model/sldEdit';
import { BUILT_IN_PRESETS, presetCard, presetParts, type FeederPreset } from '../model/presets';
import { getDragItem, setDragItem } from '../diagram/dragItem';

const ICON: Record<string, LucideIcon> = {
  'starter:DOL': Zap, 'starter:SD': Star, 'starter:SS': Gauge, 'starter:VFD': Activity,
  tie: Link2, transformer: Waves, 'board:MC': Gauge, cable: Cable, generator: Power, capacitor: BatteryCharging, 'board:UPS': BatteryFull,
  'load:motor': Cog, 'load:ahu': Fan, 'load:chiller': Snowflake, 'load:fire-pump': Flame, 'load:ev': Car,
  'load:pv': Sun, 'load:lighting': Lightbulb, 'load:it': Cpu, 'load:general': Zap,
  'acc:meter': Gauge, 'acc:ct-meter': CircleDot, 'acc:rcd': ShieldAlert, 'acc:isolator': ToggleLeft, 'acc:spd': ZapOff, 'acc:cable-fr': Flame, 'acc:cable-lszh': Cable
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

/** This viewer's palette preferences (collapsed groups, favourites, recent). */
function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : initial; } catch { return initial; }
  });
  return [v, (next: T) => { setV(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* preference only */ } }];
}

/** Equipment library for building the SLD: drag an item onto a busbar, a
 * feeder or the empty canvas. Where it's dropped decides how it connects,
 * and along a busbar, where the new way goes. Search, favourites ★,
 * recently used, collapsible groups; drop several at once (× qty); the
 * user's own presets can be edited, duplicated, exported and imported. */
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
  const [collapsed, setCollapsed] = useStored<string[]>('palette.collapsed', []);
  const [favs, setFavs] = useStored<string[]>('palette.favs', []);
  const [recent, setRecent] = useStored<string[]>('palette.recent', []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [width, setWidth] = useStored('palette.width', 210);
  const startResize = (e: React.PointerEvent) => {
    const x0 = e.clientX, w0 = width;
    const move = (ev: PointerEvent) => setWidth(Math.max(156, Math.min(320, w0 + ev.clientX - x0)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const groups = useMemo(() => [
    { group: 'Feeder presets', entries: BUILT_IN_PRESETS.map(presetEntry) },
    { group: 'My presets', entries: presets.map(presetEntry) },
    { group: 'My components', entries: components.map((p) => ({ item: { kind: 'preset' as const, preset: p }, label: p.name, title: `${p.name} — your component: drop on a busbar; breaker and cable are sized` })) },
    ...PALETTE,
    ...(library.length ? [{ group: 'My equipment', entries: library }] : [])
  ], [presets, library, components]);
  const byKey = useMemo(() => new Map(groups.flatMap((g) => g.entries.map((e) => [itemKey(e.item), e] as const))), [groups]);
  const pick = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((e): e is PaletteEntry => !!e);
  const q = query.trim().toLowerCase();
  const shown = q
    ? [{ group: `Results for “${query.trim()}”`, entries: groups.flatMap((g) => g.entries).filter((e) => `${e.label} ${e.title}${e.item.kind === 'preset' ? ` ${(c => `${c.title} ${c.value ?? ''} ${c.parts.join(' ')}`)(presetCard(e.item.preset))}` : ''}`.replace(/\u00a0/g, ' ').toLowerCase().includes(q)).filter((e, i, a) => a.findIndex((x) => itemKey(x.item) === itemKey(e.item)) === i) }]
    : [
        ...(favs.length ? [{ group: '★ Favourites', entries: pick(favs) }] : []),
        ...(recent.length ? [{ group: 'Recently used', entries: pick(recent) }] : []),
        ...groups
      ];

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
      <input className="palette-search" type="search" placeholder="Search… (AHU, RCD, SMDB)" value={query} onChange={(e) => setQuery(e.target.value)} />
      {onQty && (
        <label className="palette-qty" title="Loads and presets dropped on a busbar are added this many times">
          Drop <input inputMode="numeric" value={qty} onChange={(e) => onQty(Math.max(1, Math.min(50, Math.round(+e.target.value) || 1)))} /> at a time
          {qty > 1 && <button className="icon-btn" title="Back to 1" onClick={() => onQty(1)}>1</button>}
        </label>
      )}
      <p className="m palette-tip">Drag onto a busbar — the dashed line shows where it goes — a feeder, or the empty canvas.</p>
      {shown.map(({ group, entries }) => {
        const isMine = group === 'My presets';
        const isComp = group === 'My components';
        if (!entries.length && !isMine && !isComp) return q ? <p key={group} className="m">Nothing matches.</p> : null;
        const closed = !q && collapsed.includes(group);
        return (
          <div key={group} className="palette-group">
            <h5 onClick={() => !q && setCollapsed(closed ? collapsed.filter((g) => g !== group) : [...collapsed, group])} className={q ? '' : 'toggle'}>
              {!q && (closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />)} {group}
              {!q && <span className="m palette-count">{entries.length}</span>}
            </h5>
            {isComp && !closed && onEditComponent && (
              <div className="palette-tools">
                <button className="icon-btn" title="New component" onClick={() => onEditComponent(null)}><Plus size={13} /></button>
              </div>
            )}
            {isMine && !closed && (
              <div className="palette-tools">
                {onEditPreset && <button className="icon-btn" title="New preset" onClick={() => onEditPreset(null, 'edit')}><Plus size={13} /></button>}
                {onExportPresets && presets.length > 0 && <button className="icon-btn" title="Export my presets to a file (share with the team)" onClick={onExportPresets}><Download size={13} /></button>}
                {onImportPresets && <button className="icon-btn" title="Import presets from a file" onClick={() => fileRef.current?.click()}><Upload size={13} /></button>}
                <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f && onImportPresets) onImportPresets(await f.text());
                  e.target.value = '';
                }} />
              </div>
            )}
            {!closed && (
              <div className="palette-items">
                {isComp && !entries.length && <p className="m palette-tip">Click + to make your own equipment with inputs, formulas and an SLD label.</p>}
                {isMine && !entries.length && <p className="m palette-tip">Select a feeder and “Save as preset”, click + or import a file.</p>}
                {entries.map(({ item, label, title }) => {
                  const Icon = iconOf(item);
                  const key = itemKey(item);
                  const fav = favs.includes(key);
                  const mine = item.kind === 'preset' && presets.some((p) => p.id === item.preset.id);
                  const card = item.kind === 'preset' ? presetCard(item.preset) : undefined;
                  return (
                    <div
                      key={key}
                      className={`palette-item${card ? ' has-card' : ''}${fav ? ' is-fav' : ''}`}
                      draggable
                      title={title}
                      onDragStart={(e) => {
                        setDragItem(item);
                        e.dataTransfer.setData('text/plain', key);
                        e.dataTransfer.effectAllowed = 'copy';
                        setRecent([key, ...recent.filter((k) => k !== key)].slice(0, 6));
                      }}
                      onDragEnd={() => {
                        // The diagram clears the item when it takes the drop; still
                        // set means it was dropped somewhere it can't go.
                        const missed = getDragItem() !== null;
                        setDragItem(null);
                        if (missed) onHint(dropHint(item));
                      }}
                      onClick={() => onHint(title)}
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter') onHint(title); }}
                    >
                      <Icon size={18} strokeWidth={1.7} className="palette-ic" aria-hidden />
                      {card ? (
                        <span className="palette-card">
                          <span className="palette-l1"><span className="palette-name">{card.title}</span>{card.value && <span className="palette-val">{card.value}</span>}</span>
                          {card.parts.length > 0 && <span className="palette-l2">{card.parts.join(' · ')}</span>}
                          {details === key && (
                            <span className="palette-details" onClick={(e) => e.stopPropagation()}>
                              {card.details.map(([k, v]) => <span key={k}><span className="m">{k}</span> {v}</span>)}
                            </span>
                          )}
                        </span>
                      ) : <span className="palette-name">{label}</span>}
                      <span className="palette-acts">
                        {card && <button className={`icon-btn${details === key ? ' on' : ''}`} title="Details: PF, phase, cable length and other defaults" aria-expanded={details === key} onClick={(e) => { e.stopPropagation(); setDetails(details === key ? null : key); }}><Info size={12} /></button>}
                        {item.kind === 'preset' && item.preset.id.startsWith('cmp-') && onEditComponent && (
                          <>
                            <button className="icon-btn" title="Edit this component (updates every copy)" onClick={(e) => { e.stopPropagation(); onEditComponent(item.preset.id.slice(4)); }}><Pencil size={12} /></button>
                            {onDeleteComponent && <button className="icon-btn" title="Delete the component" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete the component “${label}”? Copies on the SLD stay as ordinary loads.`)) onDeleteComponent(item.preset.id.slice(4)); }}>✕</button>}
                          </>
                        )}
                        {item.kind === 'preset' && !item.preset.id.startsWith('cmp-') && onEditPreset && (
                          mine
                            ? <button className="icon-btn" title="Edit this preset" onClick={(e) => { e.stopPropagation(); onEditPreset(item.preset, 'edit'); }}><Pencil size={12} /></button>
                            : <button className="icon-btn" title="Copy to My presets and edit" onClick={(e) => { e.stopPropagation(); onEditPreset(item.preset, 'copy'); }}><Copy size={12} /></button>
                        )}
                        {mine && onEditPreset && <button className="icon-btn" title="Duplicate" onClick={(e) => { e.stopPropagation(); onEditPreset(item.preset, 'copy'); }}><Copy size={12} /></button>}
                        {mine && onDeletePreset && item.kind === 'preset' && (
                          <button className="icon-btn" title={`Delete the preset “${label}”`} onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete the preset “${label}”?`)) onDeletePreset(item.preset.id); }}>✕</button>
                        )}
                        <button className={`icon-btn fav${fav ? ' on' : ''}`} title={fav ? 'Remove from favourites' : 'Add to favourites'} onClick={(e) => { e.stopPropagation(); setFavs(fav ? favs.filter((k) => k !== key) : [...favs, key]); }}>
                          <Star size={12} fill={fav ? 'currentColor' : 'none'} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
