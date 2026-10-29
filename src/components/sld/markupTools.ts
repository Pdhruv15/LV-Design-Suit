import { ArrowUpRight, Cloud, CloudCog, Crosshair, MessageSquareText, MousePointer2, Slash, Square, Type, type LucideIcon } from 'lucide-react';
import type { MarkupKind } from '../../model/sheetMarkup';

/** The sheet markup tools (Design CAD → Sheets ribbon and their keys), apart from the sheet so the ribbon loads
 * without it. */
export type MarkupTool = 'select' | MarkupKind | 'pcloud' | 'parrow';

export const MARKUP_TOOLS: { tool: MarkupTool; label: string; key: string; icon: LucideIcon; hint: string }[] = [
  { tool: 'select', label: 'Select', key: 'V', icon: MousePointer2, hint: 'Click a markup to select it; drag to move, drag a handle to resize, Delete to remove, double-click to edit its text' },
  { tool: 'cloud', label: 'Cloud', key: 'C', icon: Cloud, hint: 'Drag a rectangle to draw a revision cloud with its revision triangle' },
  { tool: 'rect', label: 'Box', key: 'B', icon: Square, hint: 'Drag a rectangle' },
  { tool: 'line', label: 'Line', key: 'L', icon: Slash, hint: 'Drag a line' },
  { tool: 'arrow', label: 'Arrow', key: 'A', icon: ArrowUpRight, hint: 'Drag from the tail to the point' },
  { tool: 'text', label: 'Note', key: 'T', icon: Type, hint: 'Click where the note goes' },
  { tool: 'callout', label: 'Callout', key: 'O', icon: MessageSquareText, hint: 'Press on what you point at, drag to where the text goes, release' }
];
/** Tools tied to panels and circuits: they follow the design when it moves. */
export const ANCHORED_TOOLS: typeof MARKUP_TOOLS = [
  { tool: 'pcloud', label: 'Panel cloud', key: 'P', icon: CloudCog, hint: 'Drag around panels: a revision cloud that stays around them when the design changes' },
  { tool: 'parrow', label: 'Panel arrow', key: 'R', icon: Crosshair, hint: 'Press on a panel or circuit, drag to where the text goes: the arrow follows it when the design changes' }
];
export const ALL_TOOLS = [...MARKUP_TOOLS, ...ANCHORED_TOOLS];
/** Letter heights of notes and callouts on the paper (mm). */
export const MARKUP_SIZES = [2.5, 3.5, 5];
