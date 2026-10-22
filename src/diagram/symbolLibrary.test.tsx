import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { placePath, Sym, SYM_BOX, SYMBOL_IDS, SYMBOLS, type SymPrim } from './symbolLibrary';
import { pathPoints } from './svgPath';
import { loadSymbolOf, SwitchSym } from './IecSymbols';

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
