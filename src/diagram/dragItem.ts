import type { PaletteItem } from '../model/sldEdit';

/** The library item being dragged. Browsers hide drag data until the drop,
 * but the diagram needs it while hovering to show where it can go. */
let current: PaletteItem | null = null;

export const setDragItem = (item: PaletteItem | null) => {
  current = item;
};
export const getDragItem = () => current;
