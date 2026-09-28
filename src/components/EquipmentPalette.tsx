import { useMemo, useRef, useState } from 'react';
import {
  Activity, CircleDot, Link2, ShieldAlert, ToggleLeft, ZapOff, BatteryCharging, BatteryFull, Star, Cable, Car, Cog, Cpu, Database, Fan, Flame, Gauge, Lightbulb, PanelLeftClose, PanelLeftOpen, Power, Server, ShieldCheck, Snowflake, Sun, Waves, Zap,
  ChevronDown, ChevronRight, Pencil, Copy, Download, Upload, Plus, type LucideIcon
} from 'lucide-react';
import { dropHint, itemKey, PALETTE, type PaletteEntry, type PaletteItem } from '../model/sldEdit';
import { BUILT_IN_PRESETS, presetParts, type FeederPreset } from '../model/presets';
import { getDragItem, setDragItem } from '../diagram/dragItem';

const ICON: Record<string, LucideIcon> = {
  'starter:DOL': Zap, 'starter:SD': Star, 'starter:SS': Gauge, 'starter:VFD': Activity,
  tie: Link2, transformer: Waves, 'board:MC': Gauge, cable: Cable, generator: Power, capacitor: BatteryCharging, 'board:UPS': BatteryFull,
  'load:motor': Cog, 'load:ahu': Fan, 'load:chiller': Snowflake, 'load:fire-pump': Flame, 'load:ev': Car,
  'load:pv': Sun, 'load:lighting': Lightbulb, 'load:it': Cpu, 'load:general': Zap,
  'acc:meter': Gauge, 'acc:ct-meter': CircleDot, 'acc:rcd': ShieldAlert, 'acc:isolator': ToggleLeft, 'acc:spd': ZapOff
};
const iconOf = (i: PaletteItem): LucideIcon => (i.kind === 'preset' ? (i.preset.kind === 'board' ? Server : ICON[`load:${i.preset.loadType === 'hvac' ? 'ahu' : i.preset.loadType}`] ?? Zap) : undefined) ?? ICON[itemKey(i)] ?? (i.kind === 'board' ? Server : i.kind === 'device' ? ShieldCheck : i.kind === 'library' ? Database : Zap);

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
export default function EquipmentPalette({ onHint, library = [], presets = [], qty = 1, onQty, onDeletePreset, onEditPreset, onExportPresets, onImportPresets }: {
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

  const groups = useMemo(() => [
    { group: 'Feeder presets', entries: BUILT_IN_PRESETS.map(presetEntry) },
    { group: 'My presets', entries: presets.map(presetEntry) },
    ...PALETTE,
    ...(library.length ? [{ group: 'My equipment', entries: library }] : [])
  ], [presets, library]);
  const byKey = useMemo(() => new Map(groups.flatMap((g) => g.entries.map((e) => [itemKey(e.item), e] as const))), [groups]);
  const pick = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((e): e is PaletteEntry => !!e);
  const q = query.trim().toLowerCase();
  const shown = q
    ? [{ group: `Results for “${query.trim()}”`, entries: groups.flatMap((g) => g.entries).filter((e) => `${e.label} ${e.title}`.toLowerCase().includes(q)).filter((e, i, a) => a.findIndex((x) => itemKey(x.item) === itemKey(e.item)) === i) }]
    : [
        ...(favs.length ? [{ group: '★ Favourites', entries: pick(favs) }] : []),
        ...(recent.length ? [{ group: 'Recently used', entries: pick(recent) }] : []),
        ...groups
      ];

  if (!open) {
    return (
      <aside className="palette closed">
        <button className="chip" onClick={toggle} title="Show the equipment library"><PanelLeftOpen size={16} /></button>
      </aside>
    );
  }
  return (
    <aside className="palette" aria-label="Equipment library">
      <div className="palette-head">
        <b>Equipment</b>
        <button className="icon-btn" onClick={toggle} title="Hide the library"><PanelLeftClose size={15} /></button>
      </div>
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
        if (!entries.length && !isMine) return q ? <p key={group} className="m">Nothing matches.</p> : null;
        const closed = !q && collapsed.includes(group);
        return (
          <div key={group} className="palette-group">
            <h5 onClick={() => !q && setCollapsed(closed ? collapsed.filter((g) => g !== group) : [...collapsed, group])} className={q ? '' : 'toggle'}>
              {!q && (closed ? <ChevronRight size={12} /> : <ChevronDown size={12} />)} {group}
              {!q && <span className="m palette-count">{entries.length}</span>}
            </h5>
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
                {isMine && !entries.length && <p className="m palette-tip">Select a feeder and “Save as preset”, click + or import a file.</p>}
                {entries.map(({ item, label, title }) => {
                  const Icon = iconOf(item);
                  const key = itemKey(item);
                  const fav = favs.includes(key);
                  const mine = item.kind === 'preset' && presets.some((p) => p.id === item.preset.id);
                  return (
                    <div
                      key={key}
                      className="palette-item"
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
                    >
                      <Icon size={16} strokeWidth={1.7} />
                      <span>{label}</span>
                      <span className="palette-acts">
                        {item.kind === 'preset' && onEditPreset && (
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
