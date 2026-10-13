import { describe, expect, it } from 'vitest';
import { sampleProject } from '../data/sampleProject';
import { boardSheetSvg } from '../diagram/boardSheet';
import { earthingDrawing } from '../diagram/earthingDrawing';
import { runCalculations } from '../calc/runs';
import { boardEarth, earthSheetNo } from './boardEarth';
import { earthingLayout, pitStatus, setPitTest } from './earthingPlan';

const board = (id: string) => sampleProject.boards.find((b) => b.id === id)!;
const lvPits = () => earthingLayout(sampleProject).pits.filter((p) => p.itemKey === 'lv:MDB-1').map((p) => p.id);

describe('pit test records', () => {
  it('records measured, date and tester per pit, and judges each pit against its limit', () => {
    const [a, b] = lvPits();
    let p = setPitTest(sampleProject, a, { measured: '0.7', date: '2026-10-13', by: 'A. Eng' });
    p = setPitTest(p, b, { measured: '1.4' });
    const L = earthingLayout(p);
    const pa = L.pits.find((x) => x.id === a)!, pb = L.pits.find((x) => x.id === b)!;
    expect(pa).toMatchObject({ measured: 0.7, date: '2026-10-13', by: 'A. Eng' });
    expect(pitStatus(pa)).toBe('pass');
    expect(pitStatus(pb)).toBe('fail'); // LV limit 1 Ω
    expect(pitStatus(L.pits.find((x) => x.itemKey.startsWith('rmu'))!)).toBe('untested');
  });
  it('clears a blank reading and leaves the project untouched when nothing changes', () => {
    const [a] = lvPits();
    const p = setPitTest(sampleProject, a, { measured: '0.7', by: 'X' });
    expect(setPitTest(p, a, { measured: '0.7', by: 'X' })).toBe(p);
    const cleared = setPitTest(p, a, { measured: ' ', by: '' });
    expect(cleared.earthingPlan?.measured?.[a]).toBeUndefined();
    expect(cleared.earthingPlan?.tests?.[a]).toBeUndefined();
  });
});

describe('board earth line', () => {
  it('a main board goes to its own MET and pits; untested until both pits are measured', () => {
    const e = boardEarth(sampleProject, board('MDB-1'));
    expect(e.text).toContain(`MDB-1 MET → pits ${lvPits().join(', ')}`);
    expect(e.text).toContain('not tested');
    expect(e.text).toContain(`sheet ${earthSheetNo(sampleProject)}`);
    expect(e.status).toBe('untested');
    expect(e.conductor).toBeUndefined();
  });
  it('a sub-board earths through its incomer CPC, with the CPC I²t check, and shows the group result', () => {
    const [a, b] = lvPits();
    const p = setPitTest(setPitTest(sampleProject, a, { measured: '1.6' }), b, { measured: '1.6' });
    const e = boardEarth(p, board('DB-GF1'));
    expect(e.text).toMatch(/^Via incomer CPC to SMDB-GF, then to MDB-1 MET/);
    expect(e.text).toContain('0.80 Ω ≤ 1 Ω');
    expect(e.status).toBe('pass');
    expect(e.conductor?.text).toMatch(/^CPC .* mm² Cu · I²t needs [\d.]+ mm² — (OK|CHECK|FAIL)$/);
  });
  it('the earthing sheet number follows the SLD drawing number', () => {
    expect(earthSheetNo(sampleProject)).toMatch(/-EARTH-01$/);
    expect(earthSheetNo({ ...sampleProject, drawing: { ...sampleProject.drawing, number: 'E-100' } })).toBe('E-100-EARTH-01');
  });
  it('the board sheet carries the earth path and the incomer conductor check', () => {
    const run = runCalculations(sampleProject);
    const { svg } = boardSheetSvg(run.project, run.project.boards.find((x) => x.id === 'SMDB-GF')!, run.results);
    expect(svg).toContain('EARTH CONDUCTOR');
    expect(svg).toContain('I²t needs');
  });
});

describe('printed earthing sheet', () => {
  it('is black and white, writes FAIL, and leaves a line for untested pits', () => {
    const [a] = lvPits();
    const p = setPitTest(sampleProject, a, { measured: '3', date: '2026-10-13', by: 'A. Eng' });
    const { svg } = earthingDrawing(p, earthingLayout(p), true, { mono: true });
    const colours = [...svg.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());
    expect(colours.every((c) => c === '#111111' || c === '#ffffff')).toBe(true);
    expect(svg).toContain('FAIL');
    expect(svg).toContain('2026-10-13, A. Eng');
    expect(svg).toContain('__________');
    expect(svg).toContain(`data-pit="${a}"`);
  });
  it('the screen drawing keeps its colours', () => {
    expect(earthingDrawing(sampleProject).svg).toContain('#1a7f37');
  });
});

describe('SLD earth pit detail follows the plan', () => {
  it('warns when a board overrides the plan pit count', () => {
    const p = { ...sampleProject, boards: sampleProject.boards.map((b) => (b.id === 'MDB-1' ? { ...b, earthing: { ...b.earthing, pits: 3 } } : b)) };
    expect(earthingLayout(p).checks.some((c) => c.level === 'warn' && c.text.includes('MDB-1: the SLD earth pit detail shows 3 pits'))).toBe(true);
    expect(earthingLayout(sampleProject).checks.some((c) => c.text.includes('SLD earth pit detail'))).toBe(false);
  });
});
