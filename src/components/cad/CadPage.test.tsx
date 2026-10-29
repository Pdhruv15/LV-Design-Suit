// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CadPage from './CadPage';
import { useCad, type CadState } from './cadState';
import { cadFileMenu } from './cadFileMenu';
import { buildingInfoOf } from '../../calc/building';
import { sampleProject } from '../../data/sampleProject';
import type { Project } from '../../types';

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
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); project = villa; onChange.mockClear();
  (window as { lvds?: unknown }).lvds = { cadFile: {
    engine: async () => bytes('electron/cad/lvds_cad_reader_bg.wasm'),
    sampleBytes: vi.fn(async (name: string) => ({ file: name, bytes: bytes(`electron/samples/${name}`) })),
    openBytes: vi.fn(async () => ({ file: 'plan.dwg', path: '/plans/plan.dwg', bytes: bytes('tests/fixtures/cad/plan-2018.dwg') }))
  } };
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; delete (window as { lvds?: unknown }).lvds; });

function Host({ start = villa }: { start?: Project }) {
  const cad = useCad('p1');
  const [p, setP] = useState(start);
  state = cad;
  return <CadPage cad={cad} project={p} onChange={(next, msg) => { setP(next); onChange(next, msg); }} onStatus={() => {}} />;
}
const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
const result = () => document.querySelector('.cad-res')?.textContent ?? '';
const command = async (text: string) => {
  const input = document.querySelector('input[aria-label="Command"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { input.form!.requestSubmit(); });
};
/** A click on the drawing at a point in drawing units, through the fitted 800 × 500 view. */
const clickAt = async (x: number, y: number) => {
  const { extents: [x0, y0, x1, y1] } = state.view!.info;
  const scale = Math.min(800 / (x1 - x0), 500 / (y1 - y0)) * 0.92;
  const sx = (x - (x0 + x1) / 2) * scale + 400, sy = 250 - (y - (y0 + y1) / 2) * scale;
  const c = document.querySelector('canvas.cad-over')!;
  await act(async () => {
    c.dispatchEvent(new MouseEvent('mousemove', { clientX: sx, clientY: sy, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mouseup', { clientX: sx, clientY: sy, button: 0, bubbles: true }));
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
    expect(state.layersOn[wall]).toBe(0);
    act(() => button('All on').click());
    expect(state.layersOn[wall]).toBe(1);
    act(() => button('OSNAP').click());
    expect(state.toggles.osnap).toBe(false);
    await command('grid');
    expect(state.toggles.grid).toBe(true);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F8' })); });
    expect(state.toggles.ortho).toBe(true);
    await command('xyz');
    expect(document.querySelector('.cad-hist')?.textContent).toMatch(/Unknown command "XYZ"/);
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

  it('places an ELV device and saves the drawing as DXF with the devices on their layers', async () => {
    const saveBinary = vi.fn(async () => '/plans/out.dxf');
    (window as unknown as { lvds: { files?: unknown } }).lvds.files = { saveBinary };
    act(() => root.render(<Host />));
    await flush();
    act(() => { state.setDevice('smoke-detector'); state.setTool('dev'); state.toggle('osnap'); });
    await clickAt(3000, 8000);
    expect(project.elvDevices).toEqual([expect.objectContaining({ type: 'smoke-detector', x: expect.closeTo(3, 6), y: expect.closeTo(8, 6) })]);
    await command('save');
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
    await command('save');
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
    expect(project.cadPlans).toEqual([{ building: 'V', level: 'FF', file: 'plan.dwg' }]);
    expect(plans()[1].textContent).toBe('Firstplan.dwgopen');
  });

  it('File group: sets the level and the units of the drawing, and shows the layer roles', async () => {
    act(() => root.render(<Host />));
    await flush();
    const apply = (next: Project, message: string) => onChange(next, message);
    let menu = cadFileMenu(project, state, apply, () => {});
    expect([menu.level, menu.unit, menu.plansSub]).toEqual(['Level?', 'mm', '0 of 1 levels']);
    act(() => menu.levels![0].onClick());
    expect(project.cadPlans).toEqual([{ building: 'V', level: 'GF', file: 'sample-villa-gf.dxf' }]);
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
});

