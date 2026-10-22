import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { placePath, Sym, SYM_BOX, SYMBOL_IDS, SYMBOLS, type SymPrim } from './symbolLibrary';
import { pathPoints } from './svgPath';
import { FeederSwitchSym, feederSwitchOf, legendEntries, loadSymbolOf, rcdInSwitch, starterSymbolOf, SwitchSym } from './IecSymbols';
import { sldDevices } from './sldDevices';
import { ChangeoverIncomers } from './ChangeoverSym';
import type { Feeder, Project } from '../types';

const inBox = (u: number, v: number) =>
  u >= SYM_BOX.x - 0.01 && u <= SYM_BOX.x + SYM_BOX.w + 0.01 && v >= SYM_BOX.y - 0.01 && v <= SYM_BOX.y + SYM_BOX.h + 0.01;

function points(q: SymPrim): [number, number][] {
  switch (q.k) {
    case 'p': return pathPoints(q.d).flat();
    case 'c': return [[q.cx - q.r, q.cy - q.r], [q.cx + q.r, q.cy + q.r]];
    case 'e': return [[q.cx - q.rx, q.cy - q.ry], [q.cx + q.rx, q.cy + q.ry]];
    case 'r': return [[q.x, q.y], [q.x + q.w, q.y + q.h]];
    case 't': return [[q.x, q.y]];
  }
}

describe('symbol library', () => {
  it.each(SYMBOL_IDS)('%s keeps its body inside the 28 × 32 symbol box', (id) => {
    const body = (SYMBOLS[id].prims as SymPrim[]).filter((q) => !q.acc);
    expect(body.length).toBeGreaterThan(0);
    for (const q of body) for (const [u, v] of points(q)) expect(inBox(u, v), `${id} ${q.k} at ${u},${v}`).toBe(true);
  });

  it.each(SYMBOL_IDS)('%s renders without invalid numbers', (id) => {
    const svg = renderToStaticMarkup(<svg><Sym id={id} x={100} y={50} s={0.6} labels /></svg>);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('scales a path about the body centre', () => {
    const map = (u: number, v: number): [number, number] => [100 + (u - 30) * 0.5, 50 + (v - 40) * 0.5];
    expect(placePath('M30 24V28H34L26 32', map, 0.5)).toBe('M 100 42 V 44 H 102 L 98 46');
    expect(placePath('M26 28A4 4 0 0 1 34 28', map, 0.5)).toBe('M 98 44 A 2 2 0 0 1 102 44');
    expect(() => placePath('m0 0 l1 1', map, 1)).toThrow(/Unsupported/);
  });

  it('draws every symbol of a role at one size', () => {
    // Same scale → same body box for a breaker and an isolator in the 16-unit slot.
    const ys = (k: 'breaker' | 'isolator') => renderToStaticMarkup(<svg><SwitchSym x={0} y={0} kind={k} /></svg>).match(/V\s?(-?[\d.]+)/g);
    expect(ys('breaker')?.[0]).toBe(ys('isolator')?.[0]);
    const svg = renderToStaticMarkup(<svg><SwitchSym x={0} y={0} kind="breaker" /></svg>);
    expect(svg).toContain('L -5.5 3'); // blade from the pivot at y + 16 to the open tip
  });

  it('maps loads to library symbols', () => {
    expect(loadSymbolOf('fire-pump', true, true)).toBe('motor-fp');
    expect(loadSymbolOf('lighting')).toBe('lighting');
    expect(loadSymbolOf('general')).toBe('eq-l');
    expect(loadSymbolOf('hvac', true)).toBe('motor');
  });

  it('keeps side labels off the drawing unless asked', () => {
    const plain = renderToStaticMarkup(<svg><Sym id="acb" x={0} y={0} /></svg>);
    expect(plain).not.toContain('>ACB<');
    expect(renderToStaticMarkup(<svg><Sym id="acb" x={0} y={0} labels /></svg>)).toContain('>ACB<');
  });
});

describe('SLD symbol mappings', () => {
  const fd = (p: Partial<Feeder>) => ({ id: 'F1', boardId: 'DB-1', loadKw: 5, ...p }) as Feeder;

  it('draws a motor starter from Feeder.starter', () => {
    expect(starterSymbolOf('DOL')).toBe('dol');
    expect(starterSymbolOf('SD')).toBe('sd');
    expect(starterSymbolOf('SS')).toBe('ss');
    expect(starterSymbolOf('VFD')).toBe('vfd');
    expect(sldDevices(fd({ loadType: 'motor', starter: 'SS' })).starterType).toBe('SS');
    expect(sldDevices(fd({ loadType: 'motor' })).starterType).toBe('DOL');
  });

  it('puts the earth leakage protection in the switch: RCBO on a breaker, RCCB on a switch', () => {
    expect(feederSwitchOf(fd({}))).toBe('cb');
    expect(feederSwitchOf(fd({ rcdMa: 30 }))).toBe('rcbo');
    expect(feederSwitchOf(fd({ rcdMa: 30, device: 'ISOL' }))).toBe('rccb');
    expect(feederSwitchOf(fd({ device: 'ISOL' }))).toBe('isolator');
    // Remarks: a separate RCCB after the breaker, or an ELR, stay boxed beside the line.
    expect(feederSwitchOf(fd({ rcdMa: 30, remarks: 'RCCB 30mA' }))).toBe('cb');
    expect(feederSwitchOf(fd({ rcdMa: 100, remarks: 'ELR' }))).toBe('cb');
    expect(feederSwitchOf(fd({ rcdMa: 30, remarks: 'no elcb' }))).toBe('cb');
    expect(feederSwitchOf(fd({ rcdMa: 300, device: 'ACB' }))).toBe('acb');
    expect(rcdInSwitch(fd({ rcdMa: 30 }))).toBe(true);
    expect(rcdInSwitch(fd({ rcdMa: 30, device: 'ACB' }))).toBe(false);
  });

  it('draws the RCBO in the breaker slot with its toroid on the line', () => {
    const svg = renderToStaticMarkup(<svg><FeederSwitchSym x={0} y={0} f={fd({ rcdMa: 30 })} /></svg>);
    expect(svg).toContain('<ellipse cx="0" cy="19" rx="3" ry="1.5"');
  });

  it('mirrors a flipped symbol about its centre', () => {
    const up = renderToStaticMarkup(<svg><Sym id="spd" x={0} y={0} s={0.5} flip /></svg>);
    expect(up).toContain('<rect x="-4" y="-8" width="8" height="16"');
    expect(up).toContain('M -5 -10 H 5'); // earth above the body
    expect(renderToStaticMarkup(<svg><Sym id="spd" x={0} y={0} s={0.5} /></svg>)).toContain('M -5 10 H 5');
  });

  it('lists the drawn symbols in the legend', () => {
    const board = { id: 'DB-1', name: 'DB-1', pmu: true, spd: 'T2' } as Project['boards'][number];
    const project = { boards: [board], feeders: [fd({ loadType: 'motor', starter: 'VFD', rcdMa: 30, kwhMeter: 'CT' }), fd({ id: 'F2', device: 'ISOL', rcdMa: 30 })] } as unknown as Project;
    const keys = legendEntries(project).map((e) => e.key);
    expect(keys).toEqual(expect.arrayContaining(['rcbo', 'rccb', 'vfd', 'pmu', 'spd', 'ct', 'kwh']));
    expect(keys).not.toContain('dol');
    expect(keys).not.toContain('rcd');
    const legend = renderToStaticMarkup(<svg>{legendEntries(project).find((e) => e.key === 'vfd')!.draw(0, 0)}</svg>);
    expect(legend).toContain('>f1<');
  });
});

describe('changeover incomer symbols', () => {
  const brk = { ratingA: 1600, device: 'ACB' as const, drawOut: true };
  const draw = (pmu: boolean, spd?: 'T2') => renderToStaticMarkup(
    <svg><ChangeoverIncomers x={100} genX={300} headY={0} busY={300} kva={500} mains={brk} generator={brk} instruments pmu={pmu} spd={spd} /></svg>
  );

  it('draws the PMU from board.pmu as the library symbol, one per incomer', () => {
    expect(draw(false)).not.toContain('>PMU<');
    expect(draw(true).match(/>PMU</g)).toHaveLength(2);
    expect(draw(true)).toContain('<rect x="65" y="172" width="14" height="16"'); // mains PMU, centred 28 left of its line
  });

  it('hangs the library SPD below the voltmeter row', () => {
    const svg = draw(false, 'T2');
    expect(svg).toContain('<rect x="44" y="217" width="8" height="16"'); // body centred on busY − 75, 52 left of the mains line
  });
});
