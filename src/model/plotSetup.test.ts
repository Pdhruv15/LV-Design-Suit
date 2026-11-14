import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { addPlanSheets, planDrawing } from '../docs/planLayout';
import { buildSldSheetHtml } from '../docs/sldSheet';
import { placeLvPoint } from './cadDevices';
import { setOf, type DrawingSheet } from './drawingSet';
import {
  applySetup, DEFAULT_PENS, importSetups, loadSetupLibrary, readSetups, saveToSetupLibrary, SETUPS_LIBRARY_KEY, setupsFile, diagramPenCss, inkOf, newTableId, nextId, projectForBatch, setupUsers, withBatch, withoutBatch, withoutSetup, withSetup, parseCtb, pensFor, plotOf, plotStamp, tableFromCtb, tablesOf, withDefaults, withTable
} from './plotSetup';
import type { Project } from '../types';

const gf = { building: 'V', level: 'GF' };
const villa: Project = {
  ...sampleProject, lvPoints: undefined, cadWiring: undefined, cadSketch: undefined, elvDevices: undefined, drawingSet: undefined, plot: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground floor', kind: 'ground', heightM: 4 }] }], rooms: [{ id: 'r1', buildingId: 'V', levelId: 'GF', name: 'Hall', type: 'lobby', areaM2: 120, outline: [[0, 0], [12, 0], [12, 10], [0, 10]] }] }
};
/** A CTB file as CAD programs write it: a text header, then the plot styles compressed with zlib. */
function ctbFile(styles: Record<number, { lw?: number; scr?: number }>): Uint8Array {
  const body = Array.from({ length: 255 }, (_, i) => {
    const c = styles[i + 1] ?? {};
    return ` ${i}{\n  name="Color_${i + 1}\n  color=-1006632961\n  screening=${c.scr ?? 100}\n  lineweight=${c.lw ?? 255}\n }`;
  }).join('\n');
  const text = `description=\naci_table_available=TRUE\nplot_style{\n${body}\n}\ncustom_lineweight_table{\n 0=0.0\n 4=0.13\n 6=0.18\n 8=0.25\n 10=0.35\n 13=0.5\n 17=0.7\n}\n`;
  const head = new TextEncoder().encode('PIAFILEVERSION_2.0,CTBVER1,compress\r\npmzlibcodec');
  const pad = new Uint8Array(60);
  pad.set(head);
  const z = deflateSync(Buffer.from(text, 'latin1'));
  const out = new Uint8Array(60 + z.length);
  out.set(pad); out.set(z, 60);
  return out;
}

describe('pen tables and page setup', () => {
  it('the default table prints as the sheets always have; an edited default is kept, saved unchanged it drops out', () => {
    expect(tablesOf(villa)).toEqual([DEFAULT_PENS]);
    const heavy = { ...DEFAULT_PENS, pens: { ...DEFAULT_PENS.pens, trays: { w: 0.7, grey: 100 } } };
    const p = withTable(villa, heavy);
    expect(tablesOf(p)[0].pens.trays.w).toBe(0.7);
    expect(withTable(p, DEFAULT_PENS).plot!.tables).toEqual([]);
    expect(newTableId(withTable(villa, { ...heavy, id: 'pt3' }))).toBe('pt4');
  });

  it('the drawn-lines and hatch pens: a table saved before them takes their defaults', () => {
    expect([DEFAULT_PENS.pens.sketch, DEFAULT_PENS.pens.hatch]).toEqual([{ w: 0.25, grey: 100 }, { w: 0.13, grey: 60 }]);
    const { sketch: _s, hatch: _h, ...older } = DEFAULT_PENS.pens;
    const p: Project = { ...villa, plot: { tables: [{ id: 'pt1', name: 'Old', pens: { ...older, frame: { w: 1, grey: 100 } } as typeof DEFAULT_PENS.pens }] } };
    expect(tablesOf(p)[1].pens).toMatchObject({ frame: { w: 1, grey: 100 }, sketch: { w: 0.25, grey: 100 }, hatch: { w: 0.13, grey: 60 } });
  });

  it('a sheet takes its own setup over the set\'s default; "all one thin line" thins every pen', () => {
    const p = withDefaults(withTable(villa, { ...DEFAULT_PENS, id: 'pt1', name: 'Heavy', pens: { ...DEFAULT_PENS.pens, frame: { w: 1, grey: 100 } } }), { pens: 'pt1', stamp: true });
    const s: Pick<DrawingSheet, 'plot'> = { plot: { weights: 'thin' } };
    expect(plotOf(p, s)).toEqual({ pens: 'pt1', stamp: true, weights: 'thin' });
    expect(pensFor(p, {}).frame.w).toBe(1);
    expect(Object.values(pensFor(p, s)).every((x) => x.w === 0.13)).toBe(true);
  });

  it('inks are black or a grey; diagram pens hold their width on paper; the stamp names the sheet', () => {
    expect(inkOf({ w: 0.25, grey: 100 })).toBe('#000');
    expect(inkOf({ w: 0.25, grey: 45 })).toBe('#8c8c8c');
    expect(diagramPenCss(DEFAULT_PENS.pens)).toBe(''); // as drawn
    expect(diagramPenCss({ ...DEFAULT_PENS.pens, bus: { w: 1, grey: 100 } })).toBe('.drawing svg .bus{stroke-width:3.78px!important;vector-effect:non-scaling-stroke;}');
    expect(plotStamp({ number: 'E-LTG-101', title: 'Lighting GF' }, 'B', 'PG', new Date(2026, 10, 6, 9, 5))).toBe('E-LTG-101 - Lighting GF · 2026-11-06 09:05 · Rev B · PG');
  });
});

describe('named page setups and batch lists', () => {
  const two = (): Project => ({ ...villa, drawingSet: { ...setOf(villa), sheets: [
    { id: 's1', kind: 'plan', number: 'E-201', title: 'GF Lighting', size: 'auto', scale: '1:100' } as DrawingSheet,
    { id: 's2', kind: 'system', number: 'E-001', title: 'Main SLD', size: 'A3' } as DrawingSheet
  ] } });
  const a1 = { id: 'ps1', name: 'A1 1:100 PDF', size: 'A1' as const, scale: 100, plot: { weights: 'thin' as const } };
  it('applied to sheets, a setup gives them its paper, plan scale and pens; editing it moves them along', () => {
    let p = withSetup(two(), a1);
    const [l, pw] = setOf(p).sheets;
    p = applySetup(p, 'ps1', [l.id]);
    const s = setOf(p).sheets.find((x) => x.id === l.id)!;
    expect([s.size, s.scale, s.plot]).toEqual(['A1', '1:100', { weights: 'thin', named: 'ps1' }]);
    expect(setupUsers(p, 'ps1').map((x) => x.id)).toEqual([l.id]);
    expect(setOf(p).sheets.find((x) => x.id === pw.id)!.plot?.named).toBeUndefined();
    p = withSetup(p, { ...a1, size: 'A2', scale: 50 });
    expect(setOf(p).sheets.find((x) => x.id === l.id)!.size).toBe('A2');
    expect(setOf(p).sheets.find((x) => x.id === l.id)!.scale).toBe('1:50');
    expect(nextId(p.plot?.setups, 'ps')).toBe('ps2');
  });
  it('deleting a setup leaves its sheets as they were, as their own; batch rows go back to the sheet\'s own', () => {
    let p = withSetup(two(), a1);
    const id = setOf(p).sheets[0].id;
    p = withBatch(applySetup(p, 'ps1', [id]), { id: 'b1', name: 'Tender', rows: [{ sheet: id, setup: 'ps1' }], output: 'one' });
    p = withoutSetup(p, 'ps1');
    const s = setOf(p).sheets[0];
    expect([s.size, s.plot?.weights, s.plot?.named]).toEqual(['A1', 'thin', undefined]);
    expect(p.plot?.batches?.[0].rows).toEqual([{ sheet: id }]);
    expect(withoutBatch(p, 'b1').plot?.batches).toEqual([]);
  });
  it('a batch plots each row with its setup for that run only', () => {
    const p = withSetup(two(), a1), [l, pw] = setOf(p).sheets;
    const run = projectForBatch(p, [{ sheet: l.id, setup: 'ps1' }, { sheet: pw.id }]);
    expect(setOf(run).sheets.map((x) => x.size)).toEqual(['A1', 'A3']);
    expect(setOf(p).sheets[0].size).toBe(l.size);
  });
});

describe('CTB import', () => {
  it('reads each colour\'s lineweight and screening, and the pens take those of their layer colours', async () => {
    const ctb = await parseCtb(ctbFile({ 1: { lw: 17 }, 3: { lw: 10 }, 7: { lw: 8 }, 8: { lw: 4, scr: 50 } }));
    expect(ctb.colours[1]).toEqual({ w: 0.7, grey: 100 });
    expect(ctb.colours[2]).toEqual({ grey: 100 }); // the object's own lineweight
    const t = tableFromCtb('pt1', 'ABC', ctb);
    expect(t.pens).toMatchObject({ bus: { w: 0.7 }, devices: { w: 0.35 }, trays: { w: 0.35 }, frame: { w: 0.25 }, routes: { w: 0.25 }, arch: { w: 0.13, grey: 45 } });
    expect(t.pens.sld).toEqual({ w: 0.25, grey: 100 });
  });

  it('a file that is not a CTB says so', async () => {
    await expect(parseCtb(new TextEncoder().encode('PIAFILEVERSION_2.0,STBVER1,compress'))).rejects.toThrow(/Not a CTB/);
    await expect(parseCtb(new TextEncoder().encode('hello'))).rejects.toThrow(/Not a CTB/);
  });
});

describe('pens on the printed sheets', () => {
  const plan = () => {
    const p = placeLvPoint(villa, gf, 'ltg', 'DB-GF1-Y1', 6, 5).project;
    const { set, ids } = addPlanSheets(setOf(p), p, 'lighting');
    return { p: { ...p, drawingSet: set }, s: set.sheets.find((x) => x.id === ids[0])! };
  };

  it('a plan sheet with the default pens draws as before', () => {
    const { p, s } = plan();
    const d = planDrawing(p, s)!;
    expect(d.svg).toContain('stroke="#8c8c8c" stroke-width="0.18"');
    expect(d.svg).toContain('stroke="#000" stroke-width="0.25"');
  });

  it('edited pens change the architect\'s outline and the devices', () => {
    const { p, s } = plan();
    const q = withTable(p, { ...DEFAULT_PENS, pens: { ...DEFAULT_PENS.pens, arch: { w: 0.35, grey: 60 }, devices: { w: 0.5, grey: 100 } } });
    const d = planDrawing(q, s)!;
    expect(d.svg).toContain('stroke="#666666" stroke-width="0.35"');
    expect(d.svg).toContain('<g fill="#fff" stroke="#000" stroke-width="0.5"><circle'); // the light
  });

  it('the sheet frame, its table lines and the plot stamp follow the setup', () => {
    const plain = buildSldSheetHtml(villa, '<svg/>', 'A3');
    expect(plain).toContain('border: 0.7mm solid #000');
    expect(plain).not.toContain('class="stamp"');
    const html = buildSldSheetHtml(villa, '<svg/>', 'A3', { no: 'E-1', title: 'T', count: 1, index: 1, plot: { frame: 1, lines: 0.5, stamp: 'E-1 - T · 2026-11-06 09:05' } });
    expect(html).toContain('border: 1mm solid #000');
    expect(html).toMatch(/\.tb td\.t \{ border: 0\.\d+mm solid #000/);
    expect(html).toContain('<div class="stamp">E-1 - T · 2026-11-06 09:05</div>');
  });
});

describe('page setups in and out', () => {
  const base = (): Project => ({ ...villa, plot: { tables: [{ ...DEFAULT_PENS, id: 'pt1', name: 'Thick', pens: { ...DEFAULT_PENS.pens, bus: { w: 1, grey: 100 } } }, { ...DEFAULT_PENS, id: 'pt2', name: 'Unused' }], setups: [
    { id: 'ps1', name: 'A1 PDF', size: 'A1', scale: 100, plot: { pens: 'pt1' } }, { id: 'ps2', name: 'A3 plain', size: 'A3', plot: { pens: 'lvds' } }
  ] } });
  afterEach(() => vi.unstubAllGlobals());
  it('exports all setups or some, with only the custom pen tables they use', () => {
    const all = setupsFile(base());
    expect(all.kind).toBe('lvds.pageSetups');
    expect(all.setups.map((x) => x.id)).toEqual(['ps1', 'ps2']);
    expect(all.tables.map((t) => t.id)).toEqual(['pt1']);
    expect(setupsFile(base(), ['ps2'])).toMatchObject({ setups: [{ id: 'ps2' }], tables: [] });
  });
  it('reads its own file, a project file, and refuses junk', () => {
    const f = setupsFile(base());
    expect(readSetups(JSON.parse(JSON.stringify(f)))?.setups).toHaveLength(2);
    expect(readSetups({ plot: base().plot })?.tables).toHaveLength(2);
    expect(readSetups({ plot: { setups: [{ name: ' ', size: 'A3' }, { name: 'x', size: 'B9' }] } })).toBeUndefined();
    expect(readSetups({ kind: 'lvds.pageSetups', setups: [{ name: 'Ok', size: 'A2', plot: 5, scale: -1 }] })?.setups[0]).toMatchObject({ name: 'Ok', plot: {} });
    expect(readSetups({ kind: 'lvds.pageSetups', setups: [{ name: 'Ok', size: 'A2', plot: {}, scale: 50 }] })?.setups[0].scale).toBe(50);
    expect([readSetups(null), readSetups('x'), readSetups({}), readSetups({ plot: {} })]).toEqual([undefined, undefined, undefined, undefined]);
  });
  it('imports with new ids, leaves a setup of the same name, matches or adds the pen table, drops an unknown one', () => {
    const f = setupsFile(base());
    const target: Project = { ...villa, plot: { tables: [{ ...DEFAULT_PENS, id: 'pt1', name: 'thick' }], setups: [{ id: 'ps1', name: 'a1 pdf', size: 'A4', plot: {} }] } };
    const r = importSetups(target, f);
    expect([r.added, r.kept]).toEqual([['A3 plain'], ['A1 PDF']]);
    expect(r.project.plot?.setups?.map((x) => [x.id, x.name])).toEqual([['ps1', 'a1 pdf'], ['ps2', 'A3 plain']]);
    expect(r.project.plot?.setups?.[1].plot.pens).toBe('lvds');
    const fresh = importSetups({ ...villa, plot: undefined }, f);
    expect(fresh.added).toEqual(['A1 PDF', 'A3 plain']);
    expect(fresh.project.plot?.tables?.map((t) => [t.id, t.name])).toEqual([['pt1', 'Thick']]);
    expect(fresh.project.plot?.setups?.[0].plot.pens).toBe('pt1');
    const renamed = importSetups({ ...villa, plot: { tables: [{ ...DEFAULT_PENS, id: 'pt1', name: 'Other' }] } }, f);
    expect(renamed.project.plot?.tables?.map((t) => t.id)).toEqual(['pt1', 'pt2']);
    expect(renamed.project.plot?.setups?.[0].plot.pens).toBe('pt2');
    const lost = importSetups({ ...villa, plot: undefined }, { ...f, tables: [] });
    expect('pens' in (lost.project.plot?.setups?.[0].plot ?? {})).toBe(false);
  });
  it('the library merges setups and tables by name, any case', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(loadSetupLibrary()).toEqual({ kind: 'lvds.pageSetups', setups: [], tables: [] });
    expect(saveToSetupLibrary(setupsFile(base()))).toBe(true);
    const f2 = setupsFile(base());
    saveToSetupLibrary({ ...f2, setups: [{ ...f2.setups[0], name: 'a1 pdf', size: 'A2' }], tables: [] });
    const lib = loadSetupLibrary();
    expect(lib.setups.map((x) => [x.name, x.size])).toEqual([['A3 plain', 'A3'], ['a1 pdf', 'A2']]);
    expect(lib.tables).toHaveLength(1);
    store.set(SETUPS_LIBRARY_KEY, '{bad');
    expect(loadSetupLibrary().setups).toEqual([]);
  });
  it('the library keeps each project\'s pen table apart, though both projects call theirs pt1', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    const other: Project = { ...villa, plot: { tables: [{ ...DEFAULT_PENS, id: 'pt1', name: 'Fine', pens: { ...DEFAULT_PENS.pens, bus: { w: 0.25, grey: 100 } } }], setups: [{ id: 'ps1', name: 'A2 fine', size: 'A2', plot: { pens: 'pt1' } }] } };
    saveToSetupLibrary(setupsFile(base(), ['ps1']));
    saveToSetupLibrary(setupsFile(other));
    const lib = loadSetupLibrary();
    expect(lib.tables.map((t) => [t.id, t.name])).toEqual([['lib:thick', 'Thick'], ['lib:fine', 'Fine']]);
    expect(lib.setups.map((x) => [x.name, x.plot.pens])).toEqual([['A1 PDF', 'lib:thick'], ['A2 fine', 'lib:fine']]);
    // Each setup brings its own table into a new project, by name.
    const r = importSetups({ ...villa, plot: undefined }, lib);
    const penOf = (name: string) => r.project.plot!.tables!.find((t) => t.id === r.project.plot!.setups!.find((x) => x.name === name)!.plot.pens)!;
    expect([penOf('A1 PDF').name, penOf('A1 PDF').pens.bus.w, penOf('A2 fine').name, penOf('A2 fine').pens.bus.w]).toEqual(['Thick', 1, 'Fine', 0.25]);
    // The built-in table needs no copy: a setup on it stays on it.
    saveToSetupLibrary(setupsFile(base(), ['ps2']));
    expect(loadSetupLibrary().setups.find((x) => x.name === 'A3 plain')!.plot.pens).toBe(DEFAULT_PENS.id);
  });
  it('a file brings in only what a page setup holds: no other fields, no pen table with a pen missing', () => {
    const { bus: _bus, ...short } = DEFAULT_PENS.pens;
    const f = readSetups({ kind: 'lvds.pageSetups', tables: [{ id: 'pt1', name: 'Short', pens: short }, { id: 'pt2', name: 'Whole', pens: DEFAULT_PENS.pens }, { id: 'pt3', name: ' ', pens: DEFAULT_PENS.pens }],
      setups: [{ name: 'S', size: 'A3', plot: { pens: 'pt2', weights: 'thin', stamp: true, drawn: false, named: 'ps9', extra: { a: 1 } } }, { name: 'T', size: 'A3', plot: { weights: 'bold', stamp: 'yes' } }] })!;
    expect(f.setups.map((x) => x.plot)).toEqual([{ pens: 'pt2', weights: 'thin', stamp: true, drawn: false }, {}]);
    expect(f.tables.map((t) => t.name)).toEqual(['Whole']);
  });
});
