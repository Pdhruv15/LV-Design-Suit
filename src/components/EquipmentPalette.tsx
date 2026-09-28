import { useState } from 'react';
import {
  Activity, CircleDot, Link2, ShieldAlert, ToggleLeft, ZapOff, BatteryCharging, BatteryFull, Star, Cable, Car, Cog, Cpu, Database, Fan, Flame, Gauge, Lightbulb, PanelLeftClose, PanelLeftOpen, Power, Server, ShieldCheck, Snowflake, Sun, Waves, Zap, type LucideIcon
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

/** Equipment library for building the SLD: drag an item onto a busbar, a
 * feeder or the empty canvas. Where it's dropped decides how it connects. */
const presetEntry = (p: FeederPreset): PaletteEntry => ({ item: { kind: 'preset', preset: p }, label: p.name, title: `${presetParts(p)} — drop on a busbar; breaker and cable are sized` });

export default function EquipmentPalette({ onHint, library = [], presets = [], onDeletePreset }: {
  onHint: (m: string) => void;
  /** The user's own equipment (Loads.xlsx). */
  library?: PaletteEntry[];
  /** The user's saved feeder presets. */
  presets?: FeederPreset[];
  onDeletePreset?: (id: string) => void;
}) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('palette') !== 'closed'; } catch { return true; }
  });
  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem('palette', open ? 'closed' : 'open'); } catch { /* preference only */ }
  };

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
      <p className="m palette-tip">Drag onto a busbar, a feeder or the empty canvas.</p>
      {[
        { group: 'Feeder presets', entries: BUILT_IN_PRESETS.map(presetEntry) },
        ...(presets.length ? [{ group: 'My presets', entries: presets.map(presetEntry) }] : []),
        ...PALETTE,
        ...(library.length ? [{ group: 'My equipment', entries: library }] : [])
      ].map(({ group, entries }) => (
        <div key={group} className="palette-group">
          <h5>{group}</h5>
          <div className="palette-items">
            {entries.map(({ item, label, title }) => {
              const Icon = iconOf(item);
              return (
                <div
                  key={itemKey(item)}
                  className="palette-item"
                  draggable
                  title={title}
                  onDragStart={(e) => {
                    setDragItem(item);
                    e.dataTransfer.setData('text/plain', itemKey(item));
                    e.dataTransfer.effectAllowed = 'copy';
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
                  {group === 'My presets' && onDeletePreset && item.kind === 'preset' && (
                    <button
                      className="icon-btn palette-del"
                      title={`Delete the preset “${label}”`}
                      onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete the preset “${label}”?`)) onDeletePreset(item.preset.id); }}
                    >✕</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
