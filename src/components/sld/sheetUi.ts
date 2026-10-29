import { useRef, useState } from 'react';
import type { MarkupColor } from '../../model/sheetMarkup';
import type { MarkupTool } from './markupTools';

/** What the ribbon asks of the open sheet (Design CAD → Sheets), set by the sheet while it is shown. */
export interface SheetActions {
  zoomIn: () => void;
  zoomOut: () => void;
  removeSelected: () => void;
  /** Colour or letter height of the selected markup. */
  restyle: (p: { color?: MarkupColor; size?: number }) => void;
  publish: () => void;
  exportAs: (kind: 'pdf' | 'dxf' | 'dwg') => void;
}
export const NO_SHEET_ACTIONS: SheetActions = { zoomIn: () => {}, zoomOut: () => {}, removeSelected: () => {}, restyle: () => {}, publish: () => {}, exportAs: () => {} };

/** The open sheet's tools, shared by the ribbon and the sheet and kept by the app: the markup tool with its colour and
 * letter height, the markup selected, the zoom and side by side. New markups are black, like the printed sheets. */
export function useSheetUi() {
  const [tool, setTool] = useState<MarkupTool>('select');
  const [color, setColor] = useState<MarkupColor>('black');
  const [size, setSize] = useState(3.5);
  const [selId, setSelId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  /** The zoom on screen, as the sheet works it out (Fit depends on the window). */
  const [pct, setPct] = useState('');
  const [side, setSideState] = useState(() => { try { return localStorage.getItem('lvds.sheetSide') === '1'; } catch { return false; } });
  const setSide = (on: boolean) => { setSideState(on); try { localStorage.setItem('lvds.sheetSide', on ? '1' : '0'); } catch { /* preference only */ } };
  const actions = useRef<SheetActions>(NO_SHEET_ACTIONS);
  return { tool, setTool, color, setColor, size, setSize, selId, setSelId, zoom, setZoom, pct, setPct, side, setSide, actions };
}
export type SheetUi = ReturnType<typeof useSheetUi>;
