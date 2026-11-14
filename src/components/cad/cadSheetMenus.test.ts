import { describe, expect, it } from 'vitest';
import { cadCommand } from './cadCommands';
import { type CtxEntry, type CtxItem } from './cadContextMenu';
import { argOf, drawingObjectMenu, paperMenu, REF_FADES, viewportMenu, xrefMenu } from './cadSheetMenus';
import { SHEET_STATUSES } from '../../model/drawingSet';
import { VP_SCALES, type PlanViewport } from '../../model/planViewports';

const flat = (list: CtxEntry[]): CtxItem[] => list.flatMap((x) => (x === '-' ? [] : [x, ...(x.sub ?? [])]));
const labels = (list: CtxEntry[]) => list.map((x) => (x === '-' ? '-' : x.label));
const ref = { name: 'ARCH', fade: 50, print: true } as const;
const vp: PlanViewport = { id: 'vp1', box: [10, 10, 200, 150], at: [5, 5], scale: 100 };

describe('right-click menus (phase 3): blocks, references and sheets', () => {
  it('every entry runs a typed command or a page action: none without a tool behind it', () => {
    const all = [drawingObjectMenu({ block: 'WC', picked: 1 }), drawingObjectMenu({ picked: 2 }), xrefMenu(ref), xrefMenu({ ...ref, clip: [[0, 0], [1, 0], [1, 1]], unloaded: true }), viewportMenu(vp), paperMenu({})];
    for (const x of all.flatMap(flat)) {
      if (x.sub) continue;
      if (x.cmd) expect(cadCommand(x.cmd), x.cmd).toBeTruthy();
      else expect(x.act, x.label).toBeTruthy();
    }
  });

  it('a block of the opened drawing: Count, Explode, Copy as a block, Crop; several objects or another kind: Erase', () => {
    expect(labels(drawingObjectMenu({ block: 'WC', picked: 1 }))).toEqual(['Count instances', 'Explode into drawn objects', 'Copy as a block of this drawing', 'Crop…', '-', 'Erase', '-', 'Deselect all', 'Properties']);
    expect(labels(drawingObjectMenu({ block: 'WC', picked: 3 }))).toEqual(['Erase', '-', 'Deselect all', 'Properties']);
    expect(labels(drawingObjectMenu({ picked: 1 }))).toEqual(['Erase', '-', 'Deselect all', 'Properties']);
  });

  it('a reference: Open, Clip ▸, Fade ▸ (the fade now marked), Reload, Unload / Load, Detach, Bind, print, layers', () => {
    const m = xrefMenu(ref);
    expect(labels(m)).toEqual(['Open reference', '-', 'Clip', 'Fade', 'Reload', 'Unload', 'Detach', 'Bind (save a copy)…', '-', 'Do not print on sheets', 'Reference layers…', '-', 'Properties (References palette)…']);
    const f = flat(m).find((x) => x.label === 'Fade')!.sub!;
    expect(f.map((x) => [x.label, x.arg, !!x.off])).toEqual(REF_FADES.map((k) => [`${k} %`, `fade|${k}`, k === 50]));
    expect(flat(m).find((x) => x.label === 'Remove clip')!.off).toBe(true);
    const u = xrefMenu({ ...ref, unloaded: true, print: false, clip: [[0, 0], [1, 0], [1, 1]] });
    expect(labels(u)).toContain('Load');
    expect(labels(u)).toContain('Print on sheets');
    expect(flat(u).find((x) => x.label === 'Remove clip')!.off).toBeUndefined();
  });

  it('a viewport: Activate, Show on the Model tab, Viewport scale ▸, Lock, Frame, layers, Erase, Plot, Page setup', () => {
    const m = viewportMenu(vp);
    expect(labels(m)).toEqual(['Activate (model space)', 'Show on the Model tab', '-', 'Viewport scale', 'Unlock display', 'Frame prints', '-', 'Viewport layers…', '-', 'Erase viewport', '-', 'Plot this layout…', 'Page setup and title block…', '-', 'Properties']);
    expect(flat(m).find((x) => x.label === 'Viewport scale')!.sub!.map((x) => [x.arg, !!x.off])).toEqual(VP_SCALES.map((k) => [`scale|${k}`, k === 100]));
    const mine = flat(viewportMenu(vp, [50, 75, 100])).find((x) => x.label === 'Viewport scale')!.sub!.map((x) => x.label);
    expect(mine).toEqual(['1:50', '1:75', '1:100']);
    expect(flat(viewportMenu({ ...vp, scale: 250 }, [50, 100])).find((x) => x.label === 'Viewport scale')!.sub!.map((x) => x.label)).toEqual(['1:50', '1:100', '1:250']); // a scale in use is listed
    expect(labels(viewportMenu({ ...vp, locked: false, frame: true }))).toEqual(expect.arrayContaining(['Lock display', 'Frame does not print']));
  });

  it('the paper: New viewport, Legend, Notes, Issue status ▸ (the sheet\'s marked), Sheet list, Plot, Page setup, Model tab', () => {
    const m = paperMenu({ status: 'FOR APPROVAL' });
    expect(labels(m)).toEqual(['New viewport', 'Arrange viewports', 'Legend table', 'Notes table', '-', 'Issue status', 'Sheet list', '-', 'Plot this layout…', 'Page setup and title block…', '-', 'Model tab']);
    const st = flat(m).find((x) => x.label === 'Issue status')!.sub!;
    expect(st.map((x) => x.label)).toEqual(SHEET_STATUSES);
    expect(st.filter((x) => x.off).map((x) => x.label)).toEqual(['FOR APPROVAL']);
    expect(flat(m).find((x) => x.label === 'New viewport')!.arg).toBe('cmd|MV');
    const arr = flat(m).find((x) => x.label === 'Arrange viewports')!.sub!;
    expect(arr).toHaveLength(9);
    expect(arr.filter((x) => x.label === 'Two: side by side').map((x) => x.arg)).toEqual(['cmd|VPORTS 2V']);
  });

  it('argOf: the action and its value back from the entry', () => {
    expect(argOf('status|FOR APPROVAL')).toEqual({ action: 'status', value: 'FOR APPROVAL' });
    expect(argOf('reload')).toEqual({ action: 'reload' });
  });
});
