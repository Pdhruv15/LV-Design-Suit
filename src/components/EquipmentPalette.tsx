import { useState } from 'react';
import {
  Cable, Car, Cog, Cpu, Fan, Flame, Gauge, Lightbulb, PanelLeftClose, PanelLeftOpen, Server, ShieldCheck, Snowflake, Sun, Waves, Zap, type LucideIcon
} from 'lucide-react';
import { dropHint, itemKey, PALETTE, type PaletteItem } from '../model/sldEdit';
import { getDragItem, setDragItem } from '../diagram/dragItem';

const ICON: Record<string, LucideIcon> = {
  transformer: Waves, 'board:MC': Gauge, cable: Cable,
  'load:motor': Cog, 'load:ahu': Fan, 'load:chiller': Snowflake, 'load:fire-pump': Flame, 'load:ev': Car,
  'load:pv': Sun, 'load:lighting': Lightbulb, 'load:it': Cpu, 'load:general': Zap
};
const iconOf = (i: PaletteItem): LucideIcon => ICON[itemKey(i)] ?? (i.kind === 'board' ? Server : i.kind === 'device' ? ShieldCheck : Zap);

/** Equipment library for building the SLD: drag an item onto a busbar, a
 * feeder or the empty canvas. Where it's dropped decides how it connects. */
export default function EquipmentPalette({ onHint }: { onHint: (m: string) => void }) {
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
      {PALETTE.map(({ group, entries }) => (
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
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
