import type { PaletteItem } from '../model/sldEdit';

/** The library item being dragged. Browsers hide drag data until the drop,
 * but the diagram needs it while hovering to show where it can go. */
let current: PaletteItem | null = null;

export const setDragItem = (item: PaletteItem | null) => {
  current = item;
};
export const getDragItem = () => current;

/** The library item armed by a click: the next click on the diagram places it. */
let armed: PaletteItem | null = null;
const listeners = new Set<() => void>();

export const setArmedItem = (item: PaletteItem | null) => {
  if (item === armed) return;
  armed = item;
  listeners.forEach((l) => l());
};
export const getArmedItem = () => armed;
export const subscribeArmedItem = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
