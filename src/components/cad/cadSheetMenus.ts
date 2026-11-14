import { SHEET_STATUSES } from '../../model/drawingSet';
import { isLocked, VP_ARRANGEMENTS, VP_SCALES, type PlanViewport } from '../../model/planViewports';
import type { CadRef } from '../../model/cadRefs';
import { tidy, type CtxAct, type CtxEntry, type CtxItem } from './cadContextMenu';

/** Design CAD: the right-click menus of blocks, references and sheets (phase 3 of the context-menu plan, docs/notes/
 * Future development/UI UX proposals - 2026-11-11 - Context-aware right-click menus.md): a block of the opened drawing,
 * a reference drawing, a viewport and the paper of a layout. Pure, as cadContextMenu.ts: each entry is a typed command
 * (`cmd`) or a page action (`act`, its `arg` "action|value"). Blocks drawn here use the drawn-object menu
 * (SketchEditPanel.tsx). */

const item = (act: CtxAct, label: string, action: string, value?: string, key?: string, off?: boolean): CtxItem =>
  ({ label, act, arg: value === undefined ? action : `${action}|${value}`, ...(key ? { key } : {}), ...(off ? { off } : {}) });
/** "action|value" back into the action and its value. */
export function argOf(arg: string): { action: string; value?: string } {
  const i = arg.indexOf('|');
  return i < 0 ? { action: arg } : { action: arg.slice(0, i), value: arg.slice(i + 1) };
}

/** An object of the opened drawing (the architect's) picked: a block of it, or another object. */
export function drawingObjectMenu(s: { block?: string; picked: number }): CtxEntry[] {
  const dw = (label: string, action: string, key?: string) => item('dw', label, action, undefined, key);
  return tidy([
    ...(s.block && s.picked === 1 ? [dw('Count instances', 'count'), dw('Explode into drawn objects', 'explode', 'X'),
      dw('Copy as a block of this drawing', 'copyblock', 'INSERT'), dw('Crop…', 'crop', 'CROP'), '-' as const] : []),
    { label: 'Erase', key: 'Del', cmd: 'ERASE' }, '-',
    { label: 'Deselect all', key: 'Esc', act: 'deselect' },
    { label: 'Properties', key: 'Ctrl+1', act: 'properties' }
  ]);
}

/** The fades offered (%), as the References palette has them. */
export const REF_FADES = [0, 25, 50, 70, 90];

/** A reference drawing under the cursor. */
export function xrefMenu(r: Pick<CadRef, 'name' | 'clip' | 'fade' | 'unloaded' | 'print'>): CtxEntry[] {
  const x = (label: string, action: string, value?: string, key?: string, off?: boolean) => item('xref', label, action, value, key, off);
  return tidy([
    x('Open reference', 'open'), '-',
    { label: 'Clip', sub: [x('New boundary', 'clip', undefined, 'XCLIP'), x('Remove clip', 'unclip', undefined, undefined, !r.clip)] },
    { label: 'Fade', sub: REF_FADES.map((f) => x(`${f} %`, 'fade', String(f), r.fade === f ? 'now' : undefined, r.fade === f)) },
    x('Reload', 'reload'), x(r.unloaded ? 'Load' : 'Unload', 'unload'), x('Detach', 'detach'), x('Bind (save a copy)…', 'bind'), '-',
    x(r.print ? 'Do not print on sheets' : 'Print on sheets', 'print'), x('Reference layers…', 'layers', undefined, 'LM'), '-',
    x('Properties (References palette)…', 'manager', undefined, 'XR')
  ]);
}

/** Right-click inside a viewport frame on a layout (on the paper, not working in it). */
export function viewportMenu(v: PlanViewport, scales: number[] = VP_SCALES): CtxEntry[] {
  const vp = (label: string, action: string, value?: string, key?: string, off?: boolean) => item('vp', label, action, value, key, off);
  return tidy([
    vp('Activate (model space)', 'ms', undefined, 'Dbl-click'), vp('Show on the Model tab', 'max'), '-',
    { label: 'Viewport scale', sub: (scales.includes(v.scale) ? scales : [...scales, v.scale].sort((a, b) => a - b)).map((k) => vp(`1:${k}`, 'scale', String(k), v.scale === k ? 'now' : undefined, v.scale === k)) },
    vp(isLocked(v) ? 'Unlock display' : 'Lock display', 'lock', undefined, 'VPLOCK'),
    vp(v.frame ? 'Frame does not print' : 'Frame prints', 'frame'), '-',
    vp('Viewport layers…', 'layers', undefined, 'LM'), '-',
    vp('Erase viewport', 'erase', undefined, 'Del'), '-',
    item('paper', 'Plot this layout…', 'cmd', 'PLOT', 'PLOT'), item('paper', 'Page setup and title block…', 'cmd', 'PAGESETUP'), '-',
    { label: 'Properties', key: 'Ctrl+1', act: 'properties' }
  ]);
}

/** Right-click on the paper of a layout, outside the viewports: new viewport and tables, the sheet's issue status and the
 * sheet list, plot. Layout commands (MV, LEGEND, PLOT…) are read on the page, so they run as 'paper' actions. */
export function paperMenu(s: { status?: string }): CtxEntry[] {
  const pp = (label: string, action: string, value?: string, key?: string, off?: boolean) => item('paper', label, action, value, key, off);
  return tidy([
    pp('New viewport', 'cmd', 'MV', 'MV'), { label: 'Arrange viewports', sub: VP_ARRANGEMENTS.map((a) => pp(a.label, 'cmd', `VPORTS ${a.id}`)) }, pp('Legend table', 'cmd', 'LEGEND', 'LEGEND'), pp('Notes table', 'cmd', 'NOTES', 'NOTES'), '-',
    { label: 'Issue status', sub: SHEET_STATUSES.map((st) => pp(st, 'status', st, s.status === st ? 'now' : undefined, s.status === st)) },
    pp('Sheet list', 'register'), '-',
    pp('Plot this layout…', 'cmd', 'PLOT', 'PLOT'), pp('Page setup and title block…', 'cmd', 'PAGESETUP'), '-',
    pp('Model tab', 'cmd', 'MODEL', 'MODEL')
  ]);
}

/** Right-click on a layout of the drawing (its own, from the file, or one made here with +): the model through a
 * viewport, its scale (one made here), the layout itself, and the Model tab. The file's own layouts are shown as saved:
 * their viewports are not changed here. */
export function drawingPaperMenu(s: { inside: boolean; editable: boolean; scale?: number; scales?: number[] }): CtxEntry[] {
  const scales = s.scales ?? VP_SCALES;
  const fp = (label: string, action: string, value?: string, key?: string, off?: boolean) => item('fpaper', label, action, value, key, off);
  return tidy([
    ...(s.inside ? [fp('Show on the Model tab', 'max'),
      ...(s.editable ? [{ label: 'Viewport scale', sub: (s.scale && !scales.includes(s.scale) ? [...scales, s.scale].sort((a, b) => a - b) : scales).map((k) => fp(`1:${k}`, 'scale', String(k), s.scale === k ? 'now' : undefined, s.scale === k)) }] : []), '-' as const] : []),
    fp('New layout', 'cmd', 'LAYOUT', 'LAYOUT'),
    ...(s.editable ? [{ label: 'Arrange viewports', sub: VP_ARRANGEMENTS.map((a) => fp(a.label, 'cmd', `VPORTS ${a.id}`)) }, fp('Page setup…', 'cmd', 'PAGESETUP', 'PAGESETUP'), fp('Rename layout…', 'rename'), fp('Copy layout', 'copy'), fp('Delete layout', 'delete')] : []), '-',
    fp('Model tab', 'cmd', 'MODEL', 'MODEL')
  ]);
}
