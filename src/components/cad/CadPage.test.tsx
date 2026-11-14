// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CadPage from './CadPage';
import { useCad, type CadState } from './cadState';
import { useSheetUi } from '../sld/sheetUi';
import { cadFileMenu } from './cadFileMenu';
import { buildingInfoOf, DEFAULT_ROOM_TYPES } from '../../calc/building';
import type { CadShow } from './cadObjectMenus';
import { sizeRoute, trayPlanOf } from '../../calc/cableTray';
import { openDrawing } from '../../engines/cad/cadEngine';
import { dropRefGeometry, keepRefGeometry } from '../../model/cadRefs';
import '../../engines/cad/cadOps'; // loaded ahead: the engine loads it on demand, which a busy test run can make slow
import { sampleProject } from '../../data/sampleProject';
import { placeLvPoint } from '../../model/cadDevices';
import { planTarget, type PlanTarget } from '../../model/planTarget';
import { archOnOf } from '../../model/cadLayerState';
import { dimLabel, dimMeasure, sketchOf } from '../../model/cadSketch';
import { annoOf, unitsPerPaperMm } from '../../model/cadAnnotate';
import { drawingLayoutsOf } from '../../model/drawingLayouts';
import type { CadDimStyle } from '../../model/cadStyles';
import { explodeNote, noteBox } from '../../model/cadMtext';
import { blockDefOf, blockDefsOf, type CadBlockDef } from '../../model/cadBlocks';
import { openTitleBlockInCad, TB_LAYERS } from '../../model/titleBlockCad';
import type { TitleTemplate } from '../../model/titleBlock';
import type { Project, SketchItem } from '../../types';
import { DRAFT_DEFAULTS, type DraftSettings } from '../../model/cadDraft';
import { clearClip } from './cadClipboardStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no canvas drawing or resize observer: drawing is skipped, the page still works (the view is 800 × 500).
class Stub { moveTo() {} lineTo() {} closePath() {} observe() {} disconnect() {} }
Object.assign(globalThis, { Path2D: Stub, ResizeObserver: Stub });
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const root0 = path.resolve(__dirname, '../../..');
const bytes = (rel: string) => new Uint8Array(readFileSync(path.join(root0, rel)));
const villa: Project = {
  ...sampleProject, id: 'p1', cadPlanLinks: undefined,
  building: { buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }] }], rooms: [] }
};
let root: Root, host: HTMLDivElement, state: CadState, project: Project;
const onChange = vi.fn((p: Project, _message: string) => { project = p; });
const onPrefs = vi.fn((_p: { draft: DraftSettings; autosaveMin: number }) => {});
/** Whether the architect's layer i shows: its On, kept in the project (Layer palette or the Layers list). */
const shown = (i: number) => archOnOf(project, state.view!.file, state.view!.info.layers)[i];
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); project = villa; onChange.mockClear();
  (window as { lvds?: unknown }).lvds = { cadFile: {
    engine: async () => bytes('electron/cad/lvds_cad_reader_bg.wasm'),
    sampleBytes: vi.fn(async (name: string) => ({ file: name, bytes: bytes(`electron/samples/${name}`) })),
    openBytes: vi.fn(async () => ({ file: 'plan.dwg', path: '/plans/plan.dwg', bytes: bytes('tests/fixtures/cad/plan-2018.dwg') }))
  } };
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; delete (window as { lvds?: unknown }).lvds; });

function Host({ start = villa, show }: { start?: Project; show?: (s: CadShow) => void }) {
  const cad = useCad('p1');
  const [p, setP] = useState(start);
  const sheetUi = useSheetUi();
  const [draft, setDraft] = useState(DRAFT_DEFAULTS);
  state = cad;
  return <CadPage cad={cad} project={p} onChange={(next, msg) => { setP(next); onChange(next, msg); }} onStatus={() => {}} sheetUi={sheetUi}
    draft={draft} onPrefs={(x) => { setDraft(x.draft); onPrefs(x); }} onShow={show} />;
}
/** Waits for something on screen (a slower machine takes longer), up to 10 s. */
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 50)); }); expect(ok()).toBe(true); };
const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
/** A status bar switch, by its name (an icon, no text). */
const tg = (label: string) => document.querySelector<HTMLButtonElement>(`.cad-status button[aria-label="${label}"]`)!;
const result = () => document.querySelector('.cad-res')?.textContent ?? '';
const command = async (text: string) => {
  const input = document.querySelector('input[aria-label="Command"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { input.form!.requestSubmit(); });
};
/** SAVE / SAVEDWG the first time: Save As opens, and its Save is pressed as it starts. */
const saveCmd = async (text: string) => {
  await command(text);
  const ok = [...document.querySelectorAll('[role="dialog"][aria-label="Save As"] button')].find((b) => b.textContent === 'Save') as HTMLButtonElement | undefined;
  expect(ok, 'Save As opens').toBeTruthy();
  await act(async () => { ok!.click(); });
};
/** Drawing units → canvas pixels, through the fitted 800 × 500 view. */
const screenOf = (x: number, y: number) => {
  const { extents: [x0, y0, x1, y1] } = state.view!.info;
  const scale = Math.min(800 / (x1 - x0), 500 / (y1 - y0)) * 0.92;
  return [(x - (x0 + x1) / 2) * scale + 400, 250 - (y - (y0 + y1) / 2) * scale];
};
/** A selection window dragged from one point to another (drawing units). */
const dragWindow = async (a: [number, number], b: [number, number]) => {
  const [[ax, ay], [bx, by]] = [screenOf(...a), screenOf(...b)];
  const c = document.querySelector('canvas.cad-over')!;
  await act(async () => {
    c.dispatchEvent(new MouseEvent('mousedown', { clientX: ax, clientY: ay, button: 0, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: (ax + bx) / 2, clientY: (ay + by) / 2, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: bx, clientY: by, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mouseup', { clientX: bx, clientY: by, button: 0, bubbles: true }));
  });
};
/** A click on the drawing at a point in drawing units, through the fitted 800 × 500 view. */
const clickAt = async (x: number, y: number, shiftKey = false) => {
  const [sx, sy] = screenOf(x, y);
  const c = document.querySelector('canvas.cad-over')!;
  await act(async () => {
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: sx, clientY: sy, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mouseup', { clientX: sx, clientY: sy, button: 0, shiftKey, bubbles: true }));
  });
};

describe('CAD view', () => {
  it('opens the sample villa by default, with its layers, a command line and a status bar', async () => {
    act(() => root.render(<Host />));
    await flush();
    expect(state.view?.file).toBe('sample-villa-gf.dxf');
    expect(document.body.textContent).toContain('Sample plan for testing');
    expect(document.body.textContent).toMatch(/sample-villa-gf\.dxf · DXF · mm · 1 : 1/);
    expect(button('A-WALLon')).toBeDefined();
  });

  it('turns layers off and on, and toggles snaps from the status bar, the command line and the function keys', async () => {
    act(() => root.render(<Host />));
    await flush();
    const wall = state.view!.info.layers.findIndex((l) => l.name === 'A-WALL');
    act(() => button('A-WALLon').click());
    expect(shown(wall)).toBe(0);
    act(() => button('All on').click());
    expect(shown(wall)).toBe(1);
    act(() => tg('OSNAP').click());
    expect(state.toggles.osnap).toBe(false);
    await command('grid');
    expect(state.toggles.grid).toBe(true);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })); });
    expect(state.toggles.ortho).toBe(true);
    await command('xyz');
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/Unknown command "XYZ"/);
  });

  it('starts with the grid lines on; F7 steps lines → dots → off, as the SLD does, and shows the zoom in the corner', async () => {
    act(() => root.render(<Host />));
    await flush();
    const f7 = () => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7' })); });
    expect([state.toggles.grid, state.gridDots]).toEqual([true, false]);
    f7();
    expect([state.toggles.grid, state.gridDots]).toEqual([true, true]);
    expect(tg('GRID').title).toMatch(/^Grid: dots/);
    f7();
    expect([state.toggles.grid, state.gridDots]).toEqual([false, false]);
    f7();
    expect([state.toggles.grid, state.gridDots]).toEqual([true, false]);
    expect(document.querySelector('.zoom-chip')?.textContent).toBe('100 %'); // the drawing fitted
  });

  it('measures a distance between two snapped points (DI)', async () => {
    act(() => root.render(<Host />));
    await flush();
    await command('di');
    expect(state.tool).toBe('dist');
    await clickAt(30, -80); // snaps to the front wall's outside face end (0, -100)
    await clickAt(6170, -80); // … and to the entrance jamb (6200, -100)
    expect(result()).toMatch(/Distance 6\.20 m/);
    expect(result()).toMatch(/ΔX 6\.20 m · ΔY 0\.00 m · angle 0\.00°/);
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/Distance = 6\.20 m/);
  });

  it('says what an object is when clicked: a light block with its circuit', async () => {
    act(() => root.render(<Host />));
    await flush();
    await clickAt(6687.5 + 190, 7375); // on the light's circle
    expect(result()).toMatch(/Block · L1/);
    expect(result()).toMatch(/LayerE-LIGHT/);
    expect(result()).toMatch(/CCTDB-GF1\/R1/);
  });

  it('crops a light block (CROP): asks first as it is on a circuit, cuts it at a window and erases it, in one change (one ⌘Z)', async () => {
    act(() => root.render(<Host />));
    await flush();
    const last = () => state.history[state.history.length - 1];
    await command('CROP');
    expect(last()).toMatch(/CROP {2}Select a block to crop:/);
    await clickAt(6687.5 + 190, 7375); // on the light's circle
    await until(() => /Crop it\? \[Yes\/No\]/.test(last()));
    expect(last()).toMatch(/on circuit DB-GF1\/R1/);
    await command('Y');
    expect(last()).toMatch(/\[Circle\/Object\]/);
    // A window over the left half of the light: its circle cut at the window's right side.
    await command('6400,7100');
    await command('6687.5,7650');
    await command('');
    expect(last()).toBe('CROP  [Inside/Outside] <Inside>:');
    await command('');
    await until(() => onChange.mock.calls.length > 0);
    const [next, msg] = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(msg).toMatch(/^CROP {2}\d+ pieces? kept.* · original block erased · ⌘Z to undo$/);
    const erased = next.cadErased?.['sample-villa-gf.dxf'] ?? [];
    expect(erased).toHaveLength(1);
    const items = next.cadSketch?.find((s) => s.file === 'sample-villa-gf.dxf')?.items ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(items.every((it) => state.view!.info.layers.some((l) => l.name === it.layer))).toBe(true); // on the drawing's own layers
    expect(items.some((it) => it.kind === 'arc')).toBe(true);
    for (const it of items.filter((x) => x.kind === 'line' || x.kind === 'pline')) for (const [x] of it.pts) expect(x).toBeLessThanOrEqual(6687.5 + 1e-6);
    // The block is no longer picked: a click where it was finds what is under it, not the light.
    await clickAt(6687.5 + 190, 7375);
    expect(result()).not.toMatch(/CCTDB-GF1\/R1/);
  });

  it('finds a room area from the walls and adds it to Building information', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.setTool('room'));
    await clickAt(10500, 2250); // the guest bedroom: no outline on the plan
    expect(result()).toMatch(/Room area 16\.\d\d m²/);
    act(() => button('Add').click()); // the room form is open: Click inside is a room tool
    const rooms = buildingInfoOf(project).rooms;
    expect(rooms).toHaveLength(1);
    expect(rooms[0]).toMatchObject({ buildingId: 'V', levelId: 'GF' });
    expect(rooms[0].areaM2).toBeGreaterThan(16);
    expect(rooms[0].outline!.length).toBeGreaterThanOrEqual(4); // kept in metres: devices find their room by it
    expect(onChange.mock.calls[0][1]).toMatch(/added to Ground · ⌘Z to undo$/);
  });

  it('erases an object of the opened drawing (Delete), by handle, and RESTOREDWG brings it back', async () => {
    act(() => root.render(<Host />));
    await flush();
    const last = () => state.history[state.history.length - 1];
    await clickAt(6687.5 + 190, 7375); // on the light's circle
    expect(result()).toMatch(/Block · L1/);
    expect(button('Erase')).toBeTruthy();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toMatch(/^Block L1 on E-LIGHT erased \(the drawing file is unchanged.* · ⌘Z to undo$/);
    expect(project.cadErased?.['sample-villa-gf.dxf']).toHaveLength(1);
    expect(project.cadSketch ?? []).toEqual([]); // nothing drawn in its place
    await flush();
    await clickAt(6687.5 + 190, 7375);
    expect(result()).not.toMatch(/Block · L1/);
    await command('RESTOREDWG');
    expect(last()).toMatch(/^RESTOREDWG {2}1 erased drawing object back/);
    expect(project.cadErased?.['sample-villa-gf.dxf'] ?? []).toEqual([]);
    await flush();
    await clickAt(6687.5 + 190, 7375);
    expect(result()).toMatch(/Block · L1/);
    await command('RESTOREDWG');
    expect(last()).toBe('RESTOREDWG  Nothing of this drawing is erased.');
  });

  it('picks several objects of the opened drawing with Shift-click and erases them in one change (E)', async () => {
    act(() => root.render(<Host />));
    await flush();
    await clickAt(6687.5 + 190, 7375); // the light block
    await clickAt(2500, 150, true); // the kitchen outline, added
    expect(state.history[state.history.length - 1]).toBe('SEL  2 objects selected');
    await command('E');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toMatch(/^2 objects erased/);
    const erased = project.cadErased?.['sample-villa-gf.dxf'] ?? [];
    expect(new Set(erased).size).toBe(2);
  });

  it('measures the area of a closed object (AREA, O)', async () => {
    act(() => root.render(<Host />));
    await flush();
    await command('area');
    await command('o');
    await clickAt(2500, 150); // the kitchen outline (A-ROOM), 4.85 × 4.35 m
    expect(result()).toMatch(/Area 21\.10 m²/);
    expect(result()).toMatch(/Perimeter 18\.40 m · of the object picked/);
  });

  it('places a light on a circuit, selects it with a click, and deletes it (the circuit count follows)', async () => {
    act(() => root.render(<Host />));
    await flush();
    await command('dev');
    expect(state.tool).toBe('dev');
    act(() => { state.setFeederId('DB-GF1-Y1'); state.toggle('osnap'); }); // OSNAP off: placed exactly where clicked
    const before = villa.feeders.find((f) => f.id === 'DB-GF1-Y1')!.points?.ltg ?? 0;
    await clickAt(3000, 9000);
    expect(project.lvPoints).toEqual([expect.objectContaining({ type: 'ltg', feederId: 'DB-GF1-Y1', buildingId: 'V', levelId: 'GF', x: expect.closeTo(3, 6), y: expect.closeTo(9, 6) })]);
    expect(project.feeders.find((f) => f.id === 'DB-GF1-Y1')!.points?.ltg).toBe(before + 1);
    expect(onChange.mock.calls[0][1]).toMatch(/^Light placed on DB-GF1\/Y1 · Majlis lighting/);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(state.tool).toBe('none');
    await clickAt(3000, 9000);
    expect(result()).toMatch(/Light LV point/);
    expect(result()).toMatch(/CircuitDB-GF1\/Y1 · Majlis lighting/);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); });
    expect(project.lvPoints ?? []).toEqual([]);
    expect(project.feeders.find((f) => f.id === 'DB-GF1-Y1')!.points?.ltg).toBe(before);
  });

  it('wires the circuits on the level, takes one off with Wire one, sends the length to the schedule and saves the wiring', async () => {
    const saveBinary = vi.fn(async () => '/plans/out.dxf');
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary };
    const start: Project = {
      ...villa,
      boards: villa.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, planPoint: { x: 1, y: 1 }, level: { building: 'V', level: 'GF' } } : b)),
      lvPoints: [
        { id: 'P1', type: 'ltg', feederId: 'DB-GF1-Y1', buildingId: 'V', levelId: 'GF', x: 3, y: 9 },
        { id: 'P2', type: 'ltg', feederId: 'DB-GF1-Y1', buildingId: 'V', levelId: 'GF', x: 6, y: 9 }
      ]
    };
    act(() => root.render(<Host start={start} />));
    await flush();
    await command('WC');
    expect(project.cadWiring).toEqual([{ feederId: 'DB-GF1-Y1' }]);
    expect(onChange.mock.calls[0][1]).toMatch(/^1 circuit wired on .* · Update schedules sends the lengths to the cable schedule/);
    await command('W1');
    expect(state.tool).toBe('wire');
    act(() => { state.toggle('osnap'); });
    await clickAt(3000, 9000);
    expect(project.cadWiring).toBeUndefined();
    expect(onChange.mock.calls[1][1]).toMatch(/^Wiring of DB-GF1\/Y1 taken off/);
    await clickAt(3000, 9000);
    expect(onChange.mock.calls[2][1]).toMatch(/^DB-GF1\/Y1 · \dC × [\d.]+ mm² · \d+ m wired/);
    expect(document.body.textContent).toContain('1 circuit wired on this level.');
    await command('SCHED');
    const m = /· (\d+) m wired/.exec(onChange.mock.calls[2][1])![1];
    expect(project.feeders.find((f) => f.id === 'DB-GF1-Y1')!.lengthM).toBe(Number(m));
    await saveCmd('save');
    await flush();
    const text = new TextDecoder().decode((saveBinary.mock.calls[0] as unknown as [{ bytes: Uint8Array }])[0].bytes);
    expect(text).toContain('E-LV-WIRING');
    expect(text).toContain('E-LV-TAGS');
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/1 circuit wired on E-LV-WIRING \/ E-LV-TAGS\)/);
  });

  it('draws polygons, circles by 2 or 3 points or a diameter, arcs by start, centre and end, ellipses and revision clouds, and saves them as such', async () => {
    const saveBinary = vi.fn(async () => '/plans/out.dxf');
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary };
    const X = 200000;
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    const at = (x: number, y: number) => command(`${x},${y}`);
    const last = () => { const it = project.cadSketch![0].items; return it[it.length - 1]; };
    const near = (q: number[]) => q.map((v) => +v.toFixed(6) + 0);
    // Each tool repeats until another starts or Esc (C while Polygon runs is its Circumscribed option).
    const esc = () => act(() => state.setTool('none'));
    // A hexagon of radius 1000 m round (X, 0): six sides typed first.
    await command('POL'); await command('6'); await at(X, 0); await at(X + 1000, 0);
    expect(last()).toMatchObject({ kind: 'pline', layer: 'LV-SKETCH', closed: true });
    expect(last().pts.map(near)).toEqual([[X + 1000, 0], [X + 500, 866.025404], [X - 500, 866.025404], [X - 1000, 0], [X - 500, -866.025404], [X + 500, -866.025404]]);
    // Circles: by the ends of a diameter (2P), by three points (3P), by the centre and a diameter typed (D).
    esc(); await command('C'); await command('2P');
    expect(state.tool).toBe('circle2p');
    await at(X, 3000); await at(X + 2000, 3000);
    expect(last()).toMatchObject({ kind: 'circle', pts: [[X + 1000, 3000]], r: 1000 });
    esc(); await command('C'); await command('3P'); await at(X, 6000); await at(X + 2000, 6000); await at(X + 1000, 7000);
    expect([near(last().pts[0]), +last().r!.toFixed(6)]).toEqual([[X + 1000, 6000], 1000]);
    esc(); await command('C'); await at(X, 9000); await command('D'); await command('3000');
    expect(last()).toMatchObject({ kind: 'circle', pts: [[X, 9000]], r: 1500 });
    // An arc from its start, round its centre, to its end (a quarter, anticlockwise).
    act(() => state.setTool('arcsce'));
    await at(X + 1000, 12000); await at(X, 12000); await at(X, 13000);
    expect([last().kind, last().r, last().a0, +last().a1!.toFixed(9)]).toEqual(['arc', 1000, 0, +(Math.PI / 2).toFixed(9)]);
    // Ellipses: centre, the end of an axis, the other half-axis typed; then by the two ends of an axis (A).
    esc(); await command('EL'); await at(X, 15000); await at(X + 2000, 15000); await command('500');
    expect(last()).toMatchObject({ kind: 'ellipse', pts: [[X, 15000]], ax: [2000, 0], ratio: 0.25 });
    esc(); await command('EL'); await command('A'); await at(X, 18000); await at(X + 4000, 18000); await command('1000');
    expect(last()).toMatchObject({ kind: 'ellipse', pts: [[X + 2000, 18000]], ax: [2000, 0], ratio: 0.5 });
    // Revision clouds on the annotation layer: a rectangle with arcs typed 500 long; then round points (P).
    esc(); await command('REVCLOUD'); await command('500'); await at(X, 21000); await at(X + 3000, 23000);
    expect(last()).toMatchObject({ kind: 'pline', layer: 'LV-ANNO', closed: true, cloud: 500, pts: [[X, 21000], [X + 3000, 21000], [X + 3000, 23000], [X, 23000]] });
    esc(); await command('REVCLOUD'); await command('P'); await at(X, 25000); await at(X + 2000, 25000); await at(X + 1000, 27000); await command('');
    expect(last()).toMatchObject({ kind: 'pline', layer: 'LV-ANNO', closed: true, pts: [[X, 25000], [X + 2000, 25000], [X + 1000, 27000]] });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toMatch(/^Revision cloud, arcs [\d.]+ m long · ⌘Z to undo$/);
    // Saved: an ELLIPSE, and the clouds as polylines with their arcs (bulges, group 42).
    esc(); await saveCmd('save');
    await flush();
    const text = new TextDecoder().decode((saveBinary.mock.calls[0] as unknown as [{ bytes: Uint8Array }])[0].bytes);
    expect(text.match(/\nELLIPSE\r?\n/g)).toHaveLength(2);
    expect(text).toMatch(/\n\s*42\r?\n\s*0\.5\r?\n/);
  });

  it('places an ELV device and saves the drawing as DXF with the devices on their layers', async () => {
    const saveBinary = vi.fn(async () => '/plans/out.dxf');
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary };
    act(() => root.render(<Host />));
    await flush();
    act(() => { state.setDevice('smoke-detector'); state.setTool('dev'); state.toggle('osnap'); });
    await clickAt(3000, 8000);
    expect(project.elvDevices).toEqual([expect.objectContaining({ type: 'smoke-detector', x: expect.closeTo(3, 6), y: expect.closeTo(8, 6) })]);
    await saveCmd('save');
    await flush();
    const arg = (saveBinary.mock.calls[0] as unknown as [{ defaultName: string; bytes: Uint8Array }])[0];
    expect(arg.defaultName).toBe('sample-villa-gf - with devices.dxf');
    const text = new TextDecoder().decode(arg.bytes);
    expect(text).toContain('E-ELV-DEVICES');
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/SAVE {2}Saved out\.dxf \(1 device on E-LV-POINTS/);
  });

  it('draws lines, rectangles, circles, text and dimensions — by clicks and typed input', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap')); // exact points
    const sk = () => project.cadSketch?.[0]?.items ?? [];
    await command('l');
    await clickAt(1000, 1000);
    await clickAt(4000, 1000);
    expect(sk()[0]).toMatchObject({ kind: 'line', layer: 'LV-SKETCH' });
    expect(sk()[0].pts[1][0] - sk()[0].pts[0][0]).toBeCloseTo(3000, 0);
    await command('@0,2000'); // relative point from the last one
    expect(sk()[1].pts[1][1] - sk()[1].pts[0][1]).toBeCloseTo(2000, 6);
    await command(''); // Enter stops LINE
    await command('rec');
    await clickAt(6000, 6000);
    await clickAt(9000, 8000);
    expect(sk()[2]).toMatchObject({ kind: 'pline', closed: true });
    await command('c');
    await clickAt(12000, 9000);
    await command('500'); // typed radius
    expect(sk()[3]).toMatchObject({ kind: 'circle', r: 500 });
    await command('t');
    await clickAt(2000, 3000);
    await command('DB ROOM');
    expect(sk()[4]).toMatchObject({ kind: 'text', text: 'DB ROOM', layer: 'LV-ANNO' });
    await command('dim');
    await clickAt(1000, 500);
    await clickAt(4000, 500);
    await clickAt(2500, 200);
    expect(sk()[5]).toMatchObject({ kind: 'dim', layer: 'LV-ANNO' });
    expect(Number(sk()[5].text)).toBeCloseTo(3, 1);
  });

  it('TJUST justifies the texts picked without moving them; TXTHEIGHT sets their height on paper, or the height for new text', async () => {
    const X = 200000, F = 'sample-villa-gf.dxf';
    // "DB ROOM" 250 high (2.5 mm at 1:100): 1,050 wide from the left end of its baseline at (X, 0).
    const start: Project = { ...villa, cadSketch: [{ file: F, items: [{ id: 'T1', kind: 'text', layer: 'LV-ANNO', pts: [[X, 0]], text: 'DB ROOM', h: 250 }] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const it = () => project.cadSketch![0].items[0];
    await clickAt(X + 300, 100);
    expect(state.selected).toBe('sk:T1');
    await command('tj');
    expect(state.history[state.history.length - 1]).toContain('TJUST  Justify [Left/Centre/Right/TL/TC/TR/ML/MC/MR/BL/BC/BR] <Left>:');
    await command('mc');
    expect(it().just).toBe('MC');
    expect(it().pts[0][0]).toBeCloseTo(X + 525, 6); expect(it().pts[0][1]).toBeCloseTo(125, 6);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('TJUST  1 text justified middle centre · ⌘Z to undo');
    // Its box is where it was: a click at the old spot still picks it, and Properties shows the justification.
    act(() => state.setSelected(null));
    await clickAt(X + 300, 100);
    expect(state.selected).toBe('sk:T1');
    await until(() => !!document.querySelector('[aria-label="Justify"]'));
    expect((document.querySelector('[aria-label="Justify"]') as HTMLSelectElement).value).toBe('MC');
    await command('th');
    expect(state.history[state.history.length - 1]).toContain('<2.5>:');
    await command('5');
    expect(it().h).toBe(500);
    expect(it().pts[0][0]).toBeCloseTo(X + 525, 6);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('TXTHEIGHT  1 object 5 mm on paper at 1:100 · ⌘Z to undo');
    // With nothing picked: the height for new text.
    act(() => state.setSelected(null));
    await command('th');
    await command('');
    expect(state.history[state.history.length - 1]).toContain('for new text');
    await command('3.5');
    expect(project.cadAnno?.textMm).toBe(3.5);
    expect(it().h).toBe(500);
  });

  it('text tools on the texts picked: TCASE, TPREFIX, TALIGN, TCEN, TCOPY; ROOMTAGALL tags the rooms not tagged yet', async () => {
    const X = 200000, F = 'sample-villa-gf.dxf';
    // T1 "db room" (1,050 wide) at the left end of its baseline (X, 0); T2 "L1" at (X + 400, 1000); T3 "SOCKETS" centred on (X, 3000).
    const start: Project = { ...villa, cadSketch: [{ file: F, items: [
      { id: 'T1', kind: 'text', layer: 'LV-ANNO', pts: [[X, 0]], text: 'db room', h: 250 },
      { id: 'T2', kind: 'text', layer: 'LV-ANNO', pts: [[X + 400, 1000]], text: 'L1', h: 250 },
      { id: 'T3', kind: 'text', layer: 'LV-ANNO', pts: [[X, 3000]], text: 'SOCKETS', h: 250, just: 'MC' }
    ] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const it = (id: string) => project.cadSketch![0].items.find((x) => x.id === id)!;
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
    await dragWindow([X - 100, -100], [X + 2000, 1300]); // T1 and T2
    await command('tc');
    expect(state.history[state.history.length - 1]).toContain('TCASE  Case [Upper/Lower/Title/Sentence] <Upper>:');
    await command('title');
    expect([it('T1').text, it('T2').text]).toEqual(['Db Room', 'L1']);
    expect(last()).toBe('TCASE  2 texts in title case · ⌘Z to undo');
    await command('tprefix');
    await command('EX. ');
    expect([it('T1').text, it('T2').text]).toEqual(['EX. Db Room', 'EX. L1']);
    await command('tsuffix');
    await command('/GF');
    expect(it('T2').text).toBe('EX. L1/GF');
    // Line up on the left edge of T3's box (X − 525).
    await command('ta');
    expect(state.history[state.history.length - 1]).toContain('TALIGN  Align [Left/Right/Centre/Top/Bottom/Spacing] <Left>:');
    await command('l');
    await clickAt(X, 3000);
    expect(it('T1').pts[0][0]).toBeCloseTo(X - 525, 6); expect(it('T1').pts[0][1]).toBe(0);
    expect(it('T2').pts[0][0]).toBeCloseTo(X - 525, 6); expect(it('T2').pts[0][1]).toBe(1000);
    expect(it('T3').pts[0]).toEqual([X, 3000]);
    expect(last()).toBe('TALIGN  2 texts lined up left on "SOCKETS" · ⌘Z to undo');
    // Space the two picked 5 mm apart on paper (500 units at 1:100): T2 (centre y 1125) stays on top, T1's centre goes to 625.
    await command('ta');
    await command('s');
    expect(state.history[state.history.length - 1]).toContain('Gap between texts on paper (mm) <3.75>:');
    await command('5');
    expect(it('T2').pts[0][1]).toBe(1000);
    expect(it('T1').pts[0][1]).toBeCloseTo(500, 6);
    expect(last()).toBe('TALIGN  2 texts spaced 5 mm apart on paper · ⌘Z to undo');
    // TCEN: one text between two typed points.
    act(() => { state.setSelected(null); });
    await clickAt(X - 525 + 150, 1100); // inside T2's box
    expect(state.selected).toBe('sk:T2');
    await command('tcen');
    expect(state.history[state.history.length - 1]).toContain('TCEN  Specify first point:');
    await command(`${X},5000`);
    await command(`${X + 2000},5000`);
    const w2 = 0.6 * 250 * it('T2').text!.length;
    expect(it('T2').pts[0][0]).toBeCloseTo(X + 1000 - w2 / 2, 6); expect(it('T2').pts[0][1]).toBeCloseTo(5000 - 125, 6);
    // TCOPY: T2 takes T3's words.
    await command('tcopy');
    await clickAt(X, 3000);
    expect(it('T2').text).toBe('SOCKETS');
    expect(last()).toBe('TCOPY  1 text given the words "SOCKETS" · ⌘Z to undo');
    // ROOMTAGALL: the plan's rooms found, every one tagged once; again: nothing to do; A tags them all again.
    act(() => state.actions.current.addFound());
    const rooms = buildingInfoOf(project).rooms.length;
    expect(rooms).toBe(6);
    const texts = () => project.cadSketch![0].items.filter((x) => x.kind === 'text').length;
    await command('rtall');
    expect(state.history[state.history.length - 1]).toContain('ROOMTAGALL  Tag [All rooms/Untagged only] <Untagged>:');
    await command('');
    expect(texts()).toBe(3 + 2 * rooms);
    expect(last()).toBe('ROOMTAGALL  6 room tags · ⌘Z to undo');
    await command('rtall');
    await command('');
    expect(state.history.slice(-2)).toContain('ROOMTAGALL  Every room of the level is tagged.');
    await command('rtall');
    await command('a');
    expect(texts()).toBe(3 + 4 * rooms);
  });

  it('TFRAME and TMASK on the texts picked; TCOUNT places numbered texts, takes one back and renumbers; KEYNOTE bubbles with a legend', async () => {
    const X = 200000, F = 'sample-villa-gf.dxf';
    const start: Project = { ...villa, cadSketch: [{ file: F, items: [{ id: 'T1', kind: 'text', layer: 'LV-ANNO', pts: [[X, 0]], text: 'L1', h: 250 }] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const items = () => project.cadSketch![0].items;
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
    const lastSaid = () => state.history[state.history.length - 1];
    await clickAt(X + 100, 100);
    expect(state.selected).toBe('sk:T1');
    await command('tframe');
    expect(lastSaid()).toContain('TFRAME  Frame [Circle/Box/Hexagon/None] <Circle>:');
    await command('h');
    expect(items()[0].frame).toBe('hexagon');
    expect(last()).toBe('TFRAME  1 text framed with a hexagon · ⌘Z to undo');
    await command('tmask');
    await command('');
    expect(items()[0].mask).toBe(true);
    await until(() => !!document.querySelector('[aria-label="Frame"]'));
    expect((document.querySelector('[aria-label="Frame"]') as HTMLSelectElement).value).toBe('hexagon');
    expect((document.querySelector('[aria-label="Mask"]') as HTMLSelectElement).value).toBe('Yes');
    await command('tframe');
    await command('none');
    expect(items()[0].frame).toBeUndefined();
    // TCOUNT: "L" + 01, 02 … placed centred at each click; U takes the last back; S renumbers the texts picked.
    act(() => state.setSelected(null));
    await command('tcount');
    expect(lastSaid()).toContain('TCOUNT  Prefix <>:');
    await command('L');
    await command('01');
    await command('');
    await command('');
    expect(lastSaid()).toContain('next "L01"');
    await command(`${X},5000`);
    await clickAt(X + 3000, 5000);
    await clickAt(X + 6000, 5000);
    expect(items().slice(1).map((it) => it.text)).toEqual(['L01', 'L02', 'L03']);
    expect(items()[1]).toMatchObject({ just: 'MC', layer: 'LV-ANNO', h: 250 });
    expect(items()[1].pts[0][0]).toBeCloseTo(X, 6);
    await command('u');
    expect(items().slice(1).map((it) => it.text)).toEqual(['L01', 'L02']);
    await clickAt(X + 6000, 5000);
    expect(items()[3].text).toBe('L03');
    await command(''); // Enter ends
    expect(state.tool).toBe('none');
    // Renumber the three from 7, step 2, as "S07" … picked in order with a window first.
    await dragWindow([X - 500, 4000], [X + 7000, 6000]);
    await command('tnum');
    await command('S');
    await command('7');
    await command('2');
    await command('');
    await command('s');
    expect(items().slice(1).map((it) => it.text).sort()).toEqual(['S11', 'S7', 'S9']);
    expect(last()).toBe('TCOUNT  3 texts renumbered from S7 · ⌘Z to undo');
    // KEYNOTE: the first asks where the legend starts; the next goes under it.
    act(() => { state.setSelected(null); });
    await command('kn');
    expect(lastSaid()).toContain('KEYNOTE  Number (Enter: the next):');
    await command('');
    expect(lastSaid()).toContain('KEYNOTE  Place keynote 1:');
    await clickAt(X, 8000);
    expect(lastSaid()).toContain('KEYNOTE  Note text:');
    await command('Fire rated wall');
    expect(lastSaid()).toContain('Legend position');
    await clickAt(X + 10000, 9000);
    const kns = () => items().filter((it) => it.kn);
    expect(kns().map((it) => it.text)).toEqual(['1', 'KEYNOTES', '1  Fire rated wall']);
    expect(kns()[0]).toMatchObject({ frame: 'hexagon', just: 'MC' });
    expect(kns()[1].pts[0]).toEqual([X + 10000, 9000 - 250]);
    expect(lastSaid()).toContain('KEYNOTE  Number <2>:');
    await command('');
    await clickAt(X + 2000, 8000);
    await command('Existing DB');
    expect(kns().map((it) => it.text)).toEqual(['1', 'KEYNOTES', '1  Fire rated wall', '2', '2  Existing DB']);
    expect(kns()[4].pts[0][1]).toBeCloseTo(9000 - 250 - 2 * 400, 6);
    expect(last()).toBe('KEYNOTE  2 "Existing DB" · ⌘Z to undo');
  });

  it('moves, copies, rotates and erases what was drawn, and copies a light onto its circuit', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('l');
    await clickAt(1000, 1000);
    await clickAt(4000, 1000);
    await command('');
    await command('m');
    await clickAt(2500, 1000); // select the line
    await clickAt(1000, 1000); // base point
    await command('@0,500');
    const line = () => project.cadSketch![0].items[0];
    expect(line().pts[0][1] - 1000).toBeCloseTo(500, 0);
    await command('co');
    await clickAt(2500, line().pts[0][1]);
    await clickAt(0, 0);
    await command('@0,1000');
    await command('');
    expect(project.cadSketch![0].items).toHaveLength(2);
    await command('ro');
    await clickAt(2500, line().pts[0][1]);
    await clickAt(line().pts[0][0], line().pts[0][1]);
    await command('90');
    expect(Math.abs(line().pts[1][0] - line().pts[0][0])).toBeLessThan(1);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    await clickAt(line().pts[0][0], (line().pts[0][1] + line().pts[1][1]) / 2);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); });
    expect(project.cadSketch![0].items).toHaveLength(1);
    // A light copied is one more point on its circuit.
    act(() => { state.setFeederId('DB-GF1-Y1'); state.setDevice('ltg'); state.setTool('dev'); });
    await clickAt(3000, 9000);
    const n = project.feeders.find((f) => f.id === 'DB-GF1-Y1')!.points?.ltg ?? 0;
    await command('co');
    await clickAt(3000, 9000);
    await clickAt(3000, 9000);
    await command('@1000,0');
    expect(project.lvPoints).toHaveLength(2);
    expect(project.feeders.find((f) => f.id === 'DB-GF1-Y1')!.points?.ltg).toBe(n + 1);
  });

  it('saves what was drawn into the DXF', async () => {
    const saveBinary = vi.fn(async () => '/plans/out.dxf');
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary };
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('rec');
    await clickAt(6000, 6000);
    await clickAt(9000, 8000);
    await saveCmd('save');
    await flush();
    const text = new TextDecoder().decode((saveBinary.mock.calls[0] as unknown as [{ bytes: Uint8Array }])[0].bytes);
    expect(text).toContain('LV-SKETCH');
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/1 drawn object on LV-SKETCH \/ LV-ANNO/);
  });

  it('opens a DWG from the desktop dialog with OPEN', async () => {
    act(() => root.render(<Host />));
    await flush();
    await command('open');
    await flush();
    expect(state.view?.file).toBe('plan.dwg');
    expect(localStorage.getItem('lvds.cad.p1')).toBe('/plans/plan.dwg');
  });

  it('lists the plan of each level; opening one for a level makes the drawing that level\'s plan', async () => {
    const twoLevels: Project = { ...villa, building: { ...villa.building!, buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }, { id: 'FF', name: 'First', kind: 'typical', heightM: 4 }] }] } };
    act(() => root.render(<Host start={twoLevels} />));
    await flush();
    const plans = () => [...document.querySelectorAll('[aria-label="Plans of this project"] button')];
    expect(plans().map((b) => b.textContent)).toEqual(['Groundno planopen…', 'Firstno planopen…']);
    await act(async () => { (plans()[1] as HTMLButtonElement).click(); });
    await flush();
    expect(state.view?.file).toBe('plan.dwg');
    expect(project.cadPlans).toEqual([{ building: 'V', level: 'FF', file: 'plan.dwg', units: 4 }]);
    expect(plans()[1].textContent).toBe('Firstplan.dwgopen');
  });

  it('Show on plan (from the SLD) shows the level\'s drawing, picks the board and zooms to a window round it', async () => {
    const placedBoard: Project = { ...villa, cadPlans: [{ building: 'V', level: 'GF', file: 'sample-villa-gf.dxf', units: 4 }], boards: villa.boards.map((b, i) => (i ? b : { ...b, level: { building: 'V', level: 'GF' }, planPoint: { x: 3, y: 9 } })) };
    const id = placedBoard.boards[0].id;
    act(() => root.render(<Host start={placedBoard} />));
    await flush();
    const t = planTarget(placedBoard, { board: id });
    expect(typeof t).not.toBe('string');
    act(() => state.actions.current.showOnPlan(t as PlanTarget));
    await until(() => state.view?.file === 'sample-villa-gf.dxf' && state.selected === `board:${id}`);
    await until(() => document.querySelector('.zoom-chip')?.textContent !== '100 %'); // the 8 m window, not the drawing fitted
    expect(document.querySelector('.zoom-chip')?.textContent).toMatch(/^\d+ %$/);
    // The drawing already shown: asking again picks and zooms again without loading it.
    act(() => state.setSelected(null));
    act(() => state.actions.current.showOnPlan(t as PlanTarget));
    await until(() => state.selected === `board:${id}`);
  });

  it('File group: sets the level and the units of the drawing, and shows the layer roles', async () => {
    act(() => root.render(<Host />));
    await flush();
    const apply = (next: Project, message: string) => onChange(next, message);
    let menu = cadFileMenu(project, state, apply, () => {});
    expect([menu.level, menu.unit, menu.plansSub]).toEqual(['Level?', 'mm', '0 of 1 levels']);
    act(() => menu.levels![0].onClick());
    expect(project.cadPlans).toEqual([{ building: 'V', level: 'GF', file: 'sample-villa-gf.dxf', units: 4 }]);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('sample-villa-gf.dxf is the plan of Ground · ⌘Z to undo');
    menu = cadFileMenu(project, state, apply, () => {});
    expect(menu.level).toBe('Ground');
    act(() => menu.units!.find((u) => u.label.startsWith('Metres'))!.onClick());
    expect(project.cadPlanUnits).toEqual({ 'sample-villa-gf.dxf': 'm' });
    act(() => state.setShowRoles(true));
    expect(document.body.textContent).toContain('Layer roles');
    const wallRole = [...document.querySelectorAll('select')].find((x) => x.closest('tr')?.textContent?.includes('A-WALL')) as HTMLSelectElement | undefined;
    expect(wallRole?.value).toBe('wall');
  });

  it('adds the rooms the plan outlines, named by the text inside; adding again updates them', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.actions.current.addFound());
    const names = () => buildingInfoOf(project).rooms.map((r) => r.name.toLowerCase()).sort();
    expect(names()).toEqual(['dining', 'electrical room', 'kitchen', 'living', 'maid room', 'majlis']);
    expect(onChange.mock.calls[0][1]).toMatch(/^6 rooms from the plan on Ground — level not set: File → Level · ⌘Z to undo$/);
    const majlis = buildingInfoOf(project).rooms.find((r) => /majlis/i.test(r.name))!;
    expect(majlis.outline!.length).toBeGreaterThanOrEqual(4);
    expect(majlis.areaM2).toBeGreaterThan(10);
    await command('ROOMS');
    expect(names()).toHaveLength(6);
  });

  it('traces a room and names it by picking its name on the drawing; a name outside any room says so', async () => {
    act(() => root.render(<Host />));
    await flush();
    const text = (s: string) => state.view!.info.texts.find((t) => t.s.trim() === s)!;
    const onText = async (s: string) => { const t = text(s); await clickAt(t.x + t.h * 0.1, t.y + t.h * 0.3); };
    const k = text('KITCHEN');
    await command('TR');
    for (const [dx, dy] of [[-1500, -1500], [1500, -1500], [1500, 1500], [-1500, 1500]]) await clickAt(k.x + dx, k.y + dy);
    await command('');
    expect(result()).toMatch(/Room area 9\.00 m²/);
    await command('PN');
    await onText('KITCHEN');
    expect((document.querySelector('.cad-roomform input') as HTMLInputElement).value).toBe('KITCHEN');
    act(() => button('Add').click());
    expect(buildingInfoOf(project).rooms.map((r) => r.name)).toEqual(['KITCHEN']);
    act(() => state.setTool('name'));
    await onText('HALL');
    expect(state.history[state.history.length - 1]).toMatch(/“HALL” is not inside a room yet/);
  });

  it('draws a power tray run without a route, then changes its width and service and saves it into the DXF', async () => {
    const saveBinary = vi.fn(async () => '/plans/out.dxf');
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary };
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('CT');
    expect(document.body.textContent).toContain('The route can be left for later.');
    for (const [x, y] of [[2000, 3000], [8000, 3000], [8000, 7000]]) await clickAt(x, y);
    await command('');
    const run = state.view && project.cadSketch![0].items[0];
    expect(run).toMatchObject({ kind: 'pline', layer: 'E-TRAY', tray: { widthMm: 300, service: 'Power' } });
    expect(run!.tray!.route).toBeUndefined();
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toMatch(/^Cable tray 300 mm power, 10\.\d\d m \(no route: assign one when you know it\)/);
    act(() => state.setTool('none'));
    await clickAt(5000, 3000);
    expect(result()).toMatch(/Cable tray.*Length10\.\d\d m.*CarriesPower.*Routenot assigned/);
    const width = document.querySelector('.cad-res select[aria-label="Tray width"]') as HTMLSelectElement;
    act(() => { width.value = '450'; width.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(project.cadSketch![0].items[0].tray).toEqual({ widthMm: 450, service: 'Power' });
    const service = document.querySelector('.cad-res select[aria-label="Tray service"]') as HTMLSelectElement;
    act(() => { service.value = 'ELV'; service.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(project.cadSketch![0].items[0].tray).toEqual({ widthMm: 450, service: 'ELV' });
    await saveCmd('save');
    await flush();
    const text = new TextDecoder().decode((saveBinary.mock.calls[0] as unknown as [{ bytes: Uint8Array }])[0].bytes);
    expect(text).toContain('E-TRAY');
    expect(text).toContain('CT 450 ELV');
  });

  it('finds the fittings of the trays drawn: a branch of another width is a tee', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('CT');
    for (const [x, y] of [[2000, 3000], [8000, 3000]]) await clickAt(x, y);
    await command('');
    act(() => state.setTray({ widthMm: 150, service: 'Power', route: '' }));
    for (const [x, y] of [[5000, 3000], [5000, 7000]]) await clickAt(x, y);
    await command('');
    expect(document.querySelector('[aria-label="Fittings on this plan"]')?.textContent).toBe('Fittings on this plan1 × Tee 300 × 150');
  });

  it('draws a cable route along a tray, links a cable line of the drawing, and updates the schedules', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    const f = villa.feeders[0];
    await command('CT');
    act(() => state.setTray({ widthMm: 300, service: 'Power', route: 'A' }));
    for (const [x, y] of [[2000, 3000], [12000, 3000]]) await clickAt(x, y);
    await command('');
    await command('CR');
    act(() => state.setCableFeeder(f.id));
    for (const [x, y] of [[2000, 3000], [12000, 3000], [12000, 5000]]) await clickAt(x, y);
    await command('');
    expect(project.cadSketch![0].items[1]).toMatchObject({ layer: 'E-CABLE', cable: { feederId: f.id } });
    await command('SCHED');
    const msg = onChange.mock.calls[onChange.mock.calls.length - 1][1];
    expect(msg).toMatch(/^Schedules updated: route A 10\.\d m · 1 cable length · 1 feeder on trays · ⌘Z to undo$/);
    expect(trayPlanOf(project).routes.find((r) => r.name === 'A')!.lengthM).toBeCloseTo(10, 0);
    const fd = project.feeders.find((x) => x.id === f.id)!;
    expect(fd.trayRoute).toBe('A');
    expect(fd.lengthM).toBeGreaterThanOrEqual(Math.ceil((12 + 6 + 3) * 1.05) - 1);
    await command('SCHED');
    expect(state.history[state.history.length - 1]).toMatch(/^SCHED {2}Up to date/);

    // Link: a line on the drawing's cable layer becomes a cable's route.
    const v = state.view!, layer = v.info.layers.findIndex((l) => l.name === 'E-CABLE');
    const i = v.segLayers.findIndex((l) => l === layer);
    const [x1, y1, x2, y2] = [v.segs[i * 4], v.segs[i * 4 + 1], v.segs[i * 4 + 2], v.segs[i * 4 + 3]];
    await command('LR');
    await clickAt((x1 + x2) / 2 + v.info.origin[0], (y1 + y2) / 2 + v.info.origin[1]);
    expect(project.cadSketch![0].items).toHaveLength(3);
    expect(project.cadSketch![0].items[2]).toMatchObject({ layer: 'E-CABLE', cable: { feederId: f.id } });
  });

  it('fills a room with an ELV device at its spacing, shows coverage, and copies the devices to another level', async () => {
    const twoLevels: Project = { ...villa, building: { ...villa.building!, buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }, { id: 'FF', name: 'First', kind: 'typical', heightM: 4 }] }] } };
    act(() => root.render(<Host start={twoLevels} />));
    await flush();
    act(() => state.actions.current.addFound()); // rooms with outlines to fill
    const majlis = buildingInfoOf(project).rooms.find((r) => /majlis/i.test(r.name))!;
    const [cx, cy] = majlis.outline!.reduce(([x, y], q) => [x + q[0] / majlis.outline!.length, y + q[1] / majlis.outline!.length], [0, 0]);
    act(() => { state.setDevice('smoke-detector'); state.setTool('fill'); });
    await clickAt(cx / 0.001, cy / 0.001);
    const onGf = () => (project.elvDevices ?? []).filter((d) => d.levelId === 'GF');
    expect(onGf().length).toBeGreaterThan(0);
    expect(onGf().every((d) => d.type === 'smoke-detector' && d.roomId === majlis.id)).toBe(true);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toMatch(/smoke detectors? placed · ⌘Z to undo$/i);
    act(() => state.setCoverage(true));
    expect(document.body.textContent).toMatch(/not fully covered/);
    act(() => state.actions.current.copyTo('V/FF/0'));
    expect((project.elvDevices ?? []).filter((d) => d.levelId === 'FF')).toHaveLength(onGf().length);
  });

  it('lights a room by the lumen method (LUX): keeps the room, changes the luminaire, places the lights, replaces them', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.actions.current.addFound());
    const majlis = buildingInfoOf(project).rooms.find((r) => /majlis/i.test(r.name))!;
    const [cx, cy] = majlis.outline!.reduce(([x, y], q) => [x + q[0] / majlis.outline!.length, y + q[1] / majlis.outline!.length], [0, 0]);
    await command('LUX');
    expect(state.tool).toBe('lux');
    expect(document.body.textContent).toContain('Point at a room to see its lights');
    await clickAt(cx / 0.001, cy / 0.001);
    expect(document.body.textContent).toContain(`Light room ${majlis.name}`);
    const place = () => document.querySelector('.cad-devbtns .chip.primary') as HTMLButtonElement;
    expect(place().disabled).toBe(true); // no circuit yet
    const lum = document.querySelector('select[aria-label="Luminaire"]') as HTMLSelectElement;
    const before = place().textContent;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(lum, 'pnl36');
      lum.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(place().textContent).not.toBe(before); // brighter luminaire, fewer of them
    const n = Number(/Place (\d+)/.exec(place().textContent!)![1]);
    act(() => state.setFeederId('DB-GF1-Y1'));
    await act(async () => { place().click(); });
    const lights = () => (project.lvPoints ?? []).filter((d) => d.type === 'ltg');
    expect(lights()).toHaveLength(n);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toMatch(new RegExp(`^${n} lights? placed in ${majlis.name} on DB-GF1/Y1 — \\d+ lx · ⌘Z to undo$`));
    await clickAt(cx / 0.001, cy / 0.001); // again: replaces, does not double
    await act(async () => { place().click(); });
    expect(lights()).toHaveLength(n);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toContain(`(${n} taken off first)`);
  });

  it('lays out emergency lighting (EM): draws an escape route, an open area and a point of emphasis, then places them', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    act(() => state.actions.current.addFound());
    const majlis = buildingInfoOf(project).rooms.find((r) => /majlis/i.test(r.name))!;
    const [cx, cy] = majlis.outline!.reduce(([x, y], q) => [x + q[0] / majlis.outline!.length, y + q[1] / majlis.outline!.length], [0, 0]);
    await command('EM');
    expect(state.tool).toBe('em');
    expect(document.body.textContent).toContain('Emergency lighting');
    await clickAt(cx / 0.001 - 3000, cy / 0.001);
    await clickAt(cx / 0.001 + 3000, cy / 0.001);
    await command(''); // Enter: the route is done
    expect(document.body.textContent).toMatch(/Escape routes1 · 6\.\d\d m/);
    await act(async () => { button('Open area').click(); });
    await clickAt(cx / 0.001, cy / 0.001);
    expect(document.body.textContent).toContain(`(${majlis.name})`);
    await act(async () => { button('Point of emphasis').click(); });
    await clickAt(cx / 0.001, cy / 0.001 + 1000); // a call point 1 m off the route
    const place = () => document.querySelector('.cad-devbtns .chip.primary') as HTMLButtonElement;
    expect(place().disabled).toBe(true); // no circuit yet
    act(() => state.setFeederId('DB-GF1-Y1'));
    const [, nf, ns] = /Place (\d+) fittings? and (\d+) signs?/.exec(place().textContent!)!.map(Number);
    await act(async () => { place().click(); });
    const em = (project.lvPoints ?? []).filter((d) => d.emergency);
    expect(em.filter((d) => d.emergency === 'fitting')).toHaveLength(nf);
    expect(em.filter((d) => d.emergency !== 'fitting')).toHaveLength(ns);
    expect(em.every((d) => d.type === 'ltg' && d.feederId === 'DB-GF1-Y1')).toBe(true);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe(`${nf} emergency lights and ${ns} sign${ns === 1 ? '' : 's'} placed on DB-GF1/Y1 · ⌘Z to undo`);
    expect(place().disabled).toBe(true); // all placed: nothing marked any more
  });

  it('picks devices with a window and Shift-click; the toolbar beside them aligns them, moves them to a circuit and deletes them', async () => {
    const gf = { building: 'V', level: 'GF' };
    let start = villa;
    for (const [x, y] of [[3, 9], [6, 9.4], [9, 8.8]]) start = placeLvPoint(start, gf, 'ltg', 'DB-GF1-B2', x, y).project;
    start = placeLvPoint(start, gf, 's13', 'DB-GF1-B2', 6, 4).project;
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const bar = () => document.querySelector('[aria-label="Edit devices"]') as HTMLElement | null;
    const barButton = (t: string) => [...bar()!.querySelectorAll('button')].find((b) => b.textContent === t)!;
    await dragWindow([2000, 10000], [10000, 8000]); // left to right: the three lights, not the socket
    expect(bar()?.getAttribute('role')).toBe('toolbar');
    expect(bar()!.textContent).toMatch(/^3 selectedAlign rowAlign columnSpace equallyReplace ▾Circuit ▾MatchMoveCopyDelete$/);
    expect(result()).toMatch(/3 devices selected · Ground/);
    expect(result()).toMatch(/Devices3 × LightCircuits3 × DB-GF1\/B2/);
    await act(async () => { barButton('Align row').click(); });
    expect(new Set(project.lvPoints!.filter((d) => d.type === 'ltg').map((d) => d.y.toFixed(2)))).toEqual(new Set(['9.07']));
    await act(async () => { barButton('Circuit ▾').click(); });
    const y2 = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent!.startsWith('DB-GF1/Y2'))!;
    expect(y2.textContent).toMatch(/9 → 12 pts ⚠$/); // 8 lights and an exhaust fan, over the 10 lights allowed with 3 more
    const b2 = villa.feeders.find((f) => f.id === 'DB-GF1-B2')!.points!.ltg!;
    await act(async () => { (y2 as HTMLButtonElement).click(); });
    expect(project.lvPoints!.filter((d) => d.type === 'ltg').every((d) => d.feederId === 'DB-GF1-Y2')).toBe(true);
    expect(project.feeders.find((f) => f.id === 'DB-GF1-B2')!.points!.ltg).toBe(b2 + 3 - 3);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('CIRCUIT  3 devices on DB-GF1/Y2 (12 points; 11 of this type, over the 10 allowed) · ⌘Z to undo');
    await clickAt(9000, 9070, true); // Shift-click takes one off
    expect(bar()!.textContent).toMatch(/^2 selected/);
    await clickAt(6000, 4000, true); // and adds the socket: a mixed set gets Filter
    expect(bar()!.textContent).toMatch(/^3 selectedFilter ▾Align row/);
    await act(async () => { barButton('Filter ▾').click(); });
    await act(async () => { ([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent!.startsWith('Light only')) as HTMLButtonElement).click(); });
    expect(bar()!.textContent).toMatch(/^2 selected/);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })); });
    expect(project.lvPoints!.map((d) => d.type)).toEqual(['ltg', 's13']);
    expect(bar()).toBeNull();
    await dragWindow([10000, 3000], [2000, 10000]); // right to left: crossing
    expect(bar()!.textContent).toMatch(/^2 selected/);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(bar()).toBeNull();
  });

  it('right-click: the menu of a device; Replace, then Array on line and Match from the tools', async () => {
    const gf = { building: 'V', level: 'GF' };
    const start = placeLvPoint(placeLvPoint(villa, gf, 's13', 'DB-GF1-B6', 6, 4).project, gf, 'ltg', 'DB-GF1-Y1', 3, 9).project;
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const [sx, sy] = screenOf(6000, 4000);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); });
    const menu = document.querySelector('[role="menu"][aria-label="Command menu"]') as HTMLElement;
    const top = [...menu.children].filter((x) => x.tagName === 'BUTTON').map((x) => x.querySelector('span')!.textContent);
    expect(top).toEqual(['Circuit', 'Swap device type', 'Select same circuit', 'Select same type', 'Match to this', 'Move', 'Copy', 'Erase', 'Isolate', 'Count', 'Deselect all', 'Properties']);
    await act(async () => { [...menu.querySelectorAll('button')].find((b) => b.textContent!.startsWith('Swap device type'))!.click(); });
    await act(async () => { ([...document.querySelectorAll('[role="menuitem"]')].find((o) => o.textContent!.startsWith('Twin socket')) as HTMLButtonElement).click(); });
    expect(project.lvPoints!.find((d) => d.x === 6)!.type).toBe('s13t');
    expect(project.feeders.find((f) => f.id === 'DB-GF1-B6')!.points).toMatchObject({ s13: 6, s13t: 1 });
    await command('ARL');
    expect(state.tool).toBe('arl');
    await clickAt(0, 12000);
    await clickAt(10000, 12000);
    act(() => state.setFeederId('DB-GF1-Y1'));
    expect(document.body.textContent).toMatch(/Array on line line 10\.00 m/);
    expect(document.body.textContent).toMatch(/Devices5 × LightSpacing2\.00 m/);
    await command(''); // Enter places them
    expect(project.lvPoints!.filter((d) => d.y === 12).map((d) => d.x.toFixed(2))).toEqual(['1.00', '3.00', '5.00', '7.00', '9.00']);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('ARL  5 × Light placed on DB-GF1/Y1 · ⌘Z to undo');
    await command('MA');
    await clickAt(3000, 9000); // from the light on Y1
    expect(document.body.textContent).toMatch(/Match from Light · DB-GF1\/Y1/);
    await clickAt(6000, 4000); // the twin socket takes its circuit
    expect(project.lvPoints!.find((d) => d.x === 6)).toMatchObject({ type: 's13t', feederId: 'DB-GF1-Y1' });
  });

  it('edits what was drawn: Trim at a drawn line, Extend to one, Offset by a typed distance, Fillet into a sharp corner', async () => {
    const line = (id: string, a: [number, number], b: [number, number]) => ({ id, kind: 'line' as const, layer: 'LV-SKETCH', pts: [a, b] });
    // Well clear of the plan, so only the drawn lines are edges.
    const X = 200000, Y = 0;
    const start: Project = { ...villa, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [
      line('S1', [X, Y], [X + 10000, Y]), line('S2', [X + 6000, Y - 2000], [X + 6000, Y + 2000]),
      line('S3', [X, Y + 5000], [X + 3000, Y + 5000]), line('S4', [X + 8000, Y + 3000], [X + 8000, Y + 7000])
    ] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const item = (id: string) => project.cadSketch![0].items.find((x) => x.id === id)!;
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
    await command('TRIM');
    expect(state.tool).toBe('trim');
    await clickAt(X + 8000, Y);
    expect(item('S1').pts).toEqual([[X, Y], [X + 6000, Y]]);
    expect(last()).toBe('TRIM  4.00 m cut off · ⌘Z to undo');
    await command('EX');
    await clickAt(X + 2900, Y + 5000);
    expect(item('S3').pts).toEqual([[X, Y + 5000], [X + 8000, Y + 5000]]);
    expect(last()).toBe('EXTEND  5.00 m longer · ⌘Z to undo');
    await command('O');
    await command('0.5');
    await clickAt(X + 3000, Y);
    await clickAt(X + 3000, Y + 1000);
    const copy = project.cadSketch![0].items.find((x) => x.pts[0][1] === Y + 500)!;
    expect(copy.pts).toEqual([[X, Y + 500], [X + 6000, Y + 500]]);
    expect(last()).toBe('OFFSET  Line copied 0.50 m to the side · ⌘Z to undo');
    await command('F');
    await clickAt(X + 4000, Y + 5000);
    await clickAt(X + 8000, Y + 6500);
    expect(item('S4').pts).toEqual([[X + 8000, Y + 5000], [X + 8000, Y + 7000]]);
    expect(last()).toBe('FILLET  sharp corner · ⌘Z to undo');
  });

  it('picks drawn objects with a window: their toolbar joins them; a grip drag moves an end; mirror keeps the originals', async () => {
    const line = (id: string, a: [number, number], b: [number, number]) => ({ id, kind: 'line' as const, layer: 'LV-SKETCH', pts: [a, b] });
    const X = 200000;
    const start: Project = { ...villa, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [line('S1', [X, 0], [X + 4000, 0]), line('S2', [X + 4000, 0], [X + 4000, 3000])] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const bar = () => document.querySelector('[aria-label="Edit drawn objects"]') as HTMLElement | null;
    await dragWindow([X - 500, -500], [X + 4500, 3500]);
    expect(bar()!.textContent).toBe('2 selectedJoinMirrorScaleArrayMoveCopyErase');
    expect(result()).toMatch(/^2 objects selectedJoin/);
    // The properties palette counts them by kind.
    expect([...document.querySelectorAll('[aria-label="Objects shown"] option')].map((o) => o.textContent)).toEqual(['All (2)', 'Line (2)']);
    await act(async () => { [...bar()!.querySelectorAll('button')].find((b) => b.textContent === 'Join')!.click(); });
    expect(project.cadSketch![0].items).toEqual([{ id: 'S1', kind: 'pline', layer: 'LV-SKETCH', pts: [[X, 0], [X + 4000, 0], [X + 4000, 3000]] }]);
    await clickAt(X + 2000, 0); // select it: its grips show
    expect(bar()!.textContent).toMatch(/^Polyline · 7\.00 m/);
    const [gx, gy] = screenOf(X + 4000, 3000), [tx, ty] = screenOf(X + 4000, 5000);
    const c = document.querySelector('canvas.cad-over')!;
    await act(async () => {
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: gx, clientY: gy, button: 0, bubbles: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: tx, clientY: ty, bubbles: true }));
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: tx, clientY: ty, button: 0, bubbles: true }));
    });
    expect(project.cadSketch![0].items[0].pts[2].map((v) => Math.round(v))).toEqual([X + 4000, 5000]);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('GRIP  Polyline changed — now 9.00 m · ⌘Z to undo');
    await act(async () => { [...bar()!.querySelectorAll('button')].find((b) => b.textContent === 'Mirror')!.click(); });
    expect(state.tool).toBe('mirror');
    await clickAt(X, -1000);
    await clickAt(X + 1000, -1000); // about y = −1 m
    expect(document.querySelector('.cad-hist')!.textContent).toBe('MIRROR  Erase source objects? [Yes/No] <No>:');
    await command(''); // Enter: No, the originals stay
    const items = project.cadSketch![0].items;
    expect(items).toHaveLength(2);
    expect(items[1].pts.map((q) => q.map((v) => Math.round(v)))).toEqual([[X, -2000], [X + 4000, -2000], [X + 4000, -7000]]);
  });

  it('layer manager: a drawn layer locked cannot be picked; properties of an object and Match properties', async () => {
    const line = (id: string, layer: string, a: [number, number], b: [number, number]) => ({ id, kind: 'line' as const, layer, pts: [a, b] });
    const X = 200000;
    const start: Project = { ...villa, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [line('S1', 'LV-SKETCH', [X, 0], [X + 4000, 0]), line('S2', 'LV-ANNO', [X, 2000], [X + 4000, 2000])] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const pick = (label: string, value: string) => {
      const el = document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
      act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); });
    };
    await command('LM');
    // The layer palette docks beside the drawing: one table, drawn layers first.
    await until(() => !!document.querySelector('[aria-label="Layer palette"]'));
    expect(document.querySelector('[aria-label="Layers"]')!.textContent).toMatch(/^NameOnFrLkColourLinetypeWeightPr#Drawn in the appLV-SKETCH/);
    expect(document.querySelector('[aria-label="Layer palette"] [role="status"]')!.textContent).toMatch(/^Current layer: LV-SKETCH · \d+ layers$/);
    act(() => { (document.querySelector('[aria-label="LV-ANNO locked"]') as HTMLButtonElement).click(); });
    act(() => { (document.querySelector('[aria-label="LV-SKETCH linetype"]') as HTMLButtonElement).click(); });
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[aria-label="LV-SKETCH linetype list"] [role="option"]')].find((b) => b.textContent === 'Dashed')!.click(); });
    expect(project.cadLayerStyle).toEqual({ 'sample-villa-gf.dxf': { 'LV-ANNO': { lock: true }, 'LV-SKETCH': { lt: 'dashed' } } });
    // Index colour by number: open the colour cell, type 8, Enter.
    act(() => { (document.querySelector('[aria-label="LV-SKETCH colour"]') as HTMLButtonElement).click(); });
    const num = document.querySelector('[aria-label="LV-SKETCH colour number or RGB"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(num, '8'); num.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { num.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(project.cadLayerStyle!['sample-villa-gf.dxf']['LV-SKETCH']).toEqual({ lt: 'dashed', color: 'idx:8' });
    expect(document.querySelector('[aria-label="LV-SKETCH colour"]')!.textContent).toBe('Grey (8)');
    // And from the grid: colour 130.
    act(() => { (document.querySelector('[aria-label="LV-SKETCH colour"]') as HTMLButtonElement).click(); });
    act(() => { (document.querySelector('[aria-label="LV-SKETCH colour picker"] [aria-label="Colour 130"]') as HTMLButtonElement).click(); });
    expect(project.cadLayerStyle!['sample-villa-gf.dxf']['LV-SKETCH'].color).toBe('idx:130');
    act(() => { (document.querySelector('[aria-label="Close the layer palette"]') as HTMLButtonElement).click(); });
    expect(document.querySelector('[aria-label="Layer palette"]')).toBeNull();
    await clickAt(X + 2000, 2000); // on the locked layer: not picked
    expect(state.selected).toBeNull();
    await clickAt(X + 2000, 0);
    expect(state.selected).toBe('sk:S1');
    act(() => { (document.querySelector('[aria-label="Object colour"]') as HTMLButtonElement).click(); });
    act(() => { (document.querySelector('[aria-label="Object colour picker"] [aria-label="Red"]') as HTMLButtonElement).click(); });
    pick('Object lineweight', '0.5');
    expect(project.cadSketch![0].items[0]).toMatchObject({ color: '#ff3b30', lw: 0.5 });
    await command('LM');
    act(() => { (document.querySelector('[aria-label="LV-ANNO locked"]') as HTMLButtonElement).click(); });
    await command('LM'); // LM again closes it
    expect(document.querySelector('[aria-label="Layer palette"]')).toBeNull();
    await command('MP');
    await clickAt(X + 2000, 0);
    await clickAt(X + 2000, 2000);
    expect(project.cadSketch![0].items[1]).toMatchObject({ layer: 'LV-SKETCH', color: '#ff3b30', lw: 0.5 });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('MATCHPROP  Properties copied to the line · ⌘Z to undo');
  });

  it('layer tools by picking (off, freeze, lock, unlock, make current; all on, thaw all), new objects\' properties, what the ribbon is told, and Fit', async () => {
    const X = 200000, F = 'sample-villa-gf.dxf';
    const start: Project = { ...villa, cadSketch: [{ file: F, items: [{ id: 'S1', kind: 'line', layer: 'E-LIGHT', pts: [[X, 0], [X + 4000, 0]] }] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
    const said = () => document.querySelector('.cad-hist')!.textContent;
    // The ribbon is told the drawn layers, the current one and the properties of new objects.
    expect(state.ribbonInfo).toMatchObject({ current: 'LV-SKETCH', picked: 0, props: {} });
    expect(state.ribbonInfo!.layers.map((l) => l.name)).toEqual(expect.arrayContaining(['LV-SKETCH', 'E-LIGHT']));
    expect(state.ribbonInfo!.layers.map((l) => l.name)).not.toContain('A-WALL'); // the architect's cannot be current
    await command('LAYOFF');
    expect(said()).toBe('LAYOFF  Pick an object on the layer first, then LAYOFF.');
    await clickAt(X + 2000, 0);
    expect(state.selected).toBe('sk:S1');
    await command('LAYLCK');
    expect(last()).toBe('LAYLCK  Layer E-LIGHT locked · ⌘Z to undo');
    expect(project.cadLayerStyle).toEqual({ [F]: { 'E-LIGHT': { lock: true } } });
    await command('LAYULK');
    expect(project.cadLayerStyle).toBeUndefined();
    await command('LAYMCUR');
    expect(project.cadLayerFile).toEqual({ [F]: { current: 'E-LIGHT' } });
    await command('LAYFRZ');
    expect(said()).toBe('LAYFRZ  Nothing to change (E-LIGHT is the current layer: not frozen).');
    await command('CLAYER LV-SKETCH');
    await command('LAYFRZ');
    expect(last()).toBe('LAYFRZ  Layer E-LIGHT frozen · ⌘Z to undo');
    expect(state.selected).toBeNull(); // out of sight: no longer picked
    await command('LAYTHW');
    expect(last()).toBe('LAYTHW  Layer E-LIGHT thawed · ⌘Z to undo');
    await clickAt(X + 2000, 0);
    await command('LAYOFF');
    expect(last()).toBe('LAYOFF  Layer E-LIGHT off · ⌘Z to undo');
    await command('LAYON');
    expect(last()).toMatch(/^LAYON {2}(Layer E-LIGHT|\d+ layers) on · ⌘Z to undo$/);
    expect(project.cadLayerStyle).toBeUndefined();
    // Nothing picked: the lineweight chosen is for new objects, and the next line takes it.
    act(() => state.actions.current.setProps({ lw: 0.5 }));
    expect(last()).toBe('Lineweight of new objects: 0.50 mm · ⌘Z to undo');
    expect(state.ribbonInfo!.props).toEqual({ lw: 0.5 });
    expect((document.querySelector('select[aria-label="Lineweight of new objects"]') as HTMLSelectElement).value).toBe('0.5'); // the palette shows it too
    await command('L');
    await clickAt(X, 1000);
    await clickAt(X + 3000, 1000);
    await command('');
    act(() => state.setTool('none'));
    const items = () => project.cadSketch![0].items;
    expect(items()[1]).toMatchObject({ kind: 'line', layer: 'LV-SKETCH', lw: 0.5 });
    // Objects picked: the same list changes them, and the ribbon shows theirs.
    await clickAt(X + 1500, 1000);
    expect(state.ribbonInfo).toMatchObject({ picked: 1, props: { lw: 0.5 } });
    act(() => state.actions.current.setProps({ color: '#ff3b30' }));
    expect(items()[1]).toMatchObject({ color: '#ff3b30', lw: 0.5 });
    expect(last()).toBe('Colour Red: 1 object · ⌘Z to undo');
    // Fit is on the status bar.
    const before = state.fitKey;
    act(() => tg('FIT').click());
    expect(state.fitKey).toBe(before + 1);
  });

  it('layer palette: new objects go on the current layer; freeze, isolate, rename and states from the palette and the command line', async () => {
    const X = 200000, F = 'sample-villa-gf.dxf';
    const start: Project = { ...villa, cadSketch: [{ file: F, items: [{ id: 'S1', kind: 'line', layer: 'E-LIGHT', pts: [[X, 0], [X + 4000, 0]] }] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const items = () => project.cadSketch![0].items;
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
    const wall = state.view!.info.layers.findIndex((l) => l.name === 'A-WALL');
    // CLAYER: lines, rectangles, circles … go on it; a tray or text keeps its own layer.
    await command('CLAYER e-light');
    expect(project.cadLayerFile).toEqual({ [F]: { current: 'E-LIGHT' } });
    await command('L');
    await clickAt(X, 1000);
    await clickAt(X + 3000, 1000);
    await command('');
    expect(items()[1]).toMatchObject({ kind: 'line', layer: 'E-LIGHT' });
    act(() => state.setTool('none'));
    await command('CLAYER A-WALL');
    expect(document.querySelector('.cad-hist')!.textContent).toBe('CLAYER  A-WALL is the architect\'s; new objects go on the app\'s drawn layers.');
    // The palette stays open beside the drawing, which is still in use.
    await command('LM');
    await until(() => !!document.querySelector('[aria-label="Layer palette"]'));
    expect(document.querySelector('[aria-label="Layer palette"] [role="status"]')!.textContent).toMatch(/^Current layer: E-LIGHT · \d+ layers$/);
    act(() => { (document.querySelector('[aria-label="E-LIGHT frozen"]') as HTMLButtonElement).click(); });
    expect(document.querySelector('[aria-label="Layer palette"] [role="status"]')!.textContent).toContain('E-LIGHT is the current layer; it cannot be frozen.');
    await command('CLAYER LV-SKETCH');
    expect(project.cadLayerFile).toBeUndefined();
    act(() => { (document.querySelector('[aria-label="E-LIGHT frozen"]') as HTMLButtonElement).click(); });
    expect(project.cadLayerStyle).toEqual({ [F]: { 'E-LIGHT': { freeze: true } } });
    await clickAt(X + 2000, 0); // frozen: not picked
    expect(state.selected).toBeNull();
    act(() => { (document.querySelector('[aria-label="E-LIGHT frozen"]') as HTMLButtonElement).click(); });
    await clickAt(X + 2000, 0);
    expect(state.selected).toBe('sk:S1');
    // LAYISO: every layer but the picked object's turns off; LAYUNISO puts them back.
    await command('LAYISO');
    expect(last()).toMatch(/^LAYISO {2}E-LIGHT kept on, \d+ other layers off \(LAYUNISO puts them back\) · ⌘Z to undo$/);
    expect(shown(wall)).toBe(0);
    expect(project.cadLayerStyle![F]['LV-SKETCH']).toEqual({ hidden: true });
    await command('LAYUNISO');
    expect(shown(wall)).toBe(1);
    expect(project.cadLayerStyle).toBeUndefined();
    expect(project.cadLayerFile).toBeUndefined();
    // Rename by double-click: the objects follow.
    const name = (n: string) => [...document.querySelectorAll<HTMLElement>('.cad-lp-name')].find((td) => td.textContent === n)!;
    act(() => { name('E-LIGHT').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
    const input = document.querySelector('[aria-label="Layer name"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'E-LIGHT-SW'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(items().map((it) => it.layer)).toEqual(['E-LIGHT-SW', 'E-LIGHT-SW']);
    expect(last()).toBe('Layer E-LIGHT renamed E-LIGHT-SW · ⌘Z to undo');
    // LAYER N adds an empty layer; a layer state saved and restored.
    await command('LAYER N');
    expect(project.cadLayerFile).toEqual({ [F]: { layers: ['Layer1'] } });
    act(() => { (document.querySelector('[aria-label="A-WALL on"]') as HTMLButtonElement).click(); });
    expect(shown(wall)).toBe(0);
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Layer states ▾')!.click(); });
    const sn = document.querySelector('[aria-label="New layer state name"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(sn, 'No walls'); sn.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { sn.form!.requestSubmit(); });
    expect(project.cadLayerFile![F].states).toEqual([{ name: 'No walls', layers: expect.objectContaining({ 'A-WALL': { on: false } }) }]);
    act(() => { (document.querySelector('[aria-label="A-WALL on"]') as HTMLButtonElement).click(); });
    expect(shown(wall)).toBe(1);
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Layer states ▾')!.click(); });
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('.cad-lp-state button')].find((b) => b.textContent === 'No walls')!.click(); });
    expect(shown(wall)).toBe(0);
  });

  it('properties palette: shown with a drawing open, defaults with nothing picked, geometry of a line edited in one undo step; Ctrl/Cmd+1 hides it', async () => {
    const X = 200000, F = 'sample-villa-gf.dxf';
    const start: Project = { ...villa, cadSketch: [{ file: F, items: [{ id: 'S1', kind: 'line', layer: 'LV-SKETCH', pts: [[X, 0], [X + 4000, 0]] }] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const pal = () => document.querySelector('[aria-label="Properties palette"]');
    await until(() => !!pal());
    expect(pal()!.textContent).toContain('Text height2.5 mm');
    await clickAt(X + 2000, 0);
    expect(state.selected).toBe('sk:S1');
    await until(() => !!document.querySelector('[aria-label="Objects shown"]'));
    const endX = () => document.querySelector('[aria-label="End X"]') as HTMLElement;
    expect(endX().textContent).toBe(((X + 4000) / 1000).toFixed(2));
    act(() => { (endX() as HTMLButtonElement).click(); });
    const input = endX() as HTMLInputElement;
    const calls = onChange.mock.calls.length;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String((X + 6000) / 1000)); input.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onChange.mock.calls.length).toBe(calls + 1);
    expect(project.cadSketch![0].items[0]).toEqual({ id: 'S1', kind: 'line', layer: 'LV-SKETCH', pts: [[X, 0], [X + 6000, 0]] });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe(`Line: end x ${((X + 6000) / 1000).toFixed(2)} · ⌘Z to undo`);
    // Ctrl/Cmd+1 hides and shows it.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true })); });
    expect(pal()).toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true })); });
    expect(pal()).not.toBeNull();
  });

  it('hatches a closed object, adds a leader with its text, a room tag and a north arrow', async () => {
    const X = 200000;
    const start: Project = { ...villa, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [{ id: 'S1', kind: 'pline', layer: 'LV-SKETCH', closed: true, pts: [[X, 0], [X + 4000, 0], [X + 4000, 3000], [X, 3000]] }] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const items = () => project.cadSketch![0].items;
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
    await command('H');
    expect(document.body.textContent).toContain('Hatch H');
    await clickAt(X + 1000, 1000);
    expect(items()[1]).toEqual({ id: 'S2', kind: 'pline', layer: 'LV-HATCH', closed: true, pts: items()[0].pts, hatch: { pattern: 'ansi31', scale: 3, angle: 0 }, assoc: ['S1'] });
    expect(last()).toBe('Hatch ANSI31, 12.00 m² · associative · ⌘Z to undo');
    await command('LE');
    await clickAt(X + 2000, 1500);
    await clickAt(X + 6000, 4000);
    await command('DB-GF1');
    expect(items().slice(2).map((x) => [x.kind, x.leader ?? false, x.text ?? ''])).toEqual([['line', true, ''], ['text', false, 'DB-GF1']]);
    expect(items()[3].h).toBeCloseTo(250, 6); // 2.5 mm at 1:100 on a mm drawing
    act(() => state.actions.current.addFound());
    const room = buildingInfoOf(project).rooms.find((r) => r.outline)!;
    const [cx, cy] = room.outline!.reduce(([x, y], q) => [x + q[0] / room.outline!.length, y + q[1] / room.outline!.length], [0, 0]);
    await command('RT');
    await clickAt(cx / 0.001, cy / 0.001);
    expect(last()).toBe(`Room tag ${room.name} · ⌘Z to undo`);
    expect(items().slice(-2).map((x) => x.text)).toEqual([room.name.toUpperCase(), `${room.areaM2.toFixed(2)} m²`]);
    await command('NORTH');
    await clickAt(X + 8000, 8000);
    expect(items().slice(-3).map((x) => x.kind)).toEqual(['circle', 'pline', 'text']);
    expect(state.tool).toBe('none');
  });

  it('turns a camera to face the point clicked (RO)', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    act(() => { state.setDevice('camera'); state.setTool('dev'); });
    await clickAt(5000, 5000);
    act(() => state.setTool('rotate'));
    await clickAt(5000, 5000); // select it
    await clickAt(5000, 9000); // face north
    expect(project.elvDevices![0]).toMatchObject({ type: 'camera', rotationDeg: 90 });
  });

  it('saves the drawing as DWG with what was drawn, and the DWG opens again with it', async () => {
    const saveBinary = vi.fn(async () => '/plans/out.dwg');
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary };
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('rec');
    await clickAt(6000, 6000);
    await clickAt(9000, 8000);
    await saveCmd('SAVEDWG');
    await flush();
    const call = (saveBinary.mock.calls[0] as unknown as [{ defaultName: string; bytes: Uint8Array }])[0];
    expect(call.defaultName).toBe('sample-villa-gf - with devices.dwg');
    expect(new TextDecoder().decode(call.bytes.slice(0, 4))).toBe('AC10');
    const back = await openDrawing('out.dwg', call.bytes);
    expect(back.info.format).toBe('DWG');
    expect(back.info.layers.some((l) => l.name === 'LV-SKETCH' && l.count === 4)).toBe(true); // the rectangle drawn
    expect(back.info.segments).toBe(state.view!.info.segments + 4);
  });
});

describe('file tabs', () => {
  const tabs = () => [...document.querySelectorAll('.cad-tabs [role="tab"]')].map((t) => t.textContent);
  const shown = () => document.querySelector('.cad-tabs [aria-selected="true"]')?.textContent;
  const tabOf = (name: string) => [...document.querySelectorAll('.cad-tab')].find((t) => t.textContent?.includes(name))!;
  const nameOf = (name: string) => tabOf(name).querySelector('[role="tab"]') as HTMLButtonElement;
  const closeOf = (name: string) => tabOf(name).querySelector('.cad-tab-x') as HTMLButtonElement;
  const add = () => document.querySelector('.cad-tab-add') as HTMLButtonElement;
  const rightClick = (name: string) => act(() => { nameOf(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 60 })); });
  const menu = () => document.querySelector('.cad-tab-menu');
  const hist = () => document.querySelector('.cad-hist')?.textContent;
  const GF = 'sample-villa-gf.dxf', FF = 'sample-villa-ff.dxf';
  const sampleReads = () => (window.lvds!.cadFile!.sampleBytes as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
  const twoPlans: Project = {
    ...villa,
    building: { ...villa.building!, buildings: [{ id: 'V', name: 'Villa', levels: [{ id: 'GF', name: 'Ground', kind: 'ground', heightM: 4 }, { id: 'FF', name: 'First', kind: 'typical', heightM: 4 }] }] },
    cadPlans: [{ building: 'V', level: 'GF', file: GF, units: 4 }, { building: 'V', level: 'FF', file: FF, units: 4 }]
  };
  const openAnother = async () => { await act(async () => { add().click(); }); await flush(); };

  it('has a tab for each drawing with its level; + opens another, and a click switches back', async () => {
    act(() => root.render(<Host />));
    await flush();
    expect(tabs()).toEqual([`Level? · ${GF}`]);
    await openAnother();
    expect(tabs()).toEqual([`Level? · ${GF}`, 'Level? · plan.dwg']);
    expect(shown()).toBe('Level? · plan.dwg');
    expect(document.body.textContent).toMatch(/plan\.dwg · DWG/);
    await act(async () => { nameOf(GF).click(); });
    await flush();
    expect(state.view?.file).toBe(GF);
    expect(shown()).toBe(`Level? · ${GF}`);
    expect(document.body.textContent).toMatch(/sample-villa-gf\.dxf · DXF/);
    expect(state.drawings).toHaveLength(2); // the other stays open
  });

  it('keeps the tab showing in view when the row is full', async () => {
    const seen: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) { seen.push(this.textContent ?? ''); });
    try {
      act(() => root.render(<Host />));
      await flush();
      await openAnother();
      expect(seen[seen.length - 1]).toContain('plan.dwg');
      await act(async () => { nameOf(GF).click(); });
      expect(seen[seen.length - 1]).toContain(GF);
    } finally { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; }
  });

  it('shows the level of a drawing that is the plan of one', async () => {
    act(() => root.render(<Host start={twoPlans} />));
    await flush();
    expect(tabs()).toEqual([`Ground · ${GF}`]);
  });

  it('× closes a drawing, showing the next; the last leaves the page that offers to open one, with Reopen', async () => {
    (window.lvds!.cadFile as { readBytes?: unknown }).readBytes = vi.fn(async (p: string) => ({ file: 'plan.dwg', path: p, bytes: bytes('tests/fixtures/cad/plan-2018.dwg') }));
    act(() => root.render(<Host />));
    await flush();
    await openAnother();
    act(() => closeOf('plan.dwg').click());
    expect(tabs()).toEqual([`Level? · ${GF}`]);
    expect(state.view?.file).toBe(GF);
    expect(hist()).toBe('plan.dwg closed. What you drew stays in the project.');
    act(() => closeOf(GF).click());
    expect(tabs()).toEqual([]);
    expect(state.view).toBeNull();
    expect(document.querySelector('.cad-tabs')).toBeNull();
    expect(button('Open drawing…')).toBeDefined();
    expect(button('Reopen plan.dwg')).toBeDefined();
    expect(result()).toContain('No drawing open.');
    await act(async () => { button('Reopen plan.dwg').click(); });
    await flush();
    expect(tabs()).toEqual(['Level? · plan.dwg']);
  });

  it('NEW opens a blank drawing in millimetres in a tab of its own, Drawing1.dxf then Drawing2.dxf, with the grid on', async () => {
    act(() => root.render(<Host />));
    await flush();
    expect(state.toggles.grid).toBe(true);
    expect(document.querySelector('.cad-tg[aria-pressed="true"][title^="Grid: lines"]')).not.toBeNull();
    await command('NEW');
    await until(() => tabs().includes('Level? · Drawing1.dxf'));
    expect(tabs()).toEqual([`Level? · ${GF}`, 'Level? · Drawing1.dxf']);
    expect(state.view?.file).toBe('Drawing1.dxf');
    expect(state.view?.path).toBeUndefined();
    expect(state.view?.info).toMatchObject({ units: 4, segments: 0, layers: [{ name: '0' }] });
    expect(document.querySelector('.cad-hist-prev')?.textContent ?? '').toContain('NEW  Drawing1.dxf — a blank drawing in millimetres.');
    await command('QNEW');
    await until(() => tabs().includes('Level? · Drawing2.dxf'));
    expect(state.drawings.map((v) => v.file)).toEqual([GF, 'Drawing1.dxf', 'Drawing2.dxf']);
    // Saved the first time with Save As, as a drawing opened without a path.
    await saveCmd('SAVE');
    expect(document.querySelector('[role="dialog"][aria-label="Save As"]')).toBeNull();
  });

  it('the page with no drawing open offers New drawing beside Open drawing…', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => closeOf(GF).click());
    expect(tabs()).toEqual([]);
    await act(async () => { button('New drawing').click(); });
    await until(() => tabs().length === 1);
    expect(tabs()).toEqual(['Level? · Drawing1.dxf']);
  });

  it('right-click: Close, Close others and Close all; Close others is off with one tab', async () => {
    act(() => root.render(<Host />));
    await flush();
    await openAnother();
    rightClick(GF);
    expect(menu()).not.toBeNull();
    expect((document.activeElement as HTMLElement).textContent).toBe('Close');
    act(() => button('Close others').click());
    expect(menu()).toBeNull();
    expect(tabs()).toEqual([`Level? · ${GF}`]);
    expect(state.view?.file).toBe(GF); // plan.dwg was showing and has gone; the one kept shows
    rightClick(GF);
    expect(button('Close others').disabled).toBe(true);
    act(() => button('Close all').click());
    expect(tabs()).toEqual([]);
    await act(async () => { button('Open drawing…').click(); });
    await flush();
    rightClick('plan.dwg');
    act(() => button('Close').click());
    expect(tabs()).toEqual([]);
  });

  it('Esc or a click elsewhere shuts the menu and leaves the tool in use', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.setTool('dist'));
    rightClick(GF);
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(menu()).toBeNull();
    expect(state.tool).toBe('dist');
    rightClick(GF);
    act(() => (document.querySelector('.st-cover') as HTMLElement).click());
    expect(menu()).toBeNull();
    expect(state.drawings).toHaveLength(1);
    expect(state.tool).toBe('dist');
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(state.tool).toBe('none'); // with the menu shut, Esc cancels the tool as before
  });

  it('CLOSE and CLOSEALL at the command line, and Close on the ribbon', async () => {
    act(() => root.render(<Host />));
    await flush();
    await command('open');
    await flush();
    await command('close');
    expect(tabs()).toEqual([`Level? · ${GF}`]);
    await command('open');
    await flush();
    act(() => state.actions.current.close());
    expect(tabs()).toEqual([`Level? · ${GF}`]);
    await command('open');
    await flush();
    await command('CLOSEALL');
    expect(tabs()).toEqual([]);
    expect(hist()).toBe('2 drawings closed. What you drew stays in the project.');
    await command('close');
    expect(hist()).toBe('No drawing open.');
    await command('closeall');
    expect(hist()).toBe('No drawing open.');
    act(() => state.actions.current.close()); // nothing to close
    expect(hist()).toBe('No drawing open.');
    await command('help');
    expect(hist()).toContain('OPEN · CLOSE · CLOSEALL');
  });

  it('asks the engine what is under the pick box once the cursor rests, as far out as a click picks', async () => {
    act(() => root.render(<Host />));
    await flush();
    await openAnother();
    act(() => state.toggle('osnap'));
    const pick = vi.spyOn(state.view!, 'pick');
    const c = document.querySelector('canvas.cad-over')!;
    act(() => { c.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200, bubbles: true })); });
    // Moving: not asked yet.
    expect(pick).not.toHaveBeenCalled();
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(pick).toHaveBeenCalledTimes(1);
    const hoverTol = pick.mock.calls[0][2];
    await act(async () => { for (const t of ['mousedown', 'mouseup']) c.dispatchEvent(new MouseEvent(t, { clientX: 300, clientY: 200, button: 0, bubbles: true })); });
    await flush();
    expect(pick.mock.calls[pick.mock.calls.length - 1][2]).toBeCloseTo(hoverTol);
  });

  it('arrow keys, Home and End move between tabs without panning the drawing', async () => {
    act(() => root.render(<Host />));
    await flush();
    await openAnother();
    act(() => state.toggle('osnap'));
    const key = (k: string) => act(() => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
    const coords = () => {
      act(() => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200, bubbles: true })); });
      return document.querySelector('.cad-coords')?.textContent;
    };
    const before = coords();
    act(() => nameOf('plan.dwg').focus());
    key('ArrowRight');
    expect(state.view?.file).toBe(GF);
    expect(document.activeElement).toBe(nameOf(GF));
    expect(nameOf(GF).tabIndex).toBe(0);
    expect(nameOf('plan.dwg').tabIndex).toBe(-1);
    key('ArrowLeft');
    expect(state.view?.file).toBe('plan.dwg');
    key('Home');
    expect(state.view?.file).toBe(GF);
    key('End');
    expect(state.view?.file).toBe('plan.dwg');
    expect(coords()).toBe(before);
  });

  it('clears what was picked or being drawn when another tab shows, and when the last one closes', async () => {
    act(() => root.render(<Host />));
    await flush();
    await command('di');
    await clickAt(30, -80);
    await clickAt(6170, -80);
    expect(result()).toMatch(/Distance 6\.20 m/);
    await openAnother();
    expect(result()).not.toMatch(/Distance/);
    await act(async () => { nameOf(GF).click(); });
    await flush();
    expect(result()).not.toMatch(/Distance/);
    await command('li');
    await clickAt(6687.5 + 190, 7375);
    await flush();
    expect(result()).toMatch(/Block · L1/);
    await command('closeall'); // what was picked needs its drawing: it goes with it
    await flush();
    expect(result()).toContain('No drawing open.');
    expect(state.view).toBeNull();
  });

  it('the Plans list marks the plans in tabs and goes to a tab without reading the file again', async () => {
    act(() => root.render(<Host start={twoPlans} />));
    await flush();
    const plans = () => [...document.querySelectorAll('[aria-label="Plans of this project"] button')] as HTMLButtonElement[];
    expect(plans().map((b) => b.textContent)).toEqual([`Ground${GF}open`, `First${FF}`]);
    expect(plans()[0].disabled).toBe(true);
    await act(async () => { plans()[1].click(); });
    await flush();
    expect(tabs()).toEqual([`Ground · ${GF}`, `First · ${FF}`]);
    expect(plans().map((b) => b.textContent)).toEqual([`Ground${GF}open`, `First${FF}open`]);
    const reads = sampleReads();
    expect(plans()[0].disabled).toBe(false);
    await act(async () => { plans()[0].click(); });
    await flush();
    expect(shown()).toBe(`Ground · ${GF}`);
    expect(sampleReads()).toBe(reads);
    expect(state.drawings).toHaveLength(2);
    act(() => closeOf(FF).click());
    expect(plans().map((b) => b.textContent)).toEqual([`Ground${GF}open`, `First${FF}`]);
  });

  it('the sample floor list goes to the tab of a sample already open', async () => {
    act(() => root.render(<Host />));
    await flush();
    const pick = async (file: string) => {
      const list = document.querySelector('select[aria-label="Sample floor"]') as HTMLSelectElement;
      await act(async () => { list.value = file; list.dispatchEvent(new Event('change', { bubbles: true })); });
      await flush();
    };
    await pick(FF);
    expect(state.drawings.map((v) => v.file)).toEqual([GF, FF]);
    const reads = sampleReads();
    await pick(GF);
    expect(state.view?.file).toBe(GF);
    expect(sampleReads()).toBe(reads);
  });

  it('File → Plans goes to a tab; replacing a plan stays in its tab', async () => {
    project = twoPlans;
    act(() => root.render(<Host start={twoPlans} />));
    await flush();
    const apply = (next: Project, message: string) => onChange(next, message);
    await act(async () => { cadFileMenu(project, state, apply, () => {}).plans[1].onClick(); });
    await flush();
    expect(state.drawings.map((v) => v.file)).toEqual([GF, FF]);
    const reads = sampleReads();
    await act(async () => { cadFileMenu(project, state, apply, () => {}).plans[0].onClick(); });
    await flush();
    expect(state.view?.file).toBe(GF);
    expect(sampleReads()).toBe(reads);
    const before = state.view!;
    const replace = cadFileMenu(project, state, apply, () => {}).plans.find((x) => x.label.startsWith('Replace'))!;
    await act(async () => { replace.onClick(); });
    await flush();
    expect(state.drawings.map((v) => v.file)).toEqual(['plan.dwg', FF]);
    expect(state.view?.file).toBe('plan.dwg');
    expect(state.drawings).not.toContain(before);
  });

  it('the sample villa stays closed: not when the page shows again, nor after a drawing opened from the ribbon', async () => {
    const status = vi.fn();
    let page: (on: boolean) => void = () => {};
    function Pages({ startOn }: { startOn: boolean }) {
      const cad = useCad('p1');
      const [on, setOn] = useState(startOn);
      state = cad;
      page = setOn;
      return on ? <CadPage cad={cad} project={villa} onChange={onChange} onStatus={status} /> : null;
    }
    act(() => root.render(<Pages startOn />));
    await flush();
    expect(state.view?.file).toBe(GF);
    await command('close');
    expect(status).toHaveBeenCalledWith(`${GF} closed. What you drew stays in the project.`);
    await flush();
    expect(state.view).toBeNull();
    act(() => page(false));
    act(() => page(true));
    await flush();
    expect(state.view).toBeNull();
    expect(button('Sample villa · Ground floor')).toBeDefined(); // still offered
    act(() => root.render(null));

    act(() => root.render(<Pages startOn={false} />));
    const v = await openDrawing('plan.dwg', bytes('tests/fixtures/cad/plan-2018.dwg'));
    act(() => state.open(v));
    act(() => page(true));
    await flush();
    await command('close');
    await flush();
    expect(state.view).toBeNull();
  });

  it('References: attaches a drawing under the plan, lists it, turns its layers off, clips, binds and detaches it', async () => {
    act(() => root.render(<Host />));
    await flush();
    const lvds = (window as unknown as { lvds: { cadFile: { openBytes: ReturnType<typeof vi.fn> }; files?: unknown } }).lvds;
    lvds.cadFile.openBytes.mockResolvedValueOnce({ file: 'STR-GF.dxf', path: '/refs/STR-GF.dxf', bytes: bytes('electron/samples/sample-villa-ff.dxf') });
    const saveBinary = vi.fn(async () => '/plans/out.dxf');
    lvds.files = { saveBinary };
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
    const refs = () => project.cadRefs?.['sample-villa-gf.dxf'] ?? [];
    await command('XA');
    await flush();
    expect(document.body.textContent).toContain('Attach a reference');
    expect((document.querySelector('[aria-label="Reference name"]') as HTMLInputElement).value).toBe('STR-GF');
    expect((document.querySelector('[aria-label="Reference prints"]') as HTMLInputElement).checked).toBe(true); // the structure prints by default
    act(() => button('Pick on plan').click());
    expect(state.tool).toBe('xattach');
    await clickAt(1000, 2000);
    expect(document.body.textContent).toContain('Attach a reference');
    await act(async () => { button('Attach').click(); });
    expect(refs()).toHaveLength(1);
    expect(refs()[0]).toMatchObject({ name: 'STR-GF', file: 'STR-GF.dxf', type: 'overlay', scale: 1, rot: 0, fade: 50, print: true });
    expect(refs()[0].at[0]).toBeCloseTo(1000, -1);
    expect(last()).toMatch(/^XATTACH {2}STR-GF \(STR-GF\.dxf\) on sample-villa-gf\.dxf — overlay at [\d.]+, [\d.]+, ×1, 0°, [\d,]+ lines, faded 50 % · ⌘Z to undo$/);
    // Its layers show in the Layers panel as NAME|LAYER, and in the manager with their status.
    const wall = [...document.querySelectorAll('button')].find((b) => b.textContent?.startsWith('STR-GF|A-WALL'))!;
    expect(wall).toBeDefined();
    act(() => wall.click());
    expect(refs()[0].layers).toEqual({ 'A-WALL': { hidden: true } });
    await command('XR');
    expect(document.querySelector('[aria-label="References"]')!.textContent).toMatch(/STR-GFLoadedSTR-GF\.dxf/);
    act(() => button('Unload').click());
    expect(refs()[0].unloaded).toBe(true);
    expect(document.querySelector('[aria-label="References"]')!.textContent).toContain('Unloaded');
    act(() => button('Load').click());
    act(() => button('Clip').click());
    expect(state.tool).toBe('xclip');
    await clickAt(0, 0);
    await clickAt(5000, 4000);
    await command('');
    expect(refs()[0].clip).toEqual([[expect.any(Number), expect.any(Number)], expect.anything(), expect.anything(), expect.anything()]);
    expect(last()).toBe('XREF  STR-GF: clipped to a rectangle · ⌘Z to undo');
    // Bind: the saved copy gets the reference's lines on NAME$0$LAYER layers.
    await command('XR');
    await act(async () => { button('Bind…').click(); });
    await flush();
    const text = new TextDecoder().decode((saveBinary.mock.calls[0] as unknown as [{ bytes: Uint8Array; defaultName: string }])[0].bytes);
    expect((saveBinary.mock.calls[0] as unknown as [{ defaultName: string }])[0].defaultName).toBe('sample-villa-gf - with devices and references.dxf');
    expect(text).toContain('STR-GF$0$');
    expect(text).not.toContain('STR-GF$0$A-WALL'); // its layer is off
    expect(document.body.textContent).toContain('2 reference lines bound on NAME$0$LAYER layers'); // inside the clip; no text or hatch there
    await command('XR');
    act(() => button('Detach').click());
    expect(project.cadRefs).toBeUndefined();
    expect(last()).toBe('XREF  STR-GF detached from sample-villa-gf.dxf. STR-GF.dxf is not changed · ⌘Z to undo');
  });

  it('References: one named inside the opened drawing is looked for beside the plan and shown; one detached is not looked for again', async () => {
    act(() => root.render(<Host />));
    await flush();
    const cadFile = (window as unknown as { lvds: { cadFile: { openBytes: ReturnType<typeof vi.fn>; readBytes?: unknown } } }).lvds.cadFile;
    cadFile.openBytes.mockResolvedValueOnce({ file: 'GF.dxf', path: '/jobs/A/Arch/GF.dxf', bytes: bytes('tests/fixtures/cad/xref-host.dxf') });
    const readBytes = vi.fn(async (p: string) => (p === '/jobs/A/Structure/STR-GF.dxf' ? { file: 'STR-GF.dxf', path: p, bytes: bytes('electron/samples/sample-villa-ff.dxf') } : null));
    cadFile.readBytes = readBytes;
    await command('open');
    await flush();
    expect(state.view?.file).toBe('GF.dxf');
    // Saved as ..\Structure\STR-GF.dxf: found from the plan's folder, at the drawing's insert.
    expect(readBytes.mock.calls[0][0]).toBe('/jobs/A/Structure/STR-GF.dxf');
    const refs = () => project.cadRefs?.['gf.dxf'] ?? [];
    expect(refs()).toEqual([expect.objectContaining({ name: 'STR-GF', file: 'STR-GF.dxf', type: 'overlay', at: [500, 0], found: true })]);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('XREF  Found inside GF.dxf and shown under it: STR-GF (/jobs/A/Structure/STR-GF.dxf) · ⌘Z to undo');
    expect(localStorage.getItem('lvds.cad.paths.p1')).toContain('/jobs/A/Structure/STR-GF.dxf');
    await command('XR');
    expect(document.querySelector('[aria-label="References"]')!.textContent).toMatch(/STR-GFLoaded/);
    act(() => button('Detach').click());
    expect(refs()).toEqual([]);
    expect(JSON.parse(localStorage.getItem('lvds.cad.refsOff.p1.gf.dxf')!)).toEqual(['STR-GF']);
  });

  it('References: one named inside the opened drawing and not found says so', async () => {
    act(() => root.render(<Host />));
    await flush();
    const cadFile = (window as unknown as { lvds: { cadFile: { openBytes: ReturnType<typeof vi.fn>; readBytes?: unknown } } }).lvds.cadFile;
    cadFile.openBytes.mockResolvedValueOnce({ file: 'GF.dxf', path: '/jobs/A/Arch/GF.dxf', bytes: bytes('tests/fixtures/cad/xref-host.dxf') });
    cadFile.readBytes = vi.fn(async () => null);
    await command('open');
    await flush();
    expect(project.cadRefs).toBeUndefined();
    expect(document.body.textContent).toContain('XREF  Not found on this computer: STR-GF (inside GF.dxf). References → Repath… finds it.');
  });

  it('Layouts of the drawing file itself: a tab each on any drawing; the paper with its viewport, shown as saved', async () => {
    act(() => root.render(<Host />));
    await flush();
    const v = await openDrawing('paper-layouts.dxf', bytes('tests/fixtures/cad/paper-layouts.dxf'));
    act(() => state.open(v));
    await flush();
    const ltabs = () => [...document.querySelectorAll('[aria-label="Model and layouts"] [role="tab"]')].map((t) => t.textContent);
    expect(ltabs()).toEqual(['Model', 'Layout1', 'A1 Lighting']);
    const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.cad-ltab')].find((b) => b.textContent === name)!;
    expect(tab('Layout1').title).toBe('420 × 297 mm · 1 viewport at 1:100');
    act(() => tab('Layout1').click());
    expect(state.layout).toBe('file:Layout1');
    expect(document.querySelector('.cad-filepaper')!.getAttribute('aria-label')).toBe('Layout Layout1: 420 × 297 mm paper, 1 viewport');
    expect(document.querySelector('.cad-status')!.textContent).toContain('PAPERLayout1 · 420 × 297 mm · 1 viewport at 1:100');
    expect(document.querySelector('.cad-hist')!.textContent).toBe("LAYOUT  Layout1 — the drawing file's own layout, as saved: 420 × 297 mm · 1 viewport at 1:100.");
    await command('MV');
    expect(document.querySelector('.cad-hist')!.textContent).toMatch(/^MV {2}Layout1 is the drawing file's own layout, shown as it was saved/);
    act(() => tab('A1 Lighting').click());
    expect(document.querySelector('.cad-filepaper')!.getAttribute('aria-label')).toBe('Layout A1 Lighting: 841 × 594 mm paper, 0 viewports');
    act(() => tab('Model').click());
    expect(state.layout).toBeNull();
    expect(document.querySelector('.cad-filepaper')).toBeNull();
  });

  it('Layouts: + makes a layout of the drawing (no level needed): A3, the whole drawing in a viewport; rename, copy, move, delete; a plan sheet needs a level', async () => {
    act(() => root.render(<Host start={{ ...villa, building: undefined }} />));
    await flush();
    const v = await openDrawing('paper-layouts.dxf', bytes('tests/fixtures/cad/paper-layouts.dxf'));
    act(() => state.open(v));
    await flush();
    const ltabs = () => [...document.querySelectorAll('[aria-label="Model and layouts"] [role="tab"]')].map((t) => t.textContent);
    const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.cad-ltab')].find((b) => b.textContent === name)!;
    const hist = () => document.querySelector('.cad-hist')!.textContent;
    act(() => (document.querySelector('[aria-label="New layout"]') as HTMLButtonElement).click());
    expect(document.querySelector('[role="menu"]')).toBeNull(); // made at once, no menu
    expect(ltabs()).toEqual(['Model', 'Layout1', 'A1 Lighting', 'Layout2']);
    expect(state.layout).toBe('dwg:Layout2');
    const key = v.file.toLowerCase();
    expect(project.cadLayouts![key]).toHaveLength(1);
    expect(project.cadLayouts![key][0]).toMatchObject({ name: 'Layout2', paper: [420, 297] });
    expect(document.querySelector('.cad-filepaper')!.getAttribute('aria-label')).toBe('Layout Layout2: 420 × 297 mm paper, 1 viewport');
    expect(document.querySelector('.cad-status')!.textContent).toMatch(/PAPERLayout2 · 420 × 297 mm · 1 viewport at 1:\d+/);
    // LAYOUT alone makes the next one.
    await command('LAYOUT');
    expect(ltabs()).toEqual(['Model', 'Layout1', 'A1 Lighting', 'Layout2', 'Layout3']);
    // Right-click: rename, copy, move, delete; then New plan sheet, which needs a level.
    const menu = (name: string, item: string) => {
      act(() => tab(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 500 })));
      act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.startsWith(item))!.click());
    };
    menu('Layout3', 'Rename');
    await command('Lighting GF');
    expect(ltabs()).toEqual(['Model', 'Layout1', 'A1 Lighting', 'Layout2', 'Lighting GF']);
    menu('Lighting GF', 'Move left');
    expect(ltabs()).toEqual(['Model', 'Layout1', 'A1 Lighting', 'Lighting GF', 'Layout2']);
    menu('Layout2', 'Copy');
    expect(ltabs()).toEqual(['Model', 'Layout1', 'A1 Lighting', 'Lighting GF', 'Layout2', 'Layout3']);
    menu('Layout2', 'Delete');
    expect(ltabs()).toEqual(['Model', 'Layout1', 'A1 Lighting', 'Lighting GF', 'Layout3']);
    menu('Model', 'Lighting layout');
    expect(hist()).toBe('LAYOUT  Add the building and its levels in Building information first: a layout is a plan sheet of a level.');
    expect(project.cadLayouts![key].map((l) => l.name)).toEqual(['Lighting GF', 'Layout3']);
  });

  it('Layouts: + makes a layout of the level; its paper has a viewport; VPSCALE and VPLOCK set it, MS works in it, MV adds one, the Layer manager has This viewport', async () => {
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
    const gf = { building: 'V', level: 'GF' };
    let start: Project = { ...villa, cadPlans: [{ building: 'V', level: 'GF', file: 'sample-villa-gf.dxf', units: 4 }] };
    for (const [x, y] of [[3, 9], [6, 9.4], [9, 8.8]]) start = placeLvPoint(start, gf, 'ltg', 'DB-GF1-B2', x, y).project;
    act(() => root.render(<Host start={start} />));
    await flush();
    const tabs = () => [...document.querySelectorAll('[aria-label="Model and layouts"] [role="tab"]')].map((t) => t.textContent);
    expect(tabs()).toEqual(['Model', 'Layout1']); // the drawing file's own (empty) layout, then the level's plan sheets
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.cad-ltab')].find((b) => b.textContent === 'Model')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 500 })));
    act(() => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Lighting layout'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const sheet = () => project.drawingSet!.sheets.find((x) => x.kind === 'plan')!;
    expect(sheet()).toMatchObject({ plan: 'lighting', buildingId: 'V', levelId: 'GF', number: 'E-LTG-001' });
    expect(state.layout).toBe(sheet().id);
    expect(tabs()).toEqual(['Model', 'Layout1', 'E-LTG-001sheet']);
    expect(document.querySelector('.cad-paper')).not.toBeNull();
    expect(document.querySelector('.cad-status')!.textContent).toMatch(/PAPERViewport 1 · 1:100 · lockedE-LTG-001 · A3 · mm/);
    await until(() => !!document.querySelector('.cad-paper iframe'));
    // Its frame, dashed over the paper; picked, its properties show.
    await until(() => !!document.querySelector('.cad-vp'));
    expect([...document.querySelectorAll('.cad-vp')].map((v) => v.getAttribute('aria-label'))).toEqual(['Viewport 1']);
    // The paper's printable area, dashed, and trim marks outside its four corners; the command bar above the tabs.
    expect(document.querySelector('.cad-paper .cad-printable')!.getAttribute('title')).toMatch(/^Printable area: 5 mm in from the paper's edge/);
    expect([...document.querySelectorAll('.cad-paper .cad-trim')].map((t) => t.className)).toEqual(['cad-trim nw', 'cad-trim ne', 'cad-trim sw', 'cad-trim se']);
    const bottom = [...document.querySelectorAll('.cad-cmdbox, .cad-ltabs, .cad-status')].map((el) => el.className.split(' ')[0]);
    expect(bottom).toEqual(['cad-cmdbox', 'cad-ltabs', 'cad-status']);
    act(() => document.querySelector('.cad-vp-edge')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 })));
    expect(state.vpSel).toBe('vp1');
    expect(document.querySelector('[aria-label="Viewport properties"]')!.textContent).toMatch(/^Viewport 1 E-LTG-001Scale/);
    act(() => document.querySelector('.cad-vp-edge')!.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 10, clientY: 10 })));
    expect(sheet().viewports).toBeUndefined(); // picked, not moved
    // VPSCALE and VPLOCK act on the only viewport; the worked-out one becomes the sheet's own.
    await command('VPSCALE 50');
    expect(sheet().viewports).toEqual([expect.objectContaining({ id: 'vp1', scale: 50 })]);
    await command('VPLOCK');
    expect(sheet().viewports![0].locked).toBe(false);
    // MS: the drawing inside the viewport; PS back to the paper.
    await command('MS');
    expect(state.msVp).toBe('vp1');
    expect(document.querySelector('.cad-status')!.textContent).toContain('MODEL');
    await command('PS');
    expect(state.msVp).toBeNull();
    // MV: two corners on the paper make a second viewport at the scale of the one picked, onto the model there.
    await command('MV');
    const paperAt = (x: number, y: number) => act(() => document.querySelector('.cad-vps')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y })));
    paperAt(300, 300);
    paperAt(400, 360);
    expect(sheet().viewports!.map((v) => v.id)).toEqual(['vp1', 'vp2']);
    expect(sheet().viewports![1]).toMatchObject({ scale: 50 });
    expect(sheet().viewports![1].box[2]).toBeGreaterThan(2);
    expect(state.vpSel).toBe('vp2');
    expect(last()).toMatch(/^E-LTG-001 {2}Viewport 2 added at 1:50 · ⌘Z to undo$/);
    // LEGEND: a click on the paper places a legend table (its rows follow the plan); picked, its properties show; NOTES the same.
    await command('LEGEND');
    expect(document.querySelector('.cad-hist')!.textContent).toMatch(/^LEGEND {2}Click where the legend table's top left corner goes/);
    paperAt(320, 200);
    expect(sheet().tables).toEqual([expect.objectContaining({ id: 'tb1', kind: 'legend', widthMm: 92 })]);
    expect(state.vpSel).toBe('tb1');
    expect(last()).toMatch(/^E-LTG-001 {2}Legend table placed at [\d.-]+, [\d.-]+ mm · ⌘Z to undo$/);
    await until(() => !!document.querySelector('.cad-ptab'));
    expect(document.querySelector('.cad-ptab')!.getAttribute('aria-label')).toBe('Legend');
    expect(document.querySelector('[aria-label="Table properties"]')!.textContent).toMatch(/^Legend E-LTG-001Width/);
    expect([...document.querySelectorAll('[aria-label="Table properties"] [role="group"][aria-label="Rows"] label')].map((l) => l.textContent?.trim())).toContain('Light');
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Columns"] button')].find((b) => b.textContent === '2 columns')!.click());
    expect(sheet().tables![0].cols).toBe(2);
    await command('NOTES');
    paperAt(320, 400);
    expect(sheet().tables!.map((t) => t.kind)).toEqual(['legend', 'notes']);
    expect(state.vpSel).toBe('tb2');
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete notes table')!.click());
    expect(sheet().tables!.map((t) => t.kind)).toEqual(['legend']);
    expect(state.vpSel).toBeNull();
    act(() => state.setVpSel('vp2'));
    // The Layer manager in a layout: This viewport freezes a drawn layer in the viewport picked only.
    act(() => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Layers in this viewport…')!.click());
    expect(document.querySelector('.cad-lp-head')!.textContent).toContain('Viewport 2');
    expect([...document.querySelectorAll('[aria-label="Layers"] th')].map((t) => t.textContent)).toContain('VP');
    act(() => (document.querySelector('[aria-label="Close the layer palette"]') as HTMLButtonElement).click());
    // A paper markup from the command line: the Sheets line tool, on the paper.
    await command('L');
    expect(document.querySelector('.cad-hist')!.textContent).toBe('L  On the paper: drag where it goes (Esc stops).');
    await command('MODEL');
    expect(state.layout).toBeNull();
    expect(document.querySelector('.cad-paper')).toBeNull();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.cad-ltab')].find((b) => b.textContent?.startsWith('E-LTG-001'))!.click());
    expect(state.layout).toBe(sheet().id);
    // Delete from the tab's menu: the layout and its sheet go (undoable).
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.cad-ltab')].find((b) => b.textContent?.startsWith('E-LTG-001'))!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 500 })));
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === 'Delete')!.click());
    expect(project.drawingSet!.sheets.some((x) => x.kind === 'plan')).toBe(false);
    expect(tabs()).toEqual(['Model', 'Layout1']);
    expect(state.layout).toBeNull();
  });

  /** A select or text field of an open dialog set the way a person would. */
  const setField = (label: string, value: string) => {
    const el = document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement | HTMLInputElement;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
  };

  const lastMsg = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];

  it('Layout viewports on a plan sheet: VPORTS arranges them, VPCOPY / VPFIT / VPALIGN / VPFRAME act on the one picked, VPMAX shows its area on the Model tab and VPMIN comes back; the scale list adds 1:75', async () => {
    const gf = { building: 'V', level: 'GF' };
    let start: Project = { ...villa, cadPlans: [{ building: 'V', level: 'GF', file: 'sample-villa-gf.dxf', units: 4 }] };
    for (const [x, y] of [[3, 9], [6, 9.4], [9, 8.8]]) start = placeLvPoint(start, gf, 'ltg', 'DB-GF1-B2', x, y).project;
    act(() => root.render(<Host start={start} />));
    await flush();
    await command('LAYOUT L');
    const sheet = () => project.drawingSet!.sheets.find((x) => x.kind === 'plan')!;
    expect(state.layout).toBe(sheet().id);
    await until(() => !!document.querySelector('.cad-vp'));
    await command('VPORTS');
    expect(hist()).toMatch(/^VPORTS {2}Type VPORTS and an arrangement: 1, 2V, 2H, 3L, 3R, 3A, 3B, 4 or KEY/);
    await command('VPALIGN H');
    expect(hist()).toBe('VPALIGN  Pick another viewport: the others line up with Viewport 1.');
    // Two side by side: the first keeps its view.
    await command('VPORTS 2V');
    const vps = () => sheet().viewports!;
    expect(vps().map((v) => [v.id, v.scale])).toEqual([['vp1', 100], ['vp2', 100]]);
    expect(vps()[0].box[0] + vps()[0].box[2]).toBeLessThan(vps()[1].box[0]);
    await command('VPORTS 1');
    expect(vps().map((v) => v.id)).toEqual(['vp1']);
    await command('VPORTS KEY');
    expect(vps().map((v) => v.scale)).toEqual([100, 500]);
    // The second one picked: fit, align, frame, copy.
    act(() => state.setVpSel('vp2'));
    await command('VPALIGN H');
    const [a, b] = vps();
    const lineOf = (v: typeof a) => v.box[1] + v.box[3] / 2 - (a.at[1] - v.at[1]) * (1000 / v.scale);
    expect(Math.abs(lineOf(b) - (a.box[1] + a.box[3] / 2))).toBeLessThan(1e-6);
    await command('VPALIGN');
    expect(hist()).toBe('VPALIGN  Type VPALIGN H (side by side) or VPALIGN V (stacked).');
    await command('VPFIT');
    expect(vps()[1].scale).toBeGreaterThanOrEqual(100);
    expect([100, 200, 500, 1000, 20, 50]).toContain(vps()[1].scale);
    expect(vps()[1].at[0]).toBeCloseTo(vps()[0].at[0], 0); // centred on the level, as the first is
    expect(project.drawingSet!.sheets.find((x) => x.kind === 'plan')!.viewports![1].frame).toBeUndefined();
    await command('VPFRAME');
    expect(vps()[1].frame).toBe(true);
    expect(lastMsg()).toMatch(/Viewport 2: frame prints · ⌘Z to undo$/);
    await command('VPFRAME');
    expect(vps()[1].frame).toBeUndefined();
    await command('VPCOPY');
    expect(vps().map((v) => v.id)).toEqual(['vp1', 'vp2', 'vp3']);
    expect(state.vpSel).toBe('vp3');
    expect(lastMsg()).toMatch(/Viewport 2 copied as Viewport 3 · ⌘Z to undo$/);
    // VPMAX: the viewport's area on the Model tab; VPMIN and the layout's tab bring the paper back.
    await command('VPMAX');
    expect(state.layout).toBeNull();
    expect(hist()).toMatch(/VPMIN or the layout's tab goes back to the paper\.$/);
    await command('VPMIN');
    expect(state.layout).toBe(sheet().id);
    expect(hist()).toBe('VPMIN  Back on the layout.');
    await command('MODEL');
    await command('VPMIN');
    expect(hist()).toBe('VPMIN  No viewport is maximised (VPMAX on a layout first).');
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.cad-ltab')].find((t) => t.textContent?.startsWith('E-LTG-001'))!.click());
    // A single viewport again; the scale list gives the viewport panel 1:75.
    await command('VPORTS 1');
    expect(vps()).toHaveLength(1);
    act(() => state.setVpSel('vp1'));
    expect([...document.querySelectorAll('[aria-label="Viewport scale"] option')].map((o) => o.textContent)).toEqual(['1:20', '1:50', '1:100', '1:200', '1:500', '1:1000', 'Custom…']);
    await command('SCALELISTEDIT');
    expect(document.querySelector('[aria-label="Scale list"]')).not.toBeNull();
    act(() => [...document.querySelectorAll('[aria-label="Scales"] label')].find((l) => l.textContent?.trim() === '1:75')!.querySelector('input')!.click());
    act(() => button('Save').click());
    expect(project.plot?.scales).toEqual([20, 50, 75, 100, 200, 500, 1000]);
    expect(lastMsg()).toBe('SCALELISTEDIT  7 scales in the list · ⌘Z to undo');
    expect([...document.querySelectorAll('[aria-label="Viewport scale"] option')].map((o) => o.textContent)).toContain('1:75');
    await command('VPFIT');
    expect(lastMsg()).toMatch(/Viewport 1: the whole level at 1:\d+ · ⌘Z to undo$/);
  });

  it('Layouts made with +: VPORTS 4, VPFIT, VPSCALE, Page setup (paper and orientation), Save as template and New layout from it', async () => {
    localStorage.removeItem('lvds.layoutTemplates');
    act(() => root.render(<Host start={{ ...villa, building: undefined }} />));
    await flush();
    const v = await openDrawing('paper-layouts.dxf', bytes('tests/fixtures/cad/paper-layouts.dxf'));
    act(() => state.open(v));
    await flush();
    const key = v.file.toLowerCase(), mine = () => project.cadLayouts![key];
    const ltabs = () => [...document.querySelectorAll('[aria-label="Model and layouts"] [role="tab"]')].map((t) => t.textContent);
    await command('LAYOUT');
    expect(lastMsg()).toMatch(/Page setup changes the paper · ⌘Z to undo$/);
    expect(state.layout).toBe('dwg:Layout2');
    await command('VPORTS');
    expect(hist()).toMatch(/^VPORTS {2}Type VPORTS and an arrangement/);
    await command('VPSCALE 50');
    expect(lastMsg()).toBe('LAYOUT  Layout2: viewport at 1:50 · ⌘Z to undo');
    const perMm = (q: { vh: number; h: number }) => Math.round((q.vh / q.h) * 1e6) / 1e6; // the scale: model height per paper mm
    const vhBefore = perMm(mine()[0].viewports[0]);
    await command('VPORTS 4');
    expect(mine()[0].viewports).toHaveLength(4);
    expect(perMm(mine()[0].viewports[0])).toBe(vhBefore); // the first keeps its scale
    expect(lastMsg()).toBe('LAYOUT  Layout2: viewports arranged, four: equal · ⌘Z to undo');
    await command('VPFIT');
    expect(lastMsg()).toBe('LAYOUT  Layout2: the whole drawing in 4 viewports · ⌘Z to undo');
    await command('VPSCALE 50');
    expect(hist()).toMatch(/^VPSCALE {2}Layout2 has 4 viewports: right-click inside one/);
    // Page setup: A1 portrait; the viewports keep their scale.
    const scales = () => mine()[0].viewports.map((q) => Math.round(perMm(q) * 10) / 10); // the frame is kept to 0.1 mm
    const before = scales();
    expect(before.every((x) => x === 100)).toBe(true); // Fit: the whole drawing, at the scale it fits
    await command('PAGESETUP');
    setField('Paper', 'A1');
    act(() => button('Portrait').click());
    act(() => button('Save').click());
    expect(mine()[0].paper).toEqual([594, 841]);
    expect(scales()).toEqual(before);
    expect(lastMsg()).toBe('LAYOUT  Layout2: A1 portrait · ⌘Z to undo');
    // Save as template, then a new layout from it.
    await command('LAYOUT S');
    setField('Template name', 'My A1 portrait');
    act(() => button('Save as template').click());
    expect(JSON.parse(localStorage.getItem('lvds.layoutTemplates')!).map((t: { name: string; paper: number[] }) => [t.name, t.paper])).toEqual([['My A1 portrait', [594, 841]]]);
    act(() => button('Close').click());
    await command('LAYOUT T');
    act(() => button('New layout').click());
    expect(document.querySelector('[aria-label="Layout templates"]')).toBeNull();
    expect(ltabs()).toEqual(['Model', 'Layout1', 'A1 Lighting', 'Layout2', 'Layout3']);
    expect(mine()[1]).toMatchObject({ name: 'Layout3', paper: [594, 841] });
    expect(mine()[1].viewports).toHaveLength(4);
    expect(state.layout).toBe('dwg:Layout3');
    // VPMAX on a layout of the drawing, and back.
    await command('VPMAX');
    expect(state.layout).toBeNull();
    await command('VPMIN');
    expect(state.layout).toBe('dwg:Layout3');
    // Back by the layout's own tab: nothing is maximised any more, so VPMIN goes nowhere.
    await command('VPMAX');
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.cad-ltab')].find((b) => b.textContent === 'Layout2')!.click());
    expect(state.layout).toBe('dwg:Layout2');
    await command('VPMIN');
    expect(state.layout).toBe('dwg:Layout2');
    expect(hist()).toBe('VPMIN  No viewport is maximised (VPMAX on a layout first).');
    // What a layout of the drawing does not take yet says what it does take.
    await command('VPCOPY');
    expect(hist()).toBe('VPCOPY  Layout2 is a layout of the drawing: its viewports take Arrange (VPORTS), Fit (VPFIT), a scale and Page setup. VPCOPY works on the project\'s plan sheets (right-click a tab).');
  });
});

describe('CAD page actions from the ribbon', () => {
  it('a command given while another page showed (the sheets) runs once the page is there', async () => {
    let showPage: (on: boolean) => void = () => {};
    function Later() {
      const cad = useCad('p1');
      const [on, setOn] = useState(false);
      const sheetUi = useSheetUi();
      state = cad;
      showPage = setOn;
      return on ? <CadPage cad={cad} project={villa} onChange={onChange} onStatus={() => {}} sheetUi={sheetUi} /> : null;
    }
    act(() => root.render(<Later />));
    const ran = vi.fn((x: Parameters<NonNullable<CadState['pending']['current']>>[0]) => x.command('GRID'));
    state.pending.current = ran;
    expect([state.toggles.grid, state.gridDots]).toEqual([true, false]);
    act(() => showPage(true));
    await until(() => ran.mock.calls.length > 0);
    expect(ran).toHaveBeenCalledTimes(1);
    expect(state.pending.current).toBeNull();
    expect([state.toggles.grid, state.gridDots]).toEqual([true, true]); // GRID ran on the page, as if typed: lines → dots
    expect(state.history.slice(-1)[0]).toBe('Command: GRID');
  });
});

describe('CAD command line', () => {
  const line = (id: string, a: [number, number], b: [number, number]) => ({ id, kind: 'line' as const, layer: 'LV-SKETCH', pts: [a, b] });
  const X = 200000;
  const two: Project = { ...villa, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [line('S1', [X, 0], [X + 4000, 0]), line('S2', [X + 6000, 1000], [X + 6000, 5000])] }] };
  const hist = () => document.querySelector('.cad-hist')!.textContent;
  const earlier = () => [...document.querySelectorAll('.cad-hist-prev div')].map((d) => d.textContent);
  const key = (k: string, target: EventTarget = window, more: KeyboardEventInit = {}) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...more })); });
  const keyUp = (k: string, target: EventTarget = window) => act(() => { target.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true })); });
  /** A key pressed and let go (Space works as Enter when it is let go). */
  const tap = (k: string, target: EventTarget = window) => { key(k, target, { code: k === ' ' ? 'Space' : k }); keyUp(k, target); };
  const items = () => project.cadSketch![0].items;
  const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
  const option = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.cad-hist .cad-opt')].find((b) => b.textContent === name)!;
  const hover = (x: number, y: number) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('mousemove', { clientX: sx, clientY: sy, bubbles: true })); }); };
  const start = async (p: Project = two) => { project = p; act(() => root.render(<Host start={p} />)); await flush(); act(() => state.toggle('osnap')); };

  it('shows three earlier lines, the prompt with its options, one line for an unknown command, F1 the list and F2 the history', async () => {
    await start();
    await command('xyz');
    expect(hist()).toBe('Unknown command "XYZ". Press F1 for the list.');
    await command('O');
    expect(hist()).toBe('Command: OFFSET  Specify offset distance or [Through/Erase/Layer] <0.30>:');
    expect(earlier()).toHaveLength(3);
    expect(earlier().slice(1)).toEqual(['Unknown command "XYZ". Press F1 for the list.', 'Command: O']);
    expect([...document.querySelectorAll('.cad-hist .cad-opt')].map((b) => b.textContent)).toEqual(['Through', 'Erase', 'Layer']);
    key('F1');
    expect(document.querySelector('[aria-label="Command list (F1)"]')!.textContent).toContain('O · OFFSET  Offset');
    key('Escape');
    expect(document.querySelector('.cad-log')).toBeNull();
    expect(state.tool).toBe('offset'); // Esc closed the list only
    key('F2');
    expect(document.querySelector('[aria-label="Command history (F2)"]')!.textContent).toContain('Unknown command "XYZ"');
    key('F2');
    expect(document.querySelector('.cad-log')).toBeNull();
  });

  it('Offset: an option clicked works as typed, Enter takes the value in < >, then Enter ends the tool and repeats it', async () => {
    await start();
    await command('O');
    await act(async () => { option('Erase').click(); });
    expect(earlier()[2]).toBe('OFFSET  Erase source after offsetting: Yes');
    expect(hist()).toBe('OFFSET  Specify offset distance or [Through/Erase/Layer] <0.30>:');
    await command(''); // the 0.30 in < >
    expect(hist()).toBe('OFFSET  Select object to offset or [Exit]:');
    await clickAt(X + 2000, 0);
    expect(hist()).toBe('OFFSET  Specify point on side to offset:');
    await clickAt(X + 2000, 1000);
    expect(items()).toHaveLength(2); // the source moved, none added
    expect(items()[0]).toMatchObject({ id: 'S1', pts: [[X, 300], [X + 4000, 300]] });
    expect(last()).toBe('OFFSET  Line moved 0.30 m to the side · ⌘Z to undo');
    await command('');
    expect(state.tool).toBe('none');
    await command(''); // Enter with no tool: the last command again
    expect(state.tool).toBe('offset');
    key('Escape');
    act(() => { (document.querySelector('input[aria-label="Command"]') as HTMLInputElement).blur(); });
    tap(' '); // Space works as Enter
    expect(state.tool).toBe('offset');
  });

  it('Offset Through: the copy passes through the point clicked; Layer puts it on the current layer', async () => {
    const onLayer: Project = { ...two, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [{ ...line('S1', [X, 0], [X + 4000, 0]), layer: 'A-OTHER' }] }] };
    await start(onLayer);
    await command('O');
    await command('T');
    expect(hist()).toBe('OFFSET  Specify offset distance or [Through/Erase/Layer] <Through>:');
    await command('LAYER'); // the option's word works as its key
    await command('');
    await clickAt(X + 2000, 0);
    expect(hist()).toBe('OFFSET  Specify through point:');
    await clickAt(X + 1000, 750);
    expect(items()[1].layer).toBe('LV-SKETCH');
    expect(items()[1].pts.flat().map((v) => Math.round(v))).toEqual([X, 750, X + 4000, 750]);
    expect(last()).toBe('OFFSET  Line copied 0.75 m to the side (through the point) · ⌘Z to undo');
  });

  it('Fillet: Radius asks for the radius, Trim No keeps the lines and adds the arc', async () => {
    await start();
    await command('F');
    expect(hist()).toBe('Command: FILLET  Select first object or [Radius/Trim] <R 0.00>:');
    await command('R');
    expect(hist()).toBe('FILLET  Specify fillet radius <0.00>:');
    await command('0.5');
    expect(hist()).toBe('FILLET  Select first object or [Radius/Trim] <R 0.50>:');
    await command('T');
    expect(hist()).toBe('FILLET  Select first object or [Radius/Trim] <R 0.50, No trim>:');
    await clickAt(X + 3000, 0);
    expect(hist()).toBe('FILLET  Select second object:');
    await clickAt(X + 6000, 2000);
    expect(items().slice(0, 2).map((x) => x.pts)).toEqual([[[X, 0], [X + 4000, 0]], [[X + 6000, 1000], [X + 6000, 5000]]]);
    expect(items()[2]).toMatchObject({ kind: 'arc', r: 500 });
    expect(last()).toBe('FILLET  radius 0.50 m, lines not trimmed · ⌘Z to undo');
  });

  it('Scale asks for the factor after the base point; Array asks its type', async () => {
    await start();
    await dragWindow([X - 500, -500], [X + 6500, 5500]);
    await act(async () => { [...document.querySelectorAll('[aria-label="Edit drawn objects"] button')].find((b) => b.textContent === 'Scale')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(hist()).toBe('Command: SCALE  Specify base point:');
    await clickAt(X, 0);
    expect(hist()).toBe('SCALE  Specify scale factor <2>:');
    await command('0.5');
    expect(items()[0].pts).toEqual([[X, 0], [X + 2000, 0]]);
    expect(last()).toBe('SCALE  2 objects scaled × 0.5 · ⌘Z to undo');
    await command('AR');
    await clickAt(X + 1000, 0);
    await command('');
    expect(hist()).toBe('ARRAY  Enter array type [Rectangular/Polar] <Rectangular>:');
    await command('');
    expect(last()).toBe('ARRAY  5 copies made · ⌘Z to undo');
  });

  it('TEXT asks height and rotation after its point; a word typed there is the text', async () => {
    await start();
    await command('T');
    await clickAt(X, 0);
    expect(hist()).toBe('TEXT  Specify height <2.5 mm>:');
    await command('5');
    expect(hist()).toBe('TEXT  Specify rotation angle <0>:');
    await command('90');
    expect(hist()).toBe('TEXT  Enter text:');
    await command('DB ROOM');
    expect(items()[2]).toMatchObject({ kind: 'text', text: 'DB ROOM', h: 500 });
    expect(items()[2].rot).toBeCloseTo(Math.PI / 2, 6);
    await clickAt(X, 2000);
    await command('KITCHEN');
    expect(items()[3]).toMatchObject({ kind: 'text', text: 'KITCHEN', h: 250 });
  });

  it('lists matching commands while typing (Tab picks), and Up recalls the commands typed before', async () => {
    await start();
    const input = document.querySelector('input[aria-label="Command"]') as HTMLInputElement;
    const type = (text: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
    type('OF');
    expect(document.querySelector('[aria-label="Matching commands"]')!.textContent).toMatch(/^OFFSETOffset/);
    key('Tab', input);
    expect(input.value).toBe('OFFSET');
    await act(async () => { input.form!.requestSubmit(); });
    expect(state.tool).toBe('offset');
    await command('GRID');
    key('ArrowUp', input);
    expect(input.value).toBe('GRID');
    key('ArrowUp', input);
    expect(input.value).toBe('OFFSET');
    key('ArrowDown', input);
    expect(input.value).toBe('GRID');
  });

  it('right-click: with a tool, the command menu (Enter, options, Snap overrides…); with none and nothing under it, the blank-canvas menu', async () => {
    await start();
    const right = (x: number, y: number, shiftKey = false) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, shiftKey, bubbles: true, cancelable: true })); }); };
    const menu = () => [...document.querySelectorAll('[aria-label="Command menu"] > button')] as HTMLButtonElement[];
    const labels = () => menu().map((b) => b.firstElementChild!.textContent);
    const entry = (label: string) => menu().find((b) => b.firstElementChild!.textContent === label)!;
    await command('GRID');
    await command('F');
    await right(X + 20000, 20000);
    expect(labels()).toEqual(['Enter', 'Cancel', 'Radius', 'Trim', 'Snap overrides', 'Object snap', 'Ortho', 'Polar tracking', 'Zoom previous', 'Zoom extents']);
    await act(async () => { entry('Trim').click(); });
    expect(hist()).toBe('FILLET  Select first object or [Radius/Trim] <R 0.00, No trim>:');
    await command('');
    expect(state.tool).toBe('none');
    await right(X + 20000, 20000);
    expect(labels()).toEqual(['Repeat FILLET', 'Recent commands', 'Paste', 'Paste to original coordinates', 'Undo', 'Redo', 'Isolate', 'Pan', 'Zoom window', 'Zoom previous', 'Zoom extents',
      'Select all', 'Quick select…', 'Count', 'Place device', 'Cable route', 'Cable tray', 'Properties', 'Options…']);
    expect([entry('Paste').disabled, entry('Undo').disabled]).toEqual([true, true]); // nothing on the clipboard; no undo given
    await act(async () => { entry('Recent commands').click(); });
    expect([...document.querySelectorAll('[aria-label="Recent commands"] button')].map((b) => b.firstElementChild!.textContent)).toEqual(['GRID']);
    await act(async () => { entry('Repeat FILLET').click(); });
    expect(state.tool).toBe('fillet');
    // A prompt without options: right-click is Enter, Shift+right-click the command menu.
    await command('');
    await command('L');
    await right(X + 20000, 20000, true);
    expect(labels()).toContain('Snap overrides');
  });

  it('dynamic input: a number typed goes to the length box at the cursor, Tab to the angle, Enter places the point; F12 turns it off', async () => {
    await start();
    const box = (name: string) => document.querySelector(`.cad-dyn input[aria-label="${name}"]`) as HTMLInputElement | null;
    const type = (el: HTMLInputElement, text: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await command('L');
    await hover(X, 9000);
    expect(document.querySelector('.cad-dyn-prompt')!.textContent).toBe('Specify first point');
    expect(box('Length')).toBeNull();
    await clickAt(X, 10000);
    expect(box('Length')!.placeholder).toBe('0.00');
    expect(document.querySelector('.cad-status button[aria-pressed="true"][title^="DYN (F12)"]')).not.toBeNull();
    key('3');
    expect(document.activeElement).toBe(box('Length'));
    type(box('Length')!, '3');
    key('Tab', box('Length')!);
    expect(document.activeElement).toBe(box('Angle'));
    type(box('Angle')!, '90');
    await act(async () => { box('Angle')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(items()[2].pts.map((q) => q.map((v) => Math.round(v)))).toEqual([[X, 10000], [X, 13000]]);
    key('F12');
    expect(state.toggles.dyn).toBe(false);
    expect(document.querySelector('.cad-dyn')).toBeNull();
    key('F12');
    expect(document.querySelector('.cad-dyn')).not.toBeNull();
  });

  it('dynamic input: Offset asks its distance at the cursor; Down in the box opens the prompt options', async () => {
    await start();
    await command('O');
    await hover(X + 20000, 20000);
    const box = document.querySelector('.cad-dyn input[aria-label="Distance"]') as HTMLInputElement;
    expect(box.placeholder).toBe('0.30');
    expect(document.querySelector('.cad-dyn-prompt')!.textContent).toBe('Specify offset distance ↓');
    key('ArrowDown'); // on the drawing: it pans, as before
    expect(document.querySelector('.cad-dyn-menu')).toBeNull();
    act(() => box.focus());
    key('ArrowDown', box);
    expect([...document.querySelectorAll('.cad-dyn-menu button')].map((b) => b.textContent)).toEqual(['Through T', 'Erase E', 'Layer L']);
    key('ArrowDown', box);
    key('Enter', box);
    expect(hist()).toBe('OFFSET  Specify offset distance or [Through/Erase/Layer] <0.30>:');
    expect(earlier()[2]).toBe('OFFSET  Erase source after offsetting: Yes');
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, '0.5'); box.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(hist()).toBe('OFFSET  Select object to offset or [Exit]:');
    expect((document.querySelector('.cad-dyn input[aria-label="Distance"]') as HTMLInputElement).placeholder).toBe('0.50');
  });

  it('edit dialogs: a value changed in the Offset dialog is used at once and shows in the prompt; the command line\'s shows in it; Esc puts back', async () => {
    await start();
    const dlg = () => document.querySelector('[role="dialog"][aria-label="Offset"]') as HTMLElement | null;
    const field = (name: string) => dlg()!.querySelector(`[aria-label="${name}"]`) as HTMLInputElement;
    const type = (el: HTMLInputElement, text: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); });
    await command('O');
    expect(dlg()!.textContent).toMatch(/^OffsetO×DistancemThrough pointErase sourceLayer/);
    expect(document.querySelector('.cad-side')!.textContent).not.toContain('Click the object, then the side'); // the help moved behind ?
    type(field('Distance'), '0.');
    type(field('Distance'), '0.6');
    expect(hist()).toBe('Command: OFFSET  Specify offset distance or [Through/Erase/Layer] <0.60>:'); // at once, with no OK
    act(() => { field('Erase source').click(); });
    await command(''); // Enter takes the 0.60
    expect(hist()).toBe('OFFSET  Select object to offset or [Exit]:');
    expect(dlg()).not.toBeNull();
    await clickAt(X + 2000, 0);
    await clickAt(X + 2000, 1000);
    expect(last()).toBe('OFFSET  Line moved 0.60 m to the side · ⌘Z to undo');
    await command('0.4'); // the command line's value shows in the dialog; the others stay
    expect(field('Distance').value).toBe('0.4');
    expect(field('Erase source').checked).toBe(true);
    type(field('Distance'), '0.9');
    await act(async () => { field('Distance').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(dlg()).toBeNull();
    expect(state.tool).toBe('offset'); // Esc in the dialog closes only the dialog
    await command('');
    await command('O'); // the dialog again: Esc put back what was changed in it (the 0.4 was the command line's)
    expect(field('Distance').value).toBe('0.4');
    expect(field('Erase source').checked).toBe(false);
    await act(async () => { (dlg()!.querySelector('[aria-label="Help"]') as HTMLButtonElement).click(); });
    expect(dlg()!.textContent).toContain('Click the object, then the side for the copy');
    type(field('Distance'), '0.5');
    await act(async () => { field('Distance').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(dlg()).toBeNull(); // Enter closes, keeping it
    expect(hist()).toBe('Command: OFFSET  Specify offset distance or [Through/Erase/Layer] <0.50>:');
  });

  it('edit dialogs: moved by the title, they keep their place; Array has Rectangular and Polar tabs with a count', async () => {
    await start();
    await command('AR');
    const dlg = () => document.querySelector('[role="dialog"][aria-label="Array"]') as HTMLElement;
    expect(dlg().style.left).toBe('12px');
    const title = dlg().querySelector('.cad-dlg-t')!;
    await act(async () => {
      title.dispatchEvent(new MouseEvent('pointerdown', { clientX: 20, clientY: 20, bubbles: true }));
      title.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 70, bubbles: true }));
      title.dispatchEvent(new MouseEvent('pointerup', { clientX: 120, clientY: 70, bubbles: true }));
    });
    expect([dlg().style.left, dlg().style.top]).toEqual(['112px', '62px']);
    expect(dlg().querySelector('.cad-dlg-prev')!.textContent).toBe('2 × 3 = 6 in all');
    await act(async () => { [...dlg().querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Polar')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(dlg().textContent).toContain('Rotate items');
    expect(dlg().querySelector('.cad-dlg-prev')!.textContent).toBe('6 in all');
    await act(async () => { (dlg().querySelector('.cad-dlg-ft .p') as HTMLButtonElement).click(); });
    key('Escape');
    await command('AR');
    expect([dlg().style.left, dlg().style.top]).toEqual(['112px', '62px']);
    expect(dlg().querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Polar');
  });

  it('STYLE: a new text style set current, kept in the project; TEXT then takes its height without asking', async () => {
    await start();
    await command('STYLE');
    const dlg = () => document.querySelector('[role="dialog"][aria-label="Text style"]') as HTMLElement | null;
    expect(dlg()!.querySelector('[aria-label="Styles"]')!.textContent).toBe('Standardcurrent');
    expect([...dlg()!.querySelectorAll('[aria-label="Font"] option')].map((o) => o.textContent)).toEqual(['Arial']);
    const btn = (t: string) => [...dlg()!.querySelectorAll('button')].find((b) => b.textContent === t) as HTMLButtonElement;
    await act(async () => { btn('Delete').click(); });
    expect(dlg()!.textContent).toContain('Standard cannot be deleted.');
    await act(async () => { btn('New').click(); });
    const h = dlg()!.querySelector('[aria-label="Height"]') as HTMLInputElement;
    for (const t of ['2', '2.', '2.5']) act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(h, t); h.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(h.value).toBe('2.5'); // typed one key at a time, kept as typed
    await act(async () => { btn('Set current').click(); });
    await act(async () => { btn('OK').click(); });
    expect(dlg()).toBeNull();
    expect(project.cadTextStyles).toEqual({ styles: [{ name: 'Style 1', font: 'Arial', heightMm: 2.5 }], current: 'Style 1' }); // Standard unchanged: not kept
    expect(last()).toBe('STYLE  2 text styles, current "Style 1" · ⌘Z to undo');
    await command('T');
    await clickAt(X, 0);
    expect(hist()).toBe('TEXT  Specify rotation angle <0>:');
    await command('');
    await command('NOTE');
    expect(items()[2]).toMatchObject({ kind: 'text', text: 'NOTE', h: 250 });
  });

  it('DLI, DCO and DBA: a horizontal dimension of two points on a slope, a chain in line with it, then one stepped out', async () => {
    await start();
    await command('DCO');
    await clickAt(X, 20000);
    expect(hist()).toBe('DIMCONTINUE  No dimension on this drawing to go on from: draw one first (DIM or DLI).');
    await command('DLI');
    await clickAt(X, 10000); await clickAt(X + 3000, 11000); await clickAt(X + 1500, 13000);
    expect(items()[2]).toMatchObject({ kind: 'dim', layer: 'LV-ANNO', dir: 0, text: '3.00' });
    expect(last()).toContain('Linear dimension');
    expect(dimMeasure(items()[2])).toBeCloseTo(3000, 3);
    await command('DCO');
    await clickAt(X + 5000, 10500);
    expect(items()[3]).toMatchObject({ kind: 'dim', dir: 0, text: '2.00' });
    expect(items()[3].pts.slice(0, 2)).toEqual([[X + 3000, 11000], [X + 5000, 10500]]);
    expect(items()[3].pts[2][1]).toBeCloseTo(13000, 3); // in line with the first
    await clickAt(X + 6000, 10500); // goes on from the one just drawn
    expect(items()[4].pts[0]).toEqual([X + 5000, 10500]);
    expect(hist()).toBe('DIMCONTINUE  Specify second extension line origin (from the last dimension):');
    await command('DBA');
    await clickAt(X + 8000, 10000);
    expect(items()[5].pts[0]).toEqual([X + 5000, 10500]); // from the last one's first point
    expect(items()[5].text).toBe('3.00');
    expect(items()[5].pts[2][1]).toBeGreaterThan(13000); // one step further out
  });

  it('DIMSTYLE: closed arrows and mm with no decimals for the dimensions drawn next; older ones keep their look', async () => {
    await start();
    await command('DIM');
    await clickAt(X, 10000); await clickAt(X + 3000, 10000); await clickAt(X + 1500, 11000);
    expect(items()[2].look).toBeUndefined();
    await command('D');
    const dlg = () => document.querySelector('[role="dialog"][aria-label="Dimension style"]') as HTMLElement;
    const pick = (name: string, v: string) => act(() => { const el = dlg().querySelector(`[aria-label="${name}"]`) as HTMLSelectElement | HTMLInputElement; Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, v); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
    const ok = () => act(async () => { (dlg().querySelector('.cad-dlg-ft .p') as HTMLButtonElement).click(); });
    expect(dlg().querySelector('[role="note"]')!.textContent).toBe('Standard draws as before (sizes follow each dimension\'s length) until it is changed.');
    const changes = onChange.mock.calls.length;
    await ok(); // nothing changed: nothing kept, the dimensions draw as before
    expect(onChange.mock.calls).toHaveLength(changes);
    expect(project.cadDimStyles).toBeUndefined();
    expect(hist()).toBe('DIMSTYLE  No change.');
    await command('D');
    pick('Arrow', 'closed');
    act(() => { (dlg().querySelector('[role="tab"]:nth-child(3)') as HTMLButtonElement).click(); }); // Units
    pick('Unit', 'mm'); pick('Decimal places', '0');
    expect(dlg().querySelector('[role="note"]')).toBeNull();
    await ok();
    expect(project.cadDimStyles!.styles[0]).toMatchObject({ name: 'Standard', arrow: 'closed', unit: 'mm', decimals: 0 });
    await command('DIM');
    await clickAt(X, 12000); await clickAt(X + 3000, 12000); await clickAt(X + 1500, 13000);
    expect(items()[3]).toMatchObject({ kind: 'dim', look: { arrow: 'closed', size: 250, unit: 'mm', decimals: 0 }, h: 200 });
    expect(items()[3].text).toBeUndefined(); // measured wherever it is drawn or saved
    expect(dimLabel(items()[3], 0.001)).toBe('3000');
    expect(items()[2].look).toBeUndefined();
  });

  it('edit dialogs come back in view when the place they kept is off the window', async () => {
    localStorage.setItem('lvds.cad.dlg.scale', JSON.stringify({ left: 5000, top: -40 }));
    await start();
    await command('SC');
    const d = document.querySelector('[role="dialog"][aria-label="Scale"]') as HTMLElement;
    expect([d.style.left, d.style.top]).toEqual([`${window.innerWidth - 240}px`, '0px']);
  });

  it('Space held to pan does not end the step; tapped it does; held long with no tool it does not repeat', async () => {
    await start();
    await command('PL');
    await clickAt(X, 10000);
    await clickAt(X + 2000, 10000);
    act(() => { (document.querySelector('input[aria-label="Command"]') as HTMLInputElement).blur(); });
    const c = document.querySelector('canvas.cad-over')!, [sx, sy] = screenOf(X + 1000, 10000);
    key(' ', window, { code: 'Space' });
    await act(async () => {
      c.dispatchEvent(new MouseEvent('mousedown', { clientX: sx, clientY: sy, button: 0, bubbles: true }));
      c.dispatchEvent(new MouseEvent('mousemove', { clientX: sx + 40, clientY: sy + 20, bubbles: true }));
      c.dispatchEvent(new MouseEvent('mouseup', { clientX: sx + 40, clientY: sy + 20, button: 0, bubbles: true }));
    });
    keyUp(' ');
    expect(items()).toHaveLength(2); // the polyline goes on (the view was panned)
    await command('@0,2000');
    tap(' ');
    expect(items()[2]).toMatchObject({ kind: 'pline', pts: [[X, 10000], [X + 2000, 10000], [X + 2000, 12000]] });
    act(() => state.setTool('none'));
    await command('GRID');
    expect([state.toggles.grid, state.gridDots]).toEqual([true, true]); // the grid starts on: lines → dots
    act(() => { (document.querySelector('input[aria-label="Command"]') as HTMLInputElement).blur(); });
    key(' ', window, { code: 'Space' });
    key(' ', window, { code: 'Space', repeat: true });
    key(' ', window, { code: 'Space', repeat: true });
    keyUp(' ');
    expect(state.toggles.grid).toBe(true); // held: not a repeat of GRID
    tap(' ');
    expect([state.toggles.grid, state.gridDots]).toEqual([false, false]);
  });

  it('Esc with the right-click menu open closes the menu only; Enter in a dialog over the page is the dialog\'s', async () => {
    await start();
    await command('PL');
    await clickAt(X, 10000);
    await clickAt(X + 2000, 10000);
    const [sx, sy] = screenOf(X + 20000, 20000);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); });
    expect(document.querySelector('[aria-label="Command menu"]')).not.toBeNull();
    key('Escape');
    expect(document.querySelector('[aria-label="Command menu"]')).toBeNull();
    expect(hist()).toBe('PLINE  Specify next point or [Close], Enter to finish:'); // not cancelled
    await command('XR'); // the references dialog over the page
    const dlg = document.querySelector('[aria-label="References"]') as HTMLElement;
    key('Enter', dlg);
    tap(' ', dlg);
    expect(items()).toHaveLength(2); // the polyline behind it goes on
    key('Escape', dlg);
    expect(document.querySelector('[aria-label="References"]')).toBeNull();
    expect(state.tool).toBe('pline');
    await clickAt(X + 2000, 12000);
    key('Enter');
    expect(items()[2]).toMatchObject({ kind: 'pline', pts: [[X, 10000], [X + 2000, 10000], [X + 2000, 12000]] });
  });

  it('Enter and Space on a row of the layer palette, or on the properties palette, are the palette\'s', async () => {
    await start();
    await command('PL');
    await clickAt(X, 10000);
    await clickAt(X + 2000, 10000);
    await command('LM');
    await until(() => !!document.querySelector('[aria-label="Layer palette"]'));
    const row = document.querySelector('[aria-label="Layer palette"] .cad-lp-name') as HTMLElement;
    key('Enter', row);
    tap(' ', row);
    expect(items()).toHaveLength(2); // the polyline goes on
    const props = document.querySelector('[aria-label="Properties palette"]') as HTMLElement;
    key('Enter', props);
    tap(' ', props);
    expect(items()).toHaveLength(2); // nor on the properties palette
    expect(state.tool).toBe('pline');
    await clickAt(X + 2000, 12000);
    key('Enter');
    expect(items()[2]).toMatchObject({ kind: 'pline', pts: [[X, 10000], [X + 2000, 10000], [X + 2000, 12000]] });
  });

  it('F1 and F2 not with Ctrl or ⌘, nor in another field; Space takes the command picked in the list', async () => {
    await start();
    key('F1', window, { ctrlKey: true });
    key('F1', window, { metaKey: true });
    key('F2', document.querySelector('select[aria-label="Sample floor"]')!);
    expect(document.querySelector('.cad-log')).toBeNull();
    const input = document.querySelector('input[aria-label="Command"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'OF'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    key('ArrowDown', input);
    expect(document.querySelector('[aria-label="Matching commands"] [aria-selected="true"]')!.textContent).toMatch(/^OFFSET/);
    key(' ', input);
    expect(state.tool).toBe('offset');
  });

  it('TEXT: at the height and rotation a word typed gets its space; a number takes Space as Enter', async () => {
    await start();
    const input = document.querySelector('input[aria-label="Command"]') as HTMLInputElement;
    const type = (text: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
    const space = () => { const e = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }); act(() => { input.dispatchEvent(e); }); return e.defaultPrevented; };
    await command('T');
    await clickAt(X, 0);
    type('DB');
    expect(space()).toBe(false); // the space is typed
    expect(items()).toHaveLength(2);
    type('5');
    expect(space()).toBe(true);
    expect(hist()).toBe('TEXT  Specify rotation angle <0>:');
    type('DB');
    expect(space()).toBe(false);
    await command('DB ROOM');
    expect(items()[2]).toMatchObject({ kind: 'text', text: 'DB ROOM', h: 500 });
  });

  it('Offset with Erase moves a cable route: it stays the route of its circuit, on its layer', async () => {
    const route: Project = { ...two, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [{ id: 'C1', kind: 'pline', layer: 'E-CABLE', pts: [[X, 0], [X + 4000, 0]], cable: { feederId: 'DB-GF1-Y1' } }] }] };
    await start(route);
    await command('O');
    await command('E');
    await command('L'); // Layer: current — the route keeps its own
    await command('');
    await clickAt(X + 2000, 0);
    await clickAt(X + 2000, 1000);
    expect(items()).toEqual([{ id: 'C1', kind: 'pline', layer: 'E-CABLE', pts: [[X, 300], [X + 4000, 300]], cable: { feederId: 'DB-GF1-Y1' } }]);
    expect(last()).toBe('OFFSET  Cable route moved 0.30 m to the side · ⌘Z to undo');
  });

  it('numbers typed: 0 goes to the box with a tool running (it fits the view only with none); ".5" is 0.5; a point typed in a box works', async () => {
    await start();
    const zero = () => { const e = new KeyboardEvent('keydown', { key: '0', bubbles: true, cancelable: true }); act(() => { window.dispatchEvent(e); }); return e.defaultPrevented; };
    const input = document.querySelector('input[aria-label="Command"]') as HTMLInputElement;
    act(() => input.blur());
    expect(zero()).toBe(true); // no tool: the view fits
    expect(document.activeElement).not.toBe(input);
    await command('O');
    await hover(X + 20000, 20000);
    act(() => input.blur());
    expect(zero()).toBe(false); // typed, not a fit
    expect(document.activeElement).toBe(document.querySelector('.cad-dyn input[aria-label="Distance"]'));
    await command('.5');
    expect(earlier()[2]).toBe('OFFSET  Distance 0.50 m');
    expect((document.querySelector('.cad-dyn input[aria-label="Distance"]') as HTMLInputElement).placeholder).toBe('0.50');
    await command('');
    act(() => state.setTool('none'));
    await command('L');
    await clickAt(X, 10000);
    const len = document.querySelector('.cad-dyn input[aria-label="Length"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(len, '@0,2000'); len.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { len.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(items()[2].pts.map((q) => q.map((v) => Math.round(v)))).toEqual([[X, 10000], [X, 12000]]); // drawing units, as on the command line
    const len2 = document.querySelector('.cad-dyn input[aria-label="Length"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(len2, '3,'); len2.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { len2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(hist()).toBe('  3,: type a point as x,y, @dx,dy or @distance<angle (drawing units), or a length in metres.');
  });
});


describe('Design CAD File: Save, Save As, Close and Drafting settings', () => {
  const dialog = (name: string) => document.querySelector(`[role="dialog"][aria-label="${name}"]`) as HTMLElement | null;
  const press = async (d: HTMLElement, label: string) => { const b = [...d.querySelectorAll('button')].find((x) => x.textContent === label) as HTMLButtonElement; expect(b, label).toBeTruthy(); await act(async () => { b.click(); }); await flush(); };
  const set = (el: HTMLInputElement | HTMLSelectElement, value: string) => act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
  const tick = (d: HTMLElement, label: string) => act(() => { (d.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement).click(); });
  const dirtyMark = () => document.querySelector('.cad-tab-dirty');

  it('Save the first time is Save As (name, format and version); after that Save writes over that copy, keeping a .bak', async () => {
    const saveBinary = vi.fn(async () => '/plans/villa-copy.dxf');
    const overwriteBinary = vi.fn(async ({ file }: { file: string }) => file);
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary, overwriteBinary };
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('rec');
    await clickAt(6000, 6000);
    await clickAt(9000, 8000);
    expect(dirtyMark()).not.toBeNull(); // changed since saved: ● on its tab
    await command('save');
    const d = dialog('Save As')!;
    expect(d.closest('.cad-work')).not.toBeNull();
    expect((d.querySelector('input[aria-label="File name"]') as HTMLInputElement).value).toBe('sample-villa-gf - with devices');
    set(d.querySelector('input[aria-label="File name"]') as HTMLInputElement, 'villa-copy');
    set(d.querySelector('select[aria-label="Format"]') as HTMLSelectElement, 'dxf:R12');
    await press(d, 'Save');
    const first = (saveBinary.mock.calls[0] as unknown as [{ defaultName: string; bytes: Uint8Array }])[0];
    expect(first.defaultName).toBe('villa-copy.dxf');
    expect(new TextDecoder().decode(first.bytes)).toContain('AC1009');
    expect(dirtyMark()).toBeNull();
    await command('rec');
    await clickAt(6500, 6500);
    await clickAt(8000, 7000);
    expect(dirtyMark()).not.toBeNull();
    await command('save');
    await flush();
    expect(dialog('Save As')).toBeNull();
    expect(saveBinary).toHaveBeenCalledTimes(1);
    expect(overwriteBinary).toHaveBeenCalledTimes(1);
    const again = (overwriteBinary.mock.calls[0] as unknown as [{ file: string; bytes: Uint8Array; bak: boolean }])[0];
    expect([again.file, again.bak]).toEqual(['/plans/villa-copy.dxf', true]);
    expect(new TextDecoder().decode(again.bytes)).toContain('AC1009'); // the same version again
    expect(dirtyMark()).toBeNull();
  });

  it('Close asks first when the drawing changed since saved: Cancel keeps it, Don\'t save closes it', async () => {
    act(() => root.render(<Host />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('l');
    await clickAt(6000, 6000);
    await clickAt(9000, 6000);
    await command('');
    await command('close');
    const d = dialog('Close sample-villa-gf.dxf')!;
    expect(d.closest('.cad-work')).not.toBeNull();
    expect(d.textContent).toContain('changes since last saved');
    await press(d, 'Cancel');
    expect(state.view?.file).toBe('sample-villa-gf.dxf');
    await command('close');
    await press(dialog('Close sample-villa-gf.dxf')!, "Don't save");
    expect(state.view).toBeNull();
  });

  it('DS opens the Drafting settings at a tab; OK changes the toggles and the settings, Cancel nothing', async () => {
    act(() => root.render(<Host />));
    await flush();
    await command('OS');
    let d = dialog('Drafting settings')!;
    expect(d.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Object snap');
    expect(d.closest('.cad-work'), 'over the drawing, not under the ribbon').not.toBeNull();
    tick(d, '⊥  Perpendicular');
    await press(d, 'Cancel');
    expect(onPrefs).not.toHaveBeenCalled();
    await command('DS');
    d = dialog('Drafting settings')!;
    await act(async () => { ([...d.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Polar tracking') as HTMLButtonElement).click(); });
    tick(d, 'Polar tracking on');
    set(d.querySelector('select[aria-label="Increment angle"]') as HTMLSelectElement, '30');
    set(d.querySelector('input[aria-label="Extra angles"]') as HTMLInputElement, '15, 400');
    await act(async () => { ([...d.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Cursor') as HTMLButtonElement).click(); });
    set(d.querySelector('input[aria-label="Snap aperture"]') as HTMLInputElement, '14');
    set(d.querySelector('select[aria-label="Crosshair colour"]') as HTMLSelectElement, 'accent');
    tick(d, 'Outline the cursor');
    await act(async () => { ([...d.querySelectorAll('[role="tab"]')].find((t) => t.textContent === 'Selection') as HTMLButtonElement).click(); });
    tick(d, 'Highlight what is under the pick box');
    tick(d, 'Name tag after a pause');
    await press(d, 'OK');
    expect(dialog('Drafting settings')).toBeNull();
    expect(state.toggles.polar).toBe(true);
    expect(onPrefs.mock.calls[0][0].draft).toMatchObject({ polarInc: 30, polarExtra: [15], aperturePx: 14, crossColor: 'accent', cursorOutline: false, hoverMark: false, hoverTag: true });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })); });
    expect([state.toggles.ortho, state.toggles.polar]).toEqual([true, false]); // ORTHO and POLAR turn each other off
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F11' })); });
    expect(state.toggles.otrack).toBe(true);
    // Right-click on a status-bar toggle: its settings.
    await act(async () => { document.querySelector('.cad-status button[title^="Grid:"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    expect(dialog('Drafting settings')!.querySelector('[role="tab"][aria-selected="true"]')!.textContent).toBe('Snap & grid');
  });

  it('WBLOCK saves the objects picked as a DXF of their own; with none picked it says what to do', async () => {
    const saveBinary = vi.fn(async () => '/plans/objects.dxf');
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary };
    act(() => root.render(<Host />));
    await flush();
    await command('WBLOCK');
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/WBLOCK {2}Pick the drawn objects/);
    act(() => state.toggle('osnap'));
    await command('rec');
    await clickAt(6000, 6000);
    await clickAt(9000, 8000);
    act(() => state.setTool('none'));
    await dragWindow([5000, 5000], [10000, 9000]);
    await command('WBLOCK');
    await flush();
    await until(() => saveBinary.mock.calls.length > 0);
    const out = (saveBinary.mock.calls[0] as unknown as [{ defaultName: string; bytes: Uint8Array }])[0];
    expect(out.defaultName).toBe('sample-villa-gf - objects.dxf');
    const back = await openDrawing('objects.dxf', out.bytes);
    expect(back.info.layers.find((l) => l.name === 'LV-SKETCH')?.count).toBe(4);
    expect(back.info.segments).toBe(4);
  });
});

describe('Design CAD properties dock', () => {
  const dock = () => document.querySelector('.cad-dock') as HTMLElement;
  const head = () => document.querySelector('.cad-dock-h')?.textContent ?? '';
  const info = () => document.querySelector('.cad-info') as HTMLElement;
  const press = (label: string) => act(() => { (document.querySelector(`.cad-dock button[aria-label="${label}"]`) as HTMLButtonElement).click(); });

  it('stands left of the drawing and shows what is picked: nothing, the architect\'s object, a device', async () => {
    act(() => root.render(<Host />));
    await flush();
    expect(document.querySelector('.cad-work')!.firstElementChild).toBe(dock());
    expect(dock().className).toContain('left');
    expect(head()).toContain('No selection');
    expect(document.querySelector('.cad-work')!.lastElementChild).toBe(info()); // the drawing in its own column
    expect(info().textContent).toContain('sample-villa-gf.dxf');
    expect(info().textContent).toContain('Layers');
    expect(dock().textContent).not.toContain('sample-villa-gf.dxf'); // not mixed into the properties
    expect(dock().textContent).not.toContain('All on');
    expect(dock().querySelector('[aria-label="Properties palette"]')).not.toBeNull(); // defaults for new objects
    await clickAt(6687.5 + 190, 7375); // the architect's light block
    expect(head()).toContain('Block · L1');
    expect(dock().textContent).toMatch(/LayerE-LIGHT/);
    expect(dock().querySelector('[aria-label="Properties palette"]')).toBeNull(); // nothing of it to edit
    act(() => state.toggle('osnap'));
    act(() => { state.setDevice('camera'); state.setTool('dev'); });
    await clickAt(5000, 5000);
    act(() => state.setTool('none'));
    await clickAt(5000, 5000);
    expect(head()).toMatch(/Camera/i);
    expect(dock().textContent).toMatch(/Room/);
    expect(dock().textContent).toMatch(/Position/);
  });

  it('folds to a strip and opens again; docks on the right and remembers it', async () => {
    act(() => root.render(<Host />));
    await flush();
    press('Fold the properties palette');
    expect(dock().className).toContain('folded');
    press('Show the properties palette');
    expect(dock().className).not.toContain('folded');
    press('Dock on the right');
    expect(document.querySelector('.cad-work')!.lastElementChild).toBe(dock());
    expect(document.querySelector('.cad-work')!.firstElementChild).toBe(info()); // the drawing column swaps over
    expect(JSON.parse(localStorage.getItem('lvds.cad.dock')!)).toMatchObject({ side: 'right' });
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<Host />));
    await flush();
    expect(dock().className).toContain('right');
  });
});

describe('title block drawing (Project → Title block → Edit in CAD)', () => {
  const drawn: TitleTemplate = {
    id: 'tb-d', name: 'ACME', kind: 'drawn', cols: [], rows: [], cells: [], size: { w: 180, h: 44 },
    shapes: [{ kind: 'line', x1: 0, y1: 0, x2: 180, y2: 0 }, { kind: 'line', x1: 0, y1: 44, x2: 180, y2: 44 }, { kind: 'line', x1: 0, y1: 0, x2: 0, y2: 44 }, { kind: 'line', x1: 180, y1: 0, x2: 180, y2: 44 }],
    texts: [{ id: 't1', x: 5, y: 40, h: 2.5, text: 'ACME CONSULTANTS' }, { id: 't2', x: 100, y: 40, h: 3.5, text: '{SheetNo}', tag: 'DWG_NO' }]
  };
  it('opens the block at 1 : 1 mm, places a field from the palette at a click, and TBSAVE writes the drawing back into the template', async () => {
    const r = openTitleBlockInCad({ ...villa, titleTemplates: [drawn] }, drawn);
    act(() => root.render(<Host start={r.project} />));
    await flush();
    const v = await openDrawing(r.file, new TextEncoder().encode(r.dxf));
    act(() => state.open(v));
    await flush();
    expect(state.view?.file).toBe(r.file);
    expect(state.view?.info.units).toBe(4);
    await until(() => !!button('Save as template'));
    // A field chip starts the text tool with the field preset; the next click places it on TB-FIELD at 2.5 mm.
    const chip = [...document.querySelectorAll('button')].find((b) => b.textContent === '{Rev}')!;
    await act(async () => { chip.click(); });
    expect(state.tool).toBe('text');
    await clickAt(300, 30);
    await flush();
    const p1 = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Project;
    const placed = sketchOf(p1, r.file).find((it) => it.text === '{Rev}');
    expect(placed).toMatchObject({ kind: 'text', layer: TB_LAYERS.field, h: 2.5 });
    expect(placed!.pts[0].map(Math.round)).toEqual([300, 30]);
    // Back into the template: its size from the drawn outline, the new field among its texts.
    await command('TBSAVE');
    await flush();
    const p2 = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Project;
    const saved = p2.titleTemplates!.find((t) => t.id === 'tb-d')!;
    expect(saved.size).toEqual({ w: 180, h: 44 });
    expect(saved.texts!.map((t) => t.text).sort()).toEqual(['ACME CONSULTANTS', '{Rev}', '{SheetNo}']);
    expect(saved.texts!.find((t) => t.text === '{SheetNo}')).toMatchObject({ tag: 'DWG_NO' });
    expect(saved.texts!.find((t) => t.text === '{Rev}')).toMatchObject({ x: 90, y: 14, h: 2.5 });
  });
});

describe('clipboard of drawn objects', () => {
  const GF = 'sample-villa-gf.dxf', X = 200000;
  const start: Project = { ...villa, cadSketch: [{ file: GF, items: [
    { id: 'S1', kind: 'line', layer: 'LV-SKETCH', pts: [[X, 0], [X + 4000, 0]] },
    { id: 'S2', kind: 'circle', layer: 'E-POWER', pts: [[X + 2000, 1000]], r: 500 }
  ] }], cadLayerStyle: { [GF]: { 'E-POWER': { color: '1', lw: 0.35 } } } };
  const key = (k: string, mods: KeyboardEventInit = {}, on: Element = document.body) => act(() => { on.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...mods })); });
  const said = () => state.history[state.history.length - 1];
  const tabOf = (name: string) => [...document.querySelectorAll('.cad-tab')].find((t) => t.textContent?.includes(name))!.querySelector('[role="tab"]') as HTMLButtonElement;
  beforeEach(() => clearClip());

  it('Ctrl+C copies the drawn objects picked; Ctrl+V pastes them into another drawing in one change, with the layer and its style', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    await key('v');
    expect(said()).toBe('PASTECLIP  Nothing copied yet: pick drawn objects and press Ctrl+C.');
    await key('c');
    expect(said()).not.toMatch(/COPYCLIP/); // nothing picked: the page's own text copy
    await dragWindow([X - 600, -600], [X + 4600, 1600]);
    await key('c');
    expect(said()).toBe('COPYCLIP  2 objects copied');
    await act(async () => { (document.querySelector('.cad-tab-add') as HTMLButtonElement).click(); });
    await flush();
    expect(state.view?.file).toBe('plan.dwg');
    const calls = onChange.mock.calls.length;
    await key('v');
    expect(said()).toContain('PASTECLIP  Specify insertion point:');
    const [x0, y0, x1, y1] = state.view!.info.extents;
    await clickAt((x0 + x1) / 2, (y0 + y1) / 2);
    expect(onChange.mock.calls.length).toBe(calls + 1);
    expect(onChange.mock.calls[calls][1]).toMatch(/^PASTECLIP {2}2 objects pasted · layer E-POWER added · ⌘Z to undo$/);
    const pasted = sketchOf(project, 'plan.dwg');
    expect(pasted.map((x) => x.kind)).toEqual(['line', 'circle']);
    expect(new Set([...sketchOf(project, GF), ...pasted].map((x) => x.id)).size).toBe(4);
    expect(project.cadLayerStyle?.['plan.dwg']?.['E-POWER']).toEqual({ color: '1', lw: 0.35 });
    // PASTEORIG: the same coordinates, here as it is another drawing; refused in the drawing they came from.
    await command('pasteorig');
    expect(sketchOf(project, 'plan.dwg')).toHaveLength(4);
    await act(async () => { tabOf(GF).click(); });
    await flush();
    await command('pasteorig');
    expect(said()).toBe('PASTEORIG  Not in the drawing the objects came from — use PASTECLIP.');
    expect(sketchOf(project, GF)).toHaveLength(2);
  });

  it('Ctrl+Shift+C asks for the base point; Ctrl+V in the command line is the field\'s own', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    await dragWindow([X - 600, -600], [X + 4600, 1600]);
    await key('C', { shiftKey: true });
    expect(said()).toContain('COPYBASE  Specify base point:');
    await clickAt(X, 0);
    expect(state.history).toContain('COPYBASE  2 objects copied');
    const input = document.querySelector('input[aria-label="Command"]')!;
    await key('v', {}, input);
    expect(state.tool).toBe('none');
    await key('v');
    expect(state.tool).toBe('paste');
    const calls = onChange.mock.calls.length;
    await clickAt(X + 10000, 5000);
    expect(onChange.mock.calls.length).toBe(calls + 1);
    const line = sketchOf(project, GF).filter((x) => x.kind === 'line')[1];
    expect(line.pts[0][0]).toBeCloseTo(X + 10000, -1);
    expect(line.pts[1][0] - line.pts[0][0]).toBeCloseTo(4000, 6);
  });
});

describe('CAD 2D gap plan: zoom, quick select and radial / angular dimensions', () => {
  const last = () => state.history[state.history.length - 1];
  const rest = () => act(async () => { await new Promise((r) => setTimeout(r, 450)); });
  const chip = () => document.querySelector('.zoom-chip')!.textContent;
  const setSelect = (label: string, value: string) => act(() => {
    const el = document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const X = 200000, F = 'sample-villa-gf.dxf';

  it('ZOOM Window, Scale and Previous move the view; the zoom chip shows the zoom and opens the menu', async () => {
    act(() => root.render(<Host />));
    await flush();
    expect(chip()).toBe('100 %');
    await rest(); // the fitted view goes into the history once it rests
    await command('z');
    expect(last()).toContain('ZOOM  [Window/Previous/Scale/Extents] <Window>:');
    await command('w');
    expect(last()).toContain('ZOOM  First corner:');
    const [x0, y0, x1, y1] = state.view!.info.extents, w = x1 - x0, h = y1 - y0;
    await command(`${x0 + w / 4},${y0 + h / 4}`);
    expect(last()).toContain('ZOOM  Opposite corner:');
    await command(`${x0 + w / 2},${y0 + h / 2}`);
    // A quarter of the drawing fills the view: 4 × the fit (which keeps a 0.92 margin).
    await until(() => chip() === '435 %');
    expect(state.tool).toBe('none');
    await rest();
    await command('z s');
    expect(last()).toContain('ZOOM  Scale factor (2, 0.5 or 2x):');
    await command('abc');
    expect(last()).toContain('A factor such as');
    await command('2x');
    await until(() => chip() === '870 %');
    await rest();
    await command('zoom scale');
    await command('2'); // of the whole drawing
    await until(() => chip() === '200 %');
    await rest();
    await command('z p');
    await until(() => chip() === '870 %');
    await rest();
    // The chip's menu: ▾ opens it, Previous steps back again.
    act(() => (document.querySelector('[aria-label="Zoom menu"]') as HTMLButtonElement).click());
    expect([...document.querySelectorAll('.zoom-chip-menu [role="menuitem"]')].map((b) => b.textContent)).toEqual(['WindowZ W', 'PreviousZ P', 'Scale…Z S', 'ExtentsZE']);
    act(() => (document.querySelector('.zoom-chip-menu [role="menuitem"]:nth-child(2)') as HTMLButtonElement).click());
    await until(() => chip() === '435 %');
    await rest();
    await command('z p');
    await until(() => chip() === '100 %');
    await rest();
    await command('z p');
    expect(last()).toContain('ZOOM  No previous view');
    // A window dragged: the same.
    await command('z w');
    await dragWindow([x0 + w / 4, y0 + h / 4], [x0 + w / 2, y0 + h / 2]);
    await until(() => chip() === '435 %');
  });

  it('QSELECT picks drawn objects by kind, layer and a measure through its dialog; SELECTSIMILAR those like the ones picked', async () => {
    const start: Project = { ...villa, cadSketch: [{ file: F, items: [
      { id: 'S1', kind: 'line', layer: 'LV-SKETCH', pts: [[X, 0], [X + 1000, 0]] },
      { id: 'S2', kind: 'line', layer: 'LV-SKETCH', pts: [[X, 500], [X + 2000, 500]] },
      { id: 'S3', kind: 'line', layer: 'LV-ANNO', pts: [[X, 1000], [X + 1000, 1000]] },
      { id: 'C1', kind: 'circle', layer: 'LV-SKETCH', pts: [[X + 5000, 0]], r: 300 },
      { id: 'T1', kind: 'text', layer: 'LV-ANNO', pts: [[X, 3000]], text: 'DB-1', h: 250 }
    ] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('qs');
    await until(() => !!document.querySelector('[aria-label="Quick select"]'));
    expect([...document.querySelectorAll('[aria-label="Object type"] option')].map((o) => o.textContent)).toEqual(['Multiple (5)', 'Line (3)', 'Circle (1)', 'Text (1)']);
    setSelect('Object type', 'Line');
    expect([...document.querySelectorAll('[aria-label="Property"] option')].map((o) => o.textContent)).toEqual(['Layer', 'Colour', 'Linetype', 'Lineweight', 'Start X', 'Start Y', 'End X', 'End Y', 'Length', 'Angle']);
    expect([...document.querySelectorAll('[aria-label="Value"] option')].map((o) => o.textContent)).toEqual(['LV-ANNO', 'LV-SKETCH']);
    setSelect('Value', 'LV-SKETCH');
    expect(document.querySelector('.cad-dlg-ft .m')!.textContent).toBe('2 objects');
    act(() => button('OK').click());
    expect(last()).toBe('QSELECT  2 objects selected');
    await until(() => document.querySelector('.cad-ctx-what')?.textContent === '2 selected');
    // Lines longer than 1.5 m: the one of 2 m.
    await command('qselect');
    await until(() => !!document.querySelector('[aria-label="Quick select"]'));
    setSelect('Object type', 'Line'); setSelect('Property', 'len'); setSelect('Operator', '>');
    await act(async () => {
      const el = document.querySelector('[aria-label="Value"]') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '1.5'); el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelector('.cad-dlg-ft .m')!.textContent).toBe('1 object');
    act(() => button('OK').click());
    expect(last()).toBe('QSELECT  1 object selected');
    expect(state.selected).toBe('sk:S2');
    // SELECTSIMILAR with S1 picked: every line on LV-SKETCH.
    act(() => state.setSelected(null));
    await clickAt(X + 500, 0);
    expect(state.selected).toBe('sk:S1');
    await command('selectsimilar');
    expect(state.history.slice(-3)).toContain('SELECTSIMILAR  2 objects selected');
    expect(state.tool).toBe('none');
    expect(document.querySelector('.cad-ctx-what')?.textContent).toBe('2 selected');
    // With nothing picked: it asks, S sets what else to match, a click picks the pattern, Enter selects.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); }); // clears the picks
    await command('selectsimilar');
    expect(last()).toContain('SELECTSIMILAR  Select objects or [Settings]:');
    await command('s');
    expect(last()).toContain('Also match [Colour/Linetype/Both/None] <None>:');
    await command('c');
    await clickAt(X + 500, 1000);
    expect(last()).toContain('SEL  1 object selected — Enter when done');
    await command('');
    expect(state.history.slice(-3)).toContain('SELECTSIMILAR  1 object selected');
    expect(state.selected).toBe('sk:S3');
  });

  it('DIMRADIUS, DIMDIAMETER and DIMANGULAR draw dimensions from a circle, two lines, or a vertex and two points', async () => {
    const start: Project = { ...villa, cadSketch: [{ file: F, items: [
      { id: 'C1', kind: 'circle', layer: 'LV-SKETCH', pts: [[X, 0]], r: 500 },
      { id: 'L1', kind: 'line', layer: 'LV-SKETCH', pts: [[X + 5000, 0], [X + 7000, 0]] },
      { id: 'L2', kind: 'line', layer: 'LV-SKETCH', pts: [[X + 5000, 0], [X + 5000, 2000]] }
    ] }] };
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    const dims = () => project.cadSketch![0].items.filter((it) => it.kind === 'dim');
    await command('dra');
    expect(last()).toContain('DIMRADIUS  Select arc or circle:');
    await command(`${X + 2000},2000`);
    expect(last()).toContain('No arc or circle there');
    await command(`${X + 500},0`);
    expect(last()).toContain('DIMRADIUS  Dimension line location:');
    await command(`${X + 200},0`);
    expect(dims().length).toBe(1);
    const r = dims()[0];
    expect(r.dimKind).toBe('radius');
    expect(r.pts.map((q) => q.map(Math.round))).toEqual([[X, 0], [X + 500, 0], [X + 200, 0]]);
    expect(dimLabel(r, 0.001).startsWith('R')).toBe(true);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe(`Radius dimension ${dimLabel(r, 0.001)} · ⌘Z to undo`);
    expect(last()).toContain('DIMRADIUS  Select arc or circle:'); // ready for the next
    await command('ddi');
    await command(`${X},500`);
    await command(`${X},900`);
    const d = dims()[1];
    expect(d.dimKind).toBe('diameter');
    expect(dimMeasure(d)).toBeCloseTo(1000, 6);
    expect(dimLabel(d, 0.001).startsWith('Ø')).toBe(true);
    // Two lines: the vertex where they cross, the angle towards the ends clicked, the arc inside the corner.
    await command('dan');
    expect(last()).toContain('DIMANGULAR  Select arc, circle, line or <specify vertex>:');
    await command(`${X + 6000},0`);
    expect(last()).toContain('DIMANGULAR  Select second line:');
    await command(`${X + 5000},1000`);
    expect(last()).toContain('DIMANGULAR  Dimension arc line location:');
    await command(`${X + 5500},500`);
    const a = dims()[2];
    expect(a.dimKind).toBe('angular');
    expect(a.pts.map((q) => q.map(Math.round))).toEqual([[X + 5000, 0], [X + 7000, 0], [X + 5000, 2000], [X + 5500, 500]]);
    expect(dimMeasure(a)).toBeCloseTo(90, 6);
    expect(dimLabel(a, 0.001).endsWith('°')).toBe(true);
    // Enter: a vertex and two points; the arc placed on the far side measures the reflex angle.
    await command('');
    expect(last()).toContain('DIMANGULAR  Specify angle vertex:');
    await command(`${X + 9000},0`);
    expect(last()).toContain('Specify first angle endpoint:');
    await command(`${X + 10000},0`);
    expect(last()).toContain('Specify second angle endpoint:');
    await command(`${X + 9000},1000`);
    expect(last()).toContain('Dimension arc line location:');
    await command(`${X + 8500},500`);
    expect(dimMeasure(dims()[3])).toBeCloseTo(270, 6);
    // DCO goes on from the last linear dimension, not from these.
    await command('dco');
    await command(`${X + 12000},0`);
    expect(last()).toContain('No dimension on this drawing to go on from');
  });
});

describe('CAD 2D gap plan: TEXTEDIT, a double-click on a text or dimension to type over it', () => {
  const last = () => state.history[state.history.length - 1];
  const X = 200000, F = 'sample-villa-gf.dxf';
  const box = () => document.querySelector('input[aria-label="Edit text"]') as HTMLInputElement | null;
  const dblClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('dblclick', { clientX: sx, clientY: sy, button: 0, bubbles: true })); });
  };
  const rightClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); });
  };
  const typeBox = (text: string) => act(() => {
    const el = box()!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const keyBox = (key: string) => act(() => { box()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
  const items = () => sketchOf(project, F);
  // "DB ROOM" at (X, 0); a 3 m dimension of a style in mm above it; a text on a locked layer.
  const start: Project = { ...villa, cadSketch: [{ file: F, items: [
    { id: 'T1', kind: 'text', layer: 'LV-ANNO', pts: [[X, 0]], text: 'DB ROOM', h: 250 },
    { id: 'D1', kind: 'dim', layer: 'LV-ANNO', pts: [[X, 2000], [X + 3000, 2000], [X + 1500, 2500]], dir: 0, h: 200, look: { arrow: 'tick', size: 100, off: 50, ext: 80, unit: 'mm', decimals: 0 } },
    { id: 'T2', kind: 'text', layer: 'LV-LOCKED', pts: [[X, 4000]], text: 'FIXED', h: 250 }
  ] }], cadLayerStyle: { [F]: { 'LV-LOCKED': { lock: true } } } };

  it('a double-click opens the box over the text; Enter keeps what is typed in one undo step, Esc leaves it', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    expect(box()).toBeNull();
    await dblClickAt(X + 300, 100);
    expect(box()).not.toBeNull();
    expect(box()!.value).toBe('DB ROOM');
    expect(state.selected).toBe('sk:T1');
    expect(last()).toBe('TEXTEDIT  Type the text, Enter (Esc keeps it as it was):');
    // The box sits at the text: at the left end of its baseline, as high as the text on the screen, not turned.
    expect(box()!.style.transform).toBe('translateY(-100%) rotate(0rad)');
    const [sx, sy] = screenOf(X, 0);
    expect(parseFloat(box()!.style.left)).toBeCloseTo(sx, 0); expect(parseFloat(box()!.style.top)).toBeCloseTo(sy, 0);
    await typeBox('MAIN DB');
    await keyBox('Enter');
    expect(box()).toBeNull();
    expect(items()[0].text).toBe('MAIN DB');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toBe('TEXTEDIT  Text "MAIN DB" · ⌘Z to undo');
    // Esc: nothing changes, and the page's Esc (which would drop the selection) is not reached.
    await dblClickAt(X + 300, 100);
    await typeBox('NOT THIS');
    await keyBox('Escape');
    expect(box()).toBeNull();
    expect(items()[0].text).toBe('MAIN DB');
    expect(state.selected).toBe('sk:T1');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(last()).toBe('*Cancel*');
    // A click outside (the box losing focus) keeps what is typed; nothing typed, nothing changes.
    await dblClickAt(X + 300, 100);
    await act(async () => { box()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    expect(box()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
    // A double-click on empty drawing, or with a drawing tool running, opens nothing.
    await dblClickAt(X + 8000, 8000);
    expect(box()).toBeNull();
    await command('l');
    await dblClickAt(X + 300, 100);
    expect(box()).toBeNull();
  });

  it('ED (TEXTEDIT) picks the object; a dimension takes an override, <> standing for the measure, blank giving it back', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    await command('ed');
    expect(last()).toBe('Command: TEXTEDIT  Select a text or dimension:');
    await clickAt(X + 8000, 8000);
    expect(last()).toBe('TEXTEDIT  Nothing there. Select a text or dimension:');
    await clickAt(X + 1500, 2500);
    expect(box()!.value).toBe('');
    expect(last()).toBe('TEXTEDIT  Type the dimension\'s text (<> stands for the measured value; blank gives it back), Enter:');
    await typeBox('<> mm');
    await keyBox('Enter');
    expect(items()[1].text).toBe('<> mm');
    expect(dimLabel(items()[1], 0.001)).toBe('3000 mm');
    expect(onChange.mock.calls[0][1]).toBe('TEXTEDIT  Dimension text "<> mm" · ⌘Z to undo');
    // The tool stays for the next one; blank gives the measured value back.
    expect(state.tool).toBe('textedit');
    expect(last()).toBe('TEXTEDIT  Select a text or dimension:');
    await clickAt(X + 1500, 2500);
    expect(box()!.value).toBe('<> mm');
    await typeBox('');
    await keyBox('Enter');
    expect(items()[1].text).toBeUndefined();
    expect(onChange.mock.calls[1][1]).toBe('TEXTEDIT  Dimension measured again · ⌘Z to undo');
    expect(onChange).toHaveBeenCalledTimes(2);
    // A text on a locked layer is refused; Esc with no box ends the tool.
    await clickAt(X + 300, 4100);
    expect(box()).toBeNull();
    expect(last()).toBe('TEXTEDIT  Text on layer LV-LOCKED, which is locked: unlock it first (LAYULK).');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(state.tool).toBe('none');
    // ED with a text picked first opens its box at once.
    await clickAt(X + 300, 100);
    expect(state.selected).toBe('sk:T1');
    await command('ed');
    expect(box()!.value).toBe('DB ROOM');
    await keyBox('Escape');
  });

  it('the right-click menu of a text or dimension has Edit text', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    act(() => state.toggle('osnap'));
    await rightClickAt(X + 300, 100);
    const menu = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"][aria-label="Edit drawn objects"] button')];
    expect(menu().map((b) => b.textContent)).toEqual(['Edit text', 'Find and replace…', 'Justify ▸', 'Text height ▸', 'Case ▸', 'Frame ▸', 'Background mask', 'Move', 'Copy', 'Rotate', 'Erase', 'Draw order ▸', 'Make block…', 'Select similar', 'Quick select…', 'Clipboard ▸', 'Isolate ▸', 'Add selected', 'Quick measure', 'Count', 'Deselect all', 'Properties']);
    await act(async () => { menu()[0].click(); });
    expect(box()!.value).toBe('DB ROOM');
    await keyBox('Escape');
    // A line's menu has none.
    await command('l');
    await command(`${X},6000`);
    await command(`${X + 2000},6000`);
    await command('');
    await rightClickAt(X + 1000, 6000);
    expect(menu().map((b) => b.textContent)).not.toContain('Edit text');
  });
});

describe('CAD 2D gap plan: MTEXT, notes in a box with their lines wrapped to its width', () => {
  const last = () => state.history[state.history.length - 1];
  const X = 200000, F = 'sample-villa-gf.dxf';
  const editor = () => document.querySelector('.cad-ntedit') as HTMLDivElement | null;
  const words = () => document.querySelector('[aria-label="Note text"]') as HTMLDivElement | null;
  const items = () => sketchOf(project, F);
  const dblClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('dblclick', { clientX: sx, clientY: sy, button: 0, bubbles: true })); });
  };
  const rightClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); });
  };
  const keyWords = (key: string, more: KeyboardEventInit = {}) => act(() => { words()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...more })); });
  /** What is typed in the box: a block per line, a word in <b> or <u> for bold or underline (as the box keeps them). */
  const typeWords = (lines: (string | [string, 'b' | 'u'])[][]) => act(() => {
    const el = words()!;
    el.replaceChildren();
    for (const l of lines) {
      const d = document.createElement('div');
      for (const r of l) { if (typeof r === 'string') d.appendChild(document.createTextNode(r)); else { const e = document.createElement(r[1]); e.textContent = r[0]; d.appendChild(e); } }
      if (!l.length) d.appendChild(document.createElement('br'));
      el.appendChild(d);
    }
  });
  const setField = (label: string, value: string) => act(() => {
    // The editor's own field (the Properties palette has a Justify of its own for a note).
    const el = (document.querySelector(`.cad-ntedit [aria-label="${label}"]`) ?? document.querySelector(`[aria-label="${label}"]`)) as HTMLInputElement | HTMLSelectElement;
    if (el instanceof HTMLSelectElement) { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }
    else { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  const menuLabels = () => [...document.querySelectorAll('[role="menu"] button')].map((b) => b.textContent);
  const N1: SketchItem = { id: 'N1', kind: 'mtext', layer: 'LV-ANNO', pts: [[X, 6000]], h: 250, w: 3000, note: [{ runs: [{ s: 'GENERAL NOTES', b: true }] }, { runs: [{ s: 'LSZH cables' }] }] };
  // A note of two lines in a 3 m box at (X, 6000), and one on a locked layer below it.
  const start: Project = { ...villa, cadSketch: [{ file: F, items: [N1, { ...N1, id: 'N2', layer: 'LV-LOCKED', pts: [[X, 3000]] }] }], cadLayerStyle: { [F]: { 'LV-LOCKED': { lock: true } } } };

  it('MT: two corners (H and J first, if wanted) open the editor over the box; Ctrl/⌘+Enter draws the note in one undo step, Esc draws nothing', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('mt');
    expect(last()).toBe('Command: MTEXT  First corner:');
    await clickAt(X, 0);
    expect(last()).toBe('MTEXT  Opposite corner or [Height/Justify/Width]:');
    await command('j');
    expect(last()).toBe('MTEXT  Justify [TL/TC/TR/ML/MC/MR/BL/BC/BR] <TL>:');
    await command('tc');
    expect(last()).toBe('MTEXT  Opposite corner or [Height/Justify/Width]:');
    await command('h');
    expect(last()).toBe('MTEXT  Height on paper (mm) <2.5>:');
    await command('3.5');
    expect(editor()).toBeNull();
    await clickAt(X + 3000, -1000);
    expect(editor()).not.toBeNull();
    expect(last()).toBe('MTEXT  Type the note (Enter starts a new line); Ctrl/⌘+Enter or OK keeps it, Esc cancels:');
    // The bar shows the height and justification chosen; the box sits at the top left corner, 3 m wide, not turned.
    expect((document.querySelector('[aria-label="Height (mm on paper)"]') as HTMLInputElement).value).toBe('3.5');
    expect((document.querySelector('[aria-label="Justify"]') as HTMLSelectElement).value).toBe('TC');
    const [sx, sy] = screenOf(X, 0), [ex] = screenOf(X + 3000, 0);
    expect(parseFloat(editor()!.style.left)).toBeCloseTo(sx, 0); expect(parseFloat(editor()!.style.top)).toBeCloseTo(sy, 0);
    expect(parseFloat(editor()!.style.width)).toBeCloseTo(ex - sx, 0);
    expect(editor()!.style.transform).toBe('rotate(0rad)');
    await typeWords([[['GENERAL NOTES', 'b']], ['All cables to be ', ['LSZH', 'u'], ' unless noted'], []]);
    await keyWords('Enter', { metaKey: true });
    expect(editor()).toBeNull();
    expect(items().filter((it) => it.kind === 'mtext' && it.id === 'S1')).toEqual([{
      id: 'S1', kind: 'mtext', layer: 'LV-ANNO', pts: [[X + 1500, 0]], h: 350, w: 3000, just: 'TC',
      note: [{ runs: [{ s: 'GENERAL NOTES', b: true }] }, { runs: [{ s: 'All cables to be ' }, { s: 'LSZH', u: true }, { s: ' unless noted' }] }]
    }]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toBe('Note · ⌘Z to undo');
    expect(state.tool).toBe('none');
    // Esc in the box: nothing drawn, the command ends.
    await command('mt');
    await clickAt(X, -5000);
    await clickAt(X + 2000, -6000);
    expect(editor()).not.toBeNull();
    await keyWords('Escape');
    expect(editor()).toBeNull();
    expect(state.history.slice(-2)[0]).toBe('*Cancel*');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(state.tool).toBe('none');
  });

  it('a double-click opens the note\'s words; the bar\'s height and justification apply with OK; Esc keeps it; EXPLODE gives a text per line', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await dblClickAt(X + 500, 5900);
    expect(editor()).not.toBeNull();
    expect(words()!.textContent).toBe('GENERAL NOTESLSZH cables');
    expect(words()!.querySelector('b')?.textContent).toBe('GENERAL NOTES');
    expect(state.selected).toBe('sk:N1');
    expect(last()).toBe('MTEXT  Type the note (Enter starts a new line); Ctrl/⌘+Enter or OK keeps it, Esc leaves it as it was:');
    await keyWords('Escape');
    expect(editor()).toBeNull();
    expect(items()[0]).toEqual(N1);
    expect(last()).toBe('*Cancel*');
    expect(onChange).toHaveBeenCalledTimes(0);
    await dblClickAt(X + 500, 5900);
    await setField('Justify', 'MC');
    await setField('Height (mm on paper)', '5');
    await act(async () => { button('OK').click(); });
    expect(editor()).toBeNull();
    const after = items()[0];
    expect([after.just, after.h, after.w, after.note]).toEqual(['MC', 500, 3000, N1.note]);
    // Justified middle centre, the anchor went to the centre of the 2-line box (250 + 416.7 high); taller letters then grow it about that centre.
    expect(after.pts[0][0]).toBeCloseTo(X + 1500); expect(after.pts[0][1]).toBeCloseTo(6000 - (250 + 1250 / 3) / 2, 6);
    expect(noteBox(after).lines.length).toBe(4);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toBe('MTEXT  Note changed · ⌘Z to undo');
    // EXPLODE: the lines as drawn (wrapped at 3 m with 5 mm letters) become single-line texts.
    const lines = explodeNote(after);
    await command('x');
    await clickAt(X + 500, 5900);
    expect(last()).toBe(`EXPLODE  ${lines.length} texts · ⌘Z to undo`);
    expect(items().filter((it) => it.layer === 'LV-ANNO').map((it) => [it.kind, it.text])).toEqual(lines.map((l) => ['text', l.text]));
  });

  it('right-click on a note: Edit text, Width… (typed in metres) and Justify ▸; a note on a locked layer is refused', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    // The locked one: ED and a double-click both refuse it.
    await command('ed');
    await clickAt(X + 500, 2900);
    expect(last()).toBe('TEXTEDIT  Note on layer LV-LOCKED, which is locked: unlock it first (LAYULK).');
    expect(editor()).toBeNull();
    await dblClickAt(X + 500, 2900);
    expect(editor()).toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(state.tool).toBe('none');
    await rightClickAt(X + 500, 5900);
    expect(menuLabels()).toEqual(['Repeat TEXTEDIT', 'Edit text', 'Width…', 'Justify ▸', 'Find and replace…', 'Move', 'Copy', 'Rotate', 'Erase', 'Draw order ▸', 'Make block…', 'Select similar', 'Quick select…', 'Clipboard ▸', 'Isolate ▸', 'Add selected', 'Quick measure', 'Count', 'Deselect all', 'Properties']);
    await act(async () => { button('Width…').click(); });
    expect(last()).toBe('MTEXT  Width (m) <3.00>:');
    await command('4');
    expect(items()[0].w).toBe(4000);
    expect(items()[0].pts).toEqual([[X, 6000]]);
    expect(onChange.mock.calls[0][1]).toMatch(/^MTEXT {2}Note 4\.00 m wide/);
    await rightClickAt(X + 500, 5900);
    await act(async () => { button('Justify ▸').click(); });
    const opt = [...document.querySelectorAll('[role="listbox"][aria-label="Justify"] [role="option"]')].find((b) => b.textContent?.startsWith('Bottom right')) as HTMLButtonElement;
    await act(async () => { opt.click(); });
    expect(items()[0].just).toBe('BR');
    expect(noteBox(items()[0]).tl[0]).toBeCloseTo(X); expect(noteBox(items()[0]).tl[1]).toBeCloseTo(6000);
    expect(onChange).toHaveBeenCalledTimes(2);
    // Edit text opens the editor too.
    await rightClickAt(X + 500, 5900);
    await act(async () => { button('Edit text').click(); });
    expect(editor()).not.toBeNull();
    await keyWords('Escape');
    expect(editor()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('CAD 2D gap plan: DRAWORDER and TEXTTOFRONT, the order the drawn objects paint in', () => {
  const last = () => state.history[state.history.length - 1];
  const X = 200000, F = 'sample-villa-gf.dxf';
  const order = () => sketchOf(project, F).map((it) => it.id).join('');
  const rightClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); });
  };
  const menuLabels = () => [...document.querySelectorAll('[role="menu"] button')].map((b) => b.textContent);
  const options = () => [...document.querySelectorAll('[role="listbox"][aria-label="Draw order"] [role="option"]')] as HTMLButtonElement[];
  // A solid hatch, a line beside it and a text over the hatch, drawn in that order (the text on top).
  const start: Project = { ...villa, cadSketch: [{ file: F, items: [
    { id: 'H', kind: 'pline', layer: 'LV-HATCH', closed: true, pts: [[X, 0], [X + 4000, 0], [X + 4000, 3000], [X, 3000]], hatch: { pattern: 'solid', scale: 3, angle: 0 } },
    { id: 'L', kind: 'line', layer: 'LV-SKETCH', pts: [[X + 5000, 0], [X + 8000, 0]] },
    { id: 'T', kind: 'text', layer: 'LV-ANNO', pts: [[X + 1000, 1000]], text: 'DB', h: 250 }
  ] }] };

  it('DR: pick the objects, Enter, then Front, Back, Above or Under (the reference clicked); one undo step each', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('dr');
    expect(last()).toBe('Command: DRAWORDER  Select objects:');
    await clickAt(X + 1100, 1100);
    await clickAt(X + 6000, 0);
    expect(last()).toBe('DRAWORDER  2 objects selected — Enter when done');
    await command('');
    expect(last()).toBe('DRAWORDER  [Above objects/Under objects/Front/Back] <Back>:');
    await command('b');
    expect(order()).toBe('LTH');
    expect(onChange.mock.calls[0][1]).toBe('DRAWORDER  2 objects sent to the back · ⌘Z to undo');
    expect(state.tool).toBe('none');
    // One object selected first: the options come at once; Above asks for the reference object.
    await clickAt(X + 1100, 1100);
    expect(state.selected).toBe('sk:T');
    await command('dr');
    expect(last()).toBe('Command: DRAWORDER  [Above objects/Under objects/Front/Back] <Back>:');
    await command('a');
    expect(last()).toBe('DRAWORDER  Select reference objects:');
    await clickAt(X + 2000, 0);
    expect(order()).toBe('LHT');
    expect(onChange.mock.calls[1][1]).toBe('DRAWORDER  1 object put above the hatch · ⌘Z to undo');
    // Already there: nothing changes. DR with its order typed skips the question.
    await clickAt(X + 1100, 1100);
    await command('dr f');
    expect(state.history.slice(-2)[0]).toBe('DRAWORDER  1 object already in front.'); // then the command ends and prompts again
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(state.tool).toBe('none');
  });

  it('TEXTTOFRONT lifts the texts, dimensions or leaders; DR B typed picks the objects next', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('texttofront');
    expect(last()).toBe('Command: TEXTTOFRONT  [Text/Dimensions/Leaders/All] <All>:');
    await command('');
    expect(state.history.slice(-2)[0]).toBe('TEXTTOFRONT  The texts, dimensions and leaders are in front already.');
    expect(onChange).toHaveBeenCalledTimes(0);
    expect(state.tool).toBe('none');
    await command('dr b');
    expect(last()).toBe('Command: DRAWORDER  Select objects:');
    await clickAt(X + 1100, 1100);
    await command('');
    expect(order()).toBe('THL');
    expect(onChange.mock.calls[0][1]).toBe('DRAWORDER  1 object sent to the back · ⌘Z to undo');
    await command('texttofront');
    await command('t');
    expect(order()).toBe('HLT');
    expect(onChange.mock.calls[1][1]).toBe('TEXTTOFRONT  The texts brought to the front · ⌘Z to undo');
  });

  it('the right-click menu of drawn objects has Draw order ▸ with the four orders; Above and Under then ask for the reference', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await rightClickAt(X + 6000, 0);
    expect(menuLabels()).toEqual(['Join…', 'Chamfer', 'Reverse direction', 'Convert to cable route', 'Trim', 'Extend', 'Offset', 'Break', 'Fillet', 'Mirror', 'Move', 'Copy', 'Rotate', 'Erase', 'Draw order ▸', 'Make block…', 'Select similar', 'Quick select…', 'Clipboard ▸', 'Isolate ▸', 'Add selected', 'Quick measure', 'Count', 'Deselect all', 'Properties']);
    await act(async () => { button('Draw order ▸').click(); });
    expect(options().map((b) => b.textContent)).toEqual(['Bring to front', 'Send to back', 'Above object', 'Under object']);
    await act(async () => { options()[1].click(); });
    expect(order()).toBe('LHT');
    expect(onChange.mock.calls[0][1]).toBe('DRAWORDER  1 object sent to the back · ⌘Z to undo');
    await rightClickAt(X + 6000, 0);
    await act(async () => { button('Draw order ▸').click(); });
    await act(async () => { options()[2].click(); });
    expect(last()).toBe('Command: DRAWORDER  Select reference objects:');
    await clickAt(X + 1100, 1100);
    expect(order()).toBe('HTL');
    expect(onChange.mock.calls[1][1]).toBe('DRAWORDER  1 object put above the text · ⌘Z to undo');
    expect(state.tool).toBe('none');
  });
});

describe('CAD 2D gap plan: POINT, DIVIDE, MEASURE and the point style', () => {
  const last = () => state.history[state.history.length - 1];
  const X = 200000, F = 'sample-villa-gf.dxf';
  const points = () => sketchOf(project, F).filter((it) => it.kind === 'point').map((it) => [Math.round(it.pts[0][0] - X), Math.round(it.pts[0][1])]);
  // A 10 m line.
  const start: Project = { ...villa, cadSketch: [{ file: F, items: [{ id: 'L', kind: 'line', layer: 'LV-SKETCH', pts: [[X, 0], [X + 10000, 0]] }] }] };

  it('PO draws a point at each click until Enter; DIV and ME set points out along the object clicked', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('po');
    expect(last()).toBe('Command: POINT  Specify a point:');
    await clickAt(X + 1000, 3000);
    await clickAt(X + 2000, 3000);
    expect(points()).toEqual([[1000, 3000], [2000, 3000]]);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][1]).toBe('Point · ⌘Z to undo');
    expect(last()).toBe('POINT  Specify a point:');
    await command('');
    expect(state.tool).toBe('none');
    // DIVIDE: the object, then the number of parts (Block waits for Steps 9 and 10); one undo step for all the points.
    await command('div');
    expect(last()).toBe('Command: DIVIDE  Select object to divide:');
    await clickAt(X + 8000, 8000);
    expect(last()).toBe('DIVIDE  Click a line, polyline, arc, circle or ellipse:');
    await clickAt(X + 5000, 0);
    expect(last()).toBe('DIVIDE  Number of segments or [Block]:');
    await command('b');
    expect(last()).toBe('DIVIDE  Block name:');
    await command('nope');
    expect(last()).toBe('DIVIDE  No block "nope" in this drawing or Recent. Block name:');
    await command(''); // no name: back to the number
    expect(last()).toBe('DIVIDE  Number of segments or [Block]:');
    await command('1');
    expect(last()).toBe('DIVIDE  A whole number of 2 or more. DIVIDE  Number of segments or [Block]:');
    await command('5');
    expect(points().slice(2)).toEqual([[2000, 0], [4000, 0], [6000, 0], [8000, 0]]);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls[2][1]).toBe('DIVIDE  4 points on the line · ⌘Z to undo');
    expect(state.tool).toBe('none');
    // MEASURE: from the end nearer the click, every length typed in metres.
    await command('me');
    await clickAt(X + 9000, 0);
    expect(last()).toBe('MEASURE  Segment length or [Block]:');
    await command('3');
    expect(points().slice(6)).toEqual([[7000, 0], [4000, 0], [1000, 0]]);
    expect(onChange.mock.calls[3][1]).toBe('MEASURE  3 points on the line · ⌘Z to undo');
    await command('me');
    await clickAt(X + 5000, 0);
    await command('20');
    expect(last()).toMatch(/^MEASURE {2}The line is shorter than 20/);
    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it('PTYPE: the Point style dialog sets the shape and the size, relative to the screen or in drawing units', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    await command('ptype');
    expect(last()).toBe('PTYPE  Points shown as dot');
    const dlg = () => document.querySelector('[role="dialog"][aria-label="Point style"]');
    expect(dlg()).not.toBeNull();
    expect(document.querySelectorAll('[role="radiogroup"][aria-label="Point shape"] [role="radio"]')).toHaveLength(20);
    expect((document.querySelector('[role="radio"][aria-label="Dot"]') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    await act(async () => { (document.querySelector('[role="radio"][aria-label="Cross in a circle"]') as HTMLButtonElement).click(); });
    await act(async () => {
      const el = document.querySelector('input[aria-label="Point size"]') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '300');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { (document.querySelector('input[aria-label="Size in absolute units"]') as HTMLInputElement).click(); });
    await act(async () => { (document.querySelector('.cad-dlg-ft .p') as HTMLButtonElement).click(); });
    expect(dlg()).toBeNull();
    expect(project.cadPointStyle).toEqual({ mode: 35, size: 300, relative: false });
    expect(onChange.mock.calls[0][1]).toBe('PTYPE  Points shown as cross in a circle, 300 drawing units · ⌘Z to undo');
  });
});

describe('CAD 2D gap plan: BLOCK, a block from drawn objects', () => {
  const last = () => state.history[state.history.length - 1];
  const X = 200000, F = 'sample-villa-gf.dxf';
  const items = () => sketchOf(project, F);
  const defs = () => project.cadBlockDefs?.find((t) => t.file === F)?.defs ?? [];
  const dlg = () => document.querySelector('[role="dialog"][aria-label="Block definition"]');
  const field = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  const setField = (label: string, value: string) => act(() => {
    const el = field(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const rightClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); });
  };
  // A rectangle with a text in it (a board symbol), and a line apart from them.
  const start: Project = { ...villa, cadSketch: [{ file: F, items: [
    { id: 'R', kind: 'pline', layer: 'LV-SKETCH', closed: true, pts: [[X, 0], [X + 400, 0], [X + 400, 300], [X, 300]] },
    { id: 'T', kind: 'text', layer: 'LV-ANNO', pts: [[X + 50, 100]], text: 'DB', h: 100 },
    { id: 'L', kind: 'line', layer: 'LV-SKETCH', pts: [[X + 2000, 0], [X + 3000, 0]] }
  ] }] };

  it('-BLOCK: the name, the base point, the objects, Enter: the block is defined and the objects become one insert, which picks and explodes as one', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('-block');
    expect(last()).toBe('Command: BLOCK  Block name:');
    await command('DB/A');
    expect(last()).toBe('BLOCK  A block name cannot contain < > / \\ " : ; ? * | = or `. Block name:');
    await command('DB-A');
    expect(last()).toBe('BLOCK  Specify base point:');
    await command(`${X},0`);
    expect(last()).toBe('BLOCK  Select objects — Enter when done:');
    await clickAt(X + 200, 0);
    await clickAt(X + 100, 150);
    expect(last()).toBe('BLOCK  2 objects selected — Enter when done');
    await command('');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][1]).toBe('BLOCK  "DB-A" defined from 2 objects and inserted · ⌘Z to undo');
    expect(defs().map((d) => [d.name, d.items.length, d.units])).toEqual([['DB-A', 2, 4]]);
    expect(defs()[0].items[0].pts).toEqual([[0, 0], [400, 0], [400, 300], [0, 300]]);
    expect(items().map((it) => [it.id, it.kind, it.block])).toEqual([['L', 'line', undefined], ['S1', 'insert', 'DB-A']]);
    expect(items()[1].pts).toEqual([[X, 0]]);
    expect(state.tool).toBe('none');
    // The insert picks as one object where its block shows, and explodes back into the objects.
    await clickAt(X + 100, 150);
    expect(state.selected).toBe('sk:S1');
    await command('x');
    await clickAt(X + 200, 0);
    expect(last()).toBe('EXPLODE  2 objects · ⌘Z to undo');
    expect(items().map((it) => [it.kind, it.pts[0]])).toEqual([['line', [X + 2000, 0]], ['pline', [X, 0]], ['text', [X + 50, 100]]]);
  });

  it('B: the Block definition dialog, stepping aside to pick the objects and the base point; Retain keeps the objects; a name defined asks before redefining', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('b');
    expect(dlg()).not.toBeNull();
    expect(dlg()!.textContent).toContain('Type a name for the block.');
    await setField('Block name', 'DB-A');
    expect(dlg()!.textContent).toContain('Pick or type the base point.');
    expect(document.querySelector('[aria-label="Objects selected"]')!.textContent).toBe('0 selected');
    await act(async () => { button('Select objects').click(); });
    expect(dlg()).toBeNull();
    expect(last()).toBe('Command: BLOCK  Select objects — Enter when done:');
    await clickAt(X + 200, 0);
    await clickAt(X + 100, 150);
    await command('');
    expect(dlg()).not.toBeNull();
    expect(document.querySelector('[aria-label="Objects selected"]')!.textContent).toBe('2 selected');
    await act(async () => { button('Pick point').click(); });
    expect(dlg()).toBeNull();
    expect(last()).toBe('Command: BLOCK  Specify base point:');
    await clickAt(X, 0);
    expect(dlg()).not.toBeNull();
    expect(field('Base X').value).toBe('200.000');
    expect(field('Base Y').value).toBe('0.000');
    expect(dlg()!.textContent).toContain('millimetres');
    await act(async () => { field('Retain').click(); });
    await setField('Block description', 'Board symbol');
    await act(async () => { (document.querySelector('.cad-dlg-ft .p') as HTMLButtonElement).click(); });
    expect(dlg()).toBeNull();
    expect(onChange.mock.calls[0][1]).toBe('BLOCK  "DB-A" defined from 2 objects · ⌘Z to undo');
    expect(defs().map((d) => [d.name, d.description, d.items.length])).toEqual([['DB-A', 'Board symbol', 2]]);
    expect(items().map((it) => it.kind)).toEqual(['pline', 'text', 'line']); // Retain: the objects stay, nothing inserted
    // The same name again (case aside) asks first; Yes redefines it, the earlier insert then shows the new objects.
    await command('b');
    await setField('Block name', 'db-a');
    await act(async () => { button('Select objects').click(); });
    await clickAt(X + 2500, 0);
    await command('');
    await setField('Base X', '202');
    await setField('Base Y', '0');
    await act(async () => { (document.querySelector('.cad-dlg-ft .p') as HTMLButtonElement).click(); });
    expect(dlg()).not.toBeNull();
    expect(dlg()!.textContent).toContain('Block "db-a" exists. Redefine it?');
    await act(async () => { button('Yes').click(); });
    expect(dlg()).toBeNull();
    expect(defs().map((d) => [d.name, d.items.length])).toEqual([['db-a', 1]]);
    expect(items().map((it) => [it.kind, it.block])).toEqual([['pline', undefined], ['text', undefined], ['insert', 'db-a']]); // Convert: the line became an insert
  });

  it('the right-click menu of drawn objects has Make block…, opening the dialog with them as its objects', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await rightClickAt(X + 2500, 0);
    const labels = [...document.querySelectorAll('[role="menu"] button')].map((b) => b.textContent);
    expect(labels.slice(labels.indexOf('Erase'))).toEqual(['Erase', 'Draw order ▸', 'Make block…', 'Select similar', 'Quick select…', 'Clipboard ▸', 'Isolate ▸', 'Add selected', 'Quick measure', 'Count', 'Deselect all', 'Properties']);
    await act(async () => { button('Make block…').click(); });
    expect(dlg()).not.toBeNull();
    expect(document.querySelector('[aria-label="Objects selected"]')!.textContent).toBe('1 selected');
    expect(field('Base X').value).toBe('202.000');
    await act(async () => { button('Cancel').click(); });
    expect(dlg()).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(0);
  });
});

describe('CAD 2D gap plan: INSERT and the Blocks palette', () => {
  const last = () => state.history[state.history.length - 1];
  const X = 200000, F = 'sample-villa-gf.dxf';
  const items = () => sketchOf(project, F);
  const inserts = () => items().filter((it) => it.kind === 'insert');
  const palette = () => document.querySelector('[aria-label="Blocks palette"]');
  const pickBlock = (name: string) => act(async () => { (document.querySelector(`.cad-bk-item[aria-label="${name}"]`) as HTMLButtonElement).click(); });
  const tick = (label: string) => act(async () => { (document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement).click(); });
  const rightClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); });
  };
  const def: CadBlockDef = { name: 'DB-A', units: 4, items: [{ id: 'r', kind: 'pline', layer: '0', closed: true, pts: [[0, 0], [400, 0], [400, 300], [0, 300]] }, { id: 't', kind: 'text', layer: 'LV-ANNO', pts: [[50, 100]], text: 'DB', h: 100 }] };
  // A 10 m line, and one block defined.
  const start: Project = { ...villa, cadSketch: [{ file: F, items: [{ id: 'L', kind: 'line', layer: 'LV-SKETCH', pts: [[X, 0], [X + 10000, 0]] }] }], cadBlockDefs: [{ file: F, defs: [def] }] };

  it('I opens the palette; a block clicked waits at the cursor and goes where the click is, scaled and turned as set; Repeat keeps placing; Explode places its objects', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    expect(palette()).toBeNull();
    await command('i');
    expect(palette()).not.toBeNull();
    expect(state.tool).toBe('none');
    // The drawing's own block first, then the architect's blocks (the sample villa has several).
    const names = [...document.querySelectorAll('[role="list"][aria-label="Current drawing"] button')].map((b) => b.getAttribute('aria-label'));
    expect(names[0]).toBe('DB-A');
    expect(names.length).toBeGreaterThan(1);
    await pickBlock('DB-A');
    expect(state.tool).toBe('insert');
    expect(last()).toBe('Command: INSERT  Insertion point or [Scale/Rotate]:');
    await command('s');
    expect(last()).toBe('INSERT  Scale <1>:');
    await command('2');
    expect(last()).toBe('INSERT  Insertion point or [Scale/Rotate]:');
    await command('r');
    await command('90');
    await clickAt(X + 3000, 2000);
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]).toMatchObject({ kind: 'insert', block: 'DB-A', sc: 2, rot: Math.PI / 2 });
    expect(inserts()[0].pts[0].map(Math.round)).toEqual([X + 3000, 2000]);
    expect(onChange.mock.calls[0][1]).toMatch(/^INSERT {2}"DB-A" at /);
    expect(state.tool).toBe('none');
    expect(JSON.parse(localStorage.getItem('lvds.cad.recentBlocks')!).map((d: CadBlockDef) => d.name)).toEqual(['DB-A']);
    // Repeat placement: a click for each; Esc stops.
    await tick('Repeat placement');
    await pickBlock('DB-A');
    await clickAt(X + 5000, 2000);
    await clickAt(X + 6000, 2000);
    expect(inserts()).toHaveLength(3);
    expect(state.tool).toBe('insert');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(state.tool).toBe('none');
    // Explode: the block's objects go in, not an insert.
    await tick('Repeat placement');
    await tick('Explode');
    await pickBlock('DB-A');
    await clickAt(X + 8000, 2000);
    expect(inserts()).toHaveLength(3);
    expect(items().slice(-2).map((it) => [it.kind, it.text])).toEqual([['pline', undefined], ['text', 'DB']]);
    expect(onChange.mock.calls[3][1]).toMatch(/^INSERT {2}"DB-A", exploded, at /);
    await act(async () => { (document.querySelector('[aria-label="Close the Blocks palette"]') as HTMLButtonElement).click(); });
    expect(palette()).toBeNull();
  });

  it('-INSERT by name (also what Insert\'s arrow sends); DIVIDE\'s Block option sets blocks out, aligned; Select all of this block', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('-insert');
    expect(last()).toBe('Command: INSERT  Block name:');
    await command('nope');
    expect(last()).toBe('INSERT  No block "nope" in this drawing or Recent. Block name:');
    await command('DB-A');
    expect(last()).toBe('INSERT  Insertion point or [Scale/Rotate]:');
    await command(`${X + 1000},1000`);
    expect(inserts().map((it) => it.pts[0])).toEqual([[X + 1000, 1000]]);
    expect(state.tool).toBe('none');
    await command('-insert DB-A');
    expect(last()).toBe('Command: INSERT  Insertion point or [Scale/Rotate]:');
    await clickAt(X + 2000, 1000);
    expect(inserts()).toHaveLength(2);
    // DIVIDE with Block: the name, aligned or not, then the number of parts.
    await command('div');
    await clickAt(X + 5000, 0);
    await command('b');
    expect(last()).toBe('DIVIDE  Block name:');
    await command('DB-A');
    expect(last()).toBe('DIVIDE  Align block with object? [Yes/No] <Yes>:');
    await command('');
    expect(last()).toBe('DIVIDE  Number of segments:');
    await command('5');
    expect(inserts()).toHaveLength(6);
    expect(inserts().slice(2).map((it) => [it.pts[0][0] - X, it.block, it.rot])).toEqual([[2000, 'DB-A', undefined], [4000, 'DB-A', undefined], [6000, 'DB-A', undefined], [8000, 'DB-A', undefined]]);
    expect(onChange.mock.calls[2][1]).toBe('DIVIDE  4 "DB-A" blocks on the line · ⌘Z to undo');
    // The right-click menu of a block starts with Select all of this block.
    await rightClickAt(X + 1000, 1150);
    const labels = [...document.querySelectorAll('[role="menu"] button')].map((b) => b.textContent);
    expect(labels.slice(0, 4)).toEqual(['Repeat DIVIDE', 'Open block editor', 'Edit block in place', 'Select all of this block']);
    await act(async () => { button('Select all of this block').click(); });
    expect(last()).toBe('SELECT  Every "DB-A" block picked');
  });
});

describe('CAD 2D gap plan: block attributes (ATTDEF, INSERT prompts, ATTEDIT)', () => {
  const last = () => state.history[state.history.length - 1];
  const X = 200000, F = 'sample-villa-gf.dxf';
  const items = () => sketchOf(project, F);
  const dlg = (name: string) => document.querySelector(`[role="dialog"][aria-label="${name}"]`);
  const field = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  const setField = (label: string, value: string) => act(() => {
    const el = field(label);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const ok = () => act(async () => { (document.querySelector('.cad-dlg-ft .p') as HTMLButtonElement).click(); });
  const dblClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('dblclick', { clientX: sx, clientY: sy, button: 0, bubbles: true })); });
  };
  const light: CadBlockDef = { name: 'LIGHT', units: 4, items: [
    { id: 'c', kind: 'circle', layer: '0', pts: [[0, 0]], r: 150 },
    { id: 'a1', kind: 'attdef', layer: '0', pts: [[200, 0]], tag: 'CIRCUIT', prompt: 'Circuit', text: 'L1', h: 100 },
    { id: 'a2', kind: 'attdef', layer: '0', pts: [[200, -150]], tag: 'WATTS', prompt: 'Load (W)', text: '36', h: 80, att: { invisible: true } },
    { id: 'a3', kind: 'attdef', layer: '0', pts: [[0, 200]], tag: 'TYPE', text: 'LED', h: 80, att: { constant: true } }
  ] };
  const start: Project = { ...villa, cadSketch: [{ file: F, items: [{ id: 'R', kind: 'pline', layer: 'LV-SKETCH', closed: true, pts: [[X, 0], [X + 400, 0], [X + 400, 300], [X, 300]] }] }], cadBlockDefs: [{ file: F, defs: [light] }] };

  it('ATTDEF draws an attribute definition (shown as its tag); BLOCK takes it; the Properties palette edits an insert\'s values', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('att');
    expect(dlg('Attribute definition')).not.toBeNull();
    expect(dlg('Attribute definition')!.textContent).toContain('Type a tag');
    await setField('Tag', 'db ref');
    await setField('Prompt', 'Board reference');
    await setField('Default', 'DB-1');
    await act(async () => { button('Pick on plan').click(); });
    expect(dlg('Attribute definition')).toBeNull();
    expect(last()).toBe('Command: ATTDEF  Specify insertion point:');
    await clickAt(X + 50, 100);
    expect(dlg('Attribute definition')).not.toBeNull();
    expect(field('Insertion X').value).toBe('200.050');
    await act(async () => { field('Invisible').click(); });
    await ok();
    expect(dlg('Attribute definition')).toBeNull();
    const ad = items().find((it) => it.kind === 'attdef')!;
    expect(ad).toMatchObject({ tag: 'DB_REF', prompt: 'Board reference', text: 'DB-1', h: 250, att: { invisible: true } });
    expect(ad.pts[0].map(Math.round)).toEqual([X + 50, 100]);
    expect(onChange.mock.calls[0][1]).toBe('Attribute DB_REF · ⌘Z to undo');
    // The definition picks by its tag's box, and goes into a block with the rectangle.
    await command('-block');
    await command('BOARD');
    await command(`${X},0`);
    await clickAt(X + 200, 0);
    await clickAt(X + 100, 150);
    expect(last()).toBe('BLOCK  2 objects selected — Enter when done');
    await command('');
    const def = project.cadBlockDefs!.find((t) => t.file === F)!.defs.find((d) => d.name === 'BOARD')!;
    expect(def.items.map((it) => it.kind)).toEqual(['pline', 'attdef']);
    expect(def.items[1].pts[0].map(Math.round)).toEqual([50, 100]);
  });

  it('inserting a block with attributes asks each prompt on the command line (Enter keeps the default); the values show, invisible ones do not; a double-click edits them', async () => {
    act(() => root.render(<Host start={start} />));
    await flush();
    project = start;
    act(() => state.toggle('osnap'));
    await command('-insert LIGHT');
    await clickAt(X + 2000, 2000);
    expect(last()).toBe('INSERT  Circuit <L1>:');
    expect(items().filter((it) => it.kind === 'insert')).toHaveLength(0);
    await command('DB1/L3');
    expect(last()).toBe('INSERT  Load (W) <36>:');
    await command('');
    const ins = items().find((it) => it.kind === 'insert')!;
    expect(ins).toMatchObject({ block: 'LIGHT', attrs: { CIRCUIT: 'DB1/L3', WATTS: '36' } });
    expect(state.tool).toBe('none');
    // What shows: the circle, the circuit and the constant type; not the invisible load.
    const { expandInsert } = await import('../../model/cadBlocks');
    expect(expandInsert(ins, [light]).map((x) => [x.kind, x.text])).toEqual([['circle', undefined], ['text', 'DB1/L3'], ['text', 'LED']]);
    // A double-click on the block: the Edit attributes dialog; a value typed and OK is one undo step.
    await dblClickAt(X + 2150, 2000);
    expect(dlg('Edit attributes')).not.toBeNull();
    expect(dlg('Edit attributes')!.textContent).toContain('LIGHT');
    expect(field('Value of CIRCUIT').value).toBe('DB1/L3');
    await setField('Value of CIRCUIT', 'DB1/L4');
    await setField('Value of WATTS', '18');
    await ok();
    expect(dlg('Edit attributes')).toBeNull();
    expect(items().find((it) => it.kind === 'insert')!.attrs).toEqual({ CIRCUIT: 'DB1/L4', WATTS: '18' });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][1]).toBe('ATTEDIT  "LIGHT" attributes · ⌘Z to undo');
    // ATE picks the block too; Esc leaves it.
    await command('ate');
    expect(last()).toBe('Command: ATTEDIT  Select a block:');
    await clickAt(X + 8000, 8000);
    expect(last()).toBe('ATTEDIT  Select a block:');
    await clickAt(X + 2150, 2000);
    expect(dlg('Edit attributes')).not.toBeNull();
    expect(state.tool).toBe('none');
    await act(async () => { button('Cancel').click(); });
    expect(dlg('Edit attributes')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('right-click menus, phase 1: the tools behind them', () => {
  const line = (id: string, a: [number, number], b: [number, number]) => ({ id, kind: 'line' as const, layer: 'LV-SKETCH', pts: [a, b] });
  const X = 200000;
  const two: Project = { ...villa, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [line('S1', [X, 0], [X + 4000, 0]), line('S2', [X + 6000, 1000], [X + 6000, 5000])] }] };
  const hist = () => document.querySelector('.cad-hist')!.textContent;
  const start = async (p: Project = two) => { project = p; act(() => root.render(<Host start={p} />)); await flush(); act(() => state.toggle('osnap')); };
  const right = (x: number, y: number, shiftKey = false) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, shiftKey, bubbles: true, cancelable: true })); }); };
  const entry = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((b) => (b.firstElementChild?.textContent ?? b.textContent) === label)!;
  const lines = () => sketchOf(project, 'sample-villa-gf.dxf').filter((it) => it.kind === 'line');

  it('COUNT, SELECTALL (and Ctrl+A), ISOLATEOBJECTS, HIDEOBJECTS and UNISOLATEOBJECTS', async () => {
    await start();
    await command('COUNT');
    expect(hist()).toMatch(/^COUNT {2}In view: 2 Line/);
    await command('SELECTALL');
    expect(hist()).toMatch(/^SELECTALL {2}\d+ objects selected$/);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(hist()).toMatch(/^SELECTALL {2}\d+ objects selected$/);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await clickAt(X + 2000, 0); // S1 picked
    await command('COUNT');
    expect(hist()).toBe('COUNT  Picked: 1 Line — 1 in all');
    await command('ISOLATEOBJECTS');
    expect(hist()).toBe('ISOLATEOBJECTS  1 object shown alone · UNISOLATEOBJECTS shows all again');
    await command('COUNT');
    expect(hist()).toMatch(/^COUNT {2}In view: 1 Line — 1 in all$/);
    // What is drawn while isolated shows.
    await command('L'); await clickAt(X, 9000); await clickAt(X + 1000, 9000); await command('');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await command('COUNT');
    expect(hist()).toMatch(/^COUNT {2}In view: 2 Line — 2 in all$/);
    await command('UNISOLATEOBJECTS');
    expect(hist()).toBe('UNISOLATEOBJECTS  All objects shown again.');
    await command('COUNT');
    expect(hist()).toMatch(/^COUNT {2}In view: 3 Line/);
    await clickAt(X + 6000, 3000); // S2
    await command('HIDEOBJECTS');
    expect(hist()).toBe('HIDEOBJECTS  1 object hidden · UNISOLATEOBJECTS shows all again');
    await command('COUNT');
    expect(hist()).toMatch(/^COUNT {2}In view: 2 Line/);
    await command('UNHIDE');
    await command('COUNT');
    expect(hist()).toMatch(/^COUNT {2}In view: 3 Line/);
  });

  it('QUICKMEASURE, ADDSELECTED, PAN, UNDO and REDO', async () => {
    await start();
    await command('QM');
    expect(hist()).toBe('QUICKMEASURE  Pick lines, polylines, arcs or circles first.');
    await clickAt(X + 2000, 0);
    await command('QM');
    expect(hist()).toMatch(/^QUICKMEASURE {2}1 object: length 4(\.0+)? m$/);
    await command('ADDSELECTED');
    expect(state.tool).toBe('line');
    await command('');
    await command('PAN');
    expect([state.tool, hist()]).toEqual(['pan', 'Command: PAN  Drag to pan. Enter or Esc to end:']);
    await command('');
    expect(state.tool).toBe('none');
    expect(state.history).toContain('PAN  Ended.');
    await command('UNDO');
    expect(hist()).toBe('UNDO  Nothing to undo.');
    await command('REDO');
    expect(hist()).toBe('REDO  Nothing to redo.');
  });

  it('the command menu: Snap overrides ▸ Endpoint makes the next point snap to an endpoint only; Recent input ▸ types a value again', async () => {
    await start();
    expect(state.toggles.osnap).toBe(false);
    await command('L');
    await right(X + 20000, 20000, true);
    await act(async () => { entry('Snap overrides').click(); });
    await act(async () => { entry('Endpoint').click(); });
    expect(hist()).toBe('Endpoint snap for the next point.');
    await clickAt(X + 4000 + 60, 60); // near S1's end
    await command('@0,2000');
    await command('');
    expect(lines().slice(-1)[0].pts[0]).toEqual([X + 4000, 0]);
    await command('L');
    await right(X + 20000, 20000, true);
    await act(async () => { entry('Recent input').click(); });
    expect(entry('@0,2000')).toBeTruthy();
  });

  it('the menu of drawn objects picked: Isolate ▸, Add selected, Quick measure, Count and Deselect all run their tools', async () => {
    await start();
    await clickAt(X + 2000, 0);
    await right(X + 2000, 0);
    await act(async () => { entry('Quick measure').click(); });
    expect(hist()).toMatch(/^QUICKMEASURE {2}1 object/);
    await right(X + 2000, 0);
    await act(async () => { entry('Isolate ▸').click(); });
    await act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Isolate"] button')].find((b) => b.textContent?.startsWith('Hide objects'))!.click(); });
    expect(hist()).toBe('HIDEOBJECTS  1 object hidden · UNISOLATEOBJECTS shows all again');
    await clickAt(X + 6000, 3000);
    await right(X + 6000, 3000);
    await act(async () => { entry('Deselect all').click(); });
    await command('COUNT');
    expect(hist()).toMatch(/^COUNT {2}In view: 1 Line/);
  });
});

describe('right-click menus, phase 2: LV and ELV objects and the tools behind them', () => {
  const hist = () => document.querySelector('.cad-hist')!.textContent;
  const right = (x: number, y: number) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); }); };
  const entry = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((b) => (b.firstElementChild?.textContent ?? b.textContent) === label)!;
  const pickEntry = async (...path: string[]) => { for (const l of path) { const b = entry(l); expect(b, l).toBeTruthy(); await act(async () => { b.click(); }); } };
  const esc = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  const lit: Project = {
    ...villa,
    boards: villa.boards.map((b) => (b.id === 'DB-GF1' ? { ...b, planPoint: { x: 1, y: 1 }, level: { building: 'V', level: 'GF' } } : b)),
    lvPoints: [
      { id: 'P1', type: 'ltg', feederId: 'DB-GF1-Y1', buildingId: 'V', levelId: 'GF', x: 3, y: 9 },
      { id: 'P2', type: 'ltg', feederId: 'DB-GF1-Y1', buildingId: 'V', levelId: 'GF', x: 6, y: 9 },
      { id: 'P3', type: 's13', feederId: 'DB-GF1-B6', buildingId: 'V', levelId: 'GF', x: 6, y: 4 }
    ]
  };
  const start = async (p: Project, show?: (s: CadShow) => void) => { project = p; act(() => root.render(<Host start={p} show={show} />)); await flush(); act(() => state.toggle('osnap')); };

  it('a light: Select same circuit, Circuit ▸ Draw home-run, Show in SLD and the load schedule; a board: Draw home-runs, Load schedule, riser', async () => {
    const show = vi.fn();
    await start(lit, show);
    await right(3000, 9000);
    await pickEntry('Select same circuit');
    expect(hist()).toBe('SEL  2 devices on DB-GF1/Y1 on this level');
    await right(3000, 9000);
    await pickEntry('Circuit', 'Draw home-run');
    expect(project.cadWiring).toEqual([{ feederId: 'DB-GF1-Y1' }]);
    await right(3000, 9000);
    await pickEntry('Show in SLD');
    expect(show).toHaveBeenLastCalledWith({ to: 'sld', feeder: 'DB-GF1-Y1', board: 'DB-GF1' });
    await right(3000, 9000);
    await pickEntry('Show in load schedule');
    expect(show).toHaveBeenLastCalledWith({ to: 'load-schedule', board: 'DB-GF1' });
    await esc();
    await right(1000, 1000);
    await pickEntry('Draw home-runs');
    expect(project.cadWiring!.map((w) => w.feederId).sort()).toEqual(['DB-GF1-B6', 'DB-GF1-Y1']);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toMatch(/^1 circuit of DB-GF1 wired on /);
    await right(1000, 1000);
    await pickEntry('Show in riser');
    expect(show).toHaveBeenLastCalledWith({ to: 'riser', board: 'DB-GF1' });
    await right(1000, 1000);
    await pickEntry('Select all fed devices');
    expect(hist()).toMatch(/^SEL {2}3 devices on DB-GF1's circuits/);
  });

  it('a room with an outline: Room ▸ Room loads, Select devices in room, Rename room… and Room type… on the command line', async () => {
    const outline: [number, number][] = [[100, 100], [104, 100], [104, 104], [100, 104]];
    const p: Project = { ...lit, building: { ...villa.building!, roomTypes: DEFAULT_ROOM_TYPES, rooms: [{ id: 'R9', buildingId: 'V', levelId: 'GF', name: 'Store', type: 'office', areaM2: 16, outline }] },
      lvPoints: [...lit.lvPoints!, { id: 'P9', type: 'ltg', feederId: 'DB-GF1-Y1', buildingId: 'V', levelId: 'GF', x: 101, y: 101 }] };
    await start(p);
    await right(102500, 102500);
    await pickEntry('Room Store', 'Room loads');
    expect(hist()).toBe('LOADS  Store: Office: 1.60 kW connected, 1.28 kW demand (100 W/m² × 16.0 m², ×0.8) · 1 Light');
    await right(102500, 102500);
    await pickEntry('Room Store', 'Select devices in room');
    expect(hist()).toBe('SEL  1 device in Store');
    await esc();
    await right(102500, 102500);
    await pickEntry('Room Store', 'Rename room…');
    await command('Plant room');
    expect(buildingInfoOf(project).rooms[0].name).toBe('Plant room');
    await right(102500, 102500);
    await pickEntry('Room Plant room', 'Room type…');
    expect(hist()).toMatch(/^ROOM TYPE {2}Plant room: type the room type \(.*\) <Office>:$/);
    await command('retail');
    expect(buildingInfoOf(project).rooms[0].type).toBe('retail');
    await right(102500, 102500);
    await pickEntry('Room Plant room', 'Light room…');
    expect(state.tool).toBe('lux');
  });

  it('a cable route: Trace circuit picks its devices, Reverse direction; a tray: Size tray from cables, Fill ratio check, Cables in this route', async () => {
    const X = 200000;
    const route: SketchItem = { id: 'C1', kind: 'pline', layer: 'E-CABLE', pts: [[X, 0], [X + 4000, 0], [X + 4000, 3000]], cable: { feederId: 'DB-GF1-Y1' } };
    const tray: SketchItem = { id: 'T1', kind: 'pline', layer: 'E-TRAY', pts: [[X, 10000], [X + 6000, 10000]], tray: { widthMm: 50, service: 'Power', route: 'A' } };
    const bare: SketchItem = { ...tray, id: 'T2', pts: [[X, 20000], [X + 6000, 20000]], tray: { widthMm: 100 } };
    const p: Project = { ...lit, feeders: lit.feeders.map((f) => (f.id === 'INC-GF' || f.id === 'INC-FF' ? { ...f, trayRoute: 'A' } : f)),
      trays: { ...trayPlanOf(lit), routes: [{ id: 'RA', name: 'A', cables: [] }] }, cadSketch: [{ file: 'sample-villa-gf.dxf', items: [route, tray, bare] }] };
    await start(p);
    await clickAt(X + 2000, 0);
    await right(X + 2000, 0);
    await pickEntry('Trace circuit');
    expect(hist()).toMatch(/^TRACE {2}DB-GF1\/Y1.*: 3 devices and boards on this level$/);
    await esc();
    await clickAt(X + 2000, 0);
    await right(X + 2000, 0);
    await pickEntry('Reverse direction');
    expect(sketchOf(project, 'sample-villa-gf.dxf').find((it) => it.id === 'C1')!.pts).toEqual([[X + 4000, 3000], [X + 4000, 0], [X, 0]]);
    await esc();
    await clickAt(X + 3000, 10000);
    await right(X + 3000, 10000);
    await pickEntry('Size tray from cables');
    const need = sizeRoute(p, trayPlanOf(p), { id: 'RA', name: 'A', cables: [] }).autoWidthMm;
    expect(need).toBeGreaterThan(50);
    expect(sketchOf(project, 'sample-villa-gf.dxf').find((it) => it.id === 'T1')!.tray!.widthMm).toBe(need);
    await right(X + 3000, 10000);
    await pickEntry('Fill ratio check');
    expect(hist()).toMatch(new RegExp(`^FILL  ${need} mm tray: [\\d.]+% full \\(limit \\d+%\\) — OK$`));
    await right(X + 3000, 10000);
    await pickEntry('Cables in this route');
    expect(hist()).toMatch(/^CABLES {2}Route A: 2 cables — MDB-1 → SMDB-GF/);
    await esc();
    await clickAt(X + 3000, 20000);
    await right(X + 3000, 20000);
    await pickEntry('Fill ratio check');
    expect(hist()).toMatch(/^TRAY {2}This tray is on no route/);
  });
});

describe('right-click menus, phase 3: blocks, references and layouts', () => {
  const X = 200000, F = 'sample-villa-gf.dxf';
  const hist = () => document.querySelector('.cad-hist')!.textContent;
  const right = (x: number, y: number) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); }); };
  const entry = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((b) => (b.firstElementChild?.textContent ?? b.textContent) === label)!;
  const pickEntry = async (...path: string[]) => { for (const l of path) { const b = entry(l); expect(b, l).toBeTruthy(); await act(async () => { b.click(); }); } };
  const esc = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  const start = async (p: Project) => { project = p; act(() => root.render(<Host start={p} />)); await flush(); act(() => state.toggle('osnap')); };
  const line = { id: 'b1', kind: 'line' as const, layer: '0', pts: [[0, 0], [2000, 0]] as [number, number][] };
  const B1: CadBlockDef = { name: 'B1', items: [line] };
  const B2: CadBlockDef = { name: 'B2', items: [line, { id: 'b2', kind: 'attdef', layer: '0', pts: [[0, 500]], tag: 'TAG', text: 'X', h: 250 }] };
  const ins = (id: string, y: number, block: string, attrs?: Record<string, string>): SketchItem => ({ id, kind: 'insert', layer: '0', pts: [[X, y]], block, ...(attrs ? { attrs } : {}) });
  afterEach(() => dropRefGeometry('REF.dxf'));

  it('a block drawn here: Count instances, Replace with another block ▸, Reset attributes, Explode', async () => {
    await start({ ...villa, cadBlockDefs: [{ file: F, defs: [B1, B2] }], cadSketch: [{ file: F, items: [ins('I1', 0, 'B1'), ins('I2', 5000, 'B1'), ins('I3', 10000, 'B2', { TAG: 'L1' })] }] });
    const item = (id: string) => sketchOf(project, F).find((x) => x.id === id);
    await clickAt(X + 1000, 0);
    await right(X + 1000, 0);
    await pickEntry('Count instances');
    expect(hist()).toBe('COUNT  "B1": 2 in this drawing');
    await right(X + 1000, 0);
    await pickEntry('Replace with another block ▸', 'B2');
    expect(item('I1')!.block).toBe('B2');
    await esc();
    await clickAt(X + 1000, 10000);
    await right(X + 1000, 10000);
    await pickEntry('Reset attributes');
    expect(item('I3')!.attrs).toBeUndefined();
    await right(X + 1000, 10000);
    await pickEntry('Explode');
    expect(sketchOf(project, F).filter((x) => x.kind === 'insert').map((x) => x.id)).toEqual(['I1', 'I2']); // I3's first piece keeps its id
    expect(hist()).toMatch(/^EXPLODE {2}"B2": 2 objects/);
  });

  it('a reference drawing: Fade ▸, print on sheets, Open reference, Detach', async () => {
    keepRefGeometry({ file: 'REF.dxf', units: 4, segs: new Float64Array([0, 0, 5000, 0]), segLayers: new Uint16Array([0]), layers: [{ name: 'A-WALL', rgb: 0 }] });
    await start({ ...villa, cadRefs: { [F]: [{ name: 'REF', file: 'REF.dxf', type: 'overlay', at: [X, 50000], scale: 1, rot: 0, fade: 50, print: true }] } });
    const ref = () => project.cadRefs?.[F]?.[0];
    await right(X + 2500, 50000);
    await pickEntry('Fade', '25 %');
    expect(ref()!.fade).toBe(25);
    await right(X + 2500, 50000);
    await pickEntry('Do not print on sheets');
    expect(ref()!.print).toBe(false);
    await right(X + 2500, 50000);
    await pickEntry('Open reference');
    expect(hist()).toMatch(/^XREF {2}REF\.dxf: where it is on this computer is not known/);
    await right(X + 2500, 50000);
    await pickEntry('Detach');
    expect(ref()).toBeUndefined();
  });

  it('a layout: right-click in a viewport for its scale, lock and model space; on the paper for the issue status, MV and the Model tab', async () => {
    let p: Project = { ...villa, cadPlans: [{ building: 'V', level: 'GF', file: F, units: 4 }] };
    for (const [x, y] of [[3, 9], [6, 9.4], [9, 8.8]]) p = placeLvPoint(p, { building: 'V', level: 'GF' }, 'ltg', 'DB-GF1-B2', x, y).project;
    await start(p);
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.cad-ltab')].find((b) => b.textContent === 'Model')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 500 })));
    act(() => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent?.startsWith('Lighting layout'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const sheet = () => project.drawingSet!.sheets.find((x) => x.kind === 'plan')!;
    await until(() => !!document.querySelector('.cad-vp'));
    const frame = document.querySelector<HTMLElement>('.cad-vp')!;
    const [l, t, w, h] = ['left', 'top', 'width', 'height'].map((k) => parseFloat(frame.style.getPropertyValue(k)));
    const paperRight = (x: number, y: number) => act(async () => { document.querySelector('.cad-vps')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })); });
    await paperRight(l + w / 2, t + h / 2);
    await pickEntry('Viewport scale', '1:50');
    expect(sheet().viewports![0].scale).toBe(50);
    await paperRight(l + w / 2, t + h / 2);
    await pickEntry('Unlock display');
    expect(sheet().viewports![0].locked).toBe(false);
    await paperRight(l + w / 2, t + h / 2);
    await pickEntry('Activate (model space)');
    expect(state.msVp).toBe('vp1');
    await command('PS');
    await paperRight(l + w + 40, t + h + 20);
    await pickEntry('Issue status', 'FOR APPROVAL');
    expect(sheet().status).toBe('FOR APPROVAL');
    await paperRight(l + w + 40, t + h + 20);
    await pickEntry('New viewport');
    expect(hist()).toMatch(/^MVIEW {2}Click two corners/);
    await esc();
    await paperRight(l + w / 2, t + h / 2);
    await pickEntry('Show on the Model tab');
    expect(state.layout).toBeNull();
  }, 20_000);
});

describe('right-click menus, phase 4: texts, dimensions, hatches, polylines, hot grips and FIND', () => {
  const X = 200000, F = 'sample-villa-gf.dxf';
  const hist = () => document.querySelector('.cad-hist')!.textContent;
  const right = (x: number, y: number) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); }); };
  const entry = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((b) => (b.firstElementChild?.textContent ?? b.textContent) === label)!;
  const pickEntry = async (...path: string[]) => { for (const l of path) { const b = entry(l); expect(b, l).toBeTruthy(); await act(async () => { b.click(); }); } };
  const esc = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  /** A press and let go in place: on a grip of the object picked, it turns hot. */
  const press = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y), c = document.querySelector('canvas.cad-over')!;
    await act(async () => { for (const t of ['mousemove', 'mousedown', 'mouseup']) c.dispatchEvent(new MouseEvent(t, { clientX: sx, clientY: sy, button: 0, bubbles: true })); });
  };
  const start = async (items: SketchItem[]) => { const p = { ...villa, cadSketch: [{ file: F, items }] }; project = p; act(() => root.render(<Host start={p} />)); await flush(); act(() => state.toggle('osnap')); };
  const item = (id: string) => sketchOf(project, F).find((x) => x.id === id)!;

  it('a text: Justify ▸, Text height ▸, Case ▸, Frame ▸ and Background mask; FIND replaces words in every text', async () => {
    await start([{ id: 'T1', kind: 'text', layer: '0', pts: [[X, 0]], text: 'Panel a', h: 250 }, { id: 'T2', kind: 'text', layer: '0', pts: [[X, 5000]], text: 'panel b', h: 250 }]);
    await clickAt(X + 300, 100);
    await right(X + 300, 100);
    await pickEntry('Case ▸', 'UPPER CASE');
    expect(item('T1').text).toBe('PANEL A');
    await right(X + 300, 100);
    await pickEntry('Text height ▸', '5 mm on paper');
    expect(item('T1').h).toBeCloseTo(5 * unitsPerPaperMm(annoOf(project), 0.001), 6);
    await right(X + 300, 100);
    await pickEntry('Justify ▸', 'Middle centre');
    expect(item('T1').just).toBe('MC');
    await right(X + 300, 100);
    await pickEntry('Frame ▸', 'Box');
    expect(item('T1').frame).toBe('box');
    await right(X + 300, 100);
    await pickEntry('Background mask');
    expect(item('T1').mask).toBe(true);
    await esc();
    await command('FIND');
    await command('panel');
    expect(hist()).toBe('FIND  2 found for "panel". Replace with (Enter: leave them):');
    await command('Board');
    expect([item('T1').text, item('T2').text]).toEqual(['Board A', 'Board b']);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('FIND  2 replaced: "panel" → "Board" in 2 objects · ⌘Z to undo');
  });

  it('a dimension: Precision ▸, Text position ▸, Remove text override; a hatch: Hatch angle ▸, Hatch scale ▸, Recreate boundary', async () => {
    await start([
      { id: 'D1', kind: 'dim', layer: '0', pts: [[X, 20000], [X + 4000, 20000], [X + 2000, 21000]], text: 'TYP.', h: 250 },
      { id: 'H1', kind: 'pline', layer: '0', closed: true, pts: [[X, 40000], [X + 4000, 40000], [X + 4000, 44000], [X, 44000]], hatch: { pattern: 'ansi31', scale: 1, angle: 0 } }
    ]);
    await clickAt(X + 1000, 21000);
    await right(X + 1000, 21000);
    await pickEntry('Precision ▸', '0.0');
    expect(item('D1').look!.decimals).toBe(1);
    await right(X + 1000, 21000);
    await pickEntry('Text position ▸', 'Above');
    expect(item('D1').look!.textPos).toBe('above');
    await right(X + 1000, 21000);
    await pickEntry('Remove text override');
    expect(item('D1').text).toBeUndefined();
    await esc();
    await clickAt(X + 1000, 40000);
    await right(X + 1000, 40000);
    await pickEntry('Hatch angle ▸', '45°');
    expect(item('H1').hatch!.angle).toBe(45);
    await right(X + 1000, 40000);
    await pickEntry('Hatch scale ▸', '× 2 (wider apart)');
    expect(item('H1').hatch!.scale).toBe(2);
    await right(X + 1000, 40000);
    await pickEntry('Recreate boundary');
    const plain = sketchOf(project, F).filter((x) => x.kind === 'pline' && !x.hatch);
    expect(plain.map((x) => x.pts)).toEqual([item('H1').pts]);
    // The hatch follows the new outline from now on.
    expect(item('H1').assoc).toEqual([plain[0].id]);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('HATCH  Its boundary drawn as 1 closed polyline; the hatch is associative with it · ⌘Z to undo');
  });

  it('a hatch with islands: Edit hatch…, Set origin and Remove islands join Hatch scale, Hatch angle and Recreate boundary', async () => {
    const hole: [number, number][] = [[X + 1000, 41000], [X + 2000, 41000], [X + 2000, 42000]];
    await start([{ id: 'H1', kind: 'pline', layer: 'LV-HATCH', closed: true, pts: [[X, 40000], [X + 4000, 40000], [X + 4000, 44000], [X, 44000]], hatch: { pattern: 'ansi31', scale: 1, angle: 0 }, holes: [hole] }]);
    await clickAt(X + 4000, 42000);
    await right(X + 4000, 42000);
    const labels = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].map((b) => b.firstElementChild?.textContent ?? b.textContent ?? '');
    expect(labels().filter((t) => /hatch|origin|islands|boundary/i.test(t))).toEqual(['Edit hatch…', 'Hatch scale ▸', 'Hatch angle ▸', 'Set origin', 'Remove islands', 'Recreate boundary']);
    await pickEntry('Remove islands');
    expect(item('H1').holes).toBeUndefined();
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('HATCH  Islands removed · ⌘Z to undo');
    await right(X + 4000, 42000);
    expect(labels()).not.toContain('Remove islands');
    await pickEntry('Set origin');
    expect(hist()).toBe('HATCHEDIT  Click the pattern\'s origin:');
    await clickAt(X + 1500, 41500);
    expect(item('H1').hatch!.origin).toEqual([X + 1500, 41500]);
    await esc();
    await right(X + 4000, 42000);
    await pickEntry('Edit hatch…');
    await until(() => document.body.textContent!.includes('Edit hatch'));
  });

  it('a polyline: Close / Open, Reverse direction, Use as room boundary, Explode', async () => {
    await start([{ id: 'P1', kind: 'pline', layer: '0', pts: [[X, 60000], [X + 4000, 60000], [X + 4000, 63000]] }]);
    await clickAt(X + 1000, 60000);
    await right(X + 1000, 60000);
    await pickEntry('Close');
    expect(item('P1').closed).toBe(true);
    await right(X + 1000, 60000);
    await pickEntry('Reverse direction');
    expect(item('P1').pts).toEqual([[X + 4000, 63000], [X + 4000, 60000], [X, 60000]]);
    await right(X + 1000, 60000);
    await pickEntry('Use as room boundary');
    expect(hist()).toMatch(/^Room area = 6(\.0+)? m² — add it as a room in the panel on the right$/);
    await right(X + 1000, 60000);
    await pickEntry('Explode');
    expect(sketchOf(project, F).filter((x) => x.kind === 'line')).toHaveLength(3);
  });

  it('a hot grip: a click on it (no drag), then right-click: Add vertex, Remove vertex, Move from this point', async () => {
    await start([{ id: 'G1', kind: 'pline', layer: '0', pts: [[X, 80000], [X + 4000, 80000], [X + 4000, 83000]] }]);
    await clickAt(X + 1000, 80000);
    await right(X + 1000, 80000);
    expect(entry('Close')).toBeTruthy(); // not on a grip: the polyline's menu
    await esc();
    await clickAt(X + 1000, 80000);
    await press(X + 2000, 80000); // the first side's grip
    expect(hist()).toMatch(/^GRIP {2}Hot grip/);
    await right(X + 2000, 80000);
    await pickEntry('Add vertex');
    expect(item('G1').pts).toEqual([[X, 80000], [X + 2000, 80000], [X + 4000, 80000], [X + 4000, 83000]]);
    await press(X + 4000, 83000);
    await right(X + 4000, 83000);
    await pickEntry('Remove vertex');
    expect(item('G1').pts).toEqual([[X, 80000], [X + 2000, 80000], [X + 4000, 80000]]);
    await press(X, 80000);
    await right(X, 80000);
    await pickEntry('Move from this point');
    expect(state.tool).toBe('move');
    await clickAt(X, 90000);
    expect(item('G1').pts[0]).toEqual([X, 90000]);
  });
});

describe('right-click menus: fixes from the audit of 2026-11-11', () => {
  const X = 200000, F = 'sample-villa-gf.dxf';
  const hist = () => document.querySelector('.cad-hist')!.textContent;
  const right = (x: number, y: number) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); }); };
  const labels = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] > button')].map((b) => b.firstElementChild?.textContent ?? b.textContent);
  const entry = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((b) => (b.firstElementChild?.textContent ?? b.textContent) === label)!;
  const pickEntry = async (...path: string[]) => { for (const l of path) { const b = entry(l); expect(b, l).toBeTruthy(); await act(async () => { b.click(); }); } };
  const esc = () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  const start = async (p: Project) => { project = p; act(() => root.render(<Host start={p} />)); await flush(); act(() => state.toggle('osnap')); };
  const item = (id: string) => sketchOf(project, F).find((x) => x.id === id);
  const line: SketchItem = { id: 'L1', kind: 'line', layer: '0', pts: [[X, 0], [X + 4000, 0]] };

  it('a dimension: Dimension style ▸ lists the project\'s styles and applies one', async () => {
    const dim: SketchItem = { id: 'D1', kind: 'dim', layer: '0', pts: [[X, 20000], [X + 4000, 20000], [X + 2000, 21000]], h: 250 };
    await start({ ...villa, cadDimStyles: { styles: [{ name: 'Arch', textMm: 3.5 } as CadDimStyle], current: 'Standard' }, cadSketch: [{ file: F, items: [dim] }] });
    await clickAt(X + 1000, 21000);
    await right(X + 1000, 21000);
    await pickEntry('Dimension style ▸', 'Arch');
    expect(item('D1')!.h).toBeCloseTo(3.5 * unitsPerPaperMm(annoOf(project), 0.001), 6);
    expect(item('D1')!.look).toBeDefined();
  });

  it('drawn objects: Repeat the last command first, Properties last; Cut (Ctrl+X) copies and erases, Paste brings it back', async () => {
    await start({ ...villa, cadSketch: [{ file: F, items: [line] }] });
    await command('COUNT');
    act(() => state.setShowProps(false));
    await clickAt(X + 1000, 0);
    await right(X + 1000, 0);
    expect(labels()[0]).toBe('Repeat COUNT');
    expect(labels().slice(-1)).toEqual(['Properties']);
    await pickEntry('Properties');
    expect(state.showProps).toBe(true);
    await right(X + 1000, 0);
    await pickEntry('Clipboard ▸', 'Cut');
    expect(item('L1')).toBeUndefined();
    expect(hist()).toBe('CUTCLIP  1 object cut to the clipboard · ⌘Z to undo');
    await command('PASTEORIG');
    expect(hist()).toMatch(/^PASTEORIG {2}Not in the drawing the objects came from/); // the clipboard has it
  });

  it('a layout made with +: right-click inside its viewport for Viewport scale ▸ and Show on the Model tab, outside for the layout\'s own commands', async () => {
    await start(villa);
    act(() => (document.querySelector('[aria-label="New layout"]') as HTMLButtonElement).click());
    expect(state.layout).toBe('dwg:Layout2');
    await until(() => !!document.querySelector('.cad-filepaper'));
    const paperRight = (x: number, y: number) => act(async () => { document.querySelector('.cad-filepaper')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })); });
    // jsdom lays the pane out at 0 × 0: the paper is fitted round (0, 0), its viewport over that point.
    await paperRight(0, 0);
    expect(labels()).toEqual(['Show on the Model tab', 'Viewport scale', 'New layout', 'Arrange viewports', 'Page setup…', 'Rename layout…', 'Copy layout', 'Delete layout', 'Model tab']);
    await pickEntry('Viewport scale', '1:50');
    const v = drawingLayoutsOf(project, F)[0].viewports[0];
    expect(v.vh).toBeCloseTo(v.h * 50, 6); // mm drawing: vh = h × 50 drawing units
    await paperRight(40, 0);
    expect(labels()).toEqual(['New layout', 'Arrange viewports', 'Page setup…', 'Rename layout…', 'Copy layout', 'Delete layout', 'Model tab']);
    await esc();
    await paperRight(0, 0);
    await pickEntry('Show on the Model tab');
    expect(state.layout).toBeNull();
    // Back on the layout: Arrange viewports ▸ and Page setup… are in the paper's menu too.
    act(() => state.setLayout('dwg:Layout2'));
    await until(() => !!document.querySelector('.cad-filepaper'));
    await paperRight(40, 0);
    await pickEntry('Arrange viewports', 'Two: side by side');
    expect(drawingLayoutsOf(project, F)[0].viewports).toHaveLength(2);
    await paperRight(40, 0);
    await pickEntry('Page setup…');
    expect(document.querySelector('[aria-label="Page setup"]')).not.toBeNull();
    act(() => button('Cancel').click());
  });
});

describe('block editor (BEDIT, BSAVE, BCLOSE)', () => {
  const X = 200000, F = 'sample-villa-gf.dxf', ED = 'Block B1 = sample-villa-gf.dxf.dxf';
  const hist = () => document.querySelector('.cad-hist')!.textContent;
  const right = (x: number, y: number) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); }); };
  const entry = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((b) => (b.firstElementChild?.textContent ?? b.textContent) === label)!;
  const B1: CadBlockDef = { name: 'B1', items: [{ id: 'b1', kind: 'line', layer: '0', pts: [[0, 0], [2000, 0]] }] };
  const ins = (id: string, y: number): SketchItem => ({ id, kind: 'insert', layer: '0', pts: [[X, y]], block: 'B1' });
  const def = () => blockDefOf(blockDefsOf(project, F), 'B1')!;

  it('opens a block from its right-click menu, saves what is drawn into it (every insert follows), and closes it, asking to save', async () => {
    const p: Project = { ...villa, cadBlockDefs: [{ file: F, defs: [B1] }], cadSketch: [{ file: F, items: [ins('I1', 0), ins('I2', 5000)] }] };
    project = p; act(() => root.render(<Host start={p} />)); await flush(); act(() => state.toggle('osnap'));
    await clickAt(X + 1000, 0);
    await right(X + 1000, 0);
    await act(async () => { entry('Open block editor').click(); });
    await until(() => state.view?.file === ED);
    expect(document.querySelector('.cad-tabs [role="tab"][aria-selected="true"]')!.textContent).toBe('Block editor · B1 (in sample-villa-gf.dxf)');
    expect(sketchOf(project, ED).map((it) => it.kind)).toEqual(['line']);
    // Draw in it: a second line, then BSAVE; both inserts show it.
    await command('L'); await clickAt(0, 500); await clickAt(2000, 500); await command('');
    await command('SAVE');
    expect(hist()).toBe('BSAVE  "B1" saved: 2 objects · 2 inserts in sample-villa-gf.dxf updated · ⌘Z to undo');
    expect(def().items[1].layer).toBe('0');
    expect(def().items.map((it) => it.pts.map(([x, y]) => [Math.round(x / 10) * 10 + 0, Math.round(y / 10) * 10 + 0]))).toEqual([[[0, 0], [2000, 0]], [[0, 500], [2000, 500]]]);
    // A change not saved: BCLOSE asks; No closes without it, back on the drawing.
    await command('L'); await clickAt(0, 900); await clickAt(1000, 900); await command('');
    await command('BCLOSE');
    expect(hist()).toBe('BCLOSE  Save the changes to "B1"? [Yes/No/Cancel] <Yes>:');
    await command('N');
    expect(state.view?.file).toBe(F);
    expect(def().items).toHaveLength(2);
    expect(sketchOf(project, ED)).toEqual([]);
    expect(blockDefsOf(project, ED)).toEqual([]);
  });

  it('BEDIT and a name opens it; BEDIT alone with nothing picked lists the blocks; BSAVE outside the editor says so', async () => {
    const p: Project = { ...villa, cadBlockDefs: [{ file: F, defs: [B1, { ...B1, name: 'B2' }] }] };
    project = p; act(() => root.render(<Host start={p} />)); await flush();
    await command('BEDIT');
    expect(hist()).toBe('BEDIT  Pick a block, or type BEDIT and its name: B1, B2');
    await command('BSAVE');
    expect(hist()).toBe('BSAVE  Not in the block editor (BEDIT opens a block in it).');
    await command('BEDIT b2');
    await until(() => state.view?.file === 'Block B2 = sample-villa-gf.dxf.dxf');
    await command('BCLOSE');
    expect(state.view?.file).toBe(F);
  });
});

describe('edit block in place (REFEDIT, REFCLOSE)', () => {
  const X = 200000, F = 'sample-villa-gf.dxf';
  const hist = () => document.querySelector('.cad-hist')!.textContent;
  const right = (x: number, y: number) => { const [sx, sy] = screenOf(x, y); return act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('contextmenu', { clientX: sx, clientY: sy, button: 2, bubbles: true, cancelable: true })); }); };
  const entry = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((b) => (b.firstElementChild?.textContent ?? b.textContent) === label)!;
  const B1: CadBlockDef = { name: 'B1', items: [{ id: 'b1', kind: 'line', layer: '0', pts: [[0, 0], [2000, 0]] }] };
  const ins = (id: string, y: number): SketchItem => ({ id, kind: 'insert', layer: '0', pts: [[X, y]], block: 'B1' });
  const def = () => blockDefOf(blockDefsOf(project, F), 'B1')!;
  const items = () => sketchOf(project, F);
  const start = async () => {
    const p: Project = { ...villa, cadBlockDefs: [{ file: F, defs: [B1] }], cadSketch: [{ file: F, items: [ins('I1', 0), ins('I2', 5000)] }] };
    project = p; act(() => root.render(<Host start={p} />)); await flush(); act(() => state.toggle('osnap'));
  };
  const round = (pts: [number, number][]) => pts.map(([x, y]) => [Math.round(x / 10) * 10 + 0, Math.round(y / 10) * 10 + 0]);

  it('from a block\'s menu: its objects picked out where it stands, the rest locked; what is drawn joins it; REFCLOSE Save redefines it', async () => {
    await start();
    await clickAt(X + 1000, 0);
    await right(X + 1000, 0);
    await act(async () => { entry('Edit block in place').click(); });
    expect(hist()).toMatch(/^REFEDIT {2}Editing "B1" in place: its 1 object picked out, the rest faded and locked/);
    expect(items().map((it) => it.kind)).toEqual(['insert', 'line']); // I2 stays; I1 is its line now
    expect(project.cadRefEdit).toMatchObject({ file: F, index: 0, others: ['I2'] });
    // The other insert is locked: a click on it picks nothing; the block's line can be picked.
    await clickAt(X + 1000, 5000);
    expect(state.selected).toBeNull();
    await command('L'); await clickAt(X, 500); await clickAt(X + 2000, 500); await command('');
    await command('SAVE');
    expect(hist()).toBe('SAVE  "B1" is being edited in place: REFCLOSE first (Save or Discard).');
    await command('REFCLOSE');
    expect(hist()).toBe('REFCLOSE  Save the changes to "B1"? [Save/Discard/Cancel] <Save>:');
    await command('');
    expect(project.cadRefEdit).toBeUndefined();
    expect(items().map((it) => it.id)).toEqual(['I1', 'I2']);
    expect(def().items.map((it) => round(it.pts))).toEqual([[[0, 0], [2000, 0]], [[0, 500], [2000, 500]]]);
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][1]).toBe('REFCLOSE  "B1" saved: 2 objects · 2 inserts in sample-villa-gf.dxf updated · ⌘Z to undo');
  });

  it('REFEDIT on the block picked, the line erased, then Discard changes on the blank menu: all as it was', async () => {
    await start();
    await clickAt(X + 1000, 0);
    await command('REFEDIT');
    await clickAt(X + 1000, 0);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); });
    expect(items().map((it) => it.id)).toEqual(['I2']);
    await right(X + 50000, 50000);
    await act(async () => { entry('Discard changes').click(); });
    expect(project.cadRefEdit).toBeUndefined();
    expect(items().map((it) => it.id)).toEqual(['I1', 'I2']);
    expect(def()).toEqual(B1);
  });
});

describe('Design CAD hatch package: islands, associative hatches, HATCHEDIT and BOUNDARY', () => {
  const X = 200000, F = 'sample-villa-gf.dxf';
  const sq = (id: string, x0: number, y0: number, x1: number, y1: number): SketchItem => ({ id, kind: 'pline', layer: 'LV-SKETCH', closed: true, pts: [[X + x0, y0], [X + x1, y0], [X + x1, y1], [X + x0, y1]] });
  const withItems = (...it: SketchItem[]): Project => ({ ...villa, cadSketch: [{ file: F, items: it }] });
  const items = () => project.cadSketch![0].items;
  const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][1];
  const hist = () => state.history[state.history.length - 1];
  const begin = async (p: Project) => { act(() => root.render(<Host start={p} />)); await flush(); await until(() => !!state.view && !!document.querySelector('canvas.cad-over')); act(() => state.toggle('osnap')); };
  const dblClickAt = async (x: number, y: number) => {
    const [sx, sy] = screenOf(x, y);
    await act(async () => { document.querySelector('canvas.cad-over')!.dispatchEvent(new MouseEvent('dblclick', { clientX: sx, clientY: sy, button: 0, bubbles: true })); });
  };
  const press = async (label: string) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === label); expect(b, label).toBeTruthy(); await act(async () => { b!.click(); }); };
  const choose = async (label: string, value: string) => {
    const s = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    await act(async () => { s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  const outer = sq('S1', 0, 0, 10000, 10000), island = sq('S2', 2000, 2000, 4000, 4000);

  it('HATCH leaves the closed objects inside clear as islands and follows the boundary; the message says so', async () => {
    await begin(withItems(outer, island));
    await command('H');
    expect(document.body.textContent).toContain('Find islands');
    await clickAt(X + 6000, 1000);
    expect(last()).toBe('Hatch ANSI31, 96.00 m² · 1 island · associative · ⌘Z to undo');
    expect(items()[2]).toMatchObject({ kind: 'pline', layer: 'LV-HATCH', holes: [island.pts], assoc: ['S1', 'S2'] });
    // With both ticks off: the whole outline, tied to nothing.
    for (const l of ['Find islands', 'Associative']) await act(async () => { (document.querySelector(`input[aria-label="${l}"]`) as HTMLInputElement).click(); });
    await clickAt(X + 6000, 1000);
    expect(last()).toBe('Hatch ANSI31, 100.00 m² · ⌘Z to undo');
    expect(items()[3].holes).toBeUndefined();
    expect(items()[3].assoc).toBeUndefined();
  });

  it('HATCH finds an area closed by drawn lines when there is no closed object or room', async () => {
    const line = (id: string, a: [number, number], b: [number, number]): SketchItem => ({ id, kind: 'line', layer: 'LV-SKETCH', pts: [[X + a[0], a[1]], [X + b[0], b[1]]] });
    await begin(withItems(line('L1', [0, 0], [10000, 0]), line('L2', [10000, 0], [10000, 10000]), line('L3', [10000, 10000], [0, 10000]), line('L4', [0, 10000], [0, 0])));
    await command('H');
    await clickAt(X + 5000, 5000);
    expect(last()).toMatch(/^Hatch ANSI31, 9\d\.\d\d m² · ⌘Z to undo$/); // the area the lines close (not a room), found a little inside them
    expect(items()[4].assoc).toBeUndefined();
  });

  it('HE edits the hatch clicked: pattern, then its islands removed, one undo step each; Enter ends', async () => {
    await begin(withItems(outer, island));
    await command('H');
    await clickAt(X + 6000, 1000);
    await command('HE');
    expect(hist()).toBe('Command: HATCHEDIT  Select a hatch:');
    await clickAt(X + 6000, 1000);
    await until(() => !!document.querySelector('select[aria-label="Hatch pattern"]') && document.body.textContent!.includes('Edit hatch'));
    expect(document.body.textContent).toContain('Islands: 1');
    const calls = onChange.mock.calls.length;
    await choose('Hatch pattern', 'brick');
    expect(onChange.mock.calls.length).toBe(calls + 1);
    expect(last()).toBe('HATCHEDIT  Pattern BRICK · ⌘Z to undo');
    expect(items()[2].hatch).toMatchObject({ pattern: 'brick', scale: 3 });
    expect(items()[2].assoc).toEqual(['S1', 'S2']);
    await press('Remove islands');
    expect(hist()).toBe('HATCHEDIT  Click inside an island to hatch it again (Enter ends):');
    await clickAt(X + 3000, 3000);
    expect(last()).toBe('HATCHEDIT  Island hatched again (0 left) · ⌘Z to undo');
    expect(items()[2].holes).toBeUndefined();
    expect(items()[2].assoc).toEqual(['S1']);
    await press('Add islands');
    expect(hist()).toBe('HATCHEDIT  Click inside closed objects in the hatch to keep clear (Enter ends):');
    await clickAt(X + 3000, 3000);
    expect(last()).toBe('HATCHEDIT  Island added (1) · ⌘Z to undo');
    expect(items()[2].holes).toEqual([island.pts]);
    expect(items()[2].assoc).toEqual(['S1', 'S2']);
    await command('');
    expect(state.tool).toBe('hatchedit'); // the question ends first
    await command('');
    expect(state.tool).toBe('none');
  });

  it('HE sets the pattern\'s origin by a click; Associative can be turned off (it says so)', async () => {
    await begin(withItems(outer, island));
    await command('H');
    await clickAt(X + 6000, 1000);
    await command('HE');
    await clickAt(X + 6000, 1000);
    await until(() => document.body.textContent!.includes('Origin X'));
    await press('Pick…');
    expect(hist()).toBe('HATCHEDIT  Click the pattern\'s origin:');
    await clickAt(X + 5000, 5000);
    expect(items()[2].hatch!.origin).toEqual([X + 5000, 5000]);
    expect(last()).toMatch(/^HATCHEDIT {2}Origin .* · ⌘Z to undo$/);
    await act(async () => { (document.querySelector('input[aria-label="Associative"]') as HTMLInputElement).click(); });
    expect(items()[2].assoc).toBeUndefined();
    expect(last()).toBe('HATCHEDIT  No longer associative · ⌘Z to undo');
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Associative"]')!.disabled).toBe(true);
  });

  it('a double-click on a hatch edits it; HE with a hatch picked first edits it at once', async () => {
    await begin(withItems(outer, island));
    await command('H');
    await clickAt(X + 6000, 1000);
    act(() => state.setTool('none'));
    await dblClickAt(X + 6000, 1000);
    expect(state.tool).toBe('hatchedit');
    await until(() => document.body.textContent!.includes('Edit hatch'));
    await command('');
    expect(state.tool).toBe('none');
    // Picked first (in a window with the objects it was made from): the hatches among them are edited at once.
    await dragWindow([X - 500, -500], [X + 10500, 10500]);
    await command('HE');
    await until(() => document.body.textContent!.includes('Edit hatch'));
  });

  it('BOUNDARY makes a closed polyline round the area and one per island, and repeats; I turns islands off', async () => {
    await begin(withItems(outer, island));
    await command('BO');
    expect(hist()).toBe('Command: BOUNDARY  Pick internal point or [Islands] <Islands on>:');
    await clickAt(X + 6000, 1000);
    expect(last()).toBe('BOUNDARY  1 polyline and 1 island made · ⌘Z to undo');
    expect(items().slice(2).map((x) => [x.kind, x.closed, x.layer])).toEqual([['pline', true, 'LV-SKETCH'], ['pline', true, 'LV-SKETCH']]);
    expect(items()[2].pts).toEqual(outer.pts);
    expect(items()[3].pts).toEqual(island.pts);
    await command('I');
    expect(hist()).toBe('BOUNDARY  Pick internal point or [Islands] <Islands off>:');
    await clickAt(X + 6000, 1000);
    expect(last()).toBe('BOUNDARY  1 polyline made · ⌘Z to undo');
    expect(items()).toHaveLength(5);
    expect(state.tool).toBe('boundary');
    await command('');
    expect(state.tool).toBe('none');
  });
});
